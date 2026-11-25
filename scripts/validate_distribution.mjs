import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distributionRoot = path.join(repositoryRoot, "target", "distribution");
const manifestPath = path.join(distributionRoot, "distribution-manifest.json");
const packageVersion = "0.1.0-alpha.0";
const expectedPackages = new Set(["ruseact", "ruseact-dom", "ruseact-compiler"]);

function fail(message) { throw new Error(`distribution validation failed: ${message}`); }
function sha256(filePath) { return createHash("sha256").update(readFileSync(filePath)).digest("hex"); }
function tarEntries(filePath) { return execFileSync("tar", ["-tzf", filePath], { encoding: "utf8" }).trim().split("\n").filter(Boolean); }
function tarPackageJson(filePath) {
  return JSON.parse(execFileSync("tar", ["-xOf", filePath, "package/package.json"], { encoding: "utf8" }));
}

if (!existsSync(manifestPath)) fail(`manifest is missing: ${manifestPath}`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.schemaVersion !== 1) fail("unsupported manifest schema");
if (manifest.packageVersion !== packageVersion) fail("manifest package version mismatch");
if (manifest.sourceTree?.status === "clean" && manifest.sourceTree.changedPaths?.length !== 0) fail("clean source tree has changed paths");
if (manifest.sourceTree?.status === "dirty" && !Array.isArray(manifest.sourceTree.changedPaths)) fail("dirty source tree lacks changed paths");
if (!Array.isArray(manifest.packages) || manifest.packages.length !== expectedPackages.size) fail("package manifest count mismatch");

for (const artifact of manifest.packages) {
  if (!expectedPackages.has(artifact.name)) fail(`unexpected package ${artifact.name}`);
  if (artifact.version !== packageVersion) fail(`${artifact.name}: version mismatch`);
  const filePath = path.join(distributionRoot, artifact.file);
  if (!existsSync(filePath)) fail(`${artifact.name}: artifact is missing`);
  if (statSync(filePath).size !== artifact.bytes) fail(`${artifact.name}: byte-size mismatch`);
  if (sha256(filePath) !== artifact.sha256) fail(`${artifact.name}: checksum mismatch`);
  const entries = new Set(tarEntries(filePath));
  const packageJson = tarPackageJson(filePath);
  if (packageJson.name !== artifact.name || packageJson.version !== packageVersion) fail(`${artifact.name}: packed metadata mismatch`);
  if (packageJson.private !== true) fail(`${artifact.name}: private package status was not preserved`);
  if ([...JSON.stringify(packageJson).matchAll(/workspace:/g)].length > 0) fail(`${artifact.name}: workspace dependency escaped into tarball`);
  if (entries.has("package/node_modules/") || [...entries].some((entry) => entry.includes("node_modules/"))) fail(`${artifact.name}: node_modules included in tarball`);
  if (!entries.has("package/dist/index.js") || !entries.has("package/dist/index.d.ts")) fail(`${artifact.name}: executable or declaration entry is missing`);
  if (![...entries].some((entry) => entry.endsWith(".js.map"))) fail(`${artifact.name}: JavaScript source map is missing`);
  if (artifact.name === "ruseact") {
    for (const target of ["node", "web"]) {
      for (const suffix of ["ruseact_wasm.js", "ruseact_wasm.d.ts", "ruseact_wasm_bg.wasm"]) {
        if (!entries.has(`package/wasm/${target}/${suffix}`)) fail(`ruseact: missing ${target} WASM asset ${suffix}`);
      }
    }
    const nodePackageJson = JSON.parse(execFileSync("tar", ["-xOf", filePath, "package/wasm/node/package.json"], { encoding: "utf8" }));
    if (nodePackageJson.type !== "commonjs") fail("ruseact: Node WASM glue needs its CommonJS package boundary");
  }
  const packageRoot = path.join(distributionRoot, "package-build", artifact.name);
  const sourceFiles = execFileSync("find", [packageRoot, "-type", "f", "-name", "*.js"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  for (const sourceFile of sourceFiles) {
    const text = readFileSync(sourceFile, "utf8");
    if (text.includes("/data/home/") || text.includes("../../ruseact/src/") || text.includes("../../ruseact-dom/src/")) {
      fail(`${artifact.name}: non-distributable source import or absolute path in ${sourceFile}`);
    }
  }
}

if (manifest.packages.map((entry) => entry.version).some((version) => version !== packageVersion)) fail("package versions are not synchronized");
if (JSON.stringify(manifest.supportedTemplateProtocols) !== JSON.stringify([1, 2, 3, 4])) fail("supported protocol range is incorrect");
console.log(`Distribution manifest validated: ${manifestPath}`);
for (const artifact of manifest.packages) console.log(`${artifact.name}@${artifact.version}: ${artifact.bytes} bytes, sha256 ${artifact.sha256}`);
