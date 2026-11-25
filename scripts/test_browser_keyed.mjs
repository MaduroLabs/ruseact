import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindingDirectory = process.env.RUSEACT_BROWSER_BINDGEN_OUT;
if (bindingDirectory === undefined) throw new Error("RUSEACT_BROWSER_BINDGEN_OUT is required");
for (const file of ["ruseact_wasm.js", "ruseact_wasm_bg.wasm"]) {
  if (!existsSync(path.join(bindingDirectory, file))) throw new Error(`missing browser binding output: ${file}`);
}

function findBrowser() {
  for (const candidate of [process.env.RUSEACT_BROWSER, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean)) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (result.status === 0) return { command: candidate, version: result.stdout.trim() };
  }
  throw new Error("no Chromium executable found");
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

function runBrowser(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let settled = false;
    const timeout = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timeout); resolve({ error, stdout, stderr, status: null }); } });
    child.on("close", (status, signal) => { if (!settled) { settled = true; clearTimeout(timeout); resolve({ error: undefined, stdout, stderr, status, signal }); } });
  });
}

function browserPage() {
  return String.raw`<!doctype html><html><body data-status="pending"><script>
window.__ruseactPublish = (result) => {
  document.body.dataset.status = result.ok ? "passed" : "failed";
  document.body.dataset.testResult = encodeURIComponent(JSON.stringify(result));
  document.body.textContent = result.ok ? "Ruseact keyed-list tests passed" : "Ruseact keyed-list tests failed";
};
const publishFailure = (message) => { if (document.body.dataset.status === "pending") window.__ruseactPublish({ ok: false, checks: [], error: message }); };
window.addEventListener("error", (event) => publishFailure(event.error?.message ?? event.message));
window.addEventListener("unhandledrejection", (event) => publishFailure(String(event.reason)));
window.setTimeout(() => publishFailure("keyed watchdog expired"), 30000);
</script><script type="module">
const checks = [];
function check(condition, name) { if (!condition) throw new Error("check failed: " + name); checks.push(name); }
function success(value) { return { ok: true, value }; }
function details(result, root) {
  const error = result?.error ?? {};
  return JSON.stringify({ kind: error.kind ?? null, code: error.code ?? null, operation: error.operation ?? null, resource: error.resource ?? null, message: error.message ?? null, rootState: root?.state ?? null });
}
function value(result, name, root) { if (!result?.ok) throw new Error("check failed: " + name + "; result=" + details(result, root)); checks.push(name); return result.value; }
function expectError(result, code, name, root) { if (result?.ok !== false) throw new Error("check failed: " + name + "; result=" + details(result, root)); check(true, name + ": result"); if (result.error?.code !== code) throw new Error("check failed: " + name + "; expected " + code + "; result=" + details(result, root)); check(true, name + ": " + code); }
function emptyPlan() { return { nodes: [], bindings: [], listeners: [] }; }
function itemPlan(environment, setupCounts, clicks) {
  const textId = "item-text";
  const buttonId = "item-button";
  return success({
    nodes: [
      { id: buttonId, kind: "element", name: "button" },
      { id: textId, kind: "text", text: "", parentId: buttonId },
    ],
    bindings: [{ kind: "text", slot: "item-label", targetId: textId, dependencies: [environment.fields.label], evaluate: ({ runtime }) => runtime.get(environment.fields.label) }],
    listeners: [{ id: "item-click", targetId: buttonId, type: "click", listener: () => { clicks.push(environment.key); } }],
  });
}
function listView(revision, collectionRef, setupCounts, clicks) {
  return { protocol: "ruseact.template", version: 4, templateId: "m4.4.4-keyed", instantiate: () => ({
    nodes: [{ id: "before", kind: "element", name: "header", order: 0 }, { id: "list", kind: "element", name: "section", order: 1 }, { id: "after", kind: "element", name: "footer", order: 2 }],
    bindings: [], listeners: [], components: [], conditions: [], keyedLists: [{
      kind: "keyed", id: "items", parentId: "list", order: 0, dependencies: [revision],
      evaluate: () => success(collectionRef.value.map((item) => ({ key: item.key, fields: { label: item.label, ...(item.extra === undefined ? {} : { extra: item.extra }) } }))),
      createItem: (environment) => { setupCounts.push(environment.key); return itemPlan(environment, setupCounts, clicks); },
    }],
  }) };
}
try {
  const [{ default: initializeWasm, ...wasm }, runtimeModule, domModule, compiled] = await Promise.all([
    import("./generated/ruseact_wasm.js"), import("./ruseact/src/index.js"), import("./ruseact-dom/src/index.js"), import("./compiled_keyed.js"),
  ]);
  await initializeWasm();
  const runtime = value(await runtimeModule.createReactiveCore(() => wasm), "real runtime initializes");
  const revision = value(runtime.createSignal(0), "revision signal creation");
  const collectionRef = { value: [{ key: "a", label: "A" }, { key: 2, label: "B" }, { key: true, label: "C" }] };
  const setupCounts = []; const clicks = [];
  const container = document.createElement("main");
  const unrelatedBefore = document.createElement("aside"); unrelatedBefore.textContent = "before";
  const unrelatedAfter = document.createElement("aside"); unrelatedAfter.textContent = "after";
  container.append(unrelatedBefore, unrelatedAfter); document.body.append(container);
  const root = value(domModule.createRoot(container, runtime), "keyed root creation");
  value(root.mount(listView(revision, collectionRef, setupCounts, clicks)), "initial keyed mount", root);
  const header = container.querySelector("header"); const footer = container.querySelector("footer");
  const itemButtons = () => Array.from(container.querySelectorAll("section > button"));
  const labels = () => itemButtons().map((button) => button.textContent);
  check(labels().join(",") === "A,B,C", "initial keyed order");
  check(setupCounts.length === 3, "initial setup once per item");
  const initialButtons = new Map([["a", itemButtons()[0]], [2, itemButtons()[1]], [true, itemButtons()[2]]]);
  initialButtons.get(2).focus();
  check(document.activeElement === initialButtons.get(2), "initial retained input focus target is active");

  collectionRef.value = [{ key: true, label: "C" }, { key: "a", label: "A" }, { key: 2, label: "B" }, { key: "new", label: "D" }];
  value(runtime.set(revision, 1), "revision write for reorder");
  check(labels().join(",") === "A,B,C", "reorder waits for explicit flush");
  const reorderReport = value(root.flush(), "reorder flush", root);
  check(reorderReport.drainedCount === 1, "reorder schedules one keyed computation (drained " + reorderReport.drainedCount + ")");
  check(labels().join(",") === "C,A,B,D", "arbitrary reorder and append (got " + labels().join(",") + ")");
  check(setupCounts.length === 4 && setupCounts.filter((key) => key === "new").length === 1, "only inserted item sets up");
  check(container.querySelector("header") === header && container.querySelector("footer") === footer, "unrelated sibling identities survive reorder");
  check(initialButtons.get("a") === itemButtons()[1] && initialButtons.get(2) === itemButtons()[2] && initialButtons.get(true) === itemButtons()[0], "retained DOM identities survive reorder");
  check(document.activeElement === initialButtons.get(2) || document.activeElement === document.body, "native range movement reports browser focus behavior");

  const beforeNoop = itemButtons().slice();
  collectionRef.value = [{ key: true, label: "C" }, { key: "a", label: "A" }, { key: 2, label: "B" }, { key: "new", label: "D" }];
  value(runtime.set(revision, 2), "revision write for no-op");
  const noop = value(root.flush(), "no-op flush", root);
  check(labels().join(",") === "C,A,B,D", "no-op order remains stable");
  check(itemButtons().every((button, index) => button === beforeNoop[index]), "no-op preserves DOM identities");
  check(setupCounts.length === 4 && noop.executedCount === 1, "no-op executes only the structural snapshot");

  collectionRef.value = [{ key: 2, label: "B updated" }, { key: true, label: "C" }];
  value(runtime.set(revision, 3), "revision write for retained data");
  const retainedFlush = value(root.flush(), "retained data flush", root);
  check(retainedFlush.executedCount === 1, "retained data structural update executes once");
  const deferred = value(root.flush(), "deferred retained binding flush", root);
  check(labels().join(",") === "B updated,C", "retained scalar data updates after deferred flush");
  check(setupCounts.length === 4, "retained data does not rerun item setup");
  check(initialButtons.get(2) === itemButtons()[0], "retained key DOM is preserved during data update");

  collectionRef.value = [{ key: 2, label: "B updated" }, { key: 2, label: "duplicate" }];
  value(runtime.set(revision, 4), "revision write for duplicate validation");
  expectError(root.flush(), "duplicate_key", "duplicate keys fail before mutation", root);
  check(labels().join(",") === "B updated,C", "duplicate validation preserves published list");
  collectionRef.value = [{ key: 2, label: "B updated", extra: "incompatible" }, { key: true, label: "C" }];
  value(runtime.set(revision, 5), "revision write for schema validation");
  expectError(root.flush(), "invalid_item_schema", "retained schema mismatch fails before mutation", root);
  check(labels().join(",") === "B updated,C", "schema validation preserves published list");
  for (const [index, [invalidKey, code]] of [[NaN, "invalid_key"], [Infinity, "invalid_key"], [{}, "invalid_key"]].entries()) {
    collectionRef.value = [{ key: invalidKey, label: "invalid" }];
    value(runtime.set(revision, 6 + index), "revision write for invalid key");
    expectError(root.flush(), code, "invalid key fails before mutation", root);
    check(labels().join(",") === "B updated,C", "invalid key preserves published list");
  }
  collectionRef.value = [{ key: 0, label: "zero" }, { key: -0, label: "negative zero" }];
  value(runtime.set(revision, 9), "revision write for signed zero duplicate");
  expectError(root.flush(), "duplicate_key", "signed zero keys use SameValueZero", root);
  check(labels().join(",") === "B updated,C", "signed zero validation preserves published list");

  collectionRef.value = [{ key: 1, label: "numeric" }, { key: "1", label: "string" }, { key: true, label: "boolean" }];
  value(runtime.set(revision, 10), "revision write for distinct key types");
  value(root.flush(), "distinct key type flush", root);
  value(root.flush(), "distinct key deferred binding flush", root);
  check(labels().join(",") === "numeric,string,boolean", "numeric string and boolean keys remain distinct (got " + labels().join(",") + ")");
  check(setupCounts.length === 6, "distinct keys initialize independently");

  collectionRef.value = [{ key: "stress-a", label: "A" }, { key: "stress-b", label: "B" }];
  value(runtime.set(revision, 11), "revision write for stress insertion");
  value(root.flush(), "stress insertion flush", root);
  const stressA = itemButtons()[0]; const stressB = itemButtons()[1];
  check(setupCounts.length === 8, "stress insertion creates only new items");
  collectionRef.value = [{ key: "stress-b", label: "B" }, { key: "stress-a", label: "A" }];
  value(runtime.set(revision, 12), "revision write for stress reorder");
  value(root.flush(), "stress reorder flush", root);
  check(itemButtons()[0] === stressB && itemButtons()[1] === stressA, "stress reorder preserves both item nodes");
  collectionRef.value = [{ key: "stress-a", label: "A" }, { key: "stress-c", label: "C" }];
  value(runtime.set(revision, 13), "revision write for stress removal");
  value(root.flush(), "stress removal flush", root);
  check(setupCounts.length === 9, "stress removal creates only the replacement item");
  const removedStressB = stressB;
  collectionRef.value = [{ key: "stress-b", label: "B" }, { key: "stress-a", label: "A" }];
  value(runtime.set(revision, 14), "revision write for stress reinsertion");
  value(root.flush(), "stress reinsertion flush", root);
  check(setupCounts.length === 10, "removed key reinsertion receives a fresh activation");
  check(itemButtons()[0] !== removedStressB, "removed key does not resurrect its old DOM node");

  value(root.unmount(), "keyed root unmount", root);
  check(container.contains(unrelatedBefore) && container.contains(unrelatedAfter), "unmount preserves unrelated DOM");
  value(root.dispose(), "keyed root disposal", root);
  check(value(runtime.get(revision), "borrowed revision survives cleanup") === 14, "borrowed signal survives root cleanup");
  value(runtime.dispose(), "application runtime disposal");
  document.body.removeChild(container);

  const compiledRuntime = value(await runtimeModule.createReactiveCore(() => wasm), "compiled runtime initializes");
  const compiledRevision = value(compiledRuntime.createSignal(0), "compiled revision creation");
  const compiledItems = { value: [{ id: "x", label: "Compiled" }] };
  const compiledContainer = document.createElement("main"); document.body.append(compiledContainer);
  const compiledRoot = value(domModule.createRoot(compiledContainer, compiledRuntime), "compiled keyed root creation");
  const compiledView = compiled.createView({ revision: compiledRevision, items: compiledItems });
  check(compiledView.version === 4, "compiler emits version 4 keyed view");
  value(compiledRoot.mount(compiledView), "compiled keyed mount", compiledRoot);
  check(compiledContainer.textContent === "Compiled", "compiled keyed item renders");
  compiledItems.value = [{ id: "x", label: "Compiled updated" }];
  value(compiledRuntime.set(compiledRevision, 1), "compiled revision write");
  value(compiledRoot.flush(), "compiled keyed structural flush", compiledRoot);
  value(compiledRoot.flush(), "compiled keyed deferred binding flush", compiledRoot);
  check(compiledContainer.textContent === "Compiled updated", "compiled retained scalar data updates");
  value(compiledRoot.dispose(), "compiled keyed disposal", compiledRoot);
  value(compiledRuntime.dispose(), "compiled runtime disposal");
  document.body.removeChild(compiledContainer);
  window.__ruseactPublish({ ok: true, checks });
} catch (error) {
  window.__ruseactPublish({ ok: false, checks, error: error instanceof Error ? error.message : String(error) });
}
</script></body></html>`;
}

const browser = findBrowser();
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "ruseact-m4.4.4-browser-"));
const compilerOutput = mkdtempSync(path.join(repositoryRoot, "target", "m4.4.4-browser-compiler-"));
cpSync(bindingDirectory, path.join(temporaryRoot, "generated"), { recursive: true });
let server;
try {
  execFileSync("corepack", ["pnpm", "exec", "tsc", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler", "--strict", "--skipLibCheck", "--declaration", "false", "--noEmit", "false", "--rootDir", "packages", "--outDir", compilerOutput, "packages/ruseact/src/index.ts", "packages/ruseact-dom/src/index.ts", "packages/ruseact-compiler/src/index.ts"], { cwd: repositoryRoot, stdio: "inherit" });
  writeFileSync(path.join(compilerOutput, "package.json"), JSON.stringify({ type: "module" }));
  const compiler = await import(pathToFileURL(path.join(compilerOutput, "ruseact-compiler", "src", "index.js")));
  const compiled = compiler.compileTsxModule(`export function createView({ revision, items }) {
  return <section>{ruseact.keyed([revision],
    ({ runtime }) => ({ ok: true, value: items.value.map((item) => ({ key: item.id, fields: { label: item.label } })) }),
    ({ fields }) => <span>{ruseact.bindText([fields.label], ({ runtime: currentRuntime }) => currentRuntime.get(fields.label))}</span>
  )}</section>;
}`, { fileName: "keyed-browser.tsx" });
  if (!compiled.ok) throw new Error(`keyed compiler fixture failed: ${JSON.stringify(compiled.diagnostics)}`);
  writeFileSync(path.join(temporaryRoot, "compiled_keyed.js"), compiled.code);
  execFileSync("corepack", ["pnpm", "exec", "tsc", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler", "--strict", "--skipLibCheck", "--declaration", "false", "--noEmit", "false", "--rootDir", "packages", "--outDir", temporaryRoot, "packages/ruseact/src/index.ts", "packages/ruseact-dom/src/index.ts"], { cwd: repositoryRoot, stdio: "inherit" });
  writeFileSync(path.join(temporaryRoot, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(path.join(temporaryRoot, "index.html"), browserPage());
  server = createServer((request, response) => {
    try {
      const requestPath = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      const requestedFile = path.resolve(temporaryRoot, decodeURIComponent(requestPath).replace(/^\/+/, ""));
      const prefix = `${temporaryRoot}${path.sep}`;
      if (requestedFile !== temporaryRoot && !requestedFile.startsWith(prefix)) { response.writeHead(403); response.end("forbidden"); return; }
      if (!existsSync(requestedFile)) { response.writeHead(404); response.end("not found"); return; }
      response.writeHead(200, { "content-type": contentType(requestedFile) }); createReadStream(requestedFile).pipe(response);
    } catch (error) { response.writeHead(500); response.end(error instanceof Error ? error.message : String(error)); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address !== null && typeof address === "object");
  const result = await runBrowser(browser.command, ["--headless=new", "--no-sandbox", "--no-proxy-server", "--proxy-bypass-list=<-loopback>", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${path.join(temporaryRoot, "chromium-profile")}`, "--virtual-time-budget=30000", "--dump-dom", `http://127.0.0.1:${address.port}/index.html`]);
  if (result.status !== 0 || result.error !== undefined) throw new Error(`${browser.version} failed: ${result.error?.message ?? result.stderr}\n${result.stdout}`);
  const encoded = result.stdout.match(/data-test-result="([^"]+)"/)?.[1];
  if (encoded === undefined) throw new Error(`keyed page did not publish a result\n${result.stdout}\n${result.stderr}`);
  const testResult = JSON.parse(decodeURIComponent(encoded));
  if (!testResult.ok) throw new Error(`keyed tests failed after ${testResult.checks.length} checks: ${testResult.error}`);
  console.log(`${browser.version} Ruseact M4.4.4 keyed-list tests passed ${testResult.checks.length} checks`);
} finally {
  if (server !== undefined) await new Promise((resolve) => server.close(resolve));
  rmSync(temporaryRoot, { recursive: true, force: true });
  rmSync(compilerOutput, { recursive: true, force: true });
}
