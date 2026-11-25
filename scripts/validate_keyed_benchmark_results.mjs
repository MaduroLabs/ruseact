import { readFileSync } from "node:fs";

function check(condition, message) {
  if (!condition) throw new Error(`keyed benchmark integrity check failed: ${message}`);
}

const files = process.argv.slice(2).filter((value) => value !== "--");
if (files.length === 0) throw new Error("usage: validate_keyed_benchmark_results.mjs <result.json>");
for (const file of files) {
  const report = JSON.parse(readFileSync(file, "utf8"));
  check(report.schema_version === 1, `${file}: schema version`);
  check(report.benchmark === "m4.4.4-keyed-lists", `${file}: benchmark name`);
  check(report.metadata?.cross_origin_isolated === true, `${file}: cross-origin isolation`);
  check(report.integrity?.status === "pass", `${file}: integrity status`);
  check(report.integrity?.unresolved_rows === 0, `${file}: unresolved rows`);
  check(report.integrity?.zero_sample_rows === 0, `${file}: zero samples`);
  check(Array.isArray(report.results) && report.results.length === 12, `${file}: complete workload matrix`);
  const seen = new Set();
  for (const row of report.results) {
    check([10, 100, 1000].includes(row.workload_size), `${file}: workload size`);
    check(["append", "prepend", "reverse", "no_op"].includes(row.operation), `${file}: operation`);
    check(row.measurement_layer === "ruseact-dom-keyed-e2e", `${file}: measurement layer`);
    check(row.measurement_phase === "structural_reconciliation", `${file}: measurement phase`);
    check(Number.isInteger(row.operation_count) && row.operation_count > 0, `${file}: operation count`);
    check(Array.isArray(row.samples_ns) && row.samples_ns.length === 3, `${file}: samples`);
    check(row.samples_ns.every((sample) => Number.isFinite(sample) && sample > 0), `${file}: sample validity`);
    check(Number.isFinite(row.median_ns) && row.median_ns > 0, `${file}: median`);
    check(Number.isFinite(row.p95_ns) && row.p95_ns >= row.median_ns, `${file}: p95`);
    const key = `${row.operation}/${row.workload_size}`;
    check(!seen.has(key), `${file}: duplicate ${key}`); seen.add(key);
  }
  console.log(`${file}: valid (${report.results.length} rows)`);
}
