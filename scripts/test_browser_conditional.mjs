import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
        resolve({ error: timedOut ? new Error("browser process timed out") : undefined, signal, status, stderr, stdout });
      }
    });
  });
}

function browserPage() {
  return String.raw`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Ruseact M4.4.3 conditional regions</title><script type="importmap">{"imports":{"ruseact":"./ruseact/src/index.js"}}</script></head>
  <body data-status="pending">
    <p>Running Ruseact conditional-region checks…</p>
    <script>
      window.__ruseactPublish = (result) => {
        document.body.dataset.status = result.ok ? "passed" : "failed";
        document.body.dataset.testResult = encodeURIComponent(JSON.stringify(result));
        document.body.textContent = result.ok ? "Ruseact conditional tests passed" : "Ruseact conditional tests failed";
      };
      const publishFailure = (message) => {
        if (document.body.dataset.status === "pending") window.__ruseactPublish({ ok: false, checks: [], error: message });
      };
      window.addEventListener("error", (event) => publishFailure(event.error?.message ?? event.message));
      window.addEventListener("unhandledrejection", (event) => publishFailure(String(event.reason)));
      window.__ruseactStage = "page-ready";
      window.setTimeout(() => publishFailure("conditional watchdog expired at " + window.__ruseactStage), 30000);
    </script>
    <script type="module">
      const checks = [];
      function check(condition, name) {
        if (!condition) throw new Error("check failed: " + name);
        checks.push(name);
      }
      function success(value) { return { ok: true, value }; }
      function failure(code, operation, resource, message) {
        return { ok: false, error: { kind: "internal", code, operation, resource, message } };
      }
      function details(result, root) {
        const error = result && typeof result === "object" && result.error && typeof result.error === "object" ? result.error : {};
        return JSON.stringify({
          kind: error.kind ?? null, code: error.code ?? null, operation: error.operation ?? null,
          resource: error.resource ?? null, message: error.message ?? null, rootState: root?.state ?? null,
        });
      }
      function value(result, name, root) {
        if (!result || result.ok !== true) throw new Error("check failed: " + name + "; result=" + details(result, root));
        check(true, name);
        return result.value;
      }
      function expectError(result, code, name, root) {
        if (!result || result.ok !== false) throw new Error("check failed: " + name + "; result=" + details(result, root));
        check(true, name + ": result");
        if (result.error?.code !== code) throw new Error("check failed: " + name + "; expected " + code + "; result=" + details(result, root));
        check(true, name + ": " + code);
      }
      function emptyPlan() { return { nodes: [], bindings: [], listeners: [] }; }
      function textBranch(id, text) {
        return { nodes: [
          { id, kind: "element", name: "p" },
          { id: id + "-text", kind: "text", text, parentId: id },
        ], bindings: [], listeners: [] };
      }
      function conditionalView(flag, whenTrue, whenFalse, evaluate = ({ runtime }) => runtime.get(flag)) {
        return {
          protocol: "ruseact.template", version: 3, templateId: "m4.4.3-conditional",
          instantiate: () => ({
            nodes: [], bindings: [], listeners: [], components: [],
            conditions: [{
              kind: "conditional", id: "region", order: 0, dependencies: [flag], evaluate,
              whenTrue, whenFalse,
            }],
          }),
        };
      }

      try {
        window.__ruseactStage = "importing-modules";
        const [{ default: initializeWasm, ...wasm }, runtimeModule, domModule, compiled] = await Promise.all([
          import("./generated/ruseact_wasm.js"),
          import("./ruseact/src/index.js"),
          import("./ruseact-dom/src/index.js"),
          import("./compiled_conditional.js"),
        ]);
        await initializeWasm();
        window.__ruseactStage = "wasm-initialized";
        const runtime = value(await runtimeModule.createReactiveCore(() => wasm), "real runtime initializes");

        const flag = value(runtime.createSignal(false), "boolean selector signal creation");
        let appSetupCount = 0;
        let falseFactoryCount = 0;
        let trueFactoryCount = 0;
        let branchSetupCount = 0;
        let branchClicks = 0;
        const Branch = domModule.defineComponent("ConditionalBranch", () => {
          branchSetupCount += 1;
          return success({
            nodes: [{ id: "branch-button", kind: "element", name: "button" }, { id: "branch-text", kind: "text", text: "ON", parentId: "branch-button" }],
            bindings: [],
            listeners: [{ id: "branch-click", targetId: "branch-button", type: "click", listener: () => { branchClicks += 1; } }],
          });
        });
        const appView = {
          protocol: "ruseact.template", version: 2, templateId: "m4.4.3-app",
          instantiate: () => ({
            nodes: [{ id: "mount", kind: "element", name: "section" }], bindings: [], listeners: [],
            components: [{ kind: "component", id: "app", parentId: "mount", order: 0, component: domModule.defineComponent("App", () => {
              appSetupCount += 1;
              return success({
                nodes: [
                  { id: "header", kind: "element", name: "header", order: 0 },
                  { id: "header-text", kind: "text", text: "Header", parentId: "header" },
                  { id: "outside-input", kind: "element", name: "input", order: 1 },
                  { id: "footer", kind: "element", name: "footer", order: 3 },
                  { id: "footer-text", kind: "text", text: "Footer", parentId: "footer" },
                ],
                bindings: [], listeners: [], components: [],
                conditions: [{
                  kind: "conditional", id: "main-region", order: 2, dependencies: [flag],
                  evaluate: ({ runtime: currentRuntime }) => currentRuntime.get(flag),
                  whenTrue: () => { trueFactoryCount += 1; return success({ nodes: [], bindings: [], listeners: [], components: [{ kind: "component", id: "true-component", order: 0, component: Branch, props: {} }] }); },
                  whenFalse: () => { falseFactoryCount += 1; return success(textBranch("off", "OFF")); },
                }],
              });
            }), props: {} }],
          }),
        };
        const container = document.createElement("main");
        const unrelatedBefore = document.createElement("aside");
        unrelatedBefore.textContent = "before";
        const unrelatedAfter = document.createElement("aside");
        unrelatedAfter.textContent = "after";
        container.append(unrelatedBefore, unrelatedAfter);
        document.body.appendChild(container);
        const root = value(domModule.createRoot(container, runtime), "conditional root creation");
        value(root.mount(appView), "conditional initial mount", root);
        const header = container.querySelector("header");
        const footer = container.querySelector("footer");
        const input = container.querySelector("input");
        const anchors = () => {
          const found = [];
          const visit = (node) => {
            for (const child of node.childNodes) {
              if (child.nodeType === Node.COMMENT_NODE) found.push(child);
              visit(child);
            }
          };
          visit(container);
          return found;
        };
        check(appSetupCount === 1, "parent component setup executes once");
        check(falseFactoryCount === 1 && trueFactoryCount === 0, "only initial false branch factory executes");
        check(anchors().length === 2, "conditional owns two comment anchors");
        check(container.querySelector("p")?.textContent === "OFF", "initial false branch is present");
        check(container.contains(unrelatedBefore) && container.contains(unrelatedAfter), "unrelated siblings are preserved");
        input.value = "user value";
        input.focus();
        const firstAnchors = anchors();

        value(runtime.set(flag, true), "selector changes false to true");
        check(container.querySelector("p")?.textContent === "OFF", "branch waits for explicit flush");
        const switched = value(root.flush(), "false to true flush", root);
        check(switched.drainedCount === 1 && switched.executedCount === 1, "structural flush executes one selector");
        check(trueFactoryCount === 1 && branchSetupCount === 1, "true branch is created once");
        check(!container.querySelector("p") && container.querySelector("button")?.textContent === "ON", "true branch replaces false branch");
        check(anchors()[0] === firstAnchors[0] && anchors()[1] === firstAnchors[1], "anchors remain stable after switch");
        check(container.querySelector("header") === header && container.querySelector("footer") === footer, "unaffected siblings retain identity");
        check(input.value === "user value" && document.activeElement === input, "unaffected input state and focus survive");
        const oldButton = container.querySelector("button");
        oldButton.dispatchEvent(new Event("click"));
        check(branchClicks === 1, "active branch listener executes");

        value(runtime.set(flag, false), "selector changes true to false");
        value(root.flush(), "true to false flush", root);
        check(falseFactoryCount === 2 && branchSetupCount === 1, "returning false branch gets a fresh activation");
        oldButton.dispatchEvent(new Event("click"));
        check(branchClicks === 1, "disposed branch listener is removed");
        check(container.querySelector("p")?.textContent === "OFF", "fresh false branch is present");
        for (let index = 0; index < 6; index += 1) {
          value(runtime.set(flag, index % 2 === 0), "bounded repeated selector write " + index);
          value(root.flush(), "bounded repeated selector flush " + index, root);
        }
        check(anchors().length === 2, "repeated switching keeps a bounded anchor count");
        check(container.querySelectorAll("p, button").length === 1, "repeated switching leaves one active branch");
        value(root.unmount(), "conditional root unmount", root);
        check(container.contains(unrelatedBefore) && container.contains(unrelatedAfter), "unmount preserves unrelated siblings");
        value(root.dispose(), "conditional root disposal", root);

        const snapshotRuntime = value(await runtimeModule.createReactiveCore(() => wasm), "snapshot runtime initializes");
        const trigger = value(snapshotRuntime.createSignal(false), "snapshot selector creation");
        const snapshotView = {
          protocol: "ruseact.template", version: 3, templateId: "m4.4.3-snapshot",
          instantiate: () => ({ nodes: [], bindings: [], listeners: [], components: [], conditions: [
            { kind: "conditional", id: "A", order: 0, dependencies: [trigger], evaluate: ({ runtime: current }) => current.get(trigger), whenTrue: () => success(textBranch("new", "new")), whenFalse: () => success({
              nodes: [{ id: "old", kind: "text", text: "old" }],
              bindings: [{ kind: "text", slot: "old-binding", targetId: "old", dependencies: [trigger], evaluate: ({ runtime: current }) => { const result = current.get(trigger); return result.ok ? success(String(result.value)) : result; } }], listeners: [],
            }) },
            { kind: "conditional", id: "C", order: 1, dependencies: [trigger], evaluate: () => success(true), whenTrue: () => success(textBranch("unrelated", "unrelated")), whenFalse: () => success(emptyPlan()) },
          ] }),
        };
        const snapshotContainer = document.createElement("main");
        document.body.appendChild(snapshotContainer);
        const snapshotRoot = value(domModule.createRoot(snapshotContainer, snapshotRuntime), "snapshot root creation");
        value(snapshotRoot.mount(snapshotView), "snapshot root mount", snapshotRoot);
        value(snapshotRuntime.set(trigger, true), "snapshot trigger write");
        const snapshotReport = value(snapshotRoot.flush(), "same-snapshot disposal flush", snapshotRoot);
        check(snapshotReport.drainedCount === 3, "same-snapshot drains structural and scalar records");
        check(snapshotReport.executedCount === 2 && snapshotReport.skippedCount === 1, "same-snapshot reports one exact disposed record skip");
        check(snapshotContainer.textContent.includes("new") && snapshotContainer.textContent.includes("unrelated"), "unrelated structural work continues");
        value(snapshotRoot.dispose(), "snapshot root disposal", snapshotRoot);
        value(snapshotRuntime.dispose(), "snapshot runtime disposal");
        document.body.removeChild(snapshotContainer);

        const failedRuntime = value(await runtimeModule.createReactiveCore(() => wasm), "failure runtime initializes");
        const failedSignal = value(failedRuntime.createSignal(false), "failure selector creation");
        const failedContainer = document.createElement("main");
        document.body.appendChild(failedContainer);
        const failedRoot = value(domModule.createRoot(failedContainer, failedRuntime), "failure root creation");
        value(failedRoot.mount(conditionalView(failedSignal, () => failure("branch_setup_failed", "branch", "renderer", "intentional failure"), () => success(textBranch("safe", "safe")))), "failure fixture initial mount", failedRoot);
        value(failedRuntime.set(failedSignal, true), "failed branch selector write");
        expectError(failedRoot.flush(), "branch_setup_failed", "failed branch returns structured error", failedRoot);
        check(failedContainer.childNodes.length === 2 && Array.from(failedContainer.childNodes).every((node) => node.nodeType === Node.COMMENT_NODE), "failed replacement leaves a safely empty anchored region");
        value(failedRoot.dispose(), "failed branch root disposal", failedRoot);
        value(failedRuntime.dispose(), "failed branch runtime disposal");
        document.body.removeChild(failedContainer);

        const invalidRuntime = value(await runtimeModule.createReactiveCore(() => wasm), "invalid selector runtime initializes");
        const invalidSignal = value(invalidRuntime.createSignal(false), "invalid selector signal creation");
        const invalidContainer = document.createElement("main");
        document.body.appendChild(invalidContainer);
        const invalidRoot = value(domModule.createRoot(invalidContainer, invalidRuntime), "invalid selector root creation");
        expectError(invalidRoot.mount(conditionalView(invalidSignal, () => success(emptyPlan()), () => success(emptyPlan()), () => success("not boolean"))), "invalid_selector_result", "non-boolean selector is rejected", invalidRoot);
        check(invalidContainer.childNodes.length === 0, "invalid selector mount rolls back anchors");
        value(invalidRoot.dispose(), "invalid selector root disposal", invalidRoot);
        value(invalidRuntime.dispose(), "invalid selector runtime disposal");
        document.body.removeChild(invalidContainer);

        const fragmentRuntime = value(await runtimeModule.createReactiveCore(() => wasm), "fragment runtime initializes");
        const fragmentSignal = value(fragmentRuntime.createSignal(false), "fragment signal creation");
        const fragment = document.createDocumentFragment();
        const fragmentRoot = value(domModule.createRoot(fragment, fragmentRuntime), "DocumentFragment root creation");
        value(fragmentRoot.mount(conditionalView(fragmentSignal, () => success(textBranch("fragment-on", "on")), () => success(emptyPlan()))), "DocumentFragment conditional mount", fragmentRoot);
        check(Array.from(fragment.childNodes).filter((node) => node.nodeType === Node.COMMENT_NODE).length === 2, "DocumentFragment keeps private anchors");
        value(fragmentRuntime.set(fragmentSignal, true), "DocumentFragment selector write");
        value(fragmentRoot.flush(), "DocumentFragment conditional flush", fragmentRoot);
        check(fragment.textContent === "on", "DocumentFragment branch update works");
        value(fragmentRoot.dispose(), "DocumentFragment root disposal", fragmentRoot);
        value(fragmentRuntime.dispose(), "DocumentFragment runtime disposal");

        const compiledRuntime = value(await runtimeModule.createReactiveCore(() => wasm), "compiled conditional runtime initializes");
        const compiledSignal = value(compiledRuntime.createSignal(false), "compiled selector creation");
        const compiledContainer = document.createElement("main");
        document.body.appendChild(compiledContainer);
        const compiledRoot = value(domModule.createRoot(compiledContainer, compiledRuntime), "compiled conditional root creation");
        const compiledView = compiled.createView({ selector: compiledSignal });
        check(compiledView.version === 3, "compiler emits ViewDescription version 3");
        value(compiledRoot.mount(compiledView), "compiled conditional mount", compiledRoot);
        check(compiledContainer.textContent === "compiled off", "compiled false branch renders");
        value(compiledRuntime.set(compiledSignal, true), "compiled selector write");
        check(compiledContainer.textContent === "compiled off", "compiled branch waits for flush");
        value(compiledRoot.flush(), "compiled conditional flush", compiledRoot);
        check(compiledContainer.textContent === "compiled on", "compiled true branch renders");
        value(compiledRoot.dispose(), "compiled conditional disposal", compiledRoot);
        value(compiledRuntime.dispose(), "compiled conditional runtime disposal");
        document.body.removeChild(compiledContainer);

        const interferenceRuntime = value(await runtimeModule.createReactiveCore(() => wasm), "interference runtime initializes");
        const interferenceSignal = value(interferenceRuntime.createSignal(false), "interference signal creation");
        const interferenceContainer = document.createElement("main");
        document.body.appendChild(interferenceContainer);
        const interferenceRoot = value(domModule.createRoot(interferenceContainer, interferenceRuntime), "interference root creation");
        value(interferenceRoot.mount(conditionalView(interferenceSignal, () => success(textBranch("moved-on", "on")), () => success(textBranch("moved-off", "off")))), "interference mount", interferenceRoot);
        const interferenceAnchor = Array.from(interferenceContainer.childNodes).find((node) => node.nodeType === Node.COMMENT_NODE);
        interferenceContainer.removeChild(interferenceAnchor);
        value(interferenceRuntime.set(interferenceSignal, true), "interference selector write");
        expectError(interferenceRoot.flush(), "detached_node", "detached anchor fails closed", interferenceRoot);
        const interferenceCleanup = interferenceRoot.dispose();
        expectError(interferenceCleanup, "root_cleanup_failed", "detached anchor cleanup remains fail-closed", interferenceRoot);
        value(interferenceRuntime.dispose(), "interference runtime disposal");
        document.body.removeChild(interferenceContainer);

        value(runtime.dispose(), "application runtime disposal");
        document.body.removeChild(container);
        window.__ruseactPublish({ ok: true, checks });
      } catch (error) {
        window.__ruseactPublish({ ok: false, checks, error: error instanceof Error ? error.message : String(error) });
      }
    </script>
  </body>
</html>`;
}

const browser = findBrowser();
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "ruseact-m4.4.3-browser-"));
const compilerOutput = mkdtempSync(path.join(repositoryRoot, "target", "m4.4.3-browser-compiler-"));
const generatedRoot = path.join(temporaryRoot, "generated");
cpSync(bindingDirectory, generatedRoot, { recursive: true });
let server;
const requests = [];

try {
  execFileSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "compile_browser_sources.mjs"), compilerOutput,
  ], { cwd: repositoryRoot, stdio: "inherit" });
  writeFileSync(path.join(compilerOutput, "package.json"), JSON.stringify({ type: "module" }));
  const compiler = await import(pathToFileURL(path.join(compilerOutput, "ruseact-compiler", "src", "index.js")));
  const compiled = compiler.compileTsxModule(`export function createView({ selector }) {
  return <div>{ruseact.conditional([selector], ({ runtime }) => runtime.get(selector), () => <b>compiled on</b>, () => <i>compiled off</i>)}</div>;
}`, { fileName: "conditional-browser.tsx" });
  if (!compiled.ok) throw new Error(`conditional compiler fixture failed: ${JSON.stringify(compiled.diagnostics)}`);
  writeFileSync(path.join(temporaryRoot, "compiled_conditional.js"), compiled.code);
  execFileSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "compile_browser_sources.mjs"), temporaryRoot,
  ], { cwd: repositoryRoot, stdio: "inherit" });
  writeFileSync(path.join(temporaryRoot, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(path.join(temporaryRoot, "index.html"), browserPage());
  server = createServer((request, response) => {
    try {
      const requestPath = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      requests.push(requestPath);
      const relativePath = decodeURIComponent(requestPath).replace(/^\/+/, "");
      const requestedFile = path.resolve(temporaryRoot, relativePath);
      const rootPrefix = temporaryRoot.endsWith(path.sep) ? temporaryRoot : `${temporaryRoot}${path.sep}`;
      if (requestedFile !== temporaryRoot && !requestedFile.startsWith(rootPrefix)) {
        response.writeHead(403); response.end("forbidden"); return;
      }
      if (!existsSync(requestedFile)) { response.writeHead(404); response.end("not found"); return; }
      response.writeHead(200, { "content-type": contentType(requestedFile) });
      createReadStream(requestedFile).pipe(response);
    } catch (error) {
      response.writeHead(500); response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address !== null && typeof address === "object");
  const result = await runBrowser(browser.command, [
    "--headless=new", "--no-sandbox", "--no-proxy-server", "--proxy-bypass-list=<-loopback>",
    "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${path.join(temporaryRoot, "chromium-profile")}`, "--virtual-time-budget=30000",
    "--dump-dom", `http://127.0.0.1:${address.port}/index.html`,
  ]);
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`${browser.version} failed with status ${result.status} and signal ${result.signal}: ${result.error?.message ?? result.stderr}\nrequests: ${requests.join(", ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  const encodedResult = result.stdout.match(/data-test-result="([^"]+)"/)?.[1];
  if (encodedResult === undefined) throw new Error(`conditional page did not publish a result; stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const testResult = JSON.parse(decodeURIComponent(encodedResult));
  if (!testResult.ok) throw new Error(`conditional tests failed after ${testResult.checks.length} checks: ${testResult.error}`);
  console.log(`${browser.version} Ruseact M4.4.3 conditional tests passed ${testResult.checks.length} checks`);
} finally {
  if (server !== undefined) await new Promise((resolve) => server.close(resolve));
  rmSync(temporaryRoot, { recursive: true, force: true });
  rmSync(compilerOutput, { recursive: true, force: true });
}
