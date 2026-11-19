import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindgenDirectory = process.env.RUSEACT_WASM_BINDGEN_OUT;
if (bindgenDirectory === undefined) {
  throw new Error("RUSEACT_WASM_BINDGEN_OUT must point to generated Node/WASM bindings");
}

const modulePath = path.join(path.resolve(bindgenDirectory), "ruseact_wasm.js");
if (!existsSync(modulePath)) {
  throw new Error(`generated Node/WASM module does not exist: ${modulePath}`);
}

const outputPath = path.resolve(
  process.env.RUSEACT_BENCHMARK_OUT ?? "/tmp/ruseact-m2.5-node-results.json",
);
const summaryPath = path.resolve(
  process.env.RUSEACT_BENCHMARK_SUMMARY_OUT ?? outputPath.replace(/\.json$/u, ".md"),
);

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
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--strict",
      "--skipLibCheck",
      "--declaration",
      "false",
      "--noEmit",
      "false",
      "--outDir",
      outputDirectory,
      "packages/ruseact/src/index.ts",
    ],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  writeFileSync(path.join(outputDirectory, "package.json"), '{"type":"module"}\n');
}

async function coldInitializationSamples(moduleUrl, runtimeUrl, runtimeName, count, clock) {
  const samples = [];
  for (let trial = 0; trial < count; trial += 1) {
    const started = clock.now();
    if (runtimeName === "direct-wasm") {
      const moduleValue = await awaitImport(moduleUrl, trial);
      const core = new moduleValue.WasmCore();
      core.dispose();
      core.free();
    } else {
      const runtimeModule = await awaitImport(runtimeUrl, trial);
      const wasmModule = await awaitImport(moduleUrl, trial);
      const result = await runtimeModule.createReactiveCore(async () => wasmModule);
      if (result.ok !== true) throw new Error(`cold runtime initialization failed: ${JSON.stringify(result.error)}`);
      const dispose = result.value.dispose();
      if (dispose.ok !== true) throw new Error(`cold runtime disposal failed: ${JSON.stringify(dispose.error)}`);
    }
    samples.push(clock.toNs(clock.now() - started));
  }
  return samples;
}

function awaitImport(url, trial) {
  return import(`${url}?m2_5_cold_trial=${trial}`);
}

function estimateTimerResolutionNs() {
  let previous = process.hrtime.bigint();
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < 10000; index += 1) {
    const current = process.hrtime.bigint();
    if (current > previous) minimum = Math.min(minimum, Number(current - previous));
    previous = current;
  }
  return Number.isFinite(minimum) ? minimum : 1;
}

function renderSummary(report) {
  const lines = [
    "# M2.5 WASM bridge Node benchmark summary",
    "",
    `Source SHA: \`${report.metadata.source_sha}\``,
    `Node: ${report.metadata.node_version}`,
    `Trials: ${report.configuration.trials}; warmups: ${report.configuration.warmups}`,
    `Integrity: ${report.integrity.status}; valid rows: ${report.integrity.valid_rows}; unresolved rows: ${report.integrity.unresolved_rows}; zero-sample rows: ${report.integrity.zero_sample_rows}`,
    `Timer resolution estimate: ${report.metadata.timer_resolution_ns ?? "unavailable"} ns`,
    "",
    "| Layer | Operation | Size | Kind | Batches | Timed ops | Median ns | p95 ns | ns/op | ops/s |",
    "| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of report.results) {
    lines.push(`| ${row.layer} | ${row.operation} | ${row.size ?? "-"} | ${row.value_kind ?? "-"} | ${row.calibration_batches} | ${row.timed_operations} | ${row.median_ns.toFixed(2)} | ${row.p95_ns.toFixed(2)} | ${row.median_ns_per_operation === null ? "-" : row.median_ns_per_operation.toFixed(3)} | ${row.median_operations_per_second === null ? "-" : row.median_operations_per_second.toFixed(2)} |`);
  }
  lines.push("", "Raw samples and fixture metadata are in the JSON result.", "");
  return `${lines.join("\n")}\n`;
}

const runtimeOutput = mkdtempSync(path.join(os.tmpdir(), "ruseact-m2.5-runtime-"));
try {
  compileRuntime(runtimeOutput);
  const workloads = await import(pathToFileURL(path.join(repositoryRoot, "scripts/benchmark_workloads.mjs")).href);
  const directModule = await import(pathToFileURL(modulePath).href);
  const runtimeModule = await import(pathToFileURL(path.join(runtimeOutput, "index.js")).href);
  const timerResolutionNs = estimateTimerResolutionNs();
  const clock = {
    now: () => process.hrtime.bigint(),
    toNs: (value) => Number(value),
    resolutionNs: timerResolutionNs,
  };

  const coldCount = workloads.BENCHMARK_CONFIG.warmups + workloads.BENCHMARK_CONFIG.trials;
  const precomputed = [];
  for (const runtimeName of ["direct-wasm", "typescript-runtime"]) {
    const samples = await coldInitializationSamples(
      pathToFileURL(modulePath).href,
      pathToFileURL(path.join(runtimeOutput, "index.js")).href,
      runtimeName,
      coldCount,
      clock,
    );
    const measured = samples.slice(workloads.BENCHMARK_CONFIG.warmups);
    precomputed.push(workloads.summarizeSamples({
      layer: runtimeName,
      operation: runtimeName === "direct-wasm" ? "cold_wasm_module_initialization" : "cold_typescript_runtime_initialization",
      size: null,
      graph_size: 0,
      setup_operations: 0,
      timed_operations: 1,
      cleanup: "child module instances disposed inside each trial",
      warmups: workloads.BENCHMARK_CONFIG.warmups,
    }, measured));
  }

  const report = await workloads.runBenchmarks({
    directModule,
    runtimeModule,
    wasmModule: directModule,
    clock,
    metadata: {
      source_sha: process.env.RUSEACT_BENCHMARK_SOURCE_SHA ?? "not supplied",
      host: `${os.platform()} ${os.release()} ${os.arch()}`,
      cpu_count: os.cpus().length,
      node_version: process.version,
      rust_version: process.env.RUSEACT_RUST_VERSION ?? "1.99.0 (repository pin)",
      wasm_bindgen_version: process.env.RUSEACT_WASM_BINDGEN_VERSION ?? "0.2.130 (repository pin)",
      timer: "process.hrtime.bigint()",
      timer_resolution_ns: timerResolutionNs,
      layer: "Node.js generated wasm-bindgen Node/WASM plus compiled packages/ruseact runtime",
      wasm_build: "wasm32-unknown-unknown release",
    },
    precomputed,
  });

  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(summaryPath, renderSummary(report));
  readFileSync(outputPath);
  console.log(`M2.5 Node benchmark completed: ${report.results.length} result rows`);
  console.log(`JSON results: ${outputPath}`);
  console.log(`Summary: ${summaryPath}`);
} finally {
  rmSync(runtimeOutput, { recursive: true, force: true });
}
