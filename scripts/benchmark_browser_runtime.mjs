import { execFileSync, spawn } from "node:child_process";
import { createReadStream, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindingDirectory = process.env.RUSEACT_BROWSER_BINDGEN_OUT;
if (bindingDirectory === undefined) {
  throw new Error("RUSEACT_BROWSER_BINDGEN_OUT must point to generated web bindings");
}

const outputPath = path.resolve(
  process.env.RUSEACT_BENCHMARK_OUT ?? "/tmp/ruseact-m2.5-browser-results.json",
);
const summaryPath = path.resolve(
  process.env.RUSEACT_BENCHMARK_SUMMARY_OUT ?? outputPath.replace(/\.json$/u, ".md"),
);

function findBrowser() {
  const candidates = [
    process.env.RUSEACT_BROWSER,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const version = execFileSync(candidate, ["--version"], { encoding: "utf8" }).trim();
      return { command: candidate, version };
    } catch {
      // Continue through the configured candidate list.
    }
  }
  throw new Error("no supported Chromium executable found");
}

function compileRuntime(outputDirectory) {
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
      outputDirectory,
      "packages/ruseact/src/index.ts",
    ],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

function browserPage(sourceSha, browserVersion) {
  const encodedSourceSha = JSON.stringify(sourceSha);
  const encodedBrowserVersion = JSON.stringify(browserVersion);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Ruseact M2.5 browser benchmark</title></head>
<body data-status="pending">
<script type="module">
  import { BENCHMARK_CONFIG, runBenchmarks, summarizeSamples } from "./benchmark_workloads.mjs";

  const sourceSha = ${encodedSourceSha};
  const browserVersion = ${encodedBrowserVersion};

  function publish(value) {
    document.body.dataset.status = value.error === undefined ? "passed" : "failed";
    document.body.dataset.testResult = encodeURIComponent(JSON.stringify(value));
  }

  async function coldSamples(modulePath, runtimePath, runtimeName) {
    const samples = [];
    const count = BENCHMARK_CONFIG.warmups + BENCHMARK_CONFIG.trials;
    for (let trial = 0; trial < count; trial += 1) {
      const started = performance.now();
      if (runtimeName === "direct-wasm") {
        const moduleValue = await import(modulePath + "?m2_5_cold_trial=" + trial);
        await moduleValue.default();
        const core = new moduleValue.WasmCore();
        core.dispose();
        core.free();
      } else {
        const runtimeValue = await import(runtimePath + "?m2_5_cold_trial=" + trial);
        const moduleValue = await import(modulePath + "?m2_5_cold_runtime_trial=" + trial);
        await moduleValue.default();
        const result = await runtimeValue.createReactiveCore(() => moduleValue);
        if (result.ok !== true) throw new Error("cold runtime initialization failed: " + JSON.stringify(result.error));
        const dispose = result.value.dispose();
        if (dispose.ok !== true) throw new Error("cold runtime disposal failed: " + JSON.stringify(dispose.error));
      }
      samples.push((performance.now() - started) * 1000000);
    }
    return samples.slice(BENCHMARK_CONFIG.warmups);
  }

  try {
    const directSamples = await coldSamples("./generated/ruseact_wasm.js", "./runtime/index.js", "direct-wasm");
    const runtimeSamples = await coldSamples("./generated/ruseact_wasm.js", "./runtime/index.js", "typescript-runtime");
    const initializeWasm = (await import("./generated/ruseact_wasm.js")).default;
    const directModule = await import("./generated/ruseact_wasm.js");
    await initializeWasm();
    const runtimeModule = await import("./runtime/index.js");
    const precomputed = [
      summarizeSamples({
        layer: "direct-wasm",
        operation: "cold_wasm_module_initialization",
        size: null,
        graph_size: 0,
        setup_operations: 0,
        timed_operations: 1,
        cleanup: "module instances disposed inside each trial",
      }, directSamples),
      summarizeSamples({
        layer: "typescript-runtime",
        operation: "cold_typescript_runtime_initialization",
        size: null,
        graph_size: 0,
        setup_operations: 0,
        timed_operations: 1,
        cleanup: "module instances disposed inside each trial",
      }, runtimeSamples),
    ];
    const report = await runBenchmarks({
      directModule,
      runtimeModule,
      wasmModule: directModule,
      clock: { now: () => performance.now(), toNs: (value) => value * 1000000 },
      metadata: {
        source_sha: sourceSha,
        browser: browserVersion,
        user_agent: navigator.userAgent,
        host: navigator.platform,
        timer: "performance.now() converted to nanoseconds",
        timer_resolution_note: "browser timer resolution is environment-controlled; small absolute timings are not nanosecond claims",
        layer: "real Chromium web-module WASM plus compiled packages/ruseact runtime",
        wasm_build: "wasm32-unknown-unknown release with wasm-bindgen --target web",
      },
      precomputed,
    });
    publish(report);
  } catch (error) {
    publish({ error: error instanceof Error ? error.message : String(error) });
  }
</script>
</body></html>`;
}

function runBrowser(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 180000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ error, status: null, stdout, stderr }));
    child.on("close", (status, signal) => {
      clearTimeout(timeout);
      resolve({ error: timedOut ? new Error("browser process timed out") : undefined, status, signal, stdout, stderr });
    });
  });
}

function renderSummary(report) {
  const lines = [
    "# M2.5 WASM bridge Chromium benchmark summary",
    "",
    `Source SHA: \`${report.metadata.source_sha}\``,
    `Browser: ${report.metadata.browser}`,
    `Trials: ${report.configuration.trials}; warmups: ${report.configuration.warmups}`,
    "",
    "| Layer | Operation | Size | Kind | Median ns | p95 ns | ns/op | ops/s |",
    "| --- | --- | ---: | --- | ---: | ---: | ---: | ---: |",
  ];
  for (const row of report.results) {
    lines.push(`| ${row.layer} | ${row.operation} | ${row.size ?? "-"} | ${row.value_kind ?? "-"} | ${row.median_ns.toFixed(2)} | ${row.p95_ns.toFixed(2)} | ${row.median_ns_per_operation === null ? "-" : row.median_ns_per_operation.toFixed(3)} | ${row.median_operations_per_second === null ? "-" : row.median_operations_per_second.toFixed(2)} |`);
  }
  lines.push("", "Raw samples and fixture metadata are in the JSON result.", "");
  return `${lines.join("\n")}\n`;
}

const browser = findBrowser();
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "ruseact-m2.5-browser-"));
const runtimeOutput = path.join(temporaryRoot, "runtime");
const generatedOutput = path.join(temporaryRoot, "generated");
mkdirSync(runtimeOutput, { recursive: true });
cpSync(bindingDirectory, generatedOutput, { recursive: true });
cpSync(path.join(repositoryRoot, "scripts/benchmark_workloads.mjs"), path.join(temporaryRoot, "benchmark_workloads.mjs"));

let server;
const requests = [];
try {
  compileRuntime(runtimeOutput);
  writeFileSync(path.join(temporaryRoot, "index.html"), browserPage(
    process.env.RUSEACT_BENCHMARK_SOURCE_SHA ?? "not supplied",
    browser.version,
  ));
  server = createServer((request, response) => {
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
    response.writeHead(200, { "content-type": contentType(requestedFile), "cache-control": "no-store" });
    createReadStream(requestedFile).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address !== "object") throw new Error("browser benchmark server did not bind");
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
    "--virtual-time-budget=180000",
    "--dump-dom",
    `http://127.0.0.1:${address.port}/index.html`,
  ]);
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`${browser.version} failed with status ${result.status}: ${result.error?.message ?? result.stderr}\nrequests: ${requests.join(", ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  const encodedReport = result.stdout.match(/data-test-result="([^"]+)"/)?.[1];
  if (encodedReport === undefined) {
    throw new Error(`browser benchmark did not publish a report\nrequests: ${requests.join(", ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  const report = JSON.parse(decodeURIComponent(encodedReport));
  if (report.error !== undefined) throw new Error(`browser benchmark failed: ${report.error}`);
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(summaryPath, renderSummary(report));
  console.log(`M2.5 Chromium benchmark completed: ${report.results.length} result rows`);
  console.log(`JSON results: ${outputPath}`);
  console.log(`Summary: ${summaryPath}`);
} finally {
  if (server !== undefined) await new Promise((resolve) => server.close(resolve));
  rmSync(temporaryRoot, { recursive: true, force: true });
}
