import { readFileSync } from "node:fs";

const paths = process.argv.slice(2).filter((value) => value !== "--");
if (paths.length === 0) throw new Error("usage: node scripts/validate_benchmark_results.mjs <result.json> [...]");

function check(condition, message) {
  if (!condition) throw new Error(`benchmark result validation failed: ${message}`);
}

function nearestRank(values, percentile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

for (const filePath of paths) {
  const report = JSON.parse(readFileSync(filePath, "utf8"));
  check(report.schema_version === 1, `${filePath}: schema version`);
  check(report.configuration?.trials >= 2, `${filePath}: trial count`);
  check(report.configuration?.warmups >= 1, `${filePath}: warmup count`);
  check(Array.isArray(report.results) && report.results.length > 0, `${filePath}: results`);
  const layers = new Set(report.results.map((row) => row.layer));
  check(layers.has("direct-wasm") && layers.has("typescript-runtime"), `${filePath}: measurement layers`);
  for (const [index, row] of report.results.entries()) {
    check(typeof row.operation === "string" && row.operation.length > 0, `${filePath} row ${index}: operation`);
    check(row.layer === "direct-wasm" || row.layer === "typescript-runtime", `${filePath} row ${index}: layer`);
    check(row.size === null || report.configuration.sizes.includes(row.size), `${filePath} row ${index}: fixture size`);
    check(Number.isInteger(row.timed_operations) && row.timed_operations > 0, `${filePath} row ${index}: timed operations`);
    check(Array.isArray(row.samples_ns) && row.samples_ns.length === row.trials, `${filePath} row ${index}: raw samples`);
    check(row.samples_ns.every((value) => Number.isFinite(value) && value >= 0), `${filePath} row ${index}: sample values`);
    check(Number.isFinite(row.median_ns) && Number.isFinite(row.p95_ns), `${filePath} row ${index}: summary values`);
    check(row.p95_ns === nearestRank(row.samples_ns, 0.95), `${filePath} row ${index}: p95 calculation`);
    if (row.median_ns === 0) {
      check(row.median_operations_per_second === null, `${filePath} row ${index}: zero-timer throughput`);
    } else {
      check(Number.isFinite(row.median_operations_per_second) && row.median_operations_per_second > 0, `${filePath} row ${index}: throughput`);
    }
  }
  console.log(`${filePath}: valid (${report.results.length} rows, ${report.metadata?.source_sha ?? "unknown source"})`);
}
