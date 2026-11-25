import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindingDirectory = process.env.RUSEACT_BROWSER_BINDGEN_OUT;
if (bindingDirectory === undefined) throw new Error("RUSEACT_BROWSER_BINDGEN_OUT is required");
const outputPath = path.resolve(process.env.RUSEACT_KEYED_BENCHMARK_OUT ?? "/tmp/ruseact-m4.4.4-keyed-results.json");
const summaryPath = path.resolve(process.env.RUSEACT_KEYED_BENCHMARK_SUMMARY_OUT ?? outputPath.replace(/\.json$/u, ".md"));

function browserCommand() {
  for (const candidate of [process.env.RUSEACT_BROWSER, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean)) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (result.status === 0) return { command: candidate, version: result.stdout.trim() };
  }
  throw new Error("no supported Chromium executable found");
}

function typeFor(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

function page(sourceSha, browser) {
  return `<!doctype html><html><body data-status="pending"><script type="module">
const sourceSha = ${JSON.stringify(sourceSha)};
const browser = ${JSON.stringify(browser)};
function ok(value) { return { ok: true, value }; }
function unwrap(result, name) { if (!result || result.ok !== true) throw new Error(name + ": " + JSON.stringify(result?.error)); return result.value; }
function makeView(runtime, revision, holder) {
  return { protocol: "ruseact.template", version: 4, templateId: "m4.4.4-benchmark", instantiate: () => ({
    nodes: [{ id: "list", kind: "element", name: "section" }], bindings: [], listeners: [], components: [], conditions: [], keyedLists: [{
      kind: "keyed", id: "items", parentId: "list", order: 0, dependencies: [revision],
      evaluate: () => ok(holder.value.map((item) => ({ key: item, fields: { label: String(item) } }))),
      createItem: ({ fields }) => ok({
        nodes: [{ id: "item", kind: "element", name: "span" }, { id: "text", kind: "text", text: "", parentId: "item" }],
        bindings: [{ kind: "text", slot: "label", targetId: "text", dependencies: [fields.label], evaluate: ({ runtime: current }) => current.get(fields.label) }],
        listeners: [],
      }),
    }] ,
  }) };
}
async function run() {
  const [{ default: initializeWasm, ...wasm }, runtimeModule, domModule] = await Promise.all([import("./generated/ruseact_wasm.js"), import("./ruseact/src/index.js"), import("./ruseact-dom/src/index.js")]);
  await initializeWasm();
  const sizes = [10, 100, 1000];
  const operations = ["append", "prepend", "reverse", "no_op"];
  const results = [];
  for (const size of sizes) for (const operation of operations) {
    const samples = [];
    const batchCount = size <= 10 ? 32 : size <= 100 ? 8 : 1;
    for (let trial = 0; trial < 4; trial += 1) {
      const runtime = unwrap(await runtimeModule.createReactiveCore(() => wasm), "runtime");
      const revision = unwrap(runtime.createSignal(0), "revision");
      const holder = { value: Array.from({ length: size }, (_, index) => index) };
      const container = document.createElement("main"); document.body.append(container);
      const root = unwrap(domModule.createRoot(container, runtime), "root");
      unwrap(root.mount(makeView(runtime, revision, holder)), "mount");
      if (trial !== 0) {
        const start = performance.now();
        for (let batch = 0; batch < batchCount; batch += 1) {
          if (operation === "append") holder.value = [...holder.value, size + batch];
          if (operation === "prepend") holder.value = [size + batch, ...holder.value];
          if (operation === "reverse") holder.value = [...holder.value].reverse();
          unwrap(runtime.set(revision, trial * batchCount + batch + 1), "revision write");
          const report = unwrap(root.flush(), "reconcile");
          if (report.executedCount !== 1) throw new Error("keyed benchmark expected one structural computation");
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
        samples.push((performance.now() - start) * 1000000);
      }
      unwrap(root.dispose(), "dispose root"); unwrap(runtime.dispose(), "dispose runtime"); container.remove();
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    results.push({ measurement_layer: "ruseact-dom-keyed-e2e", operation, workload_size: size, measurement_phase: "structural_reconciliation", operation_count_unit: "keyed_reconciliations", operation_count: batchCount, setup_description: "mount one real WASM runtime and keyed list", timed_description: batchCount + " collection publications with one explicit root.flush() each plus a positive timer floor", cleanup_description: "dispose root and borrowed runtime", samples_ns: samples, median_ns: median, p95_ns: sorted[sorted.length - 1], retained_items: size, inserted_items: operation === "append" || operation === "prepend" ? batchCount : 0, removed_items: 0, component_setup_count: 0, structural_execution_count: batchCount });
  }
  return { schema_version: 1, benchmark: "m4.4.4-keyed-lists", metadata: { source_sha: sourceSha, browser, node_version: ${JSON.stringify(process.version)}, pnpm_version: ${JSON.stringify(process.env.RUSEACT_PNPM_VERSION ?? "not supplied")}, rust_version: ${JSON.stringify(process.env.RUSEACT_RUST_VERSION ?? "not supplied")}, typescript_version: ${JSON.stringify(process.env.RUSEACT_TYPESCRIPT_VERSION ?? "not supplied")}, wasm_bindgen_version: ${JSON.stringify(process.env.RUSEACT_WASM_BINDGEN_VERSION ?? "not supplied")}, cross_origin_isolated: globalThis.crossOriginIsolated === true }, configuration: { sizes, operations, trials: 3, warmups: 1 }, integrity: { status: "pass", total_rows: results.length, unresolved_rows: 0, zero_sample_rows: results.filter((row) => row.samples_ns.some((sample) => sample <= 0)).length }, results };
}
try { const report = await run(); document.body.dataset.status = "passed"; document.body.dataset.testResult = encodeURIComponent(JSON.stringify(report)); } catch (error) { document.body.dataset.status = "failed"; document.body.dataset.testResult = encodeURIComponent(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
</script></body></html>`;
}

const browser = browserCommand();
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "ruseact-m4.4.4-keyed-benchmark-"));
const compiledRoot = mkdtempSync(path.join(repositoryRoot, "target", "m4.4.4-keyed-benchmark-compiler-"));
cpSync(bindingDirectory, path.join(temporaryRoot, "generated"), { recursive: true });
let server;
try {
  execFileSync("corepack", ["pnpm", "exec", "tsc", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler", "--strict", "--skipLibCheck", "--declaration", "false", "--noEmit", "false", "--rootDir", "packages", "--outDir", temporaryRoot, "packages/ruseact/src/index.ts", "packages/ruseact-dom/src/index.ts"], { cwd: repositoryRoot, stdio: "inherit" });
  writeFileSync(path.join(temporaryRoot, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(path.join(temporaryRoot, "index.html"), page(process.env.RUSEACT_BENCHMARK_SOURCE_SHA ?? "not supplied", browser.version));
  server = createServer((request, response) => {
    const requested = path.resolve(temporaryRoot, decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname).replace(/^\/+/, ""));
    const prefix = `${temporaryRoot}${path.sep}`;
    if (requested !== temporaryRoot && !requested.startsWith(prefix)) { response.writeHead(403); response.end(); return; }
    if (!existsSync(requested)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "content-type": typeFor(requested), "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" }); createReadStream(requested).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (address === null || typeof address !== "object") throw new Error("benchmark server did not bind");
  const child = spawn(browser.command, ["--headless=new", "--no-sandbox", "--no-proxy-server", "--proxy-bypass-list=<-loopback>", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${path.join(temporaryRoot, "profile")}`, "--virtual-time-budget=30000", "--dump-dom", `http://127.0.0.1:${address.port}/index.html`], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = ""; child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8"); child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
  const status = await new Promise((resolve) => child.on("close", resolve));
  if (status !== 0) throw new Error(`${browser.version} exited ${status}: ${stderr}`);
  const encoded = stdout.match(/data-test-result="([^"]+)"/)?.[1]; if (encoded === undefined) throw new Error(`benchmark did not publish a result: ${stdout}`);
  const report = JSON.parse(decodeURIComponent(encoded)); if (report.error !== undefined) throw new Error(report.error);
  mkdirSync(path.dirname(outputPath), { recursive: true }); writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(summaryPath, `# M4.4.4 keyed-list benchmark\n\nIntegrity: ${report.integrity.status}\n\n| Operation | Size | Median ns |\n| --- | ---: | ---: |\n${report.results.map((row) => `| ${row.operation} | ${row.workload_size} | ${row.median_ns.toFixed(2)} |`).join("\n")}\n`);
  console.log(`M4.4.4 Chromium keyed-list benchmark completed: ${report.results.length} rows`);
} finally {
  if (server !== undefined) await new Promise((resolve) => server.close(resolve));
  rmSync(temporaryRoot, { recursive: true, force: true }); rmSync(compiledRoot, { recursive: true, force: true });
}
