import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = process.argv[2];
if (outputDirectory === undefined) {
  throw new Error("browser source compiler requires an output directory");
}

execFileSync("corepack", [
  "pnpm", "exec", "tsc",
  "--project", path.join(repositoryRoot, "tsconfig.browser.json"),
  "--outDir", outputDirectory,
], { cwd: repositoryRoot, stdio: "inherit" });
