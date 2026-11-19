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

const requiredOperations = new Set([
  "signal_creation",
  "signal_read",
  "signal_write_changed",
  "signal_write_unchanged",
  "signal_disposal",
  "computation_creation",
  "subscription_registration",
  "duplicate_subscription",
  "unsubscription",
  "dependency_replacement",
  "computation_disposal",
  "dependency_cleanup_signal_disposal",
  "dirty_change_and_drain",
  "pending_drain_transfer",
  "pending_reenqueue_after_drain",
  "dirty_multiple_shared_computations",
  "updates_without_batching",
  "updates_inside_one_batch",
  "updates_inside_nested_batches",
  "batch_boundary_overhead",
  "pending_transfer_after_batch",
  "warm_instance_creation",
  "explicit_graph_disposal",
  "repeated_signal_lifecycle",
]);

for (const filePath of paths) {
  const report = JSON.parse(readFileSync(filePath, "utf8"));
  if (report.integrity !== undefined && report.integrity.status !== "pass") {
    const unresolved = report.results
      .filter((row) => row.median_ns === 0 || row.samples_ns.some((value) => value === 0))
      .map((row) => `${row.layer}/${row.operation}/${row.size ?? "cold"}`);
    console.error(`${filePath}: measurement integrity diagnostics: ${JSON.stringify({ ...report.integrity, unresolved })}`);
  }
  check(report.schema_version === 1, `${filePath}: schema version`);
  check(report.configuration?.trials >= 2, `${filePath}: trial count`);
  check(report.configuration?.warmups >= 1, `${filePath}: warmup count`);
  check(Array.isArray(report.results) && report.results.length > 0, `${filePath}: results`);
  check(report.integrity?.total_rows === report.results.length, `${filePath}: integrity row count`);
  check(report.integrity?.status === "pass", `${filePath}: unresolved or invalid measurements`);
  check(report.integrity?.unresolved_rows === 0, `${filePath}: unresolved rows`);
  check(report.integrity?.zero_median_rows === 0, `${filePath}: zero-median rows`);
  check(report.integrity?.non_finite_rows === 0, `${filePath}: non-finite rows`);
  const layers = new Set(report.results.map((row) => row.layer));
  check(layers.has("direct-wasm") && layers.has("typescript-runtime"), `${filePath}: measurement layers`);
  const operationsByLayer = new Map();
  for (const [index, row] of report.results.entries()) {
    check(typeof row.operation === "string" && row.operation.length > 0, `${filePath} row ${index}: operation`);
    check(row.layer === "direct-wasm" || row.layer === "typescript-runtime", `${filePath} row ${index}: layer`);
    check(row.size === null || report.configuration.sizes.includes(row.size), `${filePath} row ${index}: fixture size`);
    check(Number.isInteger(row.timed_operations) && row.timed_operations > 0, `${filePath} row ${index}: timed operations`);
    check(Array.isArray(row.samples_ns) && row.samples_ns.length === row.trials, `${filePath} row ${index}: raw samples`);
    check(row.samples_ns.every((value) => Number.isFinite(value) && value >= 0), `${filePath} row ${index}: sample values`);
    check(row.samples_ns.some((value) => value > 0), `${filePath} row ${index}: all-zero samples`);
    check(Number.isFinite(row.median_ns) && Number.isFinite(row.p95_ns), `${filePath} row ${index}: summary values`);
    check(row.p95_ns === nearestRank(row.samples_ns, 0.95), `${filePath} row ${index}: p95 calculation`);
    check(Number.isFinite(row.median_operations_per_second) && row.median_operations_per_second > 0, `${filePath} row ${index}: throughput`);
    if (!operationsByLayer.has(row.layer)) operationsByLayer.set(row.layer, new Set());
    operationsByLayer.get(row.layer).add(row.operation);
  }
  for (const layer of ["direct-wasm", "typescript-runtime"]) {
    const actual = operationsByLayer.get(layer) ?? new Set();
    for (const operation of requiredOperations) check(actual.has(operation), `${filePath}: missing ${layer} operation ${operation}`);
  }
  check(report.results.some((row) => row.layer === "direct-wasm" && row.operation === "computation_identity_lookup"), `${filePath}: direct identity lookup`);
  check(report.results.some((row) => row.layer === "direct-wasm" && row.operation === "stale_handle_validation"), `${filePath}: direct stale-handle validation`);
  check(report.results.some((row) => row.layer === "typescript-runtime" && row.operation === "stale_handle_validation"), `${filePath}: TypeScript stale-handle validation`);
  console.log(`${filePath}: valid (${report.results.length} rows, ${report.metadata?.source_sha ?? "unknown source"})`);
}
