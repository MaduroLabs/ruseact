import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
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

for (const file of ["ruseact_wasm.js", "ruseact_wasm_bg.wasm"]) {
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
  throw new Error(`no supported Chromium executable found; tried ${candidates.join(", ")}`);
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

function runBrowser(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 60000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({ error, signal: null, status: null, stderr, stdout });
      }
    });
    child.on("close", (status, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({
          error: timedOut ? new Error("browser process timed out") : undefined,
          signal,
          status,
          stderr,
          stdout,
        });
      }
    });
  });
}

function browserPage() {
  return String.raw`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Ruseact M3.3 reactive DOM bindings</title></head>
  <body data-status="pending">
    <p>Running Ruseact reactive DOM binding checks…</p>
    <script>
      window.__ruseactPublish = (result) => {
        document.body.dataset.status = result.ok ? "passed" : "failed";
        document.body.dataset.testResult = encodeURIComponent(JSON.stringify(result));
        document.body.textContent = result.ok
          ? "Ruseact reactive DOM binding tests passed"
          : "Ruseact reactive DOM binding tests failed";
      };
      const publishFailure = (message) => {
        if (document.body.dataset.status === "pending") {
          window.__ruseactPublish({ ok: false, checks: [], error: message });
        }
      };
      window.addEventListener("error", (event) => publishFailure(event.error?.message ?? event.message));
      window.addEventListener("unhandledrejection", (event) => publishFailure(String(event.reason)));
      window.__ruseactStage = "page-ready";
      window.setTimeout(
        () => publishFailure("reactive DOM binding watchdog expired at " + window.__ruseactStage),
        15000,
      );
    </script>
    <script type="module">
      const checks = [];
      let bindingErrorClass;
      function check(condition, name) {
        if (!condition) throw new Error("check failed: " + name);
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
      function success(value) {
        return { ok: true, value };
      }
      function expectThrow(callback, code, name) {
        try {
          callback();
        } catch (error) {
          check(error instanceof bindingErrorClass, name + ": error type");
          check(error.code === code, name + ": " + code);
          return;
        }
        throw new Error("expected " + code + ": " + name);
      }

      try {
        window.__ruseactStage = "importing-modules";
        const [{ default: initializeWasm, ...wasm }, runtimeModule, bindingsModule, hostModule] = await Promise.all([
          import("./generated/ruseact_wasm.js"),
          import("./ruseact/src/index.js"),
          import("./ruseact-dom/src/bindings.js"),
          import("./ruseact-dom/src/host.js"),
        ]);
        window.__ruseactStage = "modules-imported";
        const { createReactiveCore } = runtimeModule;
        const { createBindingContext } = bindingsModule;
        bindingErrorClass = bindingsModule.DomBindingError;
        const { createHostContext } = hostModule;
        await initializeWasm();
        window.__ruseactStage = "wasm-initialized";
        const runtime = value(await createReactiveCore(() => wasm), "real WASM runtime initializes");
        const host = createHostContext(document);
        const bindings = createBindingContext(host, runtime);
        expectThrow(
          () => createBindingContext(host, runtime),
          "runtime_in_use",
          "one binding context owns the dedicated runtime",
        );
        const container = document.createElement("main");
        const unrelated = document.createElement("aside");
        unrelated.textContent = "preserve me";
        document.body.appendChild(container);
        container.appendChild(unrelated);
        host.claimContainer(container);

        const root = host.createElement("section");
        host.appendChild(container, root);
        const count = value(runtime.createSignal(0), "count signal creation");
        const label = value(runtime.createSignal("zero"), "label signal creation");
        const disabled = value(runtime.createSignal(false), "disabled signal creation");

        const text = host.createTextNode("");
        const mirror = host.createTextNode("");
        const combined = host.createTextNode("");
        const button = host.createElement("button");
        host.appendChild(root, text);
        host.appendChild(root, mirror);
        host.appendChild(root, combined);
        host.appendChild(root, button);
        const textIdentity = text;
        let textUpdates = 0;
        let mirrorUpdates = 0;
        let combinedUpdates = 0;

        value(bindings.registerBinding({
          target: text,
          dependencies: [count],
          update: () => {
            textUpdates += 1;
            const current = runtime.get(count);
            if (!current.ok) return current;
            host.setText(text, "Count: " + current.value);
            return success(undefined);
          },
          key: "text",
        }), "initial text binding registration");
        expectError(
          bindings.registerBinding({
            target: text,
            dependencies: [count],
            update: () => success(undefined),
            key: "text",
          }),
          "duplicate_binding",
          "duplicate target binding is rejected",
        );
        value(bindings.registerBinding({
          target: mirror,
          dependencies: [count],
          update: () => {
            mirrorUpdates += 1;
            const current = runtime.get(count);
            if (!current.ok) return current;
            host.setText(mirror, "Mirror: " + current.value);
            return success(undefined);
          },
          key: "mirror",
        }), "second binding sharing a signal");
        value(bindings.registerBinding({
          target: combined,
          dependencies: [count, label],
          update: () => {
            combinedUpdates += 1;
            const currentCount = runtime.get(count);
            if (!currentCount.ok) return currentCount;
            const currentLabel = runtime.get(label);
            if (!currentLabel.ok) return currentLabel;
            host.setText(combined, currentCount.value + " / " + currentLabel.value);
            return success(undefined);
          },
          key: "combined",
        }), "multi-signal binding registration");
        value(bindings.registerBinding({
          target: button,
          dependencies: [label],
          update: () => {
            const current = runtime.get(label);
            if (!current.ok) return current;
            return success(host.setAttribute(button, "aria-label", current.value));
          },
          key: "attribute",
        }), "attribute binding registration");
        value(bindings.registerBinding({
          target: button,
          dependencies: [disabled],
          update: () => {
            const current = runtime.get(disabled);
            if (!current.ok) return current;
            return success(host.setProperty(button, "disabled", current.value));
          },
          key: "property",
        }), "property binding registration");
        check(text.nodeValue === "Count: 0", "initial text binding executes");
        check(mirror.nodeValue === "Mirror: 0", "initial shared binding executes");
        check(combined.nodeValue === "0 / zero", "initial multi-signal binding executes");
        check(button.getAttribute("aria-label") === "zero", "initial attribute binding executes");
        check(button.disabled === false, "initial property binding executes");

        const unchangedUpdates = textUpdates;
        check(value(runtime.set(count, 0), "unchanged signal write") === "unchanged", "unchanged write is reported");
        const unchangedFlush = value(bindings.flush(), "flush after unchanged write");
        check(unchangedFlush.drainedCount === 0, "unchanged write has no pending binding");
        check(textUpdates === unchangedUpdates, "unchanged write performs no DOM update");

        check(value(runtime.set(count, 1), "changed count write") === "changed", "changed count write");
        const firstFlush = value(bindings.flush(), "flush changed count");
        check(firstFlush.drainedCount === 3, "shared and multi-signal bindings drain once");
        check(text.nodeValue === "Count: 1", "changed signal updates text");
        check(mirror.nodeValue === "Mirror: 1", "changed signal updates shared binding");
        check(combined.nodeValue === "1 / zero", "multi-signal binding updates text");
        check(text === textIdentity, "text node identity remains stable");

        check(value(runtime.set(label, "one"), "changed label write") === "changed", "changed label write");
        check(value(runtime.set(disabled, true), "changed property write") === "changed", "changed property signal write");
        value(bindings.flush(), "flush attribute and property bindings");
        check(button.getAttribute("aria-label") === "one", "attribute binding updates target");
        check(button.disabled === true, "property binding updates target");

        const beforeMultipleWrites = textUpdates;
        value(runtime.set(count, 2), "first pre-flush count write");
        value(runtime.set(count, 3), "second pre-flush count write");
        value(runtime.set(label, "three"), "pre-flush label write");
        value(bindings.flush(), "flush multiple writes");
        check(textUpdates === beforeMultipleWrites + 1, "multiple writes coalesce one binding execution");
        check(text.nodeValue === "Count: 3", "latest pre-flush value is rendered");
        check(combined.nodeValue === "3 / three", "multi-signal binding sees latest values");

        value(runtime.beginBatch(), "outer batch begin");
        value(runtime.set(count, 4), "batched count write");
        value(runtime.beginBatch(), "inner batch begin");
        value(runtime.set(count, 5), "nested batched count write");
        check(value(bindings.flush(), "flush during active batch").drainedCount === 0, "active batch gates binding drain");
        value(runtime.endBatch(), "inner batch end");
        check(value(bindings.flush(), "flush after inner batch").drainedCount === 0, "outer batch keeps work gated");
        value(runtime.endBatch(), "outer batch end");
        check(value(bindings.flush(), "flush after outer batch").drainedCount === 3, "outer batch releases deduplicated work");
        check(text.nodeValue === "Count: 5", "batched latest value is rendered");
        check(value(bindings.flush(), "repeated empty flush").drainedCount === 0, "empty flush is deterministic");

        const orderA = host.createTextNode("");
        const orderB = host.createTextNode("");
        host.appendChild(root, orderA);
        host.appendChild(root, orderB);
        const orderLog = [];
        value(bindings.registerBinding({
          target: orderA,
          dependencies: [count],
          update: () => {
            orderLog.push("A");
            return success(host.setText(orderA, "A" + value(runtime.get(count), "order A read")));
          },
          key: "order-a",
        }), "first FIFO binding registration");
        value(bindings.registerBinding({
          target: orderB,
          dependencies: [count],
          update: () => {
            orderLog.push("B");
            return success(host.setText(orderB, "B" + value(runtime.get(count), "order B read")));
          },
          key: "order-b",
        }), "second FIFO binding registration");
        orderLog.length = 0;
        value(runtime.set(count, 6), "FIFO signal write");
        value(bindings.flush(), "FIFO flush");
        check(orderLog.join("") === "AB", "pending bindings execute in FIFO order");

        const trigger = value(runtime.createSignal(0), "trigger signal creation");
        const written = value(runtime.createSignal("initial"), "write-during-flush signal creation");
        const writerNode = host.createTextNode("");
        const writtenNode = host.createTextNode("");
        host.appendChild(root, writerNode);
        host.appendChild(root, writtenNode);
        let writerRuns = 0;
        let writtenRuns = 0;
        value(bindings.registerBinding({
          target: writerNode,
          dependencies: [trigger],
          update: () => {
            writerRuns += 1;
            const current = runtime.get(trigger);
            if (!current.ok) return current;
            host.setText(writerNode, "trigger " + current.value);
            if (current.value === 0) return success(undefined);
            const write = runtime.set(written, "derived " + current.value);
            return write.ok ? success(undefined) : write;
          },
          key: "writer",
        }), "write-during-flush binding registration");
        value(bindings.registerBinding({
          target: writtenNode,
          dependencies: [written],
          update: () => {
            writtenRuns += 1;
            const current = runtime.get(written);
            if (!current.ok) return current;
            return success(host.setText(writtenNode, current.value));
          },
          key: "written",
        }), "written-signal binding registration");
        value(runtime.set(trigger, 1), "write-during-flush trigger");
        check(value(bindings.flush(), "write-during-flush first pass").executedCount === 1, "flush uses one pending snapshot");
        check(writerRuns === 2 && writtenRuns === 1, "write-during-flush executes only the current snapshot");
        check(writtenNode.nodeValue === "initial", "later pending binding waits for next flush");
        value(bindings.flush(), "write-during-flush second pass");
        check(writtenNode.nodeValue === "derived 1", "later pending binding runs on next flush");

        let reentrantResult;
        const reentrantSignal = value(runtime.createSignal(0), "reentrant signal creation");
        const reentrantNode = host.createTextNode("");
        host.appendChild(root, reentrantNode);
        let checkReentrant = false;
        value(bindings.registerBinding({
          target: reentrantNode,
          dependencies: [reentrantSignal],
          update: () => {
            const current = runtime.get(reentrantSignal);
            if (!current.ok) return current;
            if (checkReentrant) reentrantResult = bindings.flush();
            return success(host.setText(reentrantNode, "reentrant " + current.value));
          },
          key: "reentrant",
        }), "reentrant binding registration");
        checkReentrant = true;
        value(runtime.set(reentrantSignal, 1), "reentrant signal write");
        value(bindings.flush(), "outer reentrant flush");
        checkReentrant = false;
        expectError(reentrantResult, "reentrant_flush", "reentrant flush is rejected");

        const failedSignal = value(runtime.createSignal(0), "failed-registration signal creation");
        const failedNode = host.createTextNode("");
        host.appendChild(root, failedNode);
        const failed = bindings.registerBinding({
          target: failedNode,
          dependencies: [failedSignal],
          update: () => ({
            ok: false,
            error: { kind: "operational", code: "intentional_failure", operation: "test_initial_update" },
          }),
          key: "failed-initial",
        });
        expectError(failed, "intentional_failure", "failed initial registration is reported");
        value(runtime.set(failedSignal, 1), "failed-registration signal write");
        check(value(bindings.flush(), "failed-registration cleanup flush").drainedCount === 0, "failed registration leaves no subscription");

        const disposableSignal = value(runtime.createSignal(0), "disposable signal creation");
        const disposableNode = host.createTextNode("");
        host.appendChild(root, disposableNode);
        const disposable = value(bindings.registerBinding({
          target: disposableNode,
          dependencies: [disposableSignal],
          update: () => {
            const current = runtime.get(disposableSignal);
            if (!current.ok) return current;
            return success(host.setText(disposableNode, "disposable " + current.value));
          },
          key: "disposable",
        }), "disposable binding registration");
        value(runtime.set(disposableSignal, 1), "pending disposable write");
        value(bindings.disposeBinding(disposable), "binding disposal");
        expectError(bindings.disposeBinding(disposable), "invalid_binding", "disposed binding rejects reuse");
        check(value(bindings.flush(), "pending disposed binding flush").drainedCount === 0, "disposed pending binding is removed");

        const detachedSignal = value(runtime.createSignal(0), "detached signal creation");
        const detachedNode = host.createTextNode("");
        host.appendChild(root, detachedNode);
        value(bindings.registerBinding({
          target: detachedNode,
          dependencies: [detachedSignal],
          update: () => {
            const current = runtime.get(detachedSignal);
            if (!current.ok) return current;
            return success(host.setText(detachedNode, "detached " + current.value));
          },
          key: "detached",
        }), "detached binding registration");
        root.removeChild(detachedNode);
        value(runtime.set(detachedSignal, 1), "detached signal write");
        expectError(bindings.flush(), "detached_node", "detached target fails closed");
        check(detachedNode.nodeValue === "", "detached target is not mutated");

        const foreignRuntime = value(await createReactiveCore(() => wasm), "foreign runtime initializes");
        const foreignSignal = value(foreignRuntime.createSignal(0), "foreign signal creation");
        const foreignNode = host.createTextNode("");
        host.appendChild(root, foreignNode);
        expectError(
          bindings.registerBinding({
            target: foreignNode,
            dependencies: [foreignSignal],
            update: () => success(undefined),
            key: "foreign",
          }),
          "foreign_instance",
          "foreign dependency is rejected",
        );
        value(foreignRuntime.dispose(), "foreign runtime disposal");

        const externalSignal = value(runtime.createSignal(0), "external signal creation");
        const externalComputation = value(runtime.createComputation(), "external computation creation");
        value(runtime.subscribe(externalSignal, externalComputation), "external subscription");
        value(runtime.set(externalSignal, 1), "external pending write");
        expectError(bindings.flush(), "unknown_pending_binding", "unknown pending computation fails closed");
        value(runtime.disposeComputation(externalComputation), "external computation cleanup");
        value(runtime.disposeSignal(externalSignal), "external signal cleanup");

        value(bindings.dispose(), "binding context disposal");
        expectError(bindings.flush(), "disposed_binding_context", "disposed context rejects flush");
        check(runtime.get(count).ok === true, "borrowed runtime remains live after context disposal");
        check(container.contains(unrelated), "binding context does not remove unrelated DOM");
        check(host.setText(text, "host remains usable"), "host remains borrowed after binding disposal");

        const repeatContext = createBindingContext(host, runtime);
        const repeatNode = host.createTextNode("");
        host.appendChild(root, repeatNode);
        value(repeatContext.registerBinding({
          target: repeatNode,
          dependencies: [count],
          update: () => {
            const current = runtime.get(count);
            if (!current.ok) return current;
            return success(host.setText(repeatNode, "repeat " + current.value));
          },
          key: "repeat",
        }), "repeated context registration");
        value(repeatContext.dispose(), "repeated context disposal");
        value(runtime.dispose(), "borrowed runtime final disposal");
        host.dispose();

        report({ ok: true, checks });
      } catch (error) {
        window.__ruseactPublish({
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
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "ruseact-m3.3-browser-"));
const compiledRoot = path.join(temporaryRoot, "compiled");
const generatedRoot = path.join(temporaryRoot, "generated");
mkdirSync(compiledRoot, { recursive: true });
cpSync(bindingDirectory, generatedRoot, { recursive: true });
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
      "packages",
      "--outDir",
      compiledRoot,
      "packages/ruseact/src/index.ts",
      "packages/ruseact-dom/src/host.ts",
      "packages/ruseact-dom/src/bindings.ts",
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
      const rootPrefix = temporaryRoot.endsWith(path.sep) ? temporaryRoot : `${temporaryRoot}${path.sep}`;
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
  const result = await runBrowser(browser.command, [
    "--headless=new",
    "--no-sandbox",
    "--no-proxy-server",
    "--proxy-bypass-list=<-loopback>",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${path.join(temporaryRoot, "chromium-profile")}`,
    "--virtual-time-budget=20000",
    "--dump-dom",
    url,
  ]);

  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `${browser.version} failed with status ${result.status} and signal ${result.signal}: ${result.error?.message ?? result.stderr}\nrequests: ${requests.join(", ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  const encodedResult = result.stdout.match(/data-test-result="([^"]+)"/)?.[1];
  if (encodedResult === undefined) {
    throw new Error(`binding page did not publish a result; stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  const testResult = JSON.parse(decodeURIComponent(encodedResult));
  if (!testResult.ok) {
    throw new Error(`reactive DOM binding tests failed after ${testResult.checks.length} checks: ${testResult.error}`);
  }
  console.log(`${browser.version} Ruseact reactive DOM binding tests passed ${testResult.checks.length} checks`);
} finally {
  if (server !== undefined) {
    await new Promise((resolve) => server.close(resolve));
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
}
