import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createReadStream, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distributionRoot = path.join(repositoryRoot, "target", "distribution");
const artifactRoot = path.join(distributionRoot, "artifacts");
const version = "0.1.0-alpha.0";
const packageNames = ["ruseact", "ruseact-dom", "ruseact-compiler"];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    stdio: options.stdio ?? "inherit",
    env: process.env,
    ...options,
  });
}

function findBrowser() {
  for (const candidate of [process.env.RUSEACT_BROWSER, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean)) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (result.status === 0) return { command: candidate, version: result.stdout.trim() };
  }
  throw new Error("no supported Chromium executable found");
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
        resolve({ status: null, signal: null, stdout, stderr, error });
      }
    });
    child.on("close", (status, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({ status, signal, stdout, stderr, error: timedOut ? new Error("browser timed out") : undefined });
      }
    });
  });
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

function compileFixture(compiler, source, fileName, outputDirectory) {
  const result = compiler.compileTsxModule(source, { fileName });
  if (!result.ok) throw new Error(`${fileName} compilation failed: ${JSON.stringify(result.diagnostics)}`);
  const outputPath = path.join(outputDirectory, fileName.replace(/\.tsx$/u, ".mjs"));
  writeFileSync(outputPath, result.code);
  return { outputPath, result };
}

function browserPage() {
  return String.raw`<!doctype html>
<html><head><meta charset="utf-8"><title>Ruseact packaged consumer</title>
<script type="importmap">{"imports":{"ruseact":"/node_modules/ruseact/dist/index.js","ruseact-dom":"/node_modules/ruseact-dom/dist/index.js"}}</script>
</head><body data-status="pending"><p>Running packaged consumer checks…</p>
<script>
window.__ruseactPublish = (result) => {
  document.body.dataset.status = result.ok ? "passed" : "failed";
  document.body.dataset.testResult = encodeURIComponent(JSON.stringify(result));
  document.body.textContent = result.ok ? "Packaged consumer checks passed" : "Packaged consumer checks failed";
};
const fail = (message) => { if (document.body.dataset.status === "pending") window.__ruseactPublish({ ok: false, checks: [], error: message }); };
window.addEventListener("error", (event) => fail(event.error?.message ?? event.message));
window.addEventListener("unhandledrejection", (event) => fail(String(event.reason)));
window.setTimeout(() => fail("packaged consumer browser watchdog expired"), 30000);
</script>
<script type="module">
const checks = [];
function check(condition, name) { if (!condition) throw new Error("check failed: " + name); checks.push(name); }
function value(result, name, root) {
  if (!result || result.ok !== true) throw new Error("check failed: " + name + "; result=" + JSON.stringify({ error: result?.error ?? null, rootState: root?.state ?? null }));
  checks.push(name); return result.value;
}
function success(value) { return { ok: true, value }; }
try {
  const [{ default: initializeWasm, ...wasm }, runtimeModule, dom, v1, v2, v3, v4, v3NestedOuter, v3NestedInner] = await Promise.all([
    import("/node_modules/ruseact/wasm/web/ruseact_wasm.js"),
    import("/node_modules/ruseact/dist/index.js"),
    import("/node_modules/ruseact-dom/dist/index.js"),
    import("/v1.mjs"), import("/v2.mjs"), import("/v3.mjs"), import("/v4.mjs"),
    import("/v3-nested-outer.mjs"), import("/v3-nested-inner.mjs"),
  ]);
  await initializeWasm();

  const runtime1 = value(await runtimeModule.createReactiveCore(() => wasm), "installed WASM runtime initializes");
  const staticContainer = document.createElement("main"); document.body.append(staticContainer);
  const staticRoot = value(dom.createRoot(staticContainer, runtime1), "installed renderer root creates");
  value(staticRoot.mount(v1.createView()), "version 1 mounts", staticRoot);
  check(staticContainer.textContent === "Packaged Hello", "version 1 static DOM");
  value(staticRoot.dispose(), "version 1 cleanup", staticRoot); value(runtime1.dispose(), "version 1 runtime cleanup");

  const setupCounts = [];
  const Badge = dom.defineComponent("PackagedBadge", () => { setupCounts.push("badge"); return success({ nodes: [{ id: "badge-text", kind: "text", text: "Component" }], bindings: [], listeners: [] }); });
  const runtime2 = value(await runtimeModule.createReactiveCore(() => wasm), "version 2 runtime initializes");
  const componentContainer = document.createElement("main"); document.body.append(componentContainer);
  const componentRoot = value(dom.createRoot(componentContainer, runtime2), "version 2 root creates");
  value(componentRoot.mount(v2.createView({ Badge })), "version 2 mounts", componentRoot);
  check(componentContainer.textContent === "Component", "version 2 component DOM"); check(setupCounts.length === 1, "version 2 one-shot setup");
  value(componentRoot.dispose(), "version 2 cleanup", componentRoot); value(runtime2.dispose(), "version 2 runtime cleanup");

  const runtime3 = value(await runtimeModule.createReactiveCore(() => wasm), "version 3 runtime initializes");
  const visible = value(runtime3.createSignal(false), "version 3 selector signal");
  const conditionalContainer = document.createElement("main"); document.body.append(conditionalContainer);
  const conditionalRoot = value(dom.createRoot(conditionalContainer, runtime3), "version 3 root creates");
  value(conditionalRoot.mount(v3.createView({ visible })), "version 3 mounts", conditionalRoot);
  const header = conditionalContainer.querySelector("header"); const footer = conditionalContainer.querySelector("footer");
  check(conditionalContainer.textContent === "HeaderOffFooter", "version 3 false branch");
  value(runtime3.set(visible, true), "version 3 selector update"); check(conditionalContainer.textContent === "HeaderOffFooter", "version 3 waits for flush");
  value(conditionalRoot.flush(), "version 3 branch flush", conditionalRoot);
  check(conditionalContainer.textContent === "HeaderOnFooter", "version 3 true branch"); check(conditionalContainer.querySelector("header") === header && conditionalContainer.querySelector("footer") === footer, "version 3 sibling identity");
  value(conditionalRoot.dispose(), "version 3 cleanup", conditionalRoot); value(runtime3.dispose(), "version 3 runtime cleanup");

  const nestedRuntime = value(await runtimeModule.createReactiveCore(() => wasm), "nested packaged runtime initializes");
  const nestedOuter = value(nestedRuntime.createSignal(false), "nested packaged outer selector");
  const nestedInner = value(nestedRuntime.createSignal(false), "nested packaged inner selector");
  let nestedSetupCount = 0;
  const Nested = dom.defineComponent("PackagedNested", () => { nestedSetupCount += 1; return success(v3NestedInner.createView({ selector: nestedInner })); });
  const nestedContainer = document.createElement("main"); document.body.append(nestedContainer);
  const nestedRoot = value(dom.createRoot(nestedContainer, nestedRuntime), "nested packaged root creates");
  const nestedView = v3NestedOuter.createView({ selector: nestedOuter, Nested });
  check(nestedView.version === 3, "nested packaged compiler emits version 3");
  value(nestedRoot.mount(nestedView), "nested packaged r0 mount", nestedRoot);
  check(nestedContainer.textContent === "off" && nestedSetupCount === 0, "nested packaged inactive branch is lazy");
  value(nestedRuntime.set(nestedOuter, true), "nested packaged outer update"); value(nestedRoot.flush(), "nested packaged outer flush", nestedRoot);
  check(nestedContainer.textContent === "off" && nestedSetupCount === 1, "nested packaged component mounts once");
  value(nestedRuntime.set(nestedInner, true), "nested packaged inner update"); value(nestedRoot.flush(), "nested packaged inner flush", nestedRoot);
  check(nestedContainer.textContent === "on" && nestedSetupCount === 1, "nested packaged duplicate r0 updates independently");
  value(nestedRoot.dispose(), "nested packaged cleanup", nestedRoot); value(nestedRuntime.dispose(), "nested packaged runtime cleanup");

  const runtime4 = value(await runtimeModule.createReactiveCore(() => wasm), "version 4 runtime initializes");
  const revision = value(runtime4.createSignal(0), "version 4 revision signal");
  const items = { value: [{ id: "a", label: "A" }, { id: "b", label: "B" }] };
  const keyedContainer = document.createElement("main"); document.body.append(keyedContainer);
  const keyedRoot = value(dom.createRoot(keyedContainer, runtime4), "version 4 root creates");
  const keyedView = v4.createView({ revision, items });
  check(keyedView.version === 4, "version 4 compiler output"); value(keyedRoot.mount(keyedView), "version 4 mounts", keyedRoot);
  check(keyedContainer.textContent === "AB", "version 4 initial items"); const firstItem = keyedContainer.querySelector("li");
  items.value = [{ id: "b", label: "B2" }, { id: "a", label: "A" }]; value(runtime4.set(revision, 1), "version 4 revision update"); value(keyedRoot.flush(), "version 4 structural flush", keyedRoot); value(keyedRoot.flush(), "version 4 deferred binding flush", keyedRoot);
  check(keyedContainer.textContent === "B2A", "version 4 retained data update"); check(keyedContainer.querySelectorAll("li")[1] === firstItem, "version 4 retained node identity");
  value(keyedRoot.dispose(), "version 4 cleanup", keyedRoot); value(runtime4.dispose(), "version 4 runtime cleanup");
  window.__ruseactPublish({ ok: true, checks });
} catch (error) { window.__ruseactPublish({ ok: false, checks, error: error instanceof Error ? error.message : String(error) }); }
</script></body></html>`;
}

function writeConsumerFiles(consumerRoot, compiler) {
  const fixtureRoot = consumerRoot;
  const staticResult = compileFixture(compiler, `export function createView() { return <section><h1>Packaged Hello</h1></section>; }`, "v1.tsx", fixtureRoot);
  const componentResult = compileFixture(compiler, `export function createView({ Badge }) { return <main><Badge /></main>; }`, "v2.tsx", fixtureRoot);
  const conditionalResult = compileFixture(compiler, `export function createView({ visible }) { return <main><header>Header</header>{ruseact.conditional([visible], ({ runtime }) => runtime.get(visible), () => <p>On</p>, () => <p>Off</p>)}<footer>Footer</footer></main>; }`, "v3.tsx", fixtureRoot);
  const keyedResult = compileFixture(compiler, `export function createView({ revision, items }) { return <ul>{ruseact.keyed([revision], ({ runtime }) => ({ ok: true, value: items.value.map((item) => ({ key: item.id, fields: { label: item.label } })) }), ({ fields }) => <li>{ruseact.bindText([fields.label], ({ runtime: currentRuntime }) => currentRuntime.get(fields.label))}</li>)}</ul>; }`, "v4.tsx", fixtureRoot);
  const nestedOuterResult = compileFixture(compiler, `export function createView({ selector, Nested }) { return <div>{ruseact.conditional([selector], ({ runtime }) => runtime.get(selector), () => <Nested />, () => <p>off</p>)}</div>; }`, "v3-nested-outer.tsx", fixtureRoot);
  const nestedInnerResult = compileFixture(compiler, `export function createView({ selector }) { return <section>{ruseact.conditional([selector], ({ runtime }) => runtime.get(selector), () => <b>on</b>, () => <i>off</i>)}</section>; }`, "v3-nested-inner.tsx", fixtureRoot);
  for (const result of [staticResult, componentResult, conditionalResult, keyedResult, nestedOuterResult, nestedInnerResult]) assert.equal(result.result.ok, true);
  assert.equal(nestedOuterResult.result.metadata.slots.find((slot) => slot.kind === "conditional")?.id, "r0");
  assert.equal(nestedInnerResult.result.metadata.slots.find((slot) => slot.kind === "conditional")?.id, "r0");
  writeFileSync(path.join(consumerRoot, "index.html"), browserPage());
}

function runRuntimeOnlyConsumer() {
  const runtimeOnlyRoot = mkdtempSync(path.join(tmpdir(), "ruseact-runtime-only-consumer-"));
  try {
    const copiedArtifacts = path.join(runtimeOnlyRoot, "artifacts");
    mkdirSync(copiedArtifacts, { recursive: true });
    for (const name of ["ruseact", "ruseact-dom"]) {
      const fileName = `${name}-${version}.tgz`;
      cpSync(path.join(artifactRoot, fileName), path.join(copiedArtifacts, fileName));
    }
    writeFileSync(path.join(runtimeOnlyRoot, "package.json"), `${JSON.stringify({
      name: "ruseact-runtime-only-consumer",
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies: {
        ruseact: `file:./artifacts/ruseact-${version}.tgz`,
        "ruseact-dom": `file:./artifacts/ruseact-dom-${version}.tgz`,
      },
    }, null, 2)}\n`);
    writeFileSync(path.join(runtimeOnlyRoot, "pnpm-workspace.yaml"), `overrides:\n  ruseact: file:./artifacts/ruseact-${version}.tgz\n`);
    run("corepack", ["pnpm", "install", "--offline"], { cwd: runtimeOnlyRoot });
    if (existsSync(path.join(runtimeOnlyRoot, "node_modules", "ruseact-compiler"))) throw new Error("runtime-only consumer installed compiler tooling");
    const smokePath = path.join(runtimeOnlyRoot, "runtime-only.mjs");
    writeFileSync(smokePath, `import * as wasm from "ruseact/wasm/node";\nimport { createReactiveCore } from "ruseact";\nimport { createRoot } from "ruseact-dom";\nconst runtime = await createReactiveCore(() => wasm);\nif (!runtime.ok) throw new Error(JSON.stringify(runtime.error));\nconst signal = runtime.value.createSignal("runtime-only");\nif (!signal.ok || runtime.value.get(signal.value).value !== "runtime-only") throw new Error("runtime-only runtime failed");\nif (typeof createRoot !== "function") throw new Error("runtime-only DOM entry failed");\nconst disposed = runtime.value.dispose(); if (!disposed.ok) throw new Error(JSON.stringify(disposed.error));\nconsole.log("runtime-only consumer passed");\n`);
    run(process.execPath, [smokePath], { cwd: runtimeOnlyRoot });
  } finally {
    rmSync(runtimeOnlyRoot, { recursive: true, force: true });
  }
}

const manifestPath = path.join(distributionRoot, "distribution-manifest.json");
if (!existsSync(manifestPath)) run("corepack", ["pnpm", "build:distribution"]);
if (!existsSync(path.join(artifactRoot, `ruseact-${version}.tgz`))) run("corepack", ["pnpm", "pack:packages"]);

const consumerRoot = mkdtempSync(path.join(tmpdir(), "ruseact-package-consumer-"));
let server;
try {
  const copiedArtifacts = path.join(consumerRoot, "artifacts");
  mkdirSync(copiedArtifacts, { recursive: true });
  for (const name of packageNames) {
    const fileName = `${name}-${version}.tgz`;
    cpSync(path.join(artifactRoot, fileName), path.join(copiedArtifacts, fileName));
  }
  writeFileSync(path.join(consumerRoot, "package.json"), `${JSON.stringify({
    name: "ruseact-isolated-consumer",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: Object.fromEntries(packageNames.map((name) => [name, `file:./artifacts/${name}-${version}.tgz`])),
    devDependencies: { typescript: "5.9.3" },
  }, null, 2)}\n`);
  writeFileSync(path.join(consumerRoot, "pnpm-workspace.yaml"), `overrides:\n  ruseact: file:./artifacts/ruseact-${version}.tgz\n`);
  run("corepack", ["pnpm", "install", "--offline"], { cwd: consumerRoot });

  writeFileSync(path.join(consumerRoot, "typecheck.ts"), `import { createReactiveCore, type ReactiveCore, type SignalHandle } from "ruseact";\nimport { createRoot, defineComponent, type ViewDescriptionV4 } from "ruseact-dom";\nimport { compileTsxModule, type CompileResult } from "ruseact-compiler";\nconst core: ReactiveCore | undefined = undefined;\nconst signal: SignalHandle<number> | undefined = undefined;\nconst view: ViewDescriptionV4 | undefined = undefined;\nconst component = defineComponent("consumer", () => ({ ok: true, value: { nodes: [], bindings: [], listeners: [], components: [], conditions: [], keyedLists: [] } }));\nvoid createReactiveCore; void createRoot; void core; void signal; void view; void component; void ({} as CompileResult);\n`);
  writeFileSync(path.join(consumerRoot, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, skipLibCheck: false },
    include: ["typecheck.ts"],
  }, null, 2));
  run("corepack", ["pnpm", "exec", "tsc", "--project", "tsconfig.json"], { cwd: consumerRoot });

  const compiler = await import(pathToFileURL(path.join(consumerRoot, "node_modules", "ruseact-compiler", "dist", "index.js")));
  const nodeSmoke = path.join(consumerRoot, "node-smoke.mjs");
  writeFileSync(nodeSmoke, `import * as wasm from "ruseact/wasm/node";\nimport { createReactiveCore } from "ruseact";\nimport { compileTsxModule } from "ruseact-compiler";\nconst result = await createReactiveCore(() => wasm);\nif (!result.ok) throw new Error(JSON.stringify(result.error));\nconst signal = result.value.createSignal(1);\nif (!signal.ok || result.value.get(signal.value).value !== 1) throw new Error("installed Node runtime smoke failed");\nif (result.value.set(signal.value, 2).value !== "changed") throw new Error("installed Node signal update failed");\nif (!compileTsxModule("const view = <div />;", { fileName: "node.tsx" }).ok) throw new Error("installed compiler smoke failed");\nconst disposed = result.value.dispose(); if (!disposed.ok) throw new Error(JSON.stringify(disposed.error));\nconsole.log("installed Node runtime/compiler smoke passed");\n`);
  run(process.execPath, [nodeSmoke], { cwd: consumerRoot });
  writeConsumerFiles(consumerRoot, compiler);

  const browser = findBrowser();
  server = createServer((request, response) => {
    try {
      const requestPath = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      const relativePath = decodeURIComponent(requestPath).replace(/^\/+/, "");
      const requestedFile = path.resolve(consumerRoot, relativePath);
      const rootPrefix = consumerRoot.endsWith(path.sep) ? consumerRoot : `${consumerRoot}${path.sep}`;
      if (requestedFile !== consumerRoot && !requestedFile.startsWith(rootPrefix)) { response.writeHead(403); response.end("forbidden"); return; }
      if (!existsSync(requestedFile)) { response.writeHead(404); response.end("not found"); return; }
      response.writeHead(200, { "content-type": contentType(requestedFile) });
      createReadStream(requestedFile).pipe(response);
    } catch (error) { response.writeHead(500); response.end(error instanceof Error ? error.message : String(error)); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const browserResult = await runBrowser(browser.command, [
    "--headless=new", "--no-sandbox", "--no-proxy-server", "--proxy-bypass-list=<-loopback>", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${path.join(consumerRoot, "chromium-profile")}`, "--virtual-time-budget=30000", "--dump-dom", `http://127.0.0.1:${address.port}/index.html`,
  ]);
  if (browserResult.error || browserResult.status !== 0) throw new Error(`packaged Chromium failed: ${browserResult.error?.message ?? browserResult.stderr}`);
  const encoded = browserResult.stdout.match(/data-test-result="([^"]+)"/)?.[1];
  if (!encoded) throw new Error(`packaged browser did not publish a result: ${browserResult.stdout}`);
  const browserTest = JSON.parse(decodeURIComponent(encoded));
  if (!browserTest.ok) throw new Error(`packaged browser failed after ${browserTest.checks.length} checks: ${browserTest.error}`);
  console.log(`isolated package consumer passed ${browserTest.checks.length} Chromium checks`);
  runRuntimeOnlyConsumer();
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  rmSync(consumerRoot, { recursive: true, force: true });
}
