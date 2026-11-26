import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  packageArtifactFileName,
  readDistributionMetadata,
  validateArtifactIdentity,
  validatePackedPackageMetadata,
} from "./distribution_metadata.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const metadata = readDistributionMetadata(repositoryRoot);

assert.deepEqual(metadata.packageNames, ["ruseact", "ruseact-dom", "ruseact-compiler"]);
assert.equal(metadata.version, "0.1.0-alpha.1");
assert.equal(metadata.manifests["ruseact-dom"].dependencies.ruseact, "workspace:0.1.0-alpha.1");

const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "ruseact-distribution-version-"));
try {
  for (const name of metadata.packageNames) {
    const manifest = {
      name,
      version: metadata.version,
      private: true,
      ...(name === "ruseact-dom" ? { dependencies: { ruseact: `workspace:${metadata.version}` } } : {}),
    };
    const directory = path.join(fixtureRoot, "packages", name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "package.json"), `${JSON.stringify(manifest)}\n`);
  }
  assert.equal(readDistributionMetadata(fixtureRoot).version, metadata.version);

  const mismatchedPath = path.join(fixtureRoot, "packages", "ruseact-compiler", "package.json");
  writeFileSync(mismatchedPath, `${JSON.stringify({ name: "ruseact-compiler", version: "0.1.0-alpha.0", private: true })}\n`);
  assert.throws(() => readDistributionMetadata(fixtureRoot), /versions must match/);
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

const validArtifact = {
  name: "ruseact-dom",
  version: metadata.version,
  file: path.join("artifacts", packageArtifactFileName("ruseact-dom", metadata.version)),
};
validateArtifactIdentity(validArtifact, metadata);
assert.throws(
  () => validateArtifactIdentity({ ...validArtifact, file: "artifacts/ruseact-dom-0.1.0-alpha.0.tgz" }, metadata),
  /artifact filename must be/,
);
assert.throws(
  () => validateArtifactIdentity({ ...validArtifact, version: "0.1.0-alpha.0" }, metadata),
  /artifact version must be/,
);

validatePackedPackageMetadata("ruseact-dom", {
  name: "ruseact-dom",
  version: metadata.version,
  private: true,
  dependencies: { ruseact: metadata.version },
}, metadata);
assert.throws(
  () => validatePackedPackageMetadata("ruseact-dom", {
    name: "ruseact-dom",
    version: metadata.version,
    private: true,
    dependencies: { ruseact: "0.1.0-alpha.0" },
  }, metadata),
  /packed dependency must be/,
);
assert.throws(
  () => validatePackedPackageMetadata("ruseact-dom", {
    name: "ruseact-dom",
    version: metadata.version,
    private: true,
    dependencies: { ruseact: `workspace:${metadata.version}` },
  }, metadata),
  /workspace dependency escaped/,
);
assert.throws(
  () => validatePackedPackageMetadata("ruseact", {
    name: "ruseact",
    version: metadata.version,
    private: false,
  }, metadata),
  /private package status/,
);

console.log("Distribution version metadata regression tests passed");
