import { readFileSync } from "node:fs";

const REQUIRED_RUSEACT_OPERATIONS = [
  "root_mount",
  "signal_write_unchanged",
  "signal_write_flush",
  "multiple_signal_writes_one_flush",
  "shared_signal_binding_fanout",
  "independent_signal_bindings",
  "attribute_property_update",
  "root_unmount_cleanup",
  "root_lifecycle_cycle",
];
const REQUIRED_NATIVE_OPERATIONS = [
  "native_dom_mount",
  "native_dom_text_update",
  "native_dom_attribute_property",
  "native_dom_unmount",
  "native_dom_lifecycle_cycle",
];

function check(condition, message) {
  if (!condition) throw new Error(`benchmark integrity check failed: ${message}`);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function nearestRank(values, percentile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

function nearlyEqual(left, right) {
  return Math.abs(left - right) <= Math.max(1, Math.abs(right) * 1e-12);
}

export function validateReport(report, filePath = "report") {
  check(report !== null && typeof report === "object", `${filePath}: report object`);
  check(report.schema_version === 1, `${filePath}: schema version`);
  check(report.benchmark === "m3.5-dom-e2e", `${filePath}: benchmark name`);
  check(typeof report.metadata?.source_sha === "string" && report.metadata.source_sha.length > 0, `${filePath}: source SHA`);
  check(typeof report.metadata?.browser === "string" && report.metadata.browser.length > 0, `${filePath}: browser metadata`);
  for (const field of ["node_version", "pnpm_version", "rust_version", "typescript_version", "wasm_bindgen_version"]) {
    check(typeof report.metadata?.[field] === "string" && report.metadata[field].length > 0, `${filePath}: ${field} metadata`);
  }
  check("timer_resolution_ns" in report.metadata, `${filePath}: timer resolution metadata`);
  const configuration = report.configuration;
  check(configuration?.schema_version === 1, `${filePath}: configuration schema`);
  check(JSON.stringify(configuration.sizes) === JSON.stringify([1, 10, 100, 1000]), `${filePath}: workload sizes`);
  check(Number.isInteger(configuration.trials) && configuration.trials >= 2, `${filePath}: trial count`);
  check(Number.isInteger(configuration.warmups) && configuration.warmups >= 1, `${filePath}: warmup count`);
  check(Number.isInteger(configuration.calibration_max_batches) && configuration.calibration_max_batches > 0, `${filePath}: calibration batch bound`);
  check(Number.isInteger(configuration.calibration_max_attempts) && configuration.calibration_max_attempts > 0, `${filePath}: calibration attempt bound`);
  check(report.integrity?.status === "pass", `${filePath}: integrity status`);
  check(report.integrity?.total_rows === report.results?.length, `${filePath}: integrity row count`);
  check(report.integrity?.unresolved_rows === 0, `${filePath}: unresolved rows`);
  check(report.integrity?.zero_median_rows === 0, `${filePath}: zero median rows`);
  check(report.integrity?.zero_sample_rows === 0, `${filePath}: zero sample rows`);
  check(report.integrity?.non_finite_rows === 0, `${filePath}: non-finite rows`);
  check(Array.isArray(report.results) && report.results.length === (REQUIRED_RUSEACT_OPERATIONS.length + REQUIRED_NATIVE_OPERATIONS.length) * configuration.sizes.length, `${filePath}: complete workload matrix`);

  const seen = new Set();
  for (const [index, row] of report.results.entries()) {
    const prefix = `${filePath} row ${index}`;
    check(row.measurement_layer === "ruseact-dom-e2e" || row.measurement_layer === "native-dom-reference", `${prefix}: measurement layer`);
    check(typeof row.operation === "string" && row.operation.length > 0, `${prefix}: operation`);
    check(configuration.sizes.includes(row.workload_size), `${prefix}: workload size`);
    check(typeof row.measurement_phase === "string" && row.measurement_phase.length > 0, `${prefix}: phase`);
    check(typeof row.operation_count_unit === "string" && row.operation_count_unit.length > 0, `${prefix}: operation count unit`);
    check(Number.isInteger(row.signal_count) && row.signal_count >= 0, `${prefix}: signal count`);
    check(Number.isInteger(row.computation_count) && row.computation_count >= 0, `${prefix}: computation count`);
    check(Number.isInteger(row.binding_count) && row.binding_count >= 0, `${prefix}: binding count`);
    check(Number.isInteger(row.dependency_edges) && row.dependency_edges >= 0, `${prefix}: dependency edges`);
    check(Number.isInteger(row.affected_computations) && row.affected_computations >= 0, `${prefix}: affected computations`);
    check(Number.isInteger(row.pending_computations) && row.pending_computations >= 0, `${prefix}: pending computations`);
    check(typeof row.setup_description === "string" && row.setup_description.length > 0, `${prefix}: setup description`);
    check(typeof row.timed_description === "string" && row.timed_description.length > 0, `${prefix}: timed description`);
    check(typeof row.cleanup_description === "string" && row.cleanup_description.length > 0, `${prefix}: cleanup description`);
    check(Number.isInteger(row.timed_operations) && row.timed_operations > 0, `${prefix}: timed operation count`);
    check(Number.isInteger(row.base_timed_operations) && row.base_timed_operations > 0, `${prefix}: base operation count`);
    check(Number.isInteger(row.calibration_batches) && row.calibration_batches > 0, `${prefix}: calibration batches`);
    check(row.timed_operations === row.base_timed_operations * row.calibration_batches, `${prefix}: calibrated operation count`);
    check(Array.isArray(row.samples_ns) && row.samples_ns.length === configuration.trials, `${prefix}: samples`);
    check(row.samples_ns.every((sample) => Number.isFinite(sample) && sample > 0), `${prefix}: positive finite samples`);
    check(Number.isFinite(row.median_ns) && row.median_ns > 0, `${prefix}: median`);
    check(Number.isFinite(row.p95_ns) && row.p95_ns > 0, `${prefix}: p95`);
    check(row.median_ns === median(row.samples_ns), `${prefix}: median calculation`);
    check(row.p95_ns === nearestRank(row.samples_ns, 0.95), `${prefix}: p95 calculation`);
    check(row.measurement_validity === "calibrated" || row.measurement_validity === "capped_reliable", `${prefix}: measurement validity`);
    check(row.unresolved_reason === null, `${prefix}: unresolved reason`);
    check(Array.isArray(row.calibration_attempts) && row.calibration_attempts.length > 0, `${prefix}: calibration attempts`);
    check(Array.isArray(row.measurement_attempts) && row.measurement_attempts.length > 0, `${prefix}: measurement attempts`);
    check(row.recalibration_count === row.measurement_attempts.length - 1, `${prefix}: recalibration count`);
    check(row.calibration_attempts.length === row.measurement_attempts.length, `${prefix}: calibration attempt count`);
    for (const [attemptIndex, attempt] of row.measurement_attempts.entries()) {
      check(attempt.attempt === attemptIndex + 1, `${prefix}: attempt ordering`);
      check(attempt.timed_operations === row.calibration_attempts[attemptIndex].timed_operations, `${prefix}: attempt operation metadata`);
      check(Array.isArray(attempt.samples_ns) && attempt.samples_ns.length === configuration.trials, `${prefix}: attempt samples`);
      check(attempt.samples_ns.every((sample) => Number.isFinite(sample) && sample > 0), `${prefix}: attempt sample validity`);
    }
    check(Number.isFinite(row.median_ns_per_operation) && row.median_ns_per_operation > 0, `${prefix}: median per operation`);
    check(Number.isFinite(row.median_operations_per_second) && row.median_operations_per_second > 0, `${prefix}: throughput`);
    check(nearlyEqual(row.sample_dispersion_ns, row.p95_ns - row.median_ns), `${prefix}: dispersion`);
    const key = `${row.measurement_layer}/${row.operation}/${row.workload_size}`;
    check(!seen.has(key), `${prefix}: duplicate workload ${key}`);
    seen.add(key);
  }

  for (const operation of REQUIRED_RUSEACT_OPERATIONS) {
    for (const size of configuration.sizes) check(seen.has(`ruseact-dom-e2e/${operation}/${size}`), `${filePath}: missing Ruseact ${operation}/${size}`);
  }
  for (const operation of REQUIRED_NATIVE_OPERATIONS) {
    for (const size of configuration.sizes) check(seen.has(`native-dom-reference/${operation}/${size}`), `${filePath}: missing native ${operation}/${size}`);
  }
  return report;
}

const files = process.argv.slice(2);
if (files.length === 0) throw new Error("usage: validate_dom_benchmark_results.mjs <result.json> [...]");
for (const filePath of files) {
  const report = JSON.parse(readFileSync(filePath, "utf8"));
  validateReport(report, filePath);
  console.log(`${filePath}: valid (${report.results.length} rows, ${report.metadata.source_sha})`);
}
