import {
  BENCHMARK_CONFIG,
  measureCase,
} from "./benchmark_workloads.mjs";

const SIZES = Object.freeze([1, 10, 100, 1000]);
const UPDATE_CYCLES = 16;
const UNCHANGED_CYCLES = 64;

function check(condition, message) {
  if (!condition) throw new Error(`M3.5 benchmark correctness check failed: ${message}`);
}

function unwrap(result, operation) {
  check(result !== null && typeof result === "object", `${operation} returned an object`);
  if (result.ok !== true) throw new Error(`${operation} failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function success(value) {
  return { ok: true, value };
}

function createFailure(code, operation, message) {
  return {
    ok: false,
    error: { kind: "internal", code, operation, resource: "benchmark", message },
  };
}

function signalValue(runtime, signal, operation) {
  return unwrap(runtime.get(signal), operation);
}

function integrity(results) {
  const invalid = results.filter((row) =>
    row.unresolved_reason !== null ||
    !Number.isFinite(row.median_ns) ||
    !Number.isFinite(row.p95_ns) ||
    row.samples_ns.some((sample) => !Number.isFinite(sample) || sample <= 0),
  );
  return {
    total_rows: results.length,
    valid_rows: results.length - invalid.length,
    unresolved_rows: invalid.length,
    zero_median_rows: results.filter((row) => row.median_ns === 0).length,
    zero_sample_rows: results.filter((row) => row.samples_ns.some((sample) => sample === 0)).length,
    non_finite_rows: results.filter((row) =>
      !Number.isFinite(row.median_ns) || row.samples_ns.some((sample) => !Number.isFinite(sample)),
    ).length,
    status: invalid.length === 0 ? "pass" : "unresolved",
  };
}

function appendMetadata(row, metadata) {
  return {
    ...row,
    measurement_layer: metadata.measurementLayer,
    workload_size: metadata.workloadSize,
    measurement_phase: metadata.phase,
    operation_count_unit: metadata.operationCountUnit,
    signal_count: metadata.signalCount,
    computation_count: metadata.computationCount,
    binding_count: metadata.bindingCount,
    dependency_edges: metadata.dependencyEdges,
    affected_computations: metadata.affectedComputations,
    pending_computations: metadata.pendingComputations,
    setup_description: metadata.setupDescription,
    timed_description: metadata.timedDescription,
    cleanup_description: metadata.cleanupDescription,
  };
}

async function makeRuntime(runtimeModule, wasmModule) {
  return unwrap(await runtimeModule.createReactiveCore(() => wasmModule), "create benchmark runtime");
}

function disposeRuntime(state) {
  if (state.runtime !== undefined) {
    const result = state.runtime.dispose();
    check(result.ok === true, "benchmark runtime disposal");
    state.runtime = undefined;
  }
}

function disposeRoot(state) {
  if (state.root !== undefined) {
    const result = state.root.dispose();
    check(result.ok === true, "benchmark root disposal");
    state.root = undefined;
  }
}

function mountTextFixture(state, rootModule, size, mode, runtime) {
  const root = unwrap(rootModule.createRootContext(state.container, runtime), "create fixture root");
  const signals = [];
  if (mode === "independent") {
    for (let index = 0; index < size; index += 1) signals.push(unwrap(runtime.createSignal(0), "create independent signal"));
  } else {
    signals.push(unwrap(runtime.createSignal(0), "create shared signal"));
  }
  const nodes = [];
  const mount = root.mount((scope) => {
    const section = scope.createElement("section");
    for (let index = 0; index < size; index += 1) {
      const node = scope.createTextNode("");
      nodes.push(node);
      scope.appendChild(section, node);
      const signal = mode === "independent" ? signals[index] : signals[0];
      const registration = scope.registerBinding({
        target: node,
        dependencies: [signal],
        key: `text-${index}`,
        update: () => success(scope.setText(node, `value:${signalValue(runtime, signal, "read benchmark signal")}`)),
      });
      if (!registration.ok) return registration;
    }
    scope.appendChild(scope.container, section);
    return success(undefined);
  });
  unwrap(mount, "mount fixture root");
  state.root = root;
  state.signals = signals;
  state.nodes = nodes;
  state.size = size;
  return state;
}

async function setupMountedText(runtimeModule, rootModule, wasmModule, size, mode) {
  const runtime = await makeRuntime(runtimeModule, wasmModule);
  const state = { runtime, container: document.createElement("main") };
  return mountTextFixture(state, rootModule, size, mode, runtime);
}

async function setupAttributeProperty(runtimeModule, rootModule, wasmModule, size) {
  const runtime = await makeRuntime(runtimeModule, wasmModule);
  const state = {
    runtime,
    container: document.createElement("main"),
    nodes: [],
    inputs: [],
  };
  const label = unwrap(runtime.createSignal("zero"), "create attribute signal");
  const disabled = unwrap(runtime.createSignal(true), "create property signal");
  state.label = label;
  state.disabled = disabled;
  const root = unwrap(rootModule.createRootContext(state.container, runtime), "create attribute root");
  const mount = root.mount((scope) => {
    const section = scope.createElement("section");
    for (let index = 0; index < size; index += 1) {
      const button = scope.createElement("button");
      const input = scope.createElement("input");
      state.nodes.push(button);
      state.inputs.push(input);
      scope.appendChild(section, button);
      scope.appendChild(section, input);
      const attributeBinding = scope.registerBinding({
        target: button,
        dependencies: [label],
        key: `label-${index}`,
        update: () => success(scope.setAttribute(button, "aria-label", signalValue(runtime, label, "read label signal"))),
      });
      if (!attributeBinding.ok) return attributeBinding;
      const propertyBinding = scope.registerBinding({
        target: input,
        dependencies: [disabled],
        key: `disabled-${index}`,
        update: () => success(scope.setProperty(input, "disabled", signalValue(runtime, disabled, "read disabled signal"))),
      });
      if (!propertyBinding.ok) return propertyBinding;
    }
    scope.appendChild(scope.container, section);
    return success(undefined);
  });
  unwrap(mount, "mount attribute/property root");
  state.root = root;
  state.size = size;
  return state;
}

async function setupEmptyRoot(runtimeModule, wasmModule) {
  const runtime = await makeRuntime(runtimeModule, wasmModule);
  return { runtime, container: document.createElement("main") };
}

function mountStatic(scope, size) {
  const section = scope.createElement("section");
  for (let index = 0; index < size; index += 1) {
    const node = scope.createTextNode(`static:${index}`);
    scope.appendChild(section, node);
  }
  scope.appendChild(scope.container, section);
}

async function setupNative(runtimeModule, wasmModule, size, kind) {
  const state = { container: document.createElement("main"), size, kind };
  if (kind === "text") {
    state.nodes = Array.from({ length: size }, () => document.createTextNode("value:0"));
    state.nodes.forEach((node) => state.container.appendChild(node));
  } else if (kind === "attribute-property") {
    state.buttons = [];
    state.inputs = [];
    for (let index = 0; index < size; index += 1) {
      const button = document.createElement("button");
      const input = document.createElement("input");
      state.buttons.push(button);
      state.inputs.push(input);
      state.container.append(button, input);
    }
  } else if (kind === "unmount") {
    state.section = document.createElement("section");
    for (let index = 0; index < size; index += 1) state.section.appendChild(document.createTextNode(`static:${index}`));
    state.container.appendChild(state.section);
  }
  return state;
}

function cleanupRuseact(state) {
  if (state.root !== undefined) disposeRoot(state);
  disposeRuntime(state);
}

function cleanupNative(state) {
  state.container.replaceChildren();
}

function ruseactMetadata(size, phase, operationCountUnit, options = {}) {
  return {
    measurementLayer: "ruseact-dom-e2e",
    workloadSize: size,
    phase,
    operationCountUnit,
    signalCount: options.signalCount ?? 1,
    computationCount: options.computationCount ?? size,
    bindingCount: options.bindingCount ?? size,
    dependencyEdges: options.dependencyEdges ?? size,
    affectedComputations: options.affectedComputations ?? size,
    pendingComputations: options.pendingComputations ?? size,
    setupDescription: options.setupDescription ?? "warm WASM module; runtime, container, root, nodes, signals, and bindings are created outside the timed operation",
    timedDescription: options.timedDescription,
    cleanupDescription: "dispose root, renderer computations, subscriptions, and borrowed runtime after validation",
  };
}

function nativeMetadata(size, phase, operationCountUnit, timedDescription) {
  return {
    measurementLayer: "native-dom-reference",
    workloadSize: size,
    phase,
    operationCountUnit,
    signalCount: 0,
    computationCount: 0,
    bindingCount: 0,
    dependencyEdges: 0,
    affectedComputations: 0,
    pendingComputations: 0,
    setupDescription: "native detached DOM fixture created outside the timed operation",
    timedDescription,
    cleanupDescription: "remove all native DOM nodes after validation",
  };
}

async function measureWorkload(clock, descriptor, setup, operation, cleanup, validate) {
  const row = await measureCase(clock, descriptor, setup, operation, cleanup, validate);
  return appendMetadata(row, descriptor.m35);
}

async function ruseactRows(results, clock, runtimeModule, rootModule, wasmModule) {
  for (const size of SIZES) {
    const textOptions = { signalCount: 1, computationCount: size, bindingCount: size, dependencyEdges: size, affectedComputations: size, pendingComputations: size };
    results.push(await measureWorkload(clock, {
      layer: "typescript-runtime",
      operation: "root_mount",
      size,
      graph_size: size,
      timed_operations: 1,
      setup_operations: 1,
      cleanup: "dispose mounted root and runtime",
      m35: ruseactMetadata(size, "mount", "root-mount-cycle", { ...textOptions, timedDescription: "create root and mount a static subtree with size text nodes" }),
    },
    () => setupEmptyRoot(runtimeModule, wasmModule),
    (state) => {
      const root = unwrap(rootModule.createRootContext(state.container, state.runtime), "create timed root");
      const mounted = root.mount((scope) => {
        mountStatic(scope, size);
        return success(undefined);
      });
      unwrap(mounted, "timed root mount");
      state.root = root;
      return 1;
    },
    cleanupRuseact,
    (observed, state) => {
      check(observed === 1 && state.container.childNodes.length === 1, "root mount result");
    }));

    results.push(await measureWorkload(clock, {
      layer: "typescript-runtime",
      operation: "signal_write_unchanged",
      size,
      graph_size: size,
      timed_operations: UNCHANGED_CYCLES,
      setup_operations: size,
      cleanup: "dispose mounted root and runtime",
      m35: ruseactMetadata(size, "invalidation-only", "unchanged-signal-write", { ...textOptions, affectedComputations: 0, pendingComputations: 0, timedDescription: `write the same signal value ${UNCHANGED_CYCLES} times without flushing` }),
    },
    () => setupMountedText(runtimeModule, rootModule, wasmModule, size, "shared"),
    (state) => {
      for (let cycle = 0; cycle < UNCHANGED_CYCLES; cycle += 1) check(unwrap(state.runtime.set(state.signals[0], 0), "unchanged signal write") === "unchanged", "unchanged write result");
      return UNCHANGED_CYCLES;
    },
    cleanupRuseact,
    (observed, state) => check(observed === UNCHANGED_CYCLES && state.root.flush().value?.drainedCount === 0, "unchanged update validation")));

    results.push(await measureWorkload(clock, {
      layer: "typescript-runtime",
      operation: "signal_write_flush",
      size,
      graph_size: size,
      timed_operations: UPDATE_CYCLES,
      setup_operations: size,
      cleanup: "dispose mounted root and runtime",
      m35: ruseactMetadata(size, "full-update", "signal-write-plus-explicit-flush-cycle", { ...textOptions, timedDescription: `change one shared signal and explicitly flush ${UPDATE_CYCLES} times` }),
    },
    () => setupMountedText(runtimeModule, rootModule, wasmModule, size, "shared"),
    (state) => {
      for (let cycle = 1; cycle <= UPDATE_CYCLES; cycle += 1) {
        check(unwrap(state.runtime.set(state.signals[0], cycle), "changed signal write") === "changed", "changed write result");
        check(unwrap(state.root.flush(), "explicit signal flush").drainedCount === size, "shared bindings flush");
      }
      return UPDATE_CYCLES;
    },
    cleanupRuseact,
    (observed, state) => check(observed === UPDATE_CYCLES && state.nodes.every((node) => node.nodeValue === `value:${UPDATE_CYCLES}`), "changed flush validation")));

    results.push(await measureWorkload(clock, {
      layer: "typescript-runtime",
      operation: "multiple_signal_writes_one_flush",
      size,
      graph_size: size,
      timed_operations: UPDATE_CYCLES,
      setup_operations: size,
      cleanup: "dispose mounted root and runtime",
      m35: ruseactMetadata(size, "full-update", "three-signal-writes-plus-one-flush-cycle", { ...textOptions, timedDescription: `write one signal three times and flush once, ${UPDATE_CYCLES} cycles` }),
    },
    () => setupMountedText(runtimeModule, rootModule, wasmModule, size, "shared"),
    (state) => {
      for (let cycle = 1; cycle <= UPDATE_CYCLES; cycle += 1) {
        check(unwrap(state.runtime.set(state.signals[0], cycle), "first batched signal write") === "changed", "first batched write");
        check(unwrap(state.runtime.set(state.signals[0], cycle + 1000), "second batched signal write") === "changed", "second batched write");
        check(unwrap(state.runtime.set(state.signals[0], cycle + 2000), "third batched signal write") === "changed", "third batched write");
        check(unwrap(state.root.flush(), "batched explicit flush").drainedCount === size, "batched writes deduplicate");
      }
      return UPDATE_CYCLES;
    },
    cleanupRuseact,
    (observed, state) => check(observed === UPDATE_CYCLES && state.nodes.every((node) => node.nodeValue === `value:${UPDATE_CYCLES + 2000}`), "batched validation")));

    results.push(await measureWorkload(clock, {
      layer: "typescript-runtime",
      operation: "shared_signal_binding_fanout",
      size,
      graph_size: size,
      timed_operations: UPDATE_CYCLES,
      setup_operations: size,
      cleanup: "dispose mounted root and runtime",
      m35: ruseactMetadata(size, "targeted-dom-mutation", "shared-signal-fanout-flush-cycle", { ...textOptions, timedDescription: `update ${size} bindings sharing one signal, ${UPDATE_CYCLES} cycles` }),
    },
    () => setupMountedText(runtimeModule, rootModule, wasmModule, size, "shared"),
    (state) => {
      for (let cycle = 1; cycle <= UPDATE_CYCLES; cycle += 1) {
        unwrap(state.runtime.set(state.signals[0], cycle), "fanout signal write");
        check(unwrap(state.root.flush(), "fanout flush").executedCount === size, "fanout execution count");
      }
      return UPDATE_CYCLES;
    },
    cleanupRuseact,
    (observed, state) => check(observed === UPDATE_CYCLES && state.nodes[0].nodeValue === `value:${UPDATE_CYCLES}`, "fanout validation")));

    results.push(await measureWorkload(clock, {
      layer: "typescript-runtime",
      operation: "independent_signal_bindings",
      size,
      graph_size: size,
      timed_operations: Math.max(1, Math.min(UPDATE_CYCLES, 8)),
      setup_operations: size,
      cleanup: "dispose mounted root and runtime",
      m35: ruseactMetadata(size, "targeted-dom-mutation", "independent-signal-flush-cycle", { signalCount: size, timedDescription: `update ${size} independent bindings in one flush` }),
    },
    () => setupMountedText(runtimeModule, rootModule, wasmModule, size, "independent"),
    (state) => {
      const cycles = Math.max(1, Math.min(UPDATE_CYCLES, 8));
      for (let cycle = 1; cycle <= cycles; cycle += 1) {
        for (const signal of state.signals) unwrap(state.runtime.set(signal, cycle), "independent signal write");
        check(unwrap(state.root.flush(), "independent flush").executedCount === size, "independent execution count");
      }
      return cycles;
    },
    cleanupRuseact,
    (observed, state) => check(observed > 0 && state.nodes.every((node) => node.nodeValue === `value:${observed}`), "independent validation")));

    results.push(await measureWorkload(clock, {
      layer: "typescript-runtime",
      operation: "attribute_property_update",
      size,
      graph_size: size,
      timed_operations: UPDATE_CYCLES,
      setup_operations: size * 2,
      cleanup: "dispose mounted root and runtime",
      m35: ruseactMetadata(size, "targeted-dom-mutation", "attribute-plus-property-flush-cycle", { signalCount: 2, dependencyEdges: size * 2, affectedComputations: size * 2, pendingComputations: size * 2, timedDescription: `update ${size} attributes and ${size} properties per flush, ${UPDATE_CYCLES} cycles` }),
    },
    () => setupAttributeProperty(runtimeModule, rootModule, wasmModule, size),
    (state) => {
      for (let cycle = 1; cycle <= UPDATE_CYCLES; cycle += 1) {
        unwrap(state.runtime.set(state.label, `label-${cycle}`), "attribute signal write");
        unwrap(state.runtime.set(state.disabled, cycle % 2 === 0), "property signal write");
        check(unwrap(state.root.flush(), "attribute/property flush").executedCount === size * 2, "attribute/property execution count");
      }
      return UPDATE_CYCLES;
    },
    cleanupRuseact,
    (observed, state) => check(observed === UPDATE_CYCLES && state.nodes.every((node) => node.getAttribute("aria-label") === `label-${UPDATE_CYCLES}`) && state.inputs.every((node) => node.disabled === true), "attribute/property validation")));

    results.push(await measureWorkload(clock, {
      layer: "typescript-runtime",
      operation: "root_unmount_cleanup",
      size,
      graph_size: size,
      timed_operations: 1,
      setup_operations: size,
      cleanup: "dispose unmounted root and runtime",
      m35: ruseactMetadata(size, "teardown", "root-unmount-cycle", { ...textOptions, affectedComputations: size, pendingComputations: 0, timedDescription: `unmount and clean up a root with ${size} bound nodes` }),
    },
    () => setupMountedText(runtimeModule, rootModule, wasmModule, size, "shared"),
    (state) => {
      unwrap(state.root.unmount(), "timed root unmount");
      return 1;
    },
    cleanupRuseact,
    (observed, state) => check(observed === 1 && state.container.childNodes.length === 0, "root unmount validation")));

    results.push(await measureWorkload(clock, {
      layer: "typescript-runtime",
      operation: "root_lifecycle_cycle",
      size,
      graph_size: size,
      timed_operations: 1,
      setup_operations: 1,
      cleanup: "dispose runtime after cycle",
      m35: ruseactMetadata(size, "lifecycle", "create-mount-unmount-dispose-cycle", { ...textOptions, timedDescription: `create, mount, unmount, and dispose a ${size}-node root` }),
    },
    () => setupEmptyRoot(runtimeModule, wasmModule),
    (state) => {
      const root = unwrap(rootModule.createRootContext(state.container, state.runtime), "lifecycle root creation");
      unwrap(root.mount((scope) => {
        mountStatic(scope, size);
        return success(undefined);
      }), "lifecycle root mount");
      unwrap(root.unmount(), "lifecycle root unmount");
      unwrap(root.dispose(), "lifecycle root dispose");
      state.root = undefined;
      return 1;
    },
    cleanupRuseact,
    (observed, state) => check(observed === 1 && state.container.childNodes.length === 0, "lifecycle validation")));
  }
}

async function nativeRows(results, clock) {
  for (const size of SIZES) {
    results.push(await measureWorkload(clock, {
      layer: "native-dom",
      operation: "native_dom_mount",
      size,
      graph_size: size,
      timed_operations: 1,
      setup_operations: 1,
      cleanup: "remove native subtree",
      m35: nativeMetadata(size, "mount-reference", "native-mount-cycle", "create and append a static subtree"),
    },
    () => setupNative(null, null, size, "mount"),
    (state) => {
      state.section = document.createElement("section");
      for (let index = 0; index < size; index += 1) state.section.appendChild(document.createTextNode(`static:${index}`));
      state.container.appendChild(state.section);
      return 1;
    },
    cleanupNative,
    (observed, state) => check(observed === 1 && state.container.firstChild === state.section, "native mount validation")));

    results.push(await measureWorkload(clock, {
      layer: "native-dom",
      operation: "native_dom_text_update",
      size,
      graph_size: size,
      timed_operations: UPDATE_CYCLES * size,
      setup_operations: size,
      cleanup: "remove native text nodes",
      m35: nativeMetadata(size, "host-mutation-reference", "text-node-write", `write ${size} text nodes for ${UPDATE_CYCLES} cycles`),
    },
    () => setupNative(null, null, size, "text"),
    (state) => {
      for (let cycle = 1; cycle <= UPDATE_CYCLES; cycle += 1) {
        for (const node of state.nodes) node.nodeValue = `value:${cycle}`;
      }
      return UPDATE_CYCLES * size;
    },
    cleanupNative,
    (observed, state) => check(observed === UPDATE_CYCLES * size && state.nodes.every((node) => node.nodeValue === `value:${UPDATE_CYCLES}`), "native text validation")));

    results.push(await measureWorkload(clock, {
      layer: "native-dom",
      operation: "native_dom_attribute_property",
      size,
      graph_size: size,
      timed_operations: UPDATE_CYCLES * size * 2,
      setup_operations: size * 2,
      cleanup: "remove native attribute/property nodes",
      m35: nativeMetadata(size, "host-mutation-reference", "attribute-plus-property-write", `write ${size} attributes and ${size} properties for ${UPDATE_CYCLES} cycles`),
    },
    () => setupNative(null, null, size, "attribute-property"),
    (state) => {
      for (let cycle = 1; cycle <= UPDATE_CYCLES; cycle += 1) {
        for (let index = 0; index < size; index += 1) {
          state.buttons[index].setAttribute("aria-label", `label-${cycle}`);
          state.inputs[index].disabled = cycle % 2 === 0;
        }
      }
      return UPDATE_CYCLES * size * 2;
    },
    cleanupNative,
    (observed, state) => check(observed === UPDATE_CYCLES * size * 2 && state.buttons.every((node) => node.getAttribute("aria-label") === `label-${UPDATE_CYCLES}`) && state.inputs.every((node) => node.disabled === true), "native attribute/property validation")));

    results.push(await measureWorkload(clock, {
      layer: "native-dom",
      operation: "native_dom_unmount",
      size,
      graph_size: size,
      timed_operations: 1,
      setup_operations: size,
      cleanup: "remove native container",
      m35: nativeMetadata(size, "teardown-reference", "native-unmount-cycle", "remove an already-mounted native subtree"),
    },
    () => setupNative(null, null, size, "unmount"),
    (state) => {
      state.container.removeChild(state.section);
      return 1;
    },
    cleanupNative,
    (observed, state) => check(observed === 1 && state.container.childNodes.length === 0, "native unmount validation")));

    results.push(await measureWorkload(clock, {
      layer: "native-dom",
      operation: "native_dom_lifecycle_cycle",
      size,
      graph_size: size,
      timed_operations: 1,
      setup_operations: 1,
      cleanup: "remove native lifecycle nodes",
      m35: nativeMetadata(size, "lifecycle-reference", "native-lifecycle-cycle", "create, append, and remove a native subtree"),
    },
    () => setupNative(null, null, size, "lifecycle"),
    (state) => {
      const section = document.createElement("section");
      for (let index = 0; index < size; index += 1) section.appendChild(document.createTextNode(`static:${index}`));
      state.container.appendChild(section);
      state.container.removeChild(section);
      return 1;
    },
    cleanupNative,
    (observed, state) => check(observed === 1 && state.container.childNodes.length === 0, "native lifecycle validation")));
  }
}

export async function runDomBenchmarks({ clock, runtimeModule, rootModule, wasmModule, metadata }) {
  const results = [];
  await ruseactRows(results, clock, runtimeModule, rootModule, wasmModule);
  await nativeRows(results, clock);
  const report = {
    schema_version: 1,
    benchmark: "m3.5-dom-e2e",
    metadata: {
      ...metadata,
      benchmark: "end-to-end signal-to-DOM integration",
      timing: "performance.now() converted to nanoseconds; explicit setup, timed operation, validation, and cleanup phases",
      scheduling: "manual root.flush(); no automatic scheduler",
      calibration: "shared bounded M2.5 adaptive calibration; unresolved or zero/non-finite rows remain invalid",
      comparison_note: "native-dom-reference rows measure browser host mutations only and are not framework comparisons",
    },
    configuration: {
      schema_version: 1,
      sizes: SIZES,
      trials: BENCHMARK_CONFIG.trials,
      warmups: BENCHMARK_CONFIG.warmups,
      update_cycles: UPDATE_CYCLES,
      unchanged_cycles: UNCHANGED_CYCLES,
      calibration_min_duration_ns: BENCHMARK_CONFIG.calibration_min_duration_ns,
      calibration_max_batches: BENCHMARK_CONFIG.calibration_max_batches,
      calibration_max_attempts: BENCHMARK_CONFIG.calibration_max_attempts,
      timer_resolution_policy: BENCHMARK_CONFIG.timer_resolution_policy,
    },
    results,
  };
  report.integrity = integrity(results);
  return report;
}

export { SIZES };
