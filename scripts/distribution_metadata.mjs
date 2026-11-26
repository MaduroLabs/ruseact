import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const distributionPackageNames = ["ruseact", "ruseact-dom", "ruseact-compiler"];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function readDistributionMetadata(repositoryRoot) {
  const manifests = Object.fromEntries(distributionPackageNames.map((name) => {
    const filePath = path.join(repositoryRoot, "packages", name, "package.json");
    if (!existsSync(filePath)) throw new Error(`missing source package manifest: ${filePath}`);
    return [name, readJson(filePath)];
  }));

  for (const name of distributionPackageNames) {
    if (manifests[name].name !== name) {
      throw new Error(`${name}: source package name must be ${name}`);
    }
  }

  const versions = new Set(distributionPackageNames.map((name) => manifests[name].version));
  if (versions.size !== 1) {
    throw new Error(`distribution package versions must match: ${[...versions].join(", ")}`);
  }
  const version = manifests.ruseact.version;
  const expectedWorkspaceDependency = `workspace:${version}`;
  if (manifests["ruseact-dom"].dependencies?.ruseact !== expectedWorkspaceDependency) {
    throw new Error(`ruseact-dom: dependency must be ${expectedWorkspaceDependency}`);
  }

  return { packageNames: distributionPackageNames, manifests, version };
}

export function packageArtifactFileName(name, version) {
  return `${name}-${version}.tgz`;
}

export function validateArtifactIdentity(artifact, metadata) {
  if (!metadata.packageNames.includes(artifact.name)) {
    throw new Error(`unexpected package ${artifact.name}`);
  }
  if (artifact.version !== metadata.version) {
    throw new Error(`${artifact.name}: artifact version must be ${metadata.version}`);
  }
  const expectedFile = packageArtifactFileName(artifact.name, metadata.version);
  if (path.basename(artifact.file) !== expectedFile) {
    throw new Error(`${artifact.name}: artifact filename must be ${expectedFile}`);
  }
}

export function validatePackedPackageMetadata(name, packageJson, metadata) {
  if (!metadata.packageNames.includes(name)) throw new Error(`unexpected package ${name}`);
  if (packageJson.name !== name) throw new Error(`${name}: packed package name mismatch`);
  if (packageJson.version !== metadata.version) throw new Error(`${name}: packed package version mismatch`);
  if (packageJson.private !== true) throw new Error(`${name}: private package status was not preserved`);
  if (JSON.stringify(packageJson).includes("workspace:")) {
    throw new Error(`${name}: workspace dependency escaped into tarball`);
  }
  if (name === "ruseact-dom" && packageJson.dependencies?.ruseact !== metadata.version) {
    throw new Error(`ruseact-dom: packed dependency must be ruseact@${metadata.version}`);
  }
}
