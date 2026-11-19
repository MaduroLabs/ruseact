const SIZES = [16, 64, 256];
const TRIALS = 10;
const WARMUPS = 2;
const REPEATED_OPERATIONS = 1024;
const READ_REPETITIONS = 128;
const DEPENDENCY_COUNT = 8;
const SHORT_OPERATION_REPETITIONS = 64;
const TRANSFER_REPETITIONS = 64;
const WARM_INSTANCE_REPETITIONS = 256;
const CALIBRATION_MIN_DURATION_NS = 100_000;
const CALIBRATION_RESOLUTION_MULTIPLIER = 8;
const CALIBRATION_MAX_BATCHES = 64;
const CALIBRATION_MAX_SAMPLE_NS = 50_000_000;

export const BENCHMARK_CONFIG = Object.freeze({
  schema_version: 1,
  sizes: SIZES,
  trials: TRIALS,
  warmups: WARMUPS,
  repeated_operations: REPEATED_OPERATIONS,
  read_repetitions: READ_REPETITIONS,
  dependency_count: DEPENDENCY_COUNT,
  short_operation_repetitions: SHORT_OPERATION_REPETITIONS,
  transfer_repetitions: TRANSFER_REPETITIONS,
  warm_instance_repetitions: WARM_INSTANCE_REPETITIONS,
  calibration_min_duration_ns: CALIBRATION_MIN_DURATION_NS,
  calibration_resolution_multiplier: CALIBRATION_RESOLUTION_MULTIPLIER,
  calibration_max_batches: CALIBRATION_MAX_BATCHES,
  calibration_max_sample_ns: CALIBRATION_MAX_SAMPLE_NS,
  timer_resolution_policy: "zero-median, non-finite, or calibration-limit rows are unresolved and fail validation",
  p95_method: "nearest-rank sample quantile",
});

function check(condition, message) {
  if (!condition) {
    throw new Error(`benchmark correctness check failed: ${message}`);
  }
}

function unwrap(result, operation) {
  check(result !== null && typeof result === "object", `${operation} returned an object`);
  if (result.ok !== true) {
    throw new Error(`${operation} failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function expectFailure(result, operation) {
  check(result !== null && typeof result === "object" && result.ok === false, `${operation} rejects`);
  return result.error;
}

function valueFor(kind, index) {
  if (kind === "boolean") return index % 2 === 0;
  if (kind === "number") return index + 0.5;
  return `value-${index}`;
}

function nextValue(kind, iteration, unchanged) {
  if (unchanged) return valueFor(kind, 0);
  if (kind === "boolean") return iteration % 2 !== 0;
  if (kind === "number") return iteration + 1.5;
  return `next-${iteration}`;
}

function mix(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Math.trunc(value * 17);
  let checksum = 0;
  for (let index = 0; index < value.length; index += 1) {
    checksum = (checksum * 31 + value.charCodeAt(index)) >>> 0;
  }
  return checksum;
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
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[index];
}

export function summarizeSamples(descriptor, samplesNs) {
  const medianNs = median(samplesNs);
  const p95Ns = nearestRank(samplesNs, 0.95);
  const operations = descriptor.timed_operations;
  return {
    layer: descriptor.layer,
    operation: descriptor.operation,
    value_kind: descriptor.value_kind ?? null,
    size: descriptor.size ?? null,
    graph_size: descriptor.graph_size ?? descriptor.size ?? null,
    computation_count: descriptor.computation_count ?? 0,
    dependency_edges: descriptor.dependency_edges ?? 0,
    subscriber_fanout: descriptor.subscriber_fanout ?? 0,
    affected_computations: descriptor.affected_computations ?? 0,
    pending_pairs: descriptor.pending_pairs ?? 0,
    setup_operations: descriptor.setup_operations ?? 0,
    timed_operations: operations,
    cleanup: descriptor.cleanup,
    trials: samplesNs.length,
    warmups: descriptor.warmups ?? WARMUPS,
    samples_ns: samplesNs,
    median_ns: medianNs,
    p95_ns: p95Ns,
    median_ns_per_operation: operations > 0 ? medianNs / operations : null,
    median_operations_per_second: operations > 0 ? (operations * 1_000_000_000) / medianNs : null,
    base_timed_operations: descriptor.base_timed_operations ?? operations,
    calibration_batches: descriptor.calibration_batches ?? 1,
    calibration_target_ns: descriptor.calibration_target_ns ?? null,
    calibration_samples_ns: descriptor.calibration_samples_ns ?? [],
    calibration_limit_reached: descriptor.calibration_limit_reached ?? false,
    unresolved_reason: descriptor.unresolved_reason ?? null,
  };
}

function measurementIntegrity(results) {
  const zeroMedianRows = results.filter((row) => row.median_ns === 0);
  const zeroSampleRows = results.filter((row) => row.samples_ns.some((sample) => sample === 0));
  const nonFiniteRows = results.filter((row) =>
    !Number.isFinite(row.median_ns) || !Number.isFinite(row.p95_ns) ||
    row.samples_ns.some((sample) => !Number.isFinite(sample) || sample < 0));
  const unresolvedRows = results.filter((row) => row.unresolved_reason !== null);
  const unresolvedSet = new Set([...zeroMedianRows, ...zeroSampleRows, ...unresolvedRows]);
  const invalidSet = new Set([...zeroMedianRows, ...zeroSampleRows, ...nonFiniteRows, ...unresolvedRows]);
  return {
    total_rows: results.length,
    valid_rows: results.length - invalidSet.size,
    unresolved_rows: unresolvedSet.size,
    zero_median_rows: zeroMedianRows.length,
    zero_sample_rows: zeroSampleRows.length,
    non_finite_rows: nonFiniteRows.length,
    calibration_limit_rows: unresolvedRows.length,
    status: invalidSet.size === 0 ? "pass" : "unresolved",
  };
}

async function executeBatch(clock, setup, operation, cleanup, validate, batchCount) {
  const states = [];
  try {
    for (let index = 0; index < batchCount; index += 1) states.push(await setup());
  } catch (error) {
    for (const state of states.reverse()) await cleanup(state);
    throw error;
  }

  const observed = [];
  let operationError;
  const started = clock.now();
  try {
    for (const state of states) observed.push(await operation(state));
  } catch (error) {
    operationError = error;
  }
  const elapsedNs = clock.toNs(clock.now() - started);

  let validationError;
  if (operationError === undefined) {
    try {
      for (let index = 0; index < states.length; index += 1) await validate(observed[index], states[index]);
    } catch (error) {
      validationError = error;
    }
  }

  let cleanupError;
  for (const state of states.reverse()) {
    try {
      await cleanup(state);
    } catch (error) {
      cleanupError ??= error;
    }
  }
  if (operationError !== undefined) throw operationError;
  if (validationError !== undefined) throw validationError;
  if (cleanupError !== undefined) throw cleanupError;
  return elapsedNs;
}

function calibrationTargetNs(clock) {
  const resolutionNs = clock.resolutionNs ?? CALIBRATION_MIN_DURATION_NS;
  return Math.max(CALIBRATION_MIN_DURATION_NS, resolutionNs * CALIBRATION_RESOLUTION_MULTIPLIER);
}

async function calibrateCase(clock, setup, operation, cleanup, validate) {
  const targetNs = calibrationTargetNs(clock);
  const samplesNs = [];
  let batchCount = 1;
  let elapsedNs = 0;
  while (true) {
    elapsedNs = await executeBatch(clock, setup, operation, cleanup, validate, batchCount);
    samplesNs.push(elapsedNs);
    if (elapsedNs >= targetNs || elapsedNs >= CALIBRATION_MAX_SAMPLE_NS || batchCount >= CALIBRATION_MAX_BATCHES) break;
    const resolutionNs = Math.max(1, clock.resolutionNs ?? CALIBRATION_MIN_DURATION_NS);
    const denominator = Math.max(elapsedNs, resolutionNs);
    const suggested = Math.ceil(targetNs / denominator);
    batchCount = Math.min(CALIBRATION_MAX_BATCHES, Math.max(batchCount + 1, batchCount * Math.min(4, suggested)));
  }
  return {
    batchCount,
    targetNs,
    samplesNs,
    limitReached: elapsedNs < targetNs,
  };
}

async function measureCase(clock, descriptor, setup, operation, cleanup, validate) {
  const calibration = await calibrateCase(clock, setup, operation, cleanup, validate);
  const timedDescriptor = {
    ...descriptor,
    base_timed_operations: descriptor.timed_operations,
    timed_operations: descriptor.timed_operations * calibration.batchCount,
    calibration_batches: calibration.batchCount,
    calibration_target_ns: calibration.targetNs,
    calibration_samples_ns: calibration.samplesNs,
    calibration_limit_reached: calibration.limitReached,
    unresolved_reason: calibration.limitReached ? "calibration_limit_reached_below_target" : null,
  };

  for (let trial = 0; trial < WARMUPS; trial += 1) {
    await executeBatch(clock, setup, operation, cleanup, validate, calibration.batchCount);
  }

  const samplesNs = [];
  for (let trial = 0; trial < TRIALS; trial += 1) {
    samplesNs.push(await executeBatch(clock, setup, operation, cleanup, validate, calibration.batchCount));
  }
  return summarizeSamples(timedDescriptor, samplesNs);
}

function directLayer(moduleValue) {
  const core = new moduleValue.WasmCore();
  return {
    name: "direct-wasm",
    core,
    direct: true,
    signal(value) {
      return core.create_signal(value);
    },
    read(signal) {
      return core.read_signal(signal);
    },
    set(signal, value) {
      return core.set_signal(signal, value);
    },
    disposeSignal(signal) {
      core.dispose_signal(signal);
      signal.free();
    },
    staleSignal(signal) {
      core.dispose_signal(signal);
    },
    computation() {
      return core.create_computation();
    },
    computationIdentity(computation) {
      return core.computation_identity(computation);
    },
    disposeComputation(computation) {
      core.dispose_computation(computation);
      computation.free();
    },
    subscribe(signal, computation) {
      return core.subscribe(signal, computation);
    },
    unsubscribe(signal, computation) {
      return core.unsubscribe(signal, computation);
    },
    dependencyList() {
      return core.create_dependency_list();
    },
    dependencyPush(list, signal) {
      list.push(signal);
    },
    replaceDependencies(computation, list) {
      core.replace_dependencies(computation, list);
    },
    beginBatch() {
      core.begin_batch();
    },
    endBatch() {
      core.end_batch();
    },
    pending() {
      return core.drain_pending_computations();
    },
    disposeGraph() {
      core.dispose();
    },
    release() {
      core.free();
    },
  };
}

async function runtimeLayer(runtimeModule, wasmModule) {
  const result = await runtimeModule.createReactiveCore(async () => wasmModule);
  const core = unwrap(result, "createReactiveCore");
  return {
    name: "typescript-runtime",
    core,
    direct: false,
    signal(value) {
      return unwrap(core.createSignal(value), "createSignal");
    },
    read(signal) {
      return unwrap(core.get(signal), "get");
    },
    set(signal, value) {
      return unwrap(core.set(signal, value), "set") === "changed";
    },
    disposeSignal(signal) {
      unwrap(core.disposeSignal(signal), "disposeSignal");
    },
    staleSignal(signal) {
      unwrap(core.disposeSignal(signal), "disposeSignal");
    },
    computation() {
      return unwrap(core.createComputation(), "createComputation");
    },
    computationIdentity() {
      throw new Error("public runtime does not expose computation_identity");
    },
    disposeComputation(computation) {
      unwrap(core.disposeComputation(computation), "disposeComputation");
    },
    subscribe(signal, computation) {
      return unwrap(core.subscribe(signal, computation), "subscribe");
    },
    unsubscribe(signal, computation) {
      return unwrap(core.unsubscribe(signal, computation), "unsubscribe");
    },
    dependencyList() {
      return [];
    },
    dependencyPush() {
      throw new Error("public runtime dependency lists are arrays");
    },
    replaceDependencies(computation, list) {
      unwrap(core.replaceDependencies(computation, list), "replaceDependencies");
    },
    beginBatch() {
      unwrap(core.beginBatch(), "beginBatch");
    },
    endBatch() {
      unwrap(core.endBatch(), "endBatch");
    },
    pending() {
      return unwrap(core.drainPendingComputations(), "drainPendingComputations");
    },
    disposeGraph() {
      unwrap(core.dispose(), "dispose");
    },
    release() {},
  };
}

async function createLayer(layerName, directModule, runtimeModule, wasmModule) {
  return layerName === "direct-wasm"
    ? directLayer(directModule)
    : runtimeLayer(runtimeModule, wasmModule);
}

function disposeHandles(layer, signals, computations) {
  for (const computation of computations) {
    if (computation.live) {
      layer.disposeComputation(computation.value);
      computation.live = false;
    }
  }
  for (const signal of signals) {
    if (signal.live) {
      layer.disposeSignal(signal.value);
      signal.live = false;
    }
  }
}

async function disposeState(state) {
  if (state.layer === undefined) return;
  disposeHandles(state.layer, state.signals ?? [], state.computations ?? []);
  if (state.graphLive !== false) {
    state.layer.disposeGraph();
    state.graphLive = false;
  }
  state.layer.release();
}

async function buildGraph(layer, size, options = {}) {
  const computationCount = options.computationCount ?? Math.max(1, Math.floor(size / 4));
  const signalCount = options.signalCount ?? size;
  const signals = [];
  const computations = [];
  for (let index = 0; index < signalCount; index += 1) {
    const initialValue = options.signalKind === undefined ? index : valueFor(options.signalKind, index);
    signals.push({ value: layer.signal(initialValue), live: true });
  }
  for (let index = 0; index < computationCount; index += 1) {
    computations.push({ value: layer.computation(), live: true });
  }

  const edges = [];
  if (options.sharedSignals !== undefined) {
    const updateCount = Math.min(options.sharedSignals, signals.length);
    for (let computationIndex = 0; computationIndex < computations.length; computationIndex += 1) {
      for (let signalIndex = 0; signalIndex < updateCount; signalIndex += 1) {
        edges.push([signalIndex, computationIndex]);
      }
    }
  } else if (options.fanout !== undefined) {
    for (let computationIndex = 0; computationIndex < options.fanout; computationIndex += 1) {
      edges.push([0, computationIndex]);
    }
  } else {
    const degree = options.degree ?? 4;
    for (let computationIndex = 0; computationIndex < computations.length; computationIndex += 1) {
      for (let offset = 0; offset < degree; offset += 1) {
        edges.push([(computationIndex * degree + offset) % signalCount, computationIndex]);
      }
    }
  }

  if (options.connect !== false) {
    for (const [signalIndex, computationIndex] of edges) {
      layer.subscribe(signals[signalIndex].value, computations[computationIndex].value);
    }
  }
  return {
    layer,
    signals,
    computations,
    edges,
    graphLive: true,
    size,
  };
}

function edgeCount(state) {
  return state.edges.length;
}

function pendingCount(layer, pending) {
  return layer.direct ? pending.length / 2 : pending.length;
}

function pendingHandles(layer, pending) {
  if (!layer.direct) return pending;
  const values = [];
  for (let index = 0; index < pending.length; index += 2) {
    values.push([pending[index], pending[index + 1]]);
  }
  return values;
}

function verifyPendingOrder(layer, pending, computations) {
  const actual = pendingHandles(layer, pending);
  check(actual.length === computations.length, "pending count matches fan-out");
  for (let index = 0; index < computations.length; index += 1) {
    if (layer.direct) {
      const identity = layer.computationIdentity(computations[index].value);
      check(actual[index][0] === identity[0] && actual[index][1] === identity[1], "pending FIFO identity");
    } else {
      check(actual[index] === computations[index].value, "pending FIFO handle mapping");
    }
  }
}

async function addSignalCases(results, clock, layerName, directModule, runtimeModule, wasmModule) {
  for (const kind of ["boolean", "number", "string"]) {
    for (const size of SIZES) {
      const base = { layer: layerName, size, graph_size: size, value_kind: kind };
      results.push(await measureCase(
        clock,
        { ...base, operation: "signal_creation", setup_operations: 1, timed_operations: size * SHORT_OPERATION_REPETITIONS, cleanup: "dispose created signals and graph" },
        async () => ({ layer: await createLayer(layerName, directModule, runtimeModule, wasmModule), created: [], graphLive: true }),
        (state) => {
          for (let repetition = 0; repetition < SHORT_OPERATION_REPETITIONS; repetition += 1) {
            for (let index = 0; index < size; index += 1) state.created.push(state.layer.signal(valueFor(kind, repetition * size + index)));
          }
          return state.created.length;
        },
        async (state) => {
          for (const signal of state.created) state.layer.disposeSignal(signal);
          if (state.graphLive) {
            state.layer.disposeGraph();
            state.graphLive = false;
          }
          state.layer.release();
        },
        async (observed, state) => {
          check(observed === size * SHORT_OPERATION_REPETITIONS, "signal creation count");
          check(mix(state.layer.read(state.created[state.created.length - 1])) === mix(valueFor(kind, size * SHORT_OPERATION_REPETITIONS - 1)), "created signal value");
        },
      ));

      if (kind === "number") {
        results.push(await measureCase(
          clock,
          { ...base, operation: "stale_handle_validation", setup_operations: 2, timed_operations: REPEATED_OPERATIONS, cleanup: "release stale handle and graph" },
          async () => {
            const layer = await createLayer(layerName, directModule, runtimeModule, wasmModule);
            const signal = layer.signal(0);
            layer.staleSignal(signal);
            return { layer, signal, graphLive: true };
          },
          (state) => {
            let rejected = 0;
            for (let iteration = 0; iteration < REPEATED_OPERATIONS; iteration += 1) {
              if (state.layer.direct) {
                try {
                  state.layer.read(state.signal);
                } catch (error) {
                  if (error?.code === "stale_handle") rejected += 1;
                }
              } else {
                const result = state.layer.core.get(state.signal);
                if (result.ok === false && result.error.code === "stale_handle") rejected += 1;
              }
            }
            return rejected;
          },
          async (state) => {
            if (state.layer.direct) state.signal.free();
            state.layer.disposeGraph();
            state.layer.release();
          },
          async (observed) => check(observed === REPEATED_OPERATIONS, "stale handle rejection count"),
        ));
      }

      results.push(await measureCase(
        clock,
        { ...base, operation: "signal_read", setup_operations: size, timed_operations: size * READ_REPETITIONS, cleanup: "dispose fixture and graph" },
        async () => {
          const layer = await createLayer(layerName, directModule, runtimeModule, wasmModule);
          const state = await buildGraph(layer, size, { computationCount: 0, connect: false, signalKind: kind });
          return state;
        },
        (state) => {
          let checksum = 0;
          for (let repetition = 0; repetition < READ_REPETITIONS; repetition += 1) {
            for (const signal of state.signals) checksum = (checksum + mix(state.layer.read(signal.value))) >>> 0;
          }
          return checksum;
        },
        disposeState,
        async (observed, state) => {
          check(Number.isInteger(observed), "signal read checksum");
          check(mix(state.layer.read(state.signals[0].value)) === mix(valueFor(kind, 0)), "signal read value");
        },
      ));

      for (const unchanged of [false, true]) {
        results.push(await measureCase(
          clock,
          { ...base, operation: unchanged ? "signal_write_unchanged" : "signal_write_changed", setup_operations: 1, timed_operations: REPEATED_OPERATIONS, cleanup: "dispose signal and graph" },
          async () => {
            const layer = await createLayer(layerName, directModule, runtimeModule, wasmModule);
            return { layer, signal: layer.signal(valueFor(kind, 0)), graphLive: true };
          },
          (state) => {
            let changed = 0;
            for (let iteration = 0; iteration < REPEATED_OPERATIONS; iteration += 1) {
              if (state.layer.set(state.signal, nextValue(kind, iteration, unchanged))) changed += 1;
            }
            return changed;
          },
          async (state) => {
            state.layer.disposeSignal(state.signal);
            state.layer.disposeGraph();
            state.layer.release();
          },
          async (observed, state) => {
            check(observed === (unchanged ? 0 : REPEATED_OPERATIONS), "changed write result count");
            check(mix(state.layer.read(state.signal)) === mix(nextValue(kind, REPEATED_OPERATIONS - 1, unchanged)), "write final value");
          },
        ));
      }

      results.push(await measureCase(
        clock,
        { ...base, operation: "signal_disposal", setup_operations: size * SHORT_OPERATION_REPETITIONS, timed_operations: size * SHORT_OPERATION_REPETITIONS, cleanup: "dispose computations and graph" },
        async () => {
          const layer = await createLayer(layerName, directModule, runtimeModule, wasmModule);
          return await buildGraph(layer, size, { signalCount: size * SHORT_OPERATION_REPETITIONS, computationCount: 0, connect: false, signalKind: kind });
        },
        (state) => {
          for (const signal of state.signals) {
            state.layer.disposeSignal(signal.value);
            signal.live = false;
          }
          return state.signals.length;
        },
        async (state) => {
          state.layer.disposeGraph();
          state.layer.release();
        },
        async (observed, state) => {
          check(observed === size * SHORT_OPERATION_REPETITIONS, "signal disposal count");
          expectFailure(state.layer.direct ? (() => {
            try {
              state.layer.read(state.signals[0].value);
              return { ok: true };
            } catch (error) {
              return { ok: false, error };
            }
          })() : state.layer.core.get(state.signals[0].value), "disposed signal rejection");
        },
      ));
    }
  }
}

function replaceDependencies(layer, computation, signals) {
  if (layer.direct) {
    const list = layer.dependencyList();
    try {
      for (const signal of signals) layer.dependencyPush(list, signal.value);
      layer.replaceDependencies(computation.value, list);
    } finally {
      list.free();
    }
  } else {
    layer.replaceDependencies(computation.value, signals.map((signal) => signal.value));
  }
}

async function addDependencyCases(results, clock, layerName, directModule, runtimeModule, wasmModule) {
  for (const size of SIZES) {
    const base = { layer: layerName, size, graph_size: size };
    const computationCount = Math.max(1, Math.floor(size / 4));

    results.push(await measureCase(
      clock,
      { ...base, operation: "computation_creation", setup_operations: 0, computation_count: computationCount * SHORT_OPERATION_REPETITIONS, timed_operations: computationCount * SHORT_OPERATION_REPETITIONS, cleanup: "dispose computations and graph" },
      async () => ({ layer: await createLayer(layerName, directModule, runtimeModule, wasmModule), computations: [], signals: [], graphLive: true }),
      (state) => {
        for (let repetition = 0; repetition < SHORT_OPERATION_REPETITIONS; repetition += 1) {
          for (let index = 0; index < computationCount; index += 1) state.computations.push({ value: state.layer.computation(), live: true });
        }
        return state.computations.length;
      },
      disposeState,
        async (observed) => check(observed === computationCount * SHORT_OPERATION_REPETITIONS, "computation creation count"),
    ));

    if (layerName === "direct-wasm") {
      results.push(await measureCase(
        clock,
        { ...base, operation: "computation_identity_lookup", setup_operations: computationCount, computation_count: computationCount, timed_operations: computationCount * READ_REPETITIONS, cleanup: "dispose computations and graph" },
        async () => {
          const layer = await createLayer(layerName, directModule, runtimeModule, wasmModule);
          const state = { ...(await buildGraph(layer, size, { computationCount, connect: false })) };
          return state;
        },
        (state) => {
          let checksum = 0;
          for (let repetition = 0; repetition < READ_REPETITIONS; repetition += 1) {
            for (const computation of state.computations) {
              const identity = state.layer.computationIdentity(computation.value);
              checksum = (checksum + identity[0] + identity[1]) >>> 0;
            }
          }
          return checksum;
        },
        disposeState,
        async (observed) => check(Number.isInteger(observed), "identity checksum"),
      ));
    }

    const connected = await buildGraph(await createLayer(layerName, directModule, runtimeModule, wasmModule), size, { computationCount, degree: 4, connect: false });
    for (const [signalIndex, computationIndex] of connected.edges) {
      connected.layer.subscribe(connected.signals[signalIndex].value, connected.computations[computationIndex].value);
    }
    await disposeState(connected);

    for (const operation of ["subscription_registration", "duplicate_subscription", "unsubscription"]) {
      const edgeRepetitionCount = SHORT_OPERATION_REPETITIONS;
      results.push(await measureCase(
        clock,
        { ...base, operation, dependency_edges: size * edgeRepetitionCount, computation_count: computationCount * edgeRepetitionCount, timed_operations: size * edgeRepetitionCount, cleanup: "dispose fixture and graph" },
        async () => {
          const layer = await createLayer(layerName, directModule, runtimeModule, wasmModule);
          return await buildGraph(layer, size, { signalCount: size * edgeRepetitionCount, computationCount: computationCount * edgeRepetitionCount, degree: 4, connect: operation !== "subscription_registration" });
        },
        (state) => {
          let changed = 0;
          for (const [signalIndex, computationIndex] of state.edges) {
            const result = operation === "subscription_registration"
              ? state.layer.subscribe(state.signals[signalIndex].value, state.computations[computationIndex].value)
              : operation === "duplicate_subscription"
                ? state.layer.subscribe(state.signals[signalIndex].value, state.computations[computationIndex].value)
                : state.layer.unsubscribe(state.signals[signalIndex].value, state.computations[computationIndex].value);
            if (result) changed += 1;
          }
          return changed;
        },
        disposeState,
        async (observed) => check(observed === (operation === "duplicate_subscription" ? 0 : size * edgeRepetitionCount), `${operation} result count`),
      ));
    }

    results.push(await measureCase(
      clock,
      { ...base, operation: "dependency_replacement", dependency_edges: DEPENDENCY_COUNT, computation_count: 1, timed_operations: REPEATED_OPERATIONS, cleanup: "dispose fixture and graph" },
      async () => {
        const layer = await createLayer(layerName, directModule, runtimeModule, wasmModule);
        const state = await buildGraph(layer, size, { computationCount: 1, connect: false });
        state.dependencies = Array.from({ length: DEPENDENCY_COUNT }, (_, index) => state.signals[(index * 13) % size]);
        replaceDependencies(layer, state.computations[0], state.dependencies);
        return state;
      },
      (state) => {
        for (let iteration = 0; iteration < REPEATED_OPERATIONS; iteration += 1) replaceDependencies(state.layer, state.computations[0], state.dependencies);
        return REPEATED_OPERATIONS;
      },
      disposeState,
      async (observed) => check(observed === REPEATED_OPERATIONS, "dependency replacement count"),
    ));

    for (const operation of ["computation_disposal", "dependency_cleanup_signal_disposal"]) {
      const disposalComputationCount = operation === "computation_disposal" ? computationCount * SHORT_OPERATION_REPETITIONS : computationCount;
      const disposalSignalCount = operation === "dependency_cleanup_signal_disposal" ? size * SHORT_OPERATION_REPETITIONS : size;
      const disposalEdgeCount = operation === "computation_disposal" ? disposalComputationCount * 4 : size;
      results.push(await measureCase(
        clock,
        { ...base, operation, setup_operations: disposalSignalCount + disposalComputationCount + disposalEdgeCount, dependency_edges: disposalEdgeCount, computation_count: disposalComputationCount, affected_computations: disposalComputationCount, timed_operations: operation === "computation_disposal" ? disposalComputationCount : disposalSignalCount, cleanup: "dispose remaining resources and graph" },
        async () => {
          const layer = await createLayer(layerName, directModule, runtimeModule, wasmModule);
          return await buildGraph(layer, size, { signalCount: disposalSignalCount, computationCount: disposalComputationCount, degree: 4, connect: true });
        },
        (state) => {
          if (operation === "computation_disposal") {
            for (const computation of state.computations) {
              state.layer.disposeComputation(computation.value);
              computation.live = false;
            }
            return state.computations.length;
          }
          for (const signal of state.signals) {
            state.layer.disposeSignal(signal.value);
            signal.live = false;
          }
          return state.signals.length;
        },
        disposeState,
        async (observed) => check(observed === (operation === "computation_disposal" ? disposalComputationCount : disposalSignalCount), `${operation} count`),
      ));
    }
  }
}

async function addDirtyCases(results, clock, layerName, directModule, runtimeModule, wasmModule) {
  for (const size of SIZES) {
    const fanouts = [1, Math.max(1, Math.floor(size / 4)), size];
    for (const fanout of fanouts) {
      const base = { layer: layerName, size, graph_size: size, subscriber_fanout: fanout, affected_computations: fanout, computation_count: fanout, dependency_edges: fanout };
      results.push(await measureCase(
        clock,
        { ...base, operation: "dirty_change_and_drain", setup_operations: size + fanout + fanout, timed_operations: REPEATED_OPERATIONS * 2, cleanup: "dispose fixture and graph" },
        async () => {
          const layer = await createLayer(layerName, directModule, runtimeModule, wasmModule);
          const state = await buildGraph(layer, size, { computationCount: fanout, fanout });
          state.layer.set(state.signals[0].value, 1000);
          state.layer.set(state.signals[0].value, 1001);
          const pending = state.layer.pending();
          verifyPendingOrder(state.layer, pending, state.computations);
          check(pendingCount(state.layer, state.layer.pending()) === 0, "pending queue drains once");
          return state;
        },
        (state) => {
          let drained = 0;
          for (let iteration = 0; iteration < REPEATED_OPERATIONS; iteration += 1) {
            check(state.layer.set(state.signals[0].value, iteration + 2000), "changed dirty write");
            const pending = state.layer.pending();
            check(pendingCount(state.layer, pending) === fanout, "dirty fan-out count");
            drained += pendingCount(state.layer, pending);
          }
          return drained;
        },
        disposeState,
        async (observed, state) => {
          check(observed === REPEATED_OPERATIONS * fanout, "dirty drain total");
          check(mix(state.layer.read(state.signals[0].value)) === mix(REPEATED_OPERATIONS - 1 + 2000), "dirty final value");
        },
      ));

      results.push(await measureCase(
        clock,
        { ...base, operation: "pending_drain_transfer", setup_operations: size + fanout + fanout + 1, pending_pairs: fanout, timed_operations: fanout * REPEATED_OPERATIONS, cleanup: "dispose fixture and graph" },
        async () => {
          const layer = await createLayer(layerName, directModule, runtimeModule, wasmModule);
          const state = await buildGraph(layer, size, { computationCount: fanout, fanout });
          state.layer.set(state.signals[0].value, 3000);
          return state;
        },
        (state) => {
          let transferred = 0;
          for (let iteration = 0; iteration < REPEATED_OPERATIONS; iteration += 1) {
            const pending = state.layer.pending();
            verifyPendingOrder(state.layer, pending, state.computations);
            transferred += pendingCount(state.layer, pending);
            if (iteration + 1 < REPEATED_OPERATIONS) {
              check(state.layer.set(state.signals[0].value, iteration + 3001), "pending transfer re-enqueue");
            }
          }
          return transferred;
        },
        disposeState,
        async (observed) => check(observed === fanout * REPEATED_OPERATIONS, "pending transfer count"),
      ));

      results.push(await measureCase(
        clock,
        { ...base, operation: "pending_reenqueue_after_drain", setup_operations: size + fanout + fanout, timed_operations: REPEATED_OPERATIONS * 2, cleanup: "dispose fixture and graph" },
        async () => await buildGraph(await createLayer(layerName, directModule, runtimeModule, wasmModule), size, { computationCount: fanout, fanout }),
        (state) => {
          let drained = 0;
          for (let iteration = 0; iteration < REPEATED_OPERATIONS; iteration += 1) {
            state.layer.set(state.signals[0].value, iteration + 4000);
            drained += pendingCount(state.layer, state.layer.pending());
          }
          return drained;
        },
        disposeState,
        async (observed) => check(observed === REPEATED_OPERATIONS * fanout, "re-enqueue count"),
      ));

      const sharedSignals = Math.min(8, size);
      results.push(await measureCase(
        clock,
        { ...base, operation: "dirty_multiple_shared_computations", dependency_edges: sharedSignals * fanout, setup_operations: size + fanout + sharedSignals * fanout, pending_pairs: fanout, timed_operations: REPEATED_OPERATIONS * (sharedSignals + 1), cleanup: "dispose fixture and graph" },
        async () => await buildGraph(await createLayer(layerName, directModule, runtimeModule, wasmModule), size, { computationCount: fanout, sharedSignals }),
        (state) => {
          let drained = 0;
          for (let iteration = 0; iteration < REPEATED_OPERATIONS; iteration += 1) {
            for (let signalIndex = 0; signalIndex < sharedSignals; signalIndex += 1) {
              state.layer.set(state.signals[signalIndex].value, iteration * 17 + signalIndex + 5000);
            }
            const pending = state.layer.pending();
            check(pendingCount(state.layer, pending) === fanout, "shared computation deduplication");
            drained += pendingCount(state.layer, pending);
          }
          return drained;
        },
        disposeState,
        async (observed) => check(observed === REPEATED_OPERATIONS * fanout, "shared computation drain total"),
      ));
    }
  }
}

async function addBatchCases(results, clock, layerName, directModule, runtimeModule, wasmModule) {
  for (const size of SIZES) {
    const updateCount = Math.min(8, size);
    const computationCount = Math.max(1, Math.floor(size / 4));
    const base = { layer: layerName, size, graph_size: size, computation_count: computationCount, subscriber_fanout: computationCount, affected_computations: computationCount, dependency_edges: updateCount * computationCount };
    const operationCount = REPEATED_OPERATIONS * (updateCount + 1);

    results.push(await measureCase(
      clock,
      { ...base, operation: "updates_without_batching", setup_operations: size + computationCount + updateCount * computationCount, timed_operations: operationCount, cleanup: "dispose fixture and graph" },
      async () => await buildGraph(await createLayer(layerName, directModule, runtimeModule, wasmModule), size, { computationCount, sharedSignals: updateCount }),
      (state) => {
        let drained = 0;
        for (let iteration = 0; iteration < REPEATED_OPERATIONS; iteration += 1) {
          for (let signalIndex = 0; signalIndex < updateCount; signalIndex += 1) state.layer.set(state.signals[signalIndex].value, iteration * 31 + signalIndex + 6000);
          drained += pendingCount(state.layer, state.layer.pending());
        }
        return drained;
      },
      disposeState,
      async (observed) => check(observed === REPEATED_OPERATIONS * computationCount, "unbatched drain total"),
    ));

    results.push(await measureCase(
      clock,
      { ...base, operation: "updates_inside_one_batch", setup_operations: size + computationCount + updateCount * computationCount, timed_operations: REPEATED_OPERATIONS * (updateCount + 4), cleanup: "dispose fixture and graph" },
      async () => await buildGraph(await createLayer(layerName, directModule, runtimeModule, wasmModule), size, { computationCount, sharedSignals: updateCount }),
      (state) => {
        let drained = 0;
        for (let iteration = 0; iteration < REPEATED_OPERATIONS; iteration += 1) {
          state.layer.beginBatch();
          for (let signalIndex = 0; signalIndex < updateCount; signalIndex += 1) state.layer.set(state.signals[signalIndex].value, iteration * 31 + signalIndex + 7000);
          state.layer.endBatch();
          drained += pendingCount(state.layer, state.layer.pending());
        }
        return drained;
      },
      disposeState,
      async (observed) => check(observed === REPEATED_OPERATIONS * computationCount, "batched drain total"),
    ));

    results.push(await measureCase(
      clock,
      { ...base, operation: "updates_inside_nested_batches", setup_operations: size + computationCount + updateCount * computationCount, timed_operations: REPEATED_OPERATIONS * (updateCount + 6), cleanup: "dispose fixture and graph" },
      async () => await buildGraph(await createLayer(layerName, directModule, runtimeModule, wasmModule), size, { computationCount, sharedSignals: updateCount }),
      (state) => {
        let drained = 0;
        for (let iteration = 0; iteration < REPEATED_OPERATIONS; iteration += 1) {
          state.layer.beginBatch();
          state.layer.set(state.signals[0].value, iteration + 8000);
          state.layer.beginBatch();
          for (let signalIndex = 1; signalIndex < updateCount; signalIndex += 1) state.layer.set(state.signals[signalIndex].value, iteration * 31 + signalIndex + 8000);
          state.layer.endBatch();
          state.layer.endBatch();
          drained += pendingCount(state.layer, state.layer.pending());
        }
        return drained;
      },
      disposeState,
      async (observed) => check(observed === REPEATED_OPERATIONS * computationCount, "nested batch drain total"),
    ));

    results.push(await measureCase(
      clock,
      { ...base, operation: "batch_boundary_overhead", setup_operations: 0, dependency_edges: 0, affected_computations: 0, timed_operations: REPEATED_OPERATIONS * 4, cleanup: "dispose graph" },
      async () => ({ layer: await createLayer(layerName, directModule, runtimeModule, wasmModule), graphLive: true }),
      (state) => {
        for (let iteration = 0; iteration < REPEATED_OPERATIONS; iteration += 1) {
          state.layer.beginBatch();
          state.layer.beginBatch();
          state.layer.endBatch();
          state.layer.endBatch();
        }
        return REPEATED_OPERATIONS;
      },
      disposeState,
      async (observed) => check(observed === REPEATED_OPERATIONS, "batch boundary count"),
    ));

    results.push(await measureCase(
      clock,
      { ...base, operation: "pending_transfer_after_batch", setup_operations: (size + computationCount + updateCount * computationCount + updateCount + 3) * TRANSFER_REPETITIONS, pending_pairs: computationCount, timed_operations: computationCount * TRANSFER_REPETITIONS, cleanup: "dispose transfer fixtures and graphs" },
      async () => {
        const states = [];
        for (let repetition = 0; repetition < TRANSFER_REPETITIONS; repetition += 1) {
          const state = await buildGraph(await createLayer(layerName, directModule, runtimeModule, wasmModule), size, { computationCount, sharedSignals: updateCount });
          state.layer.beginBatch();
          for (let signalIndex = 0; signalIndex < updateCount; signalIndex += 1) state.layer.set(state.signals[signalIndex].value, signalIndex + 9000 + repetition);
          state.layer.endBatch();
          states.push(state);
        }
        return { states };
      },
      (state) => {
        let transferred = 0;
        for (const transferState of state.states) {
          transferred += pendingCount(transferState.layer, transferState.layer.pending());
        }
        return transferred;
      },
      async (state) => {
        for (const transferState of state.states) await disposeState(transferState);
      },
      async (observed, state) => {
        check(observed === computationCount * TRANSFER_REPETITIONS, "batch pending transfer count");
        for (const transferState of state.states) check(pendingCount(transferState.layer, transferState.layer.pending()) === 0, "batch pending queue drained");
      },
    ));
  }
}

async function addLifecycleCases(results, clock, layerName, directModule, runtimeModule, wasmModule) {
  const createCount = WARM_INSTANCE_REPETITIONS;
  for (const size of SIZES) {
    const computationCount = Math.max(1, Math.floor(size / 4));
    const base = { layer: layerName, size, graph_size: size };

    results.push(await measureCase(
      clock,
      { ...base, operation: "warm_instance_creation", setup_operations: 0, timed_operations: createCount, cleanup: "dispose created instances" },
      async () => ({ created: [] }),
      async (state) => {
        for (let index = 0; index < createCount; index += 1) state.created.push(await createLayer(layerName, directModule, runtimeModule, wasmModule));
        return state.created.length;
      },
      async (state) => {
        for (const layer of state.created) {
          layer.disposeGraph();
          layer.release();
        }
      },
      async (observed) => check(observed === createCount, "warm instance creation count"),
    ));

    results.push(await measureCase(
      clock,
      { ...base, operation: "explicit_graph_disposal", setup_operations: (size + computationCount + computationCount * 4) * SHORT_OPERATION_REPETITIONS, computation_count: computationCount * SHORT_OPERATION_REPETITIONS, dependency_edges: computationCount * 4 * SHORT_OPERATION_REPETITIONS, timed_operations: SHORT_OPERATION_REPETITIONS, cleanup: "release bridge objects" },
      async () => {
        const graphs = [];
        for (let repetition = 0; repetition < SHORT_OPERATION_REPETITIONS; repetition += 1) {
          graphs.push(await buildGraph(await createLayer(layerName, directModule, runtimeModule, wasmModule), size, { computationCount, degree: 4, connect: true }));
        }
        return { graphs };
      },
      (state) => {
        for (const graph of state.graphs) graph.layer.disposeGraph();
        return state.graphs.length;
      },
      async (state) => {
        for (const graph of state.graphs) graph.layer.release();
      },
      async (observed) => check(observed === SHORT_OPERATION_REPETITIONS, "graph disposal count"),
    ));

    results.push(await measureCase(
      clock,
      { ...base, operation: "repeated_signal_lifecycle", setup_operations: 1, timed_operations: REPEATED_OPERATIONS * 2, cleanup: "dispose graph" },
      async () => ({ layer: await createLayer(layerName, directModule, runtimeModule, wasmModule), graphLive: true }),
      (state) => {
        for (let iteration = 0; iteration < REPEATED_OPERATIONS; iteration += 1) {
          const signal = state.layer.signal(iteration + 1);
          state.layer.disposeSignal(signal);
        }
        return REPEATED_OPERATIONS;
      },
      disposeState,
      async (observed) => check(observed === REPEATED_OPERATIONS, "signal lifecycle count"),
    ));
  }
}

export async function runBenchmarks({ directModule, runtimeModule, wasmModule, clock, metadata, precomputed = [] }) {
  const results = [...precomputed];
  const layers = ["direct-wasm", "typescript-runtime"];
  for (const layerName of layers) {
    await addSignalCases(results, clock, layerName, directModule, runtimeModule, wasmModule);
    await addDependencyCases(results, clock, layerName, directModule, runtimeModule, wasmModule);
    await addDirtyCases(results, clock, layerName, directModule, runtimeModule, wasmModule);
    await addBatchCases(results, clock, layerName, directModule, runtimeModule, wasmModule);
    await addLifecycleCases(results, clock, layerName, directModule, runtimeModule, wasmModule);
  }

  return {
    schema_version: BENCHMARK_CONFIG.schema_version,
    benchmark: "M2.5 WASM bridge performance baseline",
    generated_at: new Date().toISOString(),
    metadata,
    configuration: BENCHMARK_CONFIG,
    correctness: {
      checks_run_outside_timing: true,
      callbacks_executed: false,
      scheduler_introduced: false,
      all_cases_completed: true,
    },
    integrity: measurementIntegrity(results),
    results,
  };
}
