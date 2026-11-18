import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createReadStream, cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindingDirectory = process.env.RUSEACT_BROWSER_BINDGEN_OUT;
if (bindingDirectory === undefined) {
  throw new Error("RUSEACT_BROWSER_BINDGEN_OUT must point to --target web wasm-bindgen output");
}

const requiredBindingFiles = ["ruseact_wasm.js", "ruseact_wasm_bg.wasm"];
for (const file of requiredBindingFiles) {
  if (!existsSync(path.join(bindingDirectory, file))) {
    throw new Error(`missing browser binding output: ${path.join(bindingDirectory, file)}`);
  }
}

function findBrowser() {
  const candidates = [
    process.env.RUSEACT_BROWSER,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ].filter((candidate) => candidate !== undefined);

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (result.status === 0) {
      return { command: candidate, version: result.stdout.trim() };
    }
  }

  throw new Error(
    `no supported Chromium executable found; tried ${candidates.join(", ")}`,
  );
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".wasm")) return "application/wasm";
  if (filePath.endsWith(".d.ts")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function browserPage() {
  return String.raw`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Ruseact M2.4 browser runtime</title></head>
  <body data-status="pending">
    <p>Running Ruseact browser integration checks…</p>
    <script>
      window.__ruseactPublish = (result) => {
        document.body.dataset.status = result.ok ? "passed" : "failed";
        document.body.dataset.testResult = encodeURIComponent(JSON.stringify(result));
        document.body.textContent = result.ok
          ? "Ruseact browser integration checks passed"
          : "Ruseact browser integration checks failed";
      };
      const publishBrowserFailure = (message) => {
        if (document.body.dataset.status === "pending") {
          window.__ruseactPublish({ ok: false, checks: [], error: message });
        }
      };
      window.addEventListener("error", (event) => publishBrowserFailure(event.error?.message ?? event.message));
      window.addEventListener("unhandledrejection", (event) => publishBrowserFailure(String(event.reason)));
      window.setTimeout(() => publishBrowserFailure("browser integration watchdog expired"), 15000);
    </script>
    <script type="module">
      import initializeWasm, * as wasm from "./generated/ruseact_wasm.js";
      import { createReactiveCore } from "./runtime/index.js";

      const checks = [];

      function check(condition, name) {
        if (!condition) {
          throw new Error("check failed: " + name);
        }
        checks.push(name);
      }

      function value(result, name) {
        check(result !== null && typeof result === "object" && result.ok === true, name);
        return result.value;
      }

      function expectError(result, code, name) {
        check(result !== null && typeof result === "object" && result.ok === false, name + ": result");
        check(result.error.code === code, name + ": " + code);
      }

      function report(result) {
        window.__ruseactPublish(result);
      }

      try {
        await initializeWasm();

        const firstResult = await createReactiveCore(() => wasm);
        const first = value(firstResult, "browser WASM initializes through createReactiveCore");
        const second = value(
          await createReactiveCore(() => wasm),
          "second browser runtime instance initializes",
        );

        const booleanSignal = value(first.createSignal(true), "boolean signal creation");
        const numberSignal = value(first.createSignal(0), "number signal creation");
        const stringSignal = value(first.createSignal("ready"), "string signal creation");
        check(value(first.get(booleanSignal), "boolean read") === true, "boolean round trip");
        check(value(first.get(numberSignal), "number read") === 0, "number round trip");
        check(value(first.get(stringSignal), "string read") === "ready", "string round trip");
        check(value(first.set(numberSignal, -0), "negative zero write") === "unchanged", "positive and negative zero compare equal");
        check(value(first.set(numberSignal, 1), "changed number write") === "changed", "changed write");
        check(value(first.get(numberSignal), "changed number read") === 1, "changed value is readable");
        check(value(first.set(stringSignal, "updated"), "changed string write") === "changed", "string changed write");
        check(value(first.set(booleanSignal, true), "unchanged boolean write") === "unchanged", "unchanged write");
        expectError(first.createSignal(NaN), "unsupported_value", "NaN is rejected");
        expectError(first.createSignal(Infinity), "unsupported_value", "Infinity is rejected");
        expectError(first.createSignal(null), "unsupported_value", "null is rejected");
        expectError(first.createSignal([]), "unsupported_value", "arrays are rejected");
        expectError(first.set(booleanSignal, "wrong-type"), "type_mismatch", "signal type mismatch is rejected");

        const firstComputation = value(first.createComputation(), "first computation creation");
        const secondComputation = value(first.createComputation(), "second computation creation");
        check(value(first.subscribe(numberSignal, firstComputation), "subscribe") === true, "subscription added");
        check(value(first.subscribe(numberSignal, firstComputation), "duplicate subscribe") === false, "duplicate subscription is idempotent");
        check(value(first.unsubscribe(numberSignal, firstComputation), "unsubscribe") === true, "subscription removed");
        check(value(first.unsubscribe(numberSignal, firstComputation), "duplicate unsubscribe") === false, "duplicate unsubscription is idempotent");
        value(first.replaceDependencies(firstComputation, [numberSignal, numberSignal]), "duplicate-free dependency replacement");
        value(first.subscribe(stringSignal, secondComputation), "second subscription");
        value(first.drainPendingComputations(), "initial drain");

        const foreignSignal = value(second.createSignal("foreign"), "foreign signal creation");
        const foreignComputation = value(second.createComputation(), "foreign computation creation");
        expectError(
          first.replaceDependencies(firstComputation, [numberSignal, foreignSignal]),
          "foreign_instance",
          "atomic dependency replacement rejects foreign signals",
        );
        check(value(first.set(numberSignal, 2), "dependency preservation write") === "changed", "dependency preservation write changed");
        const preservedPending = value(first.drainPendingComputations(), "dependency preservation drain");
        check(preservedPending.length === 1 && preservedPending[0] === firstComputation, "failed replacement preserves old dependency");

        value(first.beginBatch(), "outer batch begin");
        value(first.set(numberSignal, 3), "batched number write");
        value(first.set(stringSignal, "batched"), "batched string write");
        value(first.beginBatch(), "inner batch begin");
        value(first.set(numberSignal, 4), "nested number write");
        check(value(first.drainPendingComputations(), "active batch drain").length === 0, "active batch keeps pending work gated");
        value(first.endBatch(), "inner batch end");
        check(value(first.drainPendingComputations(), "inner batch drain").length === 0, "inner batch end keeps outer work gated");
        value(first.endBatch(), "outer batch end");
        const orderedPending = value(first.drainPendingComputations(), "outer batch drain");
        check(orderedPending.length === 2, "batched work is deduplicated");
        check(orderedPending[0] === firstComputation && orderedPending[1] === secondComputation, "pending computations preserve FIFO order");
        check(value(first.set(numberSignal, 5), "post-drain write") === "changed", "post-drain update");
        const requeued = value(first.drainPendingComputations(), "post-drain pending");
        check(requeued.length === 1 && requeued[0] === firstComputation, "drained computation can be re-enqueued");

        expectError(first.get(foreignSignal), "foreign_instance", "foreign signal is rejected");
        expectError(first.subscribe(numberSignal, foreignComputation), "foreign_instance", "foreign computation is rejected");

        value(first.disposeComputation(secondComputation), "computation disposal");
        expectError(first.disposeComputation(secondComputation), "stale_handle", "disposed computation is stale");
        value(first.disposeSignal(stringSignal), "signal disposal");
        expectError(first.get(stringSignal), "stale_handle", "disposed signal is stale");
        value(first.createSignal("replacement"), "signal slot reuse");

        value(second.dispose(), "independent runtime disposal");
        expectError(second.createSignal(false), "disposed_instance", "disposed runtime rejects creation");
        expectError(second.dispose(), "disposed_instance", "double runtime disposal is rejected");

        class CorruptCore extends wasm.WasmCore {
          drain_pending_computations() {
            const original = super.drain_pending_computations();
            const corrupted = new Uint32Array(original.length + 2);
            corrupted.set(original);
            corrupted[original.length] = 0;
            corrupted[original.length + 1] = 0xffffffff;
            return corrupted;
          }
        }

        const corruptRuntime = value(
          await createReactiveCore(() => ({ WasmCore: CorruptCore })),
          "corrupt-runtime initialization",
        );
        const corruptDrain = corruptRuntime.drainPendingComputations();
        expectError(corruptDrain, "internal_invariant", "unknown pending identity fails closed");
        value(corruptRuntime.dispose(), "corrupt-runtime disposal");

        value(first.disposeSignal(booleanSignal), "boolean disposal");
        value(first.disposeSignal(numberSignal), "number disposal");
        value(first.disposeComputation(firstComputation), "first computation disposal");
        value(first.dispose(), "first runtime disposal");

        report({ ok: true, checks });
      } catch (error) {
        report({
          ok: false,
          checks,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    </script>
  </body>
</html>`;
}

const browser = findBrowser();
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "ruseact-m2.4-browser-"));
const runtimeOutput = path.join(temporaryRoot, "runtime");
const generatedOutput = path.join(temporaryRoot, "generated");
mkdirSync(runtimeOutput, { recursive: true });
cpSync(bindingDirectory, generatedOutput, { recursive: true });

let server;
const requests = [];
try {
  execFileSync(
    "corepack",
    [
      "pnpm",
      "exec",
      "tsc",
      "--target",
      "ES2022",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      "--strict",
      "--skipLibCheck",
      "--declaration",
      "false",
      "--noEmit",
      "false",
      "--rootDir",
      "packages/ruseact/src",
      "--outDir",
      runtimeOutput,
      "packages/ruseact/src/index.ts",
    ],
    { cwd: repositoryRoot, stdio: "inherit" },
  );

  writeFileSync(path.join(temporaryRoot, "index.html"), browserPage());
  server = createServer((request, response) => {
    try {
      const requestPath = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      requests.push(requestPath);
      const relativePath = decodeURIComponent(requestPath).replace(/^\/+/, "");
      const requestedFile = path.resolve(temporaryRoot, relativePath);
      const rootPrefix = temporaryRoot.endsWith(path.sep)
        ? temporaryRoot
        : temporaryRoot + path.sep;
      if (requestedFile !== temporaryRoot && !requestedFile.startsWith(rootPrefix)) {
        response.writeHead(403);
        response.end("forbidden");
        return;
      }
      if (!existsSync(requestedFile)) {
        response.writeHead(404);
        response.end("not found");
        return;
      }
      response.writeHead(200, { "content-type": contentType(requestedFile) });
      createReadStream(requestedFile).pipe(response);
    } catch (error) {
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address !== null && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/index.html`;
  const result = spawnSync(
    browser.command,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${path.join(temporaryRoot, "chromium-profile")}`,
      "--virtual-time-budget=20000",
      "--dump-dom",
      url,
    ],
    {
      encoding: "utf8",
      timeout: 60000,
      killSignal: "SIGKILL",
      maxBuffer: 4 * 1024 * 1024,
    },
  );

  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `${browser.version} failed with status ${result.status}: ${result.error?.message ?? result.stderr}\nrequests: ${requests.join(", ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  const encodedResult = result.stdout.match(/data-test-result="([^"]+)"/)?.[1];
  if (encodedResult === undefined) {
    throw new Error(`browser page did not publish a result; stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  const testResult = JSON.parse(decodeURIComponent(encodedResult));
  if (!testResult.ok) {
    throw new Error(`browser integration failed after ${testResult.checks.length} checks: ${testResult.error}`);
  }
  console.log(`${browser.version} Ruseact browser integration passed ${testResult.checks.length} checks`);
} finally {
  if (server !== undefined) {
    await new Promise((resolve) => server.close(resolve));
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
}
