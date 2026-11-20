import assert from "node:assert/strict";
import {
  BENCHMARK_CONFIG,
  calibrationTargetNs,
  measureCase,
} from "./benchmark_workloads.mjs";

function quantizedClock({
  quantumNs = 1_000_000,
  operationNs = 100_000,
  forcedZeroIntervals = [],
  frozen = false,
} = {}) {
  const forced = new Set(forcedZeroIntervals);
  let elapsedNs = 0;
  let interval = 0;
  let phase = "start";
  let startedNs = 0;
  return {
    resolutionNs: 100_000,
    now() {
      if (phase === "start") {
        startedNs = Math.floor(elapsedNs / quantumNs) * quantumNs;
        phase = "end";
        return startedNs;
      }
      phase = "start";
      const endedNs = frozen || forced.has(interval)
        ? startedNs
        : Math.floor(elapsedNs / quantumNs) * quantumNs;
      interval += 1;
      return endedNs;
    },
    toNs(value) {
      return value;
    },
    advance(value = operationNs) {
      elapsedNs += value;
    },
  };
}

async function runCase(clock, descriptor = { operation: "calibration_test", timed_operations: 3, cleanup: "test" }) {
  const result = await measureCase(
    clock,
    descriptor,
    async () => ({}),
    async (state) => {
      clock.advance();
      return state;
    },
    async () => {},
    async () => {},
  );
  return result;
}

assert.equal(
  calibrationTargetNs({ resolutionNs: 100_000 }),
  2_000_000,
  "the timer target stays at least 2 ms for 100 microsecond quantization",
);
assert.equal(
  calibrationTargetNs({ resolutionNs: 500_000 }),
  8_000_000,
  "the target scales with a coarser observed timer",
);
assert.equal(
  BENCHMARK_CONFIG.calibration_max_attempts,
  3,
  "recalibration is bounded",
);

const quantized = await runCase(quantizedClock());
assert.equal(quantized.recalibration_count, 0, "calibration handles quantized warmup samples");
assert.ok(quantized.calibration_samples_ns.some((sample) => sample === 0), "quantized calibration is recorded");
assert.ok(quantized.samples_ns.every((sample) => sample > 0), "official quantized samples are measurable");
assert.ok(quantized.timed_operations > 3, "calibration reports expanded operation count");

const recalibrated = await runCase(quantizedClock({ forcedZeroIntervals: [7] }));
assert.equal(recalibrated.recalibration_count, 1, "an intermittent zero triggers one retry");
assert.equal(recalibrated.measurement_attempts.length, 2, "the discarded attempt is retained diagnostically");
assert.ok(
  recalibrated.measurement_attempts[0].samples_ns.some((sample) => sample === 0),
  "the discarded zero sample remains visible",
);
assert.ok(recalibrated.samples_ns.every((sample) => sample > 0), "the final attempt has no zero samples");
assert.ok(
  recalibrated.measurement_attempts[1].timed_operations > recalibrated.measurement_attempts[0].timed_operations,
  "recalibration increases the actual timed operation count",
);
assert.equal(
  recalibrated.timed_operations,
  recalibrated.base_timed_operations * recalibrated.calibration_batches,
  "final operation count matches the selected batch",
);

const exhausted = await runCase(quantizedClock({ frozen: true }));
assert.equal(exhausted.measurement_attempts.length, BENCHMARK_CONFIG.calibration_max_attempts, "limit exhaustion stops at the attempt bound");
assert.equal(exhausted.calibration_batches, BENCHMARK_CONFIG.calibration_max_batches, "limit exhaustion reports the batch ceiling");
assert.equal(exhausted.unresolved_reason, "calibration_limit_reached_below_target", "limit exhaustion is actionable");
assert.ok(exhausted.samples_ns.some((sample) => sample === 0), "unresolved zero samples are not fabricated away");

const reproducibleFirst = await runCase(quantizedClock({ forcedZeroIntervals: [7] }));
const reproducibleSecond = await runCase(quantizedClock({ forcedZeroIntervals: [7] }));
assert.deepEqual(
  {
    samples: reproducibleFirst.samples_ns,
    attempts: reproducibleFirst.measurement_attempts,
    operations: reproducibleFirst.timed_operations,
  },
  {
    samples: reproducibleSecond.samples_ns,
    attempts: reproducibleSecond.measurement_attempts,
    operations: reproducibleSecond.timed_operations,
  },
  "deterministic clock inputs produce reproducible calibration results",
);

console.log("M2.5 calibration regression tests passed");
