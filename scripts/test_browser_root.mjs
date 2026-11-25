import assert from "node:assert/strict";
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
  <head><meta charset="utf-8"><title>Ruseact M3.4 root lifecycle</title><script type="importmap">{"imports":{"ruseact":"./ruseact/src/index.js"}}</script></head>
  <body data-status="pending">
    <p>Running Ruseact root lifecycle checks…</p>
    <script>
      window.__ruseactPublish = (result) => {
        document.body.dataset.status = result.ok ? "passed" : "failed";
        document.body.dataset.testResult = encodeURIComponent(JSON.stringify(result));
        document.body.textContent = result.ok
          ? "Ruseact root lifecycle tests passed"
          : "Ruseact root lifecycle tests failed";
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
        () => publishFailure("root lifecycle watchdog expired at " + window.__ruseactStage),
        15000,
      );
    </script>
    <script type="module">
      const checks = [];
      let activeRoot;
      function check(condition, name) {
        if (!condition) throw new Error("check failed: " + name);
        checks.push(name);
      }
      function success(value) {
        return { ok: true, value };
      }
      function describeFailure(result) {
        if (result === null || typeof result !== "object" || result.ok !== false) {
          return { rootState: activeRoot?.state ?? "unavailable" };
        }
        const error = result.error;
        if (error === null || typeof error !== "object") {
          return { rootState: activeRoot?.state ?? "unavailable" };
        }
        return {
          kind: error.kind,
          code: error.code,
          operation: error.operation,
          resource: error.resource,
          causeCode: error.causeCode ?? null,
          cleanupCode: error.cleanupCode ?? null,
          rootState: activeRoot?.state ?? "unavailable",
        };
      }
      function value(result, name) {
        if (result === null || typeof result !== "object" || result.ok !== true) {
          throw new Error("check failed: " + name + "; result=" + JSON.stringify(describeFailure(result)));
        }
        check(true, name);
        return result.value;
      }
      function expectError(result, code, name) {
        check(result !== null && typeof result === "object" && result.ok === false, name + ": result");
        check(result.error.code === code, name + ": " + code);
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

        const runtime = value(await createReactiveCore(() => wasm), "primary runtime initializes");
        expectError(
          createRootContext(document.createTextNode("not a container"), runtime),
          "invalid_root",
          "invalid container is rejected",
        );
        const count = value(runtime.createSignal(0), "count signal creation");
        const label = value(runtime.createSignal("zero"), "label signal creation");
        const disabled = value(runtime.createSignal(false), "disabled signal creation");

        const container = document.createElement("main");
        const unrelated = document.createElement("aside");
        unrelated.textContent = "preserve me";
        document.body.appendChild(container);
        container.appendChild(unrelated);
        activeRoot = value(createRootContext(container, runtime), "root creation");
        const root = activeRoot;
        check(root.state === "created", "root starts in created state");

        let scope;
        let section;
        let text;
        let button;
        let input;
        let clickCount = 0;
        let textUpdates = 0;
        let reentrantResult;
        let checkReentrant = false;
        const reentrantSignal = value(runtime.createSignal(0), "reentrant signal creation");

        value(root.mount((mountScope) => {
          scope = mountScope;
          section = scope.createElement("section");
          text = scope.createTextNode("");
          button = scope.createElement("button");
          input = scope.createElement("input");
          scope.appendChild(section, text);
          scope.appendChild(section, button);
          scope.appendChild(section, input);
          scope.addEventListener(button, "click", () => { clickCount += 1; });

          const textBinding = scope.registerBinding({
            target: text,
            dependencies: [count],
            update: () => {
              textUpdates += 1;
              const current = runtime.get(count);
              if (!current.ok) return current;
              scope.setText(text, "Count: " + current.value);
              return success(undefined);
            },
            key: "text",
          });
          if (!textBinding.ok) return textBinding;

          const attributeBinding = scope.registerBinding({
            target: button,
            dependencies: [label],
            update: () => {
              const current = runtime.get(label);
              if (!current.ok) return current;
              return success(scope.setAttribute(button, "aria-label", current.value));
            },
            key: "attribute",
          });
          if (!attributeBinding.ok) return attributeBinding;

          const propertyBinding = scope.registerBinding({
            target: input,
            dependencies: [disabled],
            update: () => {
              const current = runtime.get(disabled);
              if (!current.ok) return current;
              return success(scope.setProperty(input, "disabled", current.value));
            },
            key: "property",
          });
          if (!propertyBinding.ok) return propertyBinding;

          const reentrantBinding = scope.registerBinding({
            target: text,
            dependencies: [reentrantSignal],
            update: () => {
              const current = runtime.get(reentrantSignal);
              if (!current.ok) return current;
              if (checkReentrant) reentrantResult = root.flush();
              return success(undefined);
            },
            key: "reentrant",
          });
          if (!reentrantBinding.ok) return reentrantBinding;

          scope.appendChild(scope.container, section);
          return success(undefined);
        }), "initial mount");
        check(root.state === "mounted", "root becomes mounted after setup");
        check(container.contains(section), "static section is mounted");
        check(text.nodeValue === "Count: 0", "initial reactive text is rendered");
        check(button.getAttribute("aria-label") === "zero", "initial attribute is rendered");
        check(input.disabled === false, "initial property is rendered");
        check(textUpdates === 1, "initial binding updates execute once");
        const sectionIdentity = section;
        const textIdentity = text;

        button.dispatchEvent(new Event("click"));
        check(clickCount === 1, "native event dispatch reaches mounted root");

        const unchangedUpdates = textUpdates;
        check(value(runtime.set(count, 0), "unchanged count write") === "unchanged", "unchanged signal write");
        check(value(root.flush(), "flush unchanged write").drainedCount === 0, "unchanged write has no pending root work");
        check(textUpdates === unchangedUpdates, "unchanged write does not update DOM");

        check(value(runtime.set(count, 1), "changed count write") === "changed", "changed count write");
        check(value(root.flush(), "flush changed count").drainedCount === 1, "changed count drains one binding");
        check(text.nodeValue === "Count: 1", "changed signal updates text");
        check(text === textIdentity, "reactive text preserves node identity");
        check(section === sectionIdentity, "static element preserves node identity");

        value(runtime.set(label, "one"), "changed label write");
        value(runtime.set(disabled, true), "changed disabled write");
        value(root.flush(), "flush attribute and property");
        check(button.getAttribute("aria-label") === "one", "attribute binding updates");
        check(input.disabled === true, "property binding updates");

        value(runtime.beginBatch(), "outer batch begin");
        value(runtime.set(count, 2), "first batched count write");
        value(runtime.beginBatch(), "nested batch begin");
        value(runtime.set(count, 3), "second batched count write");
        check(value(root.flush(), "flush during nested batch").drainedCount === 0, "active batch gates root flush");
        value(runtime.endBatch(), "nested batch end");
        check(value(root.flush(), "flush during outer batch").drainedCount === 0, "outer batch keeps root work gated");
        value(runtime.endBatch(), "outer batch end");
        check(value(root.flush(), "flush after nested batch").drainedCount === 1, "batch releases one deduplicated binding");
        check(text.nodeValue === "Count: 3", "batched latest value is rendered");

        const orderSignal = value(runtime.createSignal(0), "FIFO signal creation");
        const orderA = scope.createTextNode("");
        const orderB = scope.createTextNode("");
        scope.appendChild(section, orderA);
        scope.appendChild(section, orderB);
        const orderLog = [];
        value(scope.registerBinding({
          target: orderA,
          dependencies: [orderSignal],
          update: () => {
            orderLog.push("A");
            return success(scope.setText(orderA, "A" + value(runtime.get(orderSignal), "FIFO A read")));
          },
          key: "fifo-a",
        }), "first FIFO binding registration");
        value(scope.registerBinding({
          target: orderB,
          dependencies: [orderSignal],
          update: () => {
            orderLog.push("B");
            return success(scope.setText(orderB, "B" + value(runtime.get(orderSignal), "FIFO B read")));
          },
          key: "fifo-b",
        }), "second FIFO binding registration");
        orderLog.length = 0;
        value(runtime.set(orderSignal, 1), "FIFO signal write");
        check(value(root.flush(), "FIFO root flush").executedCount === 2, "FIFO flush executes two bindings");
        check(orderLog.join("") === "AB", "FIFO binding order is preserved");

        checkReentrant = true;
        value(runtime.set(reentrantSignal, 1), "reentrant signal write");
        value(root.flush(), "outer reentrant flush");
        check(reentrantResult?.ok === false, "reentrant root flush returns an error");
        check(reentrantResult?.error.code === "reentrant_flush", "reentrant root flush is rejected");
        checkReentrant = false;

        const duplicate = createRootContext(container, runtime);
        expectError(duplicate, "duplicate_root", "duplicate container root is rejected");

        const secondaryRuntime = value(await createReactiveCore(() => wasm), "secondary runtime initializes");
        const secondaryContainer = document.createElement("main");
        const secondaryUnrelated = document.createElement("aside");
        secondaryUnrelated.textContent = "secondary preserve";
        document.body.appendChild(secondaryContainer);
        secondaryContainer.appendChild(secondaryUnrelated);
        const secondaryRoot = value(createRootContext(secondaryContainer, secondaryRuntime), "independent root creation");
        value(secondaryRoot.mount((secondaryScope) => {
          const node = secondaryScope.createTextNode("secondary");
          secondaryScope.appendChild(secondaryScope.container, node);
          return success(undefined);
        }), "independent root mount");
        check(secondaryRoot.state === "mounted", "independent root is mounted");
        check(secondaryContainer.textContent.includes("secondary"), "independent root renders separately");

        const sharedContainer = document.createElement("main");
        const sharedUnrelated = document.createElement("aside");
        document.body.appendChild(sharedContainer);
        sharedContainer.appendChild(sharedUnrelated);
        const sharedRoot = value(createRootContext(sharedContainer, runtime), "shared runtime root creation");
        expectError(
          sharedRoot.mount((sharedScope) => {
            const node = sharedScope.createTextNode("must not mount");
            sharedScope.appendChild(sharedScope.container, node);
            return success(undefined);
          }),
          "runtime_in_use",
          "active runtime sharing is rejected",
        );
        check(sharedRoot.state === "unmounted", "failed shared runtime root rolls back");
        check(sharedContainer.contains(sharedUnrelated), "shared runtime rollback preserves unrelated nodes");
        value(sharedRoot.dispose(), "failed shared runtime root disposal");

        const failureRuntime = value(await createReactiveCore(() => wasm), "failure runtime initializes");
        const failureContainer = document.createElement("main");
        const failureUnrelated = document.createElement("aside");
        document.body.appendChild(failureContainer);
        failureContainer.appendChild(failureUnrelated);
        const failureRoot = value(createRootContext(failureContainer, failureRuntime), "failure root creation");
        expectError(
          failureRoot.mount((failureScope) => {
            const failedSection = failureScope.createElement("section");
            failureScope.appendChild(failureContainer, failedSection);
            const badBinding = failureScope.registerBinding({
              target: failedSection,
              dependencies: [count],
              update: () => success(undefined),
              key: "foreign-dependency",
            });
            return badBinding;
          }),
          "foreign_instance",
          "failed binding registration is reported",
        );
        check(failureRoot.state === "unmounted", "failed mount reaches unmounted state");
        check(failureContainer.childNodes.length === 1 && failureContainer.firstChild === failureUnrelated,
          "failed mount removes only renderer-created nodes");
        value(failureRoot.dispose(), "failed root disposal");
        value(failureRuntime.dispose(), "failure runtime disposal");

        const foreignRuntime = value(await createReactiveCore(() => wasm), "foreign root runtime initializes");
        const foreignContainer = document.createElement("main");
        document.body.appendChild(foreignContainer);
        const foreignRoot = value(createRootContext(foreignContainer, foreignRuntime), "foreign root creation");
        expectError(
          foreignRoot.mount((foreignScope) => {
            foreignScope.appendChild(foreignScope.container, section);
            return success(undefined);
          }),
          "foreign_node",
          "foreign root cannot move another root node",
        );
        check(container.contains(section), "foreign root failure preserves original subtree");
        value(foreignRoot.dispose(), "foreign root disposal");
        value(foreignRuntime.dispose(), "foreign root runtime disposal");

        const detachedRuntime = value(await createReactiveCore(() => wasm), "detached runtime initializes");
        const detachedContainer = document.createElement("main");
        document.body.appendChild(detachedContainer);
        const detachedRoot = value(createRootContext(detachedContainer, detachedRuntime), "detached root creation");
        const detachedSignal = value(detachedRuntime.createSignal(0), "detached signal creation");
        let detachedText;
        value(detachedRoot.mount((detachedScope) => {
          const detachedSection = detachedScope.createElement("section");
          detachedText = detachedScope.createTextNode("detached 0");
          detachedScope.appendChild(detachedSection, detachedText);
          const binding = detachedScope.registerBinding({
            target: detachedText,
            dependencies: [detachedSignal],
            update: () => {
              const current = detachedRuntime.get(detachedSignal);
              if (!current.ok) return current;
              return success(detachedScope.setText(detachedText, "detached " + current.value));
            },
            key: "detached",
          });
          if (!binding.ok) return binding;
          detachedScope.appendChild(detachedScope.container, detachedSection);
          return success(undefined);
        }), "detached root mount");
        const detachedValue = detachedText.nodeValue;
        detachedContainer.removeChild(detachedText.parentNode);
        value(detachedRuntime.set(detachedSignal, 1), "detached signal write");
        const detachedFlush = detachedRoot.flush();
        expectError(detachedFlush, "detached_node", "detached target fails closed");
        check(detachedText.nodeValue === detachedValue, "detached target is not mutated");
        value(detachedRoot.unmount(), "detached root unmount");
        value(detachedRoot.dispose(), "detached root disposal");
        value(detachedRuntime.dispose(), "detached runtime disposal");

        const movedRuntime = value(await createReactiveCore(() => wasm), "moved runtime initializes");
        const movedContainer = document.createElement("main");
        document.body.appendChild(movedContainer);
        const movedRoot = value(createRootContext(movedContainer, movedRuntime), "moved root creation");
        const movedSignal = value(movedRuntime.createSignal(0), "moved signal creation");
        let movedSection;
        let movedText;
        value(movedRoot.mount((movedScope) => {
          movedSection = movedScope.createElement("section");
          movedText = movedScope.createTextNode("");
          movedScope.appendChild(movedSection, movedText);
          const binding = movedScope.registerBinding({
            target: movedText,
            dependencies: [movedSignal],
            update: () => {
              const current = movedRuntime.get(movedSignal);
              if (!current.ok) return current;
              return success(movedScope.setText(movedText, "moved " + current.value));
            },
            key: "moved",
          });
          if (!binding.ok) return binding;
          movedScope.appendChild(movedScope.container, movedSection);
          return success(undefined);
        }), "moved root mount");
        const unmanagedParent = document.createElement("div");
        document.body.appendChild(unmanagedParent);
        unmanagedParent.appendChild(movedSection);
        value(movedRuntime.set(movedSignal, 1), "moved signal write");
        expectError(movedRoot.flush(), "detached_node", "mounted subtree moved to unmanaged DOM fails closed");
        check(movedText.nodeValue === "moved 0", "moved subtree is not mutated");
        value(movedRoot.unmount(), "moved root unmount");
        check(unmanagedParent.contains(movedSection), "cleanup does not remove a moved foreign subtree");
        unmanagedParent.remove();
        value(movedRoot.dispose(), "moved root disposal");
        value(movedRuntime.dispose(), "moved runtime disposal");

        const foreignDocument = document.implementation.createHTMLDocument("foreign");
        const foreignHost = createHostContext(foreignDocument);
        foreignHost.claimContainer(foreignDocument.body);
        let foreignDocumentError;
        try {
          foreignHost.claimContainer(document.createElement("main"));
        } catch (error) {
          foreignDocumentError = error;
        }
        check(foreignDocumentError?.code === "foreign_document", "foreign document container is rejected");
        const foreignNode = foreignHost.createElement("div");
        const foreignDocumentRuntime = value(await createReactiveCore(() => wasm), "foreign document runtime initializes");
        const foreignDocumentContainer = document.createElement("main");
        document.body.appendChild(foreignDocumentContainer);
        const foreignDocumentRoot = value(
          createRootContext(foreignDocumentContainer, foreignDocumentRuntime),
          "foreign document root creation",
        );
        expectError(
          foreignDocumentRoot.mount((foreignDocumentScope) => {
            foreignDocumentScope.appendChild(foreignDocumentScope.container, foreignNode);
            return success(undefined);
          }),
          "foreign_node",
          "foreign document host node is rejected",
        );
        value(foreignDocumentRoot.dispose(), "foreign document root disposal");
        value(foreignDocumentRuntime.dispose(), "foreign document runtime disposal");
        foreignHost.dispose();

        value(root.unmount(), "primary root unmount");
        check(root.state === "unmounted", "root becomes unmounted");
        check(!container.contains(section), "unmount removes owned subtree");
        check(container.contains(unrelated), "unmount preserves unrelated children");
        button.dispatchEvent(new Event("click"));
        check(clickCount === 1, "unmount removes native event listeners");
        check(value(root.unmount(), "repeated unmount") === undefined, "unmount is idempotent");
        expectError(root.flush(), "invalid_root_state", "post-unmount flush is rejected");
        expectError(root.mount(() => success(undefined)), "invalid_root_state", "post-unmount mount is rejected");
        check(value(runtime.get(count), "borrowed signal survives unmount") === 3, "application signal survives unmount");

        const reuseRoot = value(createRootContext(container, runtime), "container reuse root creation");
        value(reuseRoot.mount((reuseScope) => {
          const node = reuseScope.createTextNode("reused");
          reuseScope.appendChild(reuseScope.container, node);
          return success(undefined);
        }), "container reuse mount");
        check(container.textContent.includes("reused"), "container can be reused after cleanup");
        value(reuseRoot.dispose(), "container reuse root disposal");
        value(root.dispose(), "primary root disposal");
        check(root.state === "disposed", "root becomes permanently disposed");
        check(value(root.dispose(), "repeated primary root disposal") === undefined, "root disposal is idempotent");
        expectError(root.mount(() => success(undefined)), "disposed_root", "disposed root cannot mount");
        expectError(root.unmount(), "disposed_root", "disposed root cannot unmount");

        value(secondaryRoot.unmount(), "independent root unmount");
        check(secondaryContainer.contains(secondaryUnrelated), "independent root preserves unrelated nodes");
        value(secondaryRoot.dispose(), "independent root disposal");
        value(secondaryRuntime.dispose(), "secondary runtime disposal");

        const fragmentRuntime = value(await createReactiveCore(() => wasm), "fragment runtime initializes");
        const fragmentContainer = document.createDocumentFragment();
        const fragmentRoot = value(createRootContext(fragmentContainer, fragmentRuntime), "fragment root creation");
        value(fragmentRoot.mount((fragmentScope) => {
          const node = fragmentScope.createTextNode("fragment root");
          fragmentScope.appendChild(fragmentScope.container, node);
          return success(undefined);
        }), "fragment root mount");
        check(fragmentContainer.textContent === "fragment root", "DocumentFragment root mounts content");
        value(fragmentRoot.unmount(), "fragment root unmount");
        value(fragmentRoot.dispose(), "fragment root disposal");
        value(fragmentRuntime.dispose(), "fragment runtime disposal");
        value(runtime.dispose(), "primary borrowed runtime disposal");

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
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "ruseact-m3.4-browser-"));
const generatedRoot = path.join(temporaryRoot, "generated");
cpSync(bindingDirectory, generatedRoot, { recursive: true });
let server;
const requests = [];

try {
  execFileSync(
    process.execPath,
    [path.join(repositoryRoot, "scripts", "compile_browser_sources.mjs"), temporaryRoot],
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
    throw new Error(`root lifecycle page did not publish a result; stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  const testResult = JSON.parse(decodeURIComponent(encodedResult));
  if (!testResult.ok) {
    throw new Error(`root lifecycle tests failed after ${testResult.checks.length} checks: ${testResult.error}`);
  }
  console.log(`${browser.version} Ruseact root lifecycle tests passed ${testResult.checks.length} checks`);
} finally {
  if (server !== undefined) {
    await new Promise((resolve) => server.close(resolve));
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
}
