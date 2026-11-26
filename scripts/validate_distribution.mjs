import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  packageArtifactFileName,
  readDistributionMetadata,
  validateArtifactIdentity,
  validatePackedPackageMetadata,
} from "./distribution_metadata.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distributionRoot = path.join(repositoryRoot, "target", "distribution");
const manifestPath = path.join(distributionRoot, "distribution-manifest.json");
const distributionMetadata = readDistributionMetadata(repositoryRoot);
const { packageNames, version: packageVersion } = distributionMetadata;
const expectedPackages = new Set(packageNames);

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
  try {
    validateArtifactIdentity(artifact, distributionMetadata);
  } catch (error) {
    fail(error.message);
  }
  if (!expectedPackages.has(artifact.name)) fail(`unexpected package ${artifact.name}`);
  const filePath = path.join(distributionRoot, artifact.file);
  if (!existsSync(filePath)) fail(`${artifact.name}: artifact is missing`);
  if (statSync(filePath).size !== artifact.bytes) fail(`${artifact.name}: byte-size mismatch`);
  if (sha256(filePath) !== artifact.sha256) fail(`${artifact.name}: checksum mismatch`);
  const entries = new Set(tarEntries(filePath));
  const packageJson = tarPackageJson(filePath);
  try {
    validatePackedPackageMetadata(artifact.name, packageJson, distributionMetadata);
  } catch (error) {
    fail(error.message);
  }
  if (!entries.has("package/LICENSE")) fail(`${artifact.name}: MIT license notice is missing`);
  const packagedLicense = execFileSync("tar", ["-xOf", filePath, "package/LICENSE"], { encoding: "utf8" });
  const sourceLicense = readFileSync(path.join(repositoryRoot, "LICENSE"), "utf8");
  if (packagedLicense !== sourceLicense) fail(`${artifact.name}: packaged license notice differs from repository LICENSE`);
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
if (new Set(manifest.packages.map((entry) => entry.name)).size !== expectedPackages.size) fail("package names are not unique");
if (manifest.packages.some((entry) => entry.file !== path.posix.join("artifacts", packageArtifactFileName(entry.name, packageVersion)))) {
  fail("artifact filenames do not match the source package version");
}
if (JSON.stringify(manifest.supportedTemplateProtocols) !== JSON.stringify([1, 2, 3, 4])) fail("supported protocol range is incorrect");
console.log(`Distribution manifest validated: ${manifestPath}`);
for (const artifact of manifest.packages) console.log(`${artifact.name}@${artifact.version}: ${artifact.bytes} bytes, sha256 ${artifact.sha256}`);
