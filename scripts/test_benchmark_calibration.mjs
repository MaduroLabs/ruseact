import assert from "node:assert/strict";
import {
  BENCHMARK_CONFIG,
  assessOfficialSamples,
  calibrationTargetNs,
  measureCase,
  timerSafetyTargetNs,
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

function scriptedClock({
  resolutionNs = 100_000,
  calibrationDurationNs = 1_900_000,
  officialDurations = [],
} = {}) {
  let currentNs = 0;
  let phase = "start";
  let attempt = 0;
  let interval = 0;

  function durationForInterval() {
    const calibrationIntervals = attempt === 0 ? 5 : 1;
    const warmupIntervals = 2;
    if (interval < calibrationIntervals + warmupIntervals) {
      return interval === 0 && attempt === 0 ? 0 : calibrationDurationNs;
    }
    const trialIndex = interval - calibrationIntervals - warmupIntervals;
    return officialDurations[trialIndex] ?? calibrationDurationNs;
  }

  function advanceAttempt() {
    const attemptLength = attempt === 0 ? 17 : 13;
    if (interval === attemptLength) {
      attempt += 1;
      interval = 0;
    }
  }

  return {
    resolutionNs,
    now() {
      if (phase === "start") {
        phase = "end";
        return currentNs;
      }
      currentNs += durationForInterval();
      interval += 1;
      advanceAttempt();
      phase = "start";
      return currentNs;
    },
    toNs(value) {
      return value;
    },
    advance() {},
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
assert.equal(timerSafetyTargetNs({ resolutionNs: 100 }), 1_600, "high-resolution Node timers keep a small safety margin");
assert.equal(timerSafetyTargetNs({ resolutionNs: 500_000 }), 8_000_000, "coarse browser timers require a larger safety margin");
assert.equal(
  BENCHMARK_CONFIG.calibration_max_attempts,
  3,
  "recalibration is bounded",
);

const quantized = await runCase(quantizedClock({ quantumNs: 100_000, operationNs: 70_000 }));
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

const cappedReliable = await runCase(quantizedClock({ quantumNs: 100_000, operationNs: 30_000 }));
assert.equal(cappedReliable.calibration_limit_reached, true, "the capped case reaches the batch ceiling");
assert.equal(cappedReliable.measurement_validity, "capped_reliable", "positive capped samples can be accepted as reliable");
assert.equal(cappedReliable.calibration_limit_decision, "accepted_reliable_official_samples", "capped acceptance is explicit");
assert.equal(cappedReliable.unresolved_reason, null, "reliable capped samples are not unresolved");
assert.ok(cappedReliable.samples_ns.every((sample) => sample >= cappedReliable.timer_safety_target_ns), "capped samples clear the timer-safety margin");

const dispersed = await runCase(scriptedClock({
  officialDurations: [
    1_900_000, 1_900_000, 1_900_000, 1_900_000, 1_900_000,
    1_900_000, 1_900_000, 4_000_000, 4_000_000, 4_000_000,
  ],
}));
assert.equal(dispersed.calibration_limit_reached, true, "the dispersed case reaches the batch ceiling");
assert.equal(dispersed.measurement_validity, "unresolved", "excessive capped dispersion remains unresolved");
assert.equal(dispersed.calibration_limit_decision, "rejected_unreliable_official_samples", "unreliable capped samples are rejected explicitly");
assert.equal(dispersed.unresolved_reason, "excessive_dispersion_after_recalibration_limit", "dispersion failure is actionable");
assert.equal(dispersed.measurement_attempts.length, BENCHMARK_CONFIG.calibration_max_attempts, "dispersion retries remain bounded");

const directQuality = assessOfficialSamples(
  { resolutionNs: 100_000 },
  [1_900_000, 1_900_000, 1_900_000, 1_900_000, 1_900_000, 1_900_000, 1_900_000, 4_000_000, 4_000_000, 4_000_000],
);
assert.equal(directQuality.reliable, false, "excessive dispersion is rejected independently of calibration");
assert.equal(directQuality.reason, "excessive_dispersion", "dispersion diagnostic is deterministic");

const nonFinite = await runCase(scriptedClock({ officialDurations: Array(10).fill(Number.NaN) }));
assert.equal(nonFinite.unresolved_reason, "non_finite_sample_after_recalibration_limit", "non-finite samples remain unresolved");
assert.equal(nonFinite.measurement_validity, "unresolved", "non-finite measurements are never accepted");

const exhausted = await runCase(quantizedClock({ frozen: true }));
assert.equal(exhausted.measurement_attempts.length, BENCHMARK_CONFIG.calibration_max_attempts, "limit exhaustion stops at the attempt bound");
assert.equal(exhausted.calibration_batches, BENCHMARK_CONFIG.calibration_max_batches, "limit exhaustion reports the batch ceiling");
assert.equal(exhausted.unresolved_reason, "zero_sample_after_recalibration_limit", "zero-sample limit exhaustion is actionable");
assert.equal(exhausted.calibration_limit_decision, "rejected_unreliable_official_samples", "zero-sample capped measurements are rejected explicitly");
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
