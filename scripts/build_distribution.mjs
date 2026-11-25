import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distributionRoot = path.join(repositoryRoot, "target", "distribution");
const packageBuildRoot = path.join(distributionRoot, "package-build");
const wasmBuildRoot = path.join(distributionRoot, "wasm");
const packageVersion = "0.1.0-alpha.0";
const tscPath = path.join(repositoryRoot, "node_modules", ".bin", "tsc");
const wasmInput = path.join(repositoryRoot, "target", "wasm32-unknown-unknown", "release", "ruseact_wasm.wasm");

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: repositoryRoot,
    stdio: "inherit",
    env: process.env,
    ...options,
  });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeTsConfig(name, rootDir, outDir, entry, paths = {}) {
  const configPath = path.join(distributionRoot, `tsconfig.${name}.json`);
  writeJson(configPath, {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      skipLibCheck: true,
      declaration: true,
      sourceMap: true,
      inlineSources: true,
      rootDir,
      outDir,
      baseUrl: repositoryRoot,
      ...(Object.keys(paths).length === 0 ? {} : { paths }),
    },
    files: [entry],
  });
  return configPath;
}

function compilePackage(name, sourceDirectory, entry, paths = {}) {
  const outDir = path.join(packageBuildRoot, name, "dist");
  const configPath = makeTsConfig(
    name,
    path.join(repositoryRoot, sourceDirectory),
    outDir,
    path.join(repositoryRoot, entry),
    paths,
  );
  run(tscPath, ["--project", configPath]);
}

function stageManifest(name) {
  const sourcePath = path.join(repositoryRoot, "packages", name, "package.json");
  const manifest = readJson(sourcePath);
  if (manifest.version !== packageVersion) {
    throw new Error(`${name}: package version must be ${packageVersion}`);
  }
  if (name === "ruseact-dom") {
    manifest.dependencies = { ...(manifest.dependencies ?? {}), ruseact: packageVersion };
  }
  writeJson(path.join(packageBuildRoot, name, "package.json"), manifest);
}

function buildWasm() {
  mkdirSync(path.join(wasmBuildRoot, "node"), { recursive: true });
  mkdirSync(path.join(wasmBuildRoot, "web"), { recursive: true });
  run("cargo", ["build", "-p", "ruseact-wasm", "--target", "wasm32-unknown-unknown", "--release", "--locked"]);
  if (!existsSync(wasmInput)) {
    throw new Error(`release WASM output is missing: ${wasmInput}`);
  }
  for (const target of ["nodejs", "web"]) {
    const outputDirectory = path.join(wasmBuildRoot, target === "nodejs" ? "node" : "web");
    run("wasm-bindgen", [
      wasmInput,
      "--target", target,
      "--out-dir", outputDirectory,
      "--out-name", "ruseact_wasm",
    ]);
  }
}

function buildPackages() {
  compilePackage("ruseact", "packages/ruseact/src", "packages/ruseact/src/index.ts");
  compilePackage(
    "ruseact-dom",
    "packages/ruseact-dom/src",
    "packages/ruseact-dom/src/index.ts",
    {
      ruseact: [path.join(packageBuildRoot, "ruseact", "dist", "index.d.ts")],
    },
  );
  compilePackage("ruseact-compiler", "packages/ruseact-compiler/src", "packages/ruseact-compiler/src/index.ts");

  for (const name of ["ruseact", "ruseact-dom", "ruseact-compiler"]) {
    stageManifest(name);
  }
  cpSync(path.join(wasmBuildRoot, "node"), path.join(packageBuildRoot, "ruseact", "wasm", "node"), { recursive: true });
  cpSync(path.join(wasmBuildRoot, "web"), path.join(packageBuildRoot, "ruseact", "wasm", "web"), { recursive: true });
  writeFileSync(path.join(packageBuildRoot, "ruseact", "wasm", "node", "package.json"), "{\n  \"type\": \"commonjs\"\n}\n");
}

rmSync(distributionRoot, { recursive: true, force: true });
mkdirSync(distributionRoot, { recursive: true });
buildWasm();
buildPackages();
console.log(`Distribution package build complete: ${packageBuildRoot}`);
