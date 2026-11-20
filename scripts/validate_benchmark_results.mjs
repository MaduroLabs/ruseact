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

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
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
      .filter((row) => row.unresolved_reason !== null || row.median_ns === 0 || row.samples_ns.some((value) => value === 0))
      .map((row) => ({ workload: `${row.layer}/${row.operation}/${row.size ?? "cold"}`, reason: row.unresolved_reason, samples_ns: row.samples_ns }));
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
  check(report.integrity?.zero_sample_rows === 0, `${filePath}: zero-sample rows`);
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
    check(Number.isInteger(row.base_timed_operations) && row.base_timed_operations > 0, `${filePath} row ${index}: base timed operations`);
    check(Number.isInteger(row.calibration_batches) && row.calibration_batches > 0, `${filePath} row ${index}: calibration batches`);
    check(row.timed_operations === row.base_timed_operations * row.calibration_batches, `${filePath} row ${index}: calibrated operation count`);
    if (row.size !== null) {
      check(Number.isFinite(row.calibration_target_ns) && row.calibration_target_ns > 0, `${filePath} row ${index}: calibration target`);
      check(Array.isArray(row.calibration_samples_ns) && row.calibration_samples_ns.length > 0, `${filePath} row ${index}: calibration samples`);
      check(row.calibration_samples_ns.every((value) => Number.isFinite(value) && value >= 0), `${filePath} row ${index}: calibration sample values`);
      check(Number.isInteger(row.recalibration_count) && row.recalibration_count >= 0, `${filePath} row ${index}: recalibration count`);
      check(Array.isArray(row.calibration_attempts) && row.calibration_attempts.length > 0, `${filePath} row ${index}: calibration attempts`);
      check(Array.isArray(row.measurement_attempts) && row.measurement_attempts.length > 0, `${filePath} row ${index}: measurement attempts`);
      check(row.recalibration_count === row.measurement_attempts.length - 1, `${filePath} row ${index}: recalibration count matches attempts`);
      check(row.calibration_attempts.length === row.measurement_attempts.length, `${filePath} row ${index}: calibration/measurement attempts`);
      for (const [attemptIndex, attempt] of row.measurement_attempts.entries()) {
        check(attempt.attempt === attemptIndex + 1, `${filePath} row ${index}: attempt sequence`);
        check(Number.isInteger(attempt.timed_operations) && attempt.timed_operations > 0, `${filePath} row ${index}: attempt timed operations`);
        check(Array.isArray(attempt.samples_ns) && attempt.samples_ns.length === row.trials, `${filePath} row ${index}: attempt samples`);
        check(attempt.samples_ns.every((value) => Number.isFinite(value) && value >= 0), `${filePath} row ${index}: attempt sample values`);
        check(attempt.failure_reason === null || typeof attempt.failure_reason === "string", `${filePath} row ${index}: attempt failure reason`);
        const calibrationAttempt = row.calibration_attempts[attemptIndex];
        check(calibrationAttempt.attempt === attempt.attempt, `${filePath} row ${index}: calibration attempt sequence`);
        check(calibrationAttempt.timed_operations === attempt.timed_operations, `${filePath} row ${index}: calibration attempt operations`);
        check(Array.isArray(calibrationAttempt.calibration_samples_ns), `${filePath} row ${index}: calibration attempt samples`);
      }
      const finalAttempt = row.measurement_attempts[row.measurement_attempts.length - 1];
      check(finalAttempt.timed_operations === row.timed_operations, `${filePath} row ${index}: final attempt operations`);
      check(finalAttempt.samples_ns.length === row.samples_ns.length && finalAttempt.samples_ns.every((value, sampleIndex) => value === row.samples_ns[sampleIndex]), `${filePath} row ${index}: final attempt samples`);
    }
    check(Number.isFinite(row.median_ns) && Number.isFinite(row.p95_ns), `${filePath} row ${index}: summary values`);
    check(row.median_ns === median(row.samples_ns), `${filePath} row ${index}: median calculation`);
    check(row.p95_ns === nearestRank(row.samples_ns, 0.95), `${filePath} row ${index}: p95 calculation`);
    check(Number.isFinite(row.sample_dispersion_ns) && row.sample_dispersion_ns >= 0, `${filePath} row ${index}: sample dispersion`);
    check(row.sample_dispersion_ns === row.p95_ns - row.median_ns, `${filePath} row ${index}: sample dispersion calculation`);
    check(Number.isFinite(row.sample_iqr_ns) && row.sample_iqr_ns >= 0, `${filePath} row ${index}: sample IQR`);
    check(row.sample_iqr_ns === nearestRank(row.samples_ns, 0.75) - nearestRank(row.samples_ns, 0.25), `${filePath} row ${index}: sample IQR calculation`);
    check(row.sample_iqr_ns === row.median_ns - row.sample_stability_lower_ns, `${filePath} row ${index}: sample stability calculation`);
    check(Number.isFinite(row.sample_stability_lower_ns), `${filePath} row ${index}: sample stability lower bound`);
    check(row.measurement_quality_reason === null || typeof row.measurement_quality_reason === "string", `${filePath} row ${index}: measurement quality reason`);
    if (row.size === null) {
      check(row.measurement_validity === "not_calibrated", `${filePath} row ${index}: cold measurement validity`);
      check(row.calibration_limit_decision === "not_applicable", `${filePath} row ${index}: cold calibration decision`);
      check(row.timer_safety_target_ns === null, `${filePath} row ${index}: cold timer-safety target`);
    } else {
      check(Number.isFinite(row.timer_safety_target_ns) && row.timer_safety_target_ns > 0, `${filePath} row ${index}: timer-safety target`);
      check(row.sample_stability_lower_ns >= row.timer_safety_target_ns || row.measurement_validity === "unresolved", `${filePath} row ${index}: sample stability gate`);
      check(row.measurement_validity === "calibrated" || row.measurement_validity === "capped_reliable" || row.measurement_validity === "unresolved", `${filePath} row ${index}: measurement validity`);
      check(row.calibration_limit_reached === true || row.calibration_limit_reached === false, `${filePath} row ${index}: calibration limit flag`);
      if (row.measurement_validity === "unresolved") {
        check(typeof row.unresolved_reason === "string" && row.unresolved_reason.length > 0, `${filePath} row ${index}: unresolved reason`);
        check(row.calibration_limit_reached
          ? row.calibration_limit_decision === "rejected_unreliable_official_samples"
          : row.calibration_limit_decision === "official_samples_unreliable", `${filePath} row ${index}: rejected calibration decision`);
      } else {
        check(row.unresolved_reason === null, `${filePath} row ${index}: resolved row has no unresolved reason`);
        check(row.calibration_limit_reached
          ? row.measurement_validity === "capped_reliable" && row.calibration_limit_decision === "accepted_reliable_official_samples"
          : row.measurement_validity === "calibrated" && row.calibration_limit_decision === "target_reached", `${filePath} row ${index}: accepted calibration decision`);
      }
    }
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
