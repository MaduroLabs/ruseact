import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createReadStream, cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    if (result.status === 0) return { command: candidate, version: result.stdout.trim() };
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
  <head><meta charset="utf-8"><title>Ruseact M3.5 end-to-end DOM checks</title></head>
  <body data-status="pending">
    <p>Running Ruseact end-to-end DOM checks…</p>
    <script>
      window.__ruseactPublish = (result) => {
        document.body.dataset.status = result.ok ? "passed" : "failed";
        document.body.dataset.testResult = encodeURIComponent(JSON.stringify(result));
        document.body.textContent = result.ok
          ? "Ruseact end-to-end DOM checks passed"
          : "Ruseact end-to-end DOM checks failed";
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
        () => publishFailure("end-to-end DOM watchdog expired at " + window.__ruseactStage),
        20000,
      );
    </script>
    <script type="module">
      const checks = [];
      function check(condition, name) {
        if (!condition) throw new Error("check failed: " + name);
        checks.push(name);
      }
      function success(value) {
        return { ok: true, value };
      }
      function failure(code, operation, resource, message) {
        return { ok: false, error: { kind: "internal", code, operation, resource, message } };
      }
      function value(result, name) {
        check(result !== null && typeof result === "object" && result.ok === true, name);
        return result.value;
      }
      function expectError(result, code, name) {
        check(result !== null && typeof result === "object" && result.ok === false, name + ": result");
        check(result.error.code === code, name + ": " + code);
      }
      function expectThrow(callback, code, name) {
        try {
          callback();
        } catch (error) {
          check(error?.code === code, name + ": " + code);
          return;
        }
        throw new Error("expected " + code + ": " + name);
      }
      function read(runtime, signal, name) {
        return value(runtime.get(signal), name);
      }

      try {
        window.__ruseactStage = "importing-modules";
        const [{ default: initializeWasm, ...wasm }, runtimeModule, rootModule, hostModule] = await Promise.all([
          import("./generated/ruseact_wasm.js"),
          import("./ruseact/src/index.js"),
          import("./ruseact-dom/src/root.js"),
          import("./ruseact-dom/src/host.js"),
        ]);
        window.__ruseactStage = "modules-imported";
        const { createReactiveCore } = runtimeModule;
        const { createRootContext } = rootModule;
        const { createHostContext } = hostModule;
        await initializeWasm();
        window.__ruseactStage = "wasm-initialized";

        const runtime = value(await createReactiveCore(() => wasm), "real ReactiveCore initializes");
        const count = value(runtime.createSignal(0), "count signal creation");
        const label = value(runtime.createSignal("zero"), "label signal creation");
        const disabled = value(runtime.createSignal(false), "disabled signal creation");
        const orderSignal = value(runtime.createSignal(0), "FIFO signal creation");
        const deferredTrigger = value(runtime.createSignal(0), "deferred trigger creation");
        const deferredValue = value(runtime.createSignal(0), "deferred value creation");

        const container = document.createElement("main");
        const unrelated = document.createElement("aside");
        unrelated.textContent = "preserve me";
        container.appendChild(unrelated);
        document.body.appendChild(container);
        const root = value(createRootContext(container, runtime), "root creation");
        check(root.state === "created", "root starts created");

        let section;
        let text;
        let mirror;
        let button;
        let input;
        let orderA;
        let orderB;
        let deferredNode;
        let deferredValueNode;
        let clickCount = 0;
        let textUpdates = 0;
        let mirrorUpdates = 0;
        let deferredWrite = false;
        let reentrantResult;
        let checkReentrant = false;
        const setupResult = root.mount((scope) => {
          section = scope.createElement("section");
          text = scope.createTextNode("");
          mirror = scope.createTextNode("");
          orderA = scope.createTextNode("");
          orderB = scope.createTextNode("");
          deferredNode = scope.createTextNode("");
          deferredValueNode = scope.createTextNode("");
          button = scope.createElement("button");
          input = scope.createElement("input");
          scope.appendChild(button, scope.createTextNode("increment"));
          scope.appendChild(section, text);
          scope.appendChild(section, mirror);
          scope.appendChild(section, orderA);
          scope.appendChild(section, orderB);
          scope.appendChild(section, deferredNode);
          scope.appendChild(section, deferredValueNode);
          scope.appendChild(section, button);
          scope.appendChild(section, input);
          scope.addEventListener(button, "click", () => {
            clickCount += 1;
            const current = runtime.get(count);
            if (current.ok) runtime.set(count, current.value + 1);
          });

          const countBinding = scope.registerBinding({
            target: text,
            dependencies: [count],
            key: "count",
            update: () => {
              textUpdates += 1;
              return value(runtime.get(count), "count read during update") === undefined
                ? failure("update_failed", "count_update", "binding", "count read failed")
                : success(scope.setText(text, "Count: " + read(runtime, count, "count value")));
            },
          });
          if (!countBinding.ok) return countBinding;
          const mirrorBinding = scope.registerBinding({
            target: mirror,
            dependencies: [count],
            key: "mirror",
            update: () => {
              mirrorUpdates += 1;
              return success(scope.setText(mirror, "Mirror: " + read(runtime, count, "mirror value")));
            },
          });
          if (!mirrorBinding.ok) return mirrorBinding;
          const labelBinding = scope.registerBinding({
            target: button,
            dependencies: [label],
            key: "label",
            update: () => success(scope.setAttribute(button, "aria-label", read(runtime, label, "label value"))),
          });
          if (!labelBinding.ok) return labelBinding;
          const propertyBinding = scope.registerBinding({
            target: input,
            dependencies: [disabled],
            key: "disabled",
            update: () => success(scope.setProperty(input, "disabled", read(runtime, disabled, "disabled value"))),
          });
          if (!propertyBinding.ok) return propertyBinding;
          const fifoA = scope.registerBinding({
            target: orderA,
            dependencies: [orderSignal],
            key: "fifo-a",
            update: () => success(scope.setText(orderA, "A" + read(runtime, orderSignal, "FIFO A value"))),
          });
          if (!fifoA.ok) return fifoA;
          const fifoB = scope.registerBinding({
            target: orderB,
            dependencies: [orderSignal],
            key: "fifo-b",
            update: () => success(scope.setText(orderB, "B" + read(runtime, orderSignal, "FIFO B value"))),
          });
          if (!fifoB.ok) return fifoB;
          const deferredBinding = scope.registerBinding({
            target: deferredNode,
            dependencies: [deferredTrigger],
            key: "deferred",
            update: () => {
              const trigger = read(runtime, deferredTrigger, "deferred trigger value");
              if (trigger === 1 && !deferredWrite) {
                deferredWrite = true;
                const changed = runtime.set(deferredValue, 7);
                if (!changed.ok) return changed;
              }
              return success(scope.setText(deferredNode, "Deferred trigger: " + trigger));
            },
          });
          if (!deferredBinding.ok) return deferredBinding;
          const deferredValueBinding = scope.registerBinding({
            target: deferredValueNode,
            dependencies: [deferredValue],
            key: "deferred-value",
            update: () => success(scope.setText(deferredValueNode, "Deferred value: " + read(runtime, deferredValue, "deferred value display"))),
          });
          if (!deferredValueBinding.ok) return deferredValueBinding;
          const reentrantBinding = scope.registerBinding({
            target: text,
            dependencies: [deferredTrigger],
            key: "reentrant",
            update: () => {
              if (checkReentrant) reentrantResult = root.flush();
              return success(undefined);
            },
          });
          if (!reentrantBinding.ok) return reentrantBinding;
          scope.appendChild(scope.container, section);
          return success(undefined);
        });
        value(setupResult, "initial mount executes through real root and bindings");
        check(root.state === "mounted", "root becomes mounted");
        check(container.contains(section), "mounted section is in the container");
        check(text.nodeValue === "Count: 0", "initial count text");
        check(mirror.nodeValue === "Mirror: 0", "initial shared binding text");
        check(button.getAttribute("aria-label") === "zero", "initial attribute binding");
        check(input.disabled === false, "initial property binding");
        check(textUpdates === 1 && mirrorUpdates === 1, "initial bindings execute once");

        const sectionIdentity = section;
        const textIdentity = text;
        check(value(runtime.set(count, 1), "changed count write") === "changed", "changed signal state");
        check(text.nodeValue === "Count: 0", "DOM waits for explicit flush");
        const firstFlush = value(root.flush(), "first explicit flush");
        check(firstFlush.drainedCount === 2, "shared signal has two pending bindings");
        check(text.nodeValue === "Count: 1" && mirror.nodeValue === "Mirror: 1", "flush updates shared bindings");
        check(text === textIdentity && section === sectionIdentity, "flush preserves DOM identity");

        const unchangedUpdates = textUpdates;
        check(value(runtime.set(count, 1), "unchanged count write") === "unchanged", "unchanged write result");
        check(value(root.flush(), "unchanged flush").drainedCount === 0, "unchanged write has no pending work");
        check(textUpdates === unchangedUpdates, "unchanged write avoids binding execution");

        value(runtime.set(count, 2), "first repeated count write");
        value(runtime.set(count, 3), "second repeated count write");
        check(value(root.flush(), "deduplicated repeated writes").drainedCount === 2, "repeated writes deduplicate per binding");
        check(text.nodeValue === "Count: 3", "latest repeated value wins");

        value(runtime.beginBatch(), "outer batch begin");
        value(runtime.set(count, 4), "batched count write");
        value(runtime.beginBatch(), "nested batch begin");
        value(runtime.set(label, "four"), "nested label write");
        check(value(root.flush(), "flush in nested batch").drainedCount === 0, "nested batch gates pending work");
        value(runtime.endBatch(), "nested batch end");
        value(runtime.endBatch(), "outer batch end");
        check(value(root.flush(), "flush after nested batch").drainedCount === 3, "batch releases deduplicated bindings");
        check(text.nodeValue === "Count: 4" && button.getAttribute("aria-label") === "four", "batch applies latest values");

        const orderLog = [];
        value(runtime.set(orderSignal, 1), "FIFO signal update");
        const fifoFlush = value(root.flush(), "FIFO flush");
        check(fifoFlush.drainedCount === 2, "FIFO drains both bindings");
        check(orderA.nodeValue === "A1" && orderB.nodeValue === "B1", "FIFO bindings update deterministically");
        orderLog.push(orderA.nodeValue[0], orderB.nodeValue[0]);
        check(orderLog.join("") === "AB", "FIFO DOM order is stable");

        value(runtime.set(deferredTrigger, 1), "deferred write trigger");
        const deferredFirst = value(root.flush(), "deferred first flush");
        check(deferredFirst.drainedCount === 2, "deferred trigger snapshot executes once");
        check(read(runtime, deferredValue, "deferred signal after first flush") === 7, "binding can write a signal");
        check(deferredNode.nodeValue === "Deferred trigger: 1", "first flush does not recursively drain");
        check(value(root.flush(), "deferred second flush").drainedCount === 1, "deferred write executes later");
        check(deferredValueNode.nodeValue === "Deferred value: 7", "second flush applies deferred value");

        checkReentrant = true;
        value(runtime.set(deferredTrigger, 2), "reentrant trigger write");
        value(root.flush(), "reentrant binding flush");
        check(reentrantResult?.ok === false && reentrantResult.error.code === "reentrant_flush", "reentrant flush is rejected");
        checkReentrant = false;

        button.dispatchEvent(new Event("click"));
        check(clickCount === 1, "native event reaches binding root");
        check(text.nodeValue === "Count: 4", "event does not implicitly flush DOM");
        value(root.flush(), "event update flush");
        check(text.nodeValue === "Count: 5", "event signal reaches DOM after flush");
        value(runtime.set(disabled, true), "disabled property write");
        value(root.flush(), "property binding flush");
        check(input.disabled === true, "supported property updates natively");

        const beforeUnmountClicks = clickCount;
        value(root.unmount(), "successful unmount");
        check(root.state === "unmounted", "root enters unmounted state");
        check(!container.contains(section), "owned subtree is removed on unmount");
        check(container.contains(unrelated), "unrelated container child survives unmount");
        button.dispatchEvent(new Event("click"));
        check(clickCount === beforeUnmountClicks, "unmounted listener cannot mutate state");
        expectError(root.flush(), "invalid_root_state", "flush after unmount is rejected");
        value(root.unmount(), "repeated unmount is idempotent");
        check(read(runtime, count, "borrowed signal survives unmount") === 5, "application signal survives unmount");

        const reusedRoot = value(createRootContext(container, runtime), "container reuse root creation");
        value(reusedRoot.mount((scope) => {
          const reused = scope.createElement("div");
          const reusedText = scope.createTextNode("reused");
          scope.appendChild(reused, reusedText);
          scope.appendChild(scope.container, reused);
          return success(undefined);
        }), "container reuse mount");
        check(container.textContent.includes("reused"), "container can be reused after cleanup");
        value(reusedRoot.dispose(), "reused root disposal");
        check(read(runtime, count, "borrowed runtime survives root disposal") === 5, "borrowed runtime remains live");

        const rollbackContainer = document.createElement("main");
        const rollbackUnrelated = document.createElement("aside");
        rollbackUnrelated.textContent = "rollback preserve";
        rollbackContainer.appendChild(rollbackUnrelated);
        document.body.appendChild(rollbackContainer);
        const rollbackRoot = value(createRootContext(rollbackContainer, runtime), "rollback root creation");
        const rollbackSignal = value(runtime.createSignal(0), "rollback signal creation");
        const rollbackResult = rollbackRoot.mount((scope) => {
          const rollbackNode = scope.createElement("div");
          const rollbackText = scope.createTextNode("");
          scope.appendChild(rollbackNode, rollbackText);
          const registration = scope.registerBinding({
            target: rollbackText,
            dependencies: [rollbackSignal],
            update: () => success(scope.setText(rollbackText, "rollback " + read(runtime, rollbackSignal, "rollback read"))),
            key: "rollback",
          });
          if (!registration.ok) return registration;
          scope.appendChild(scope.container, rollbackNode);
          return failure("intentional_mount_failure", "mount_setup", "root", "rollback test failure");
        });
        expectError(rollbackResult, "intentional_mount_failure", "mount failure is returned");
        check(rollbackRoot.state === "unmounted", "failed mount rolls root back");
        check(rollbackContainer.childNodes.length === 1 && rollbackContainer.firstChild === rollbackUnrelated, "rollback preserves unrelated DOM");
        value(rollbackRoot.dispose(), "rollback root disposal");

        const secondContainer = document.createElement("main");
        document.body.appendChild(secondContainer);
        const secondRuntime = value(await createReactiveCore(() => wasm), "independent runtime initializes");
        const secondSignal = value(secondRuntime.createSignal(0), "independent signal creation");
        const secondRoot = value(createRootContext(secondContainer, secondRuntime), "independent root creation");
        value(secondRoot.mount((scope) => {
          const node = scope.createTextNode("");
          const registration = scope.registerBinding({
            target: node,
            dependencies: [secondSignal],
            update: () => success(scope.setText(node, "second " + read(secondRuntime, secondSignal, "second signal read"))),
          });
          if (!registration.ok) return registration;
          scope.appendChild(scope.container, node);
          return success(undefined);
        }), "independent root mount");
        check(secondContainer.textContent === "second 0", "independent root initial DOM");
        const duplicateRoot = createRootContext(secondContainer, secondRuntime);
        expectError(duplicateRoot, "duplicate_root", "duplicate container claim is rejected");

        const sharedContainer = document.createElement("main");
        document.body.appendChild(sharedContainer);
        const sharedRoot = value(createRootContext(sharedContainer, secondRuntime), "shared-runtime root creation");
        const sharedMount = sharedRoot.mount((scope) => {
          const node = scope.createTextNode("shared");
          scope.appendChild(scope.container, node);
          const registration = scope.registerBinding({
            target: node,
            dependencies: [secondSignal],
            update: () => success(scope.setText(node, "shared")),
          });
          return registration;
        });
        expectError(sharedMount, "runtime_in_use", "shared runtime binding ownership is rejected");
        check(sharedRoot.state === "unmounted", "shared runtime failure rolls back root");
        value(secondRoot.unmount(), "independent root unmount");
        value(secondRoot.dispose(), "independent root disposal");
        value(secondRuntime.dispose(), "independent runtime disposal");

        const foreignHost = createHostContext(document);
        const localHost = createHostContext(document);
        const foreignContainer = document.createElement("div");
        const localContainer = document.createElement("div");
        foreignHost.claimContainer(foreignContainer);
        localHost.claimContainer(localContainer);
        const foreignNode = foreignHost.createElement("span");
        expectThrow(() => localHost.appendChild(localContainer, foreignNode), "foreign_node", "foreign host node is rejected");
        const foreignDocument = document.implementation.createHTMLDocument("foreign");
        expectThrow(() => localHost.claimContainer(foreignDocument.body), "foreign_document", "foreign document container is rejected");
        const detachedNode = localHost.createElement("p");
        localHost.appendChild(localContainer, detachedNode);
        localHost.removeChild(localContainer, detachedNode);
        expectThrow(() => localHost.assertOwned(detachedNode), "detached_node", "detached host node is rejected");
        localHost.dispose();
        foreignHost.dispose();

        const fragment = document.createDocumentFragment();
        const fragmentRuntime = value(await createReactiveCore(() => wasm), "fragment runtime initializes");
        const fragmentRoot = value(createRootContext(fragment, fragmentRuntime), "fragment root creation");
        value(fragmentRoot.mount((scope) => {
          const node = scope.createTextNode("fragment");
          scope.appendChild(scope.container, node);
          return success(undefined);
        }), "fragment mount");
        check(fragment.textContent === "fragment", "DocumentFragment is a valid root container");
        value(fragmentRoot.unmount(), "fragment unmount");
        value(fragmentRoot.dispose(), "fragment disposal");
        value(fragmentRuntime.dispose(), "fragment runtime disposal");

        value(runtime.dispose(), "borrowed primary runtime final disposal");
        document.body.removeChild(container);
        document.body.removeChild(rollbackContainer);
        document.body.removeChild(secondContainer);
        document.body.removeChild(sharedContainer);
        window.__ruseactPublish({ ok: true, checks });
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
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "ruseact-m3.5-e2e-"));
const generatedRoot = path.join(temporaryRoot, "generated");
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
      temporaryRoot,
      "packages/ruseact/src/index.ts",
      "packages/ruseact-dom/src/host.ts",
      "packages/ruseact-dom/src/bindings.ts",
      "packages/ruseact-dom/src/root.ts",
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
  if (address === null || typeof address !== "object") throw new Error("browser server did not bind");
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
    "--virtual-time-budget=30000",
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
    throw new Error(`end-to-end page did not publish a result; stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  const testResult = JSON.parse(decodeURIComponent(encodedResult));
  if (!testResult.ok) {
    throw new Error(`end-to-end DOM tests failed after ${testResult.checks.length} checks: ${testResult.error}`);
  }
  console.log(`${browser.version} Ruseact M3.5 end-to-end DOM tests passed ${testResult.checks.length} checks`);
} finally {
  if (server !== undefined) await new Promise((resolve) => server.close(resolve));
  rmSync(temporaryRoot, { recursive: true, force: true });
}
