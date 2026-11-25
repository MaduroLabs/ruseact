import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distributionRoot = path.join(repositoryRoot, "target", "distribution");
const packageBuildRoot = path.join(distributionRoot, "package-build");
const artifactRoot = path.join(distributionRoot, "artifacts");
const manifestPath = path.join(distributionRoot, "distribution-manifest.json");
const packageVersion = "0.1.0-alpha.0";
const packageNames = ["ruseact", "ruseact-dom", "ruseact-compiler"];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "inherit"],
    env: process.env,
    ...options,
  });
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function directoryBytes(directory) {
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    total += entry.isDirectory() ? directoryBytes(entryPath) : statSync(entryPath).size;
  }
  return total;
}

function fileStats(directory) {
  const stats = { javascriptBytes: 0, wasmBytes: 0, declarationBytes: 0, sourceMapBytes: 0 };
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }
      const size = statSync(entryPath).size;
      if (entry.name.endsWith(".js")) stats.javascriptBytes += size;
      if (entry.name.endsWith(".wasm")) stats.wasmBytes += size;
      if (entry.name.endsWith(".d.ts")) stats.declarationBytes += size;
      if (entry.name.endsWith(".map")) stats.sourceMapBytes += size;
    }
  }
  walk(directory);
  return stats;
}

function gitOutput(args) {
  return run("git", args).trim();
}

function gitStatusOutput() {
  return run("git", ["status", "--short", "--untracked-files=all"]).trimEnd();
}

if (!existsSync(packageBuildRoot)) {
  throw new Error(`package build is missing; run pnpm build:distribution first: ${packageBuildRoot}`);
}
mkdirSync(artifactRoot, { recursive: true });
for (const name of packageNames) {
  const packageDirectory = path.join(packageBuildRoot, name);
  if (!existsSync(path.join(packageDirectory, "package.json"))) throw new Error(`${name}: staged package.json is missing`);
  run("corepack", ["pnpm", "pack", "--pack-destination", artifactRoot], { cwd: packageDirectory });
}

const packages = packageNames.map((name) => {
  const fileName = `${name}-${packageVersion}.tgz`;
  const filePath = path.join(artifactRoot, fileName);
  if (!existsSync(filePath)) throw new Error(`missing packed artifact: ${fileName}`);
  const packageDirectory = path.join(packageBuildRoot, name);
  return {
    name,
    version: packageVersion,
    file: path.relative(distributionRoot, filePath),
    bytes: statSync(filePath).size,
    sha256: sha256(filePath),
    unpackedBytes: directoryBytes(packageDirectory),
    contents: fileStats(packageDirectory),
  };
});

const dirtyPaths = gitStatusOutput()
  .split("\n")
  .map((line) => line.slice(3))
  .filter(Boolean);
const manifest = {
  schemaVersion: 1,
  repository: "MaduroLabs/ruseact",
  sourceCommit: gitOutput(["rev-parse", "HEAD"]),
  sourceTree: {
    status: dirtyPaths.length === 0 ? "clean" : "dirty",
    changedPaths: dirtyPaths,
    note: dirtyPaths.length === 0
      ? "Generated from a clean source tree."
      : "Generated from a dirty source tree; the commit identifies the base revision only.",
  },
  packageVersion,
  supportedTemplateProtocols: [1, 2, 3, 4],
  toolchain: {
    node: process.version,
    os: `${os.platform()} ${os.arch()}`,
    pnpm: run("corepack", ["pnpm", "--version"]).trim(),
    rust: run("rustc", ["--version"]).trim(),
    cargo: run("cargo", ["--version"]).trim(),
    typescript: readFileSync(path.join(repositoryRoot, "node_modules", "typescript", "package.json"), "utf8")
      .match(/"version"\s*:\s*"([^"]+)"/)?.[1] ?? "unknown",
    wasmBindgen: run("wasm-bindgen", ["--version"]).trim(),
    wasmTarget: "wasm32-unknown-unknown",
  },
  wasm: {
    package: "ruseact",
    targets: ["nodejs", "web"],
    loaderSubpaths: ["ruseact/wasm/node", "ruseact/wasm/web"],
  },
  packages,
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Packed ${packages.length} packages.`);
console.log(`Manifest: ${manifestPath}`);
for (const artifact of packages) console.log(`${artifact.name}: ${artifact.file} (${artifact.bytes} bytes, sha256 ${artifact.sha256})`);
