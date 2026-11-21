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
  <head><meta charset="utf-8"><title>Ruseact M4.2 public renderer</title></head>
  <body data-status="pending">
    <p>Running Ruseact public renderer checks…</p>
    <script>
      window.__ruseactPublish = (result) => {
        document.body.dataset.status = result.ok ? "passed" : "failed";
        document.body.dataset.testResult = encodeURIComponent(JSON.stringify(result));
        document.body.textContent = result.ok
          ? "Ruseact public renderer tests passed"
          : "Ruseact public renderer tests failed";
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
        () => publishFailure("public renderer watchdog expired at " + window.__ruseactStage),
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

      const staticView = {
        protocol: "ruseact.template",
        version: 1,
        templateId: "m4.2-hello",
        instantiate: () => ({
          nodes: [
            { id: "root", kind: "element", name: "div" },
            { id: "heading", kind: "element", name: "h1", parentId: "root" },
            { id: "heading-text", kind: "text", text: "Hello Ruseact", parentId: "heading" },
            { id: "paragraph", kind: "element", name: "p", parentId: "root" },
            { id: "paragraph-text", kind: "text", text: "Public Renderer MVP", parentId: "paragraph" },
          ],
          bindings: [],
          listeners: [],
        }),
      };

      try {
        window.__ruseactStage = "importing-modules";
        const [{ default: initializeWasm, ...wasm }, runtimeModule, domModule] = await Promise.all([
          import("./generated/ruseact_wasm.js"),
          import("./ruseact/src/index.js"),
          import("./ruseact-dom/src/index.js"),
        ]);
        window.__ruseactStage = "modules-imported";
        await initializeWasm();
        window.__ruseactStage = "wasm-initialized";
        const runtime = value(await runtimeModule.createReactiveCore(() => wasm), "runtime initializes");

        expectError(
          domModule.createRoot(document.createTextNode("not a container"), runtime),
          "invalid_root",
          "invalid container is rejected",
        );
        expectError(
          domModule.createRoot(document.createElement("main"), {}),
          "invalid_root",
          "invalid runtime is rejected",
        );

        const helloContainer = document.createElement("main");
        const unrelated = document.createElement("aside");
        unrelated.textContent = "preserve me";
        helloContainer.appendChild(unrelated);
        document.body.appendChild(helloContainer);
        const helloRoot = value(domModule.createRoot(helloContainer, runtime), "public root creation");
        check(helloRoot.state === "created", "public root starts in created state");
        expectError(domModule.createRoot(helloContainer, runtime), "duplicate_root", "duplicate root is rejected");
        value(helloRoot.mount(staticView), "static Hello World mount");
        check(helloRoot.state === "mounted", "public root becomes mounted");
        const helloNode = helloContainer.querySelector("div");
        const headingNode = helloContainer.querySelector("h1");
        check(helloNode?.textContent === "Hello RuseactPublic Renderer MVP", "static Hello World content");
        check(headingNode?.textContent === "Hello Ruseact", "static heading content");
        check(helloNode?.firstElementChild === headingNode, "static child ordering");
        value(helloRoot.unmount(), "public root unmount");
        check(helloRoot.state === "unmounted", "public root becomes unmounted");
        check(helloContainer.contains(unrelated), "unmount preserves unrelated content");
        check(!helloContainer.querySelector("h1"), "unmount removes renderer nodes");
        expectError(helloRoot.mount(staticView), "invalid_root_state", "one-shot mount is enforced");
        value(helloRoot.dispose(), "public root disposal");
        check(helloRoot.state === "disposed", "public root becomes disposed");

        let instantiateCount = 0;
        const count = value(runtime.createSignal(0), "count signal creation");
        const label = value(runtime.createSignal("zero"), "label signal creation");
        const disabled = value(runtime.createSignal(false), "disabled signal creation");
        let button;
        let countText;
        const counterView = {
          protocol: "ruseact.template",
          version: 1,
          templateId: "m4.2-counter",
          instantiate: () => {
            instantiateCount += 1;
            return {
              nodes: [
                { id: "counter", kind: "element", name: "section" },
                { id: "count-text", kind: "text", text: "", parentId: "counter" },
                { id: "button", kind: "element", name: "button", parentId: "counter" },
                { id: "button-text", kind: "text", text: "Increment", parentId: "button" },
                { id: "input", kind: "element", name: "input", parentId: "counter" },
              ],
              bindings: [
                {
                  kind: "text",
                  slot: "count-text",
                  targetId: "count-text",
                  dependencies: [count],
                  evaluate: ({ runtime: currentRuntime }) => {
                    const result = currentRuntime.get(count);
                    return result.ok ? success(String(result.value)) : result;
                  },
                },
                {
                  kind: "attribute",
                  slot: "button-label",
                  targetId: "button",
                  name: "aria-label",
                  dependencies: [label],
                  evaluate: ({ runtime: currentRuntime }) => currentRuntime.get(label),
                },
                {
                  kind: "property",
                  slot: "input-disabled",
                  targetId: "input",
                  property: "disabled",
                  dependencies: [disabled],
                  evaluate: ({ runtime: currentRuntime }) => currentRuntime.get(disabled),
                },
              ],
              listeners: [
                {
                  id: "increment",
                  targetId: "button",
                  type: "click",
                  listener: () => {
                    const current = runtime.get(count);
                    if (current.ok) runtime.set(count, current.value + 1);
                  },
                },
              ],
            };
          },
        };

        const counterContainer = document.createElement("main");
        const counterUnrelated = document.createElement("p");
        counterUnrelated.textContent = "keep";
        counterContainer.appendChild(counterUnrelated);
        document.body.appendChild(counterContainer);
        const counterRoot = value(domModule.createRoot(counterContainer, runtime), "counter root creation");
        value(counterRoot.mount(counterView), "public counter mount");
        button = counterContainer.querySelector("button");
        countText = counterContainer.querySelector("section")?.firstChild;
        const input = counterContainer.querySelector("input");
        check(instantiateCount === 1, "view instantiate runs once");
        check(countText?.nodeValue === "0", "initial public counter text");
        check(button?.getAttribute("aria-label") === "zero", "initial public attribute");
        check(input?.disabled === false, "initial public property");
        const buttonIdentity = button;
        const textIdentity = countText;

        button.dispatchEvent(new Event("click"));
        check(value(runtime.get(count), "counter signal changes after click") === 1, "native event changes signal");
        check(countText?.nodeValue === "0", "DOM waits for explicit flush");
        const firstFlush = value(counterRoot.flush(), "counter flush");
        check(firstFlush.drainedCount === 1 && countText?.nodeValue === "1", "flush updates reactive text");
        check(button === buttonIdentity && countText === textIdentity, "reactive update preserves node identity");

        button.dispatchEvent(new Event("click"));
        button.dispatchEvent(new Event("click"));
        value(counterRoot.flush(), "coalesced counter flush");
        check(countText?.nodeValue === "3", "multiple events update once to final value");
        check(value(runtime.set(count, 3), "unchanged counter write") === "unchanged", "unchanged write is reported");
        check(value(counterRoot.flush(), "flush unchanged counter").drainedCount === 0, "unchanged write has no pending work");
        check(value(runtime.set(disabled, true), "changed property write") === "changed", "property signal changes");
        value(counterRoot.flush(), "property binding flush");
        check(input?.disabled === true, "property binding updates native property");

        let reentrantResult;
        let reentrantEnabled = false;
        const reentrantSignal = value(runtime.createSignal(0), "reentrant signal creation");
        const reentrantView = {
          protocol: "ruseact.template",
          version: 1,
          templateId: "m4.2-reentrant",
          instantiate: () => ({
            nodes: [{ id: "text", kind: "text", text: "" }],
            bindings: [{
              kind: "text",
              slot: "text",
              targetId: "text",
              dependencies: [reentrantSignal],
              evaluate: ({ runtime: currentRuntime }) => {
                const current = currentRuntime.get(reentrantSignal);
                if (current.ok && reentrantEnabled) reentrantResult = reentrantRoot.flush();
                return current.ok ? success(String(current.value)) : current;
              },
            }],
            listeners: [],
          }),
        };
        const reentrantContainer = document.createElement("main");
        document.body.appendChild(reentrantContainer);
        const reentrantRoot = value(domModule.createRoot(reentrantContainer, runtime), "reentrant root creation");
        value(reentrantRoot.mount(reentrantView), "reentrant root mount");
        reentrantEnabled = true;
        value(runtime.set(reentrantSignal, 1), "reentrant signal write");
        value(reentrantRoot.flush(), "outer reentrant flush");
        expectError(reentrantResult, "reentrant_flush", "reentrant flush is rejected");
        value(reentrantRoot.dispose(), "reentrant root disposal");

        const invalidPlans = [
          ["unsupported_view_version", { ...staticView, version: 2 }],
          ["duplicate_node_id", { ...staticView, instantiate: () => ({ nodes: [
            { id: "same", kind: "element", name: "div" },
            { id: "same", kind: "text", text: "bad" },
          ], bindings: [], listeners: [] }) }],
          ["invalid_parent_reference", { ...staticView, instantiate: () => ({ nodes: [
            { id: "child", kind: "text", text: "bad", parentId: "missing" },
          ], bindings: [], listeners: [] }) }],
          ["invalid_binding_target", { ...staticView, instantiate: () => ({ nodes: [
            { id: "text", kind: "text", text: "bad" },
          ], bindings: [{
            kind: "text", slot: "bad", targetId: "missing", dependencies: [count],
            evaluate: () => success("bad"),
          }], listeners: [] }) }],
          ["binding_evaluation_failed", { ...staticView, instantiate: () => ({ nodes: [
            { id: "text", kind: "text", text: "bad" },
          ], bindings: [{
            kind: "text", slot: "bad", targetId: "text", dependencies: [count],
            evaluate: () => failure("binding_evaluation_failed", "evaluate", "renderer", "intentional test failure"),
          }], listeners: [] }) }],
        ];
        for (const [code, invalidView] of invalidPlans) {
          const invalidContainer = document.createElement("main");
          document.body.appendChild(invalidContainer);
          const invalidRoot = value(domModule.createRoot(invalidContainer, runtime), "invalid plan root creation");
          expectError(invalidRoot.mount(invalidView), code, "invalid plan " + code);
          check(invalidRoot.state === "unmounted", "invalid plan " + code + " rolls back");
          value(invalidRoot.dispose(), "invalid plan " + code + " disposal");
          check(invalidContainer.childNodes.length === 0, "invalid plan " + code + " leaves container clean");
        }

        value(counterRoot.unmount(), "counter unmount");
        check(counterRoot.state === "unmounted", "counter root unmounts");
        const signalBeforeDetachedClick = value(runtime.get(count), "signal before detached click");
        button.dispatchEvent(new Event("click"));
        check(value(runtime.get(count), "signal after detached click") === signalBeforeDetachedClick, "unmount removes listener");
        check(counterContainer.contains(counterUnrelated), "counter unmount preserves unrelated content");
        check(!counterContainer.querySelector("section"), "counter unmount removes static subtree");
        value(counterRoot.dispose(), "counter root disposal");
        value(runtime.get(count), "borrowed signal survives root disposal");

        const reuseRoot = value(domModule.createRoot(counterContainer, runtime), "container reuse root creation");
        value(reuseRoot.mount(staticView), "container reuse mount");
        value(reuseRoot.dispose(), "container reuse disposal");
        value(runtime.dispose(), "application-owned runtime disposal");
        document.body.removeChild(helloContainer);
        document.body.removeChild(counterContainer);
        document.body.removeChild(reentrantContainer);
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
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "ruseact-m4.2-browser-"));
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
      "packages/ruseact-dom/src/index.ts",
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
    throw new Error(`public renderer page did not publish a result; stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  const testResult = JSON.parse(decodeURIComponent(encodedResult));
  if (!testResult.ok) {
    throw new Error(`public renderer tests failed after ${testResult.checks.length} checks: ${testResult.error}`);
  }
  console.log(`${browser.version} Ruseact public renderer tests passed ${testResult.checks.length} checks`);
} finally {
  if (server !== undefined) await new Promise((resolve) => server.close(resolve));
  rmSync(temporaryRoot, { recursive: true, force: true });
}
