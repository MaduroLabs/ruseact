import {
  ComputationHandle,
  createComputationHandle,
  createSignalHandle,
  SignalHandle,
} from "./handles.js";
import type {
  CoreError,
  CoreResult,
  ReactiveCore,
  SignalUpdate,
  SupportedScalar,
  WasmModuleLoader,
} from "./types.js";
import {
  callBridge,
  failure,
  isWasmDependencyListBinding,
  isWasmHandleBinding,
  isUint32Array,
  loadWasmCore,
  makeError,
  releaseWasmResource,
  success,
  UnexpectedCoreError,
  type WasmCoreBinding,
  type WasmDependencyListBinding,
  type WasmHandleBinding,
} from "./wasm.js";

type ScalarKind = "boolean" | "number" | "string";

interface SignalState {
  readonly owner: ReactiveCoreImpl;
  readonly raw: WasmHandleBinding;
  readonly kind: ScalarKind;
  live: boolean;
}

interface ComputationState {
  readonly owner: ReactiveCoreImpl;
  readonly raw: WasmHandleBinding;
  readonly key: string;
  readonly slot: number;
  readonly generation: number;
  readonly handle: ComputationHandle;
  live: boolean;
}

const SIGNAL_STATES = new WeakMap<SignalHandle<SupportedScalar>, SignalState>();
const COMPUTATION_STATES = new WeakMap<ComputationHandle, ComputationState>();

function scalarKind(value: unknown): ScalarKind | undefined {
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "string") {
    return "string";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return "number";
  }
  return undefined;
}

function typedScalar(value: unknown, kind: ScalarKind): SupportedScalar | undefined {
  return scalarKind(value) === kind ? (value as SupportedScalar) : undefined;
}

function identityKey(slot: number, generation: number): string {
  return `${slot}:${generation}`;
}

function handleError(
  code: string,
  operation: string,
  resource: "signal" | "computation",
): CoreResult<never> {
  return failure(makeError(code, operation, { resource }));
}

class ReactiveCoreImpl implements ReactiveCore {
  private readonly signalStates = new Set<SignalState>();
  private readonly computationStates = new Set<ComputationState>();
  private readonly computationsByIdentity = new Map<string, ComputationState>();
  private disposed = false;

  constructor(private readonly bridge: WasmCoreBinding) {}

  createSignal<T extends SupportedScalar>(initial: T): CoreResult<SignalHandle<T>> {
    if (this.disposed) {
      return failure(makeError("disposed_instance", "create_signal"));
    }
    const kind = scalarKind(initial);
    if (kind === undefined) {
      return failure(makeError("unsupported_value", "create_signal"));
    }
    const result = callBridge("create_signal", () => this.bridge.create_signal(initial));
    if (!result.ok) {
      return result;
    }
    if (!isWasmHandleBinding(result.value)) {
      return failure(makeError("internal_invariant", "create_signal", { kind: "internal" }));
    }

    const handle = createSignalHandle<T>();
    const state: SignalState = { owner: this, raw: result.value, kind, live: true };
    SIGNAL_STATES.set(handle as SignalHandle<SupportedScalar>, state);
    this.signalStates.add(state);
    return success(handle);
  }

  get<T extends SupportedScalar>(signal: SignalHandle<T>): CoreResult<T> {
    const state = this.requireSignal(signal, "read_signal");
    if (!state.ok) {
      return state;
    }
    const result = callBridge("read_signal", () => this.bridge.read_signal(state.value.raw));
    if (!result.ok) {
      return result;
    }
    const value = typedScalar(result.value, state.value.kind);
    if (value === undefined) {
      return failure(makeError("internal_invariant", "read_signal", { kind: "internal" }));
    }
    return success(value as T);
  }

  set<T extends SupportedScalar>(
    signal: SignalHandle<T>,
    value: T,
  ): CoreResult<SignalUpdate> {
    const state = this.requireSignal(signal, "set_signal");
    if (!state.ok) {
      return state;
    }
    const valueKind = scalarKind(value);
    if (valueKind === undefined) {
      return failure(makeError("unsupported_value", "set_signal", { resource: "signal" }));
    }
    if (valueKind !== state.value.kind) {
      return failure(makeError("type_mismatch", "set_signal", { resource: "signal" }));
    }
    const result = callBridge("set_signal", () => this.bridge.set_signal(state.value.raw, value));
    return result.ok ? success(result.value ? "changed" : "unchanged") : result;
  }

  disposeSignal<T extends SupportedScalar>(signal: SignalHandle<T>): CoreResult<void> {
    const state = this.requireSignal(signal, "dispose_signal");
    if (!state.ok) {
      return state;
    }
    const result = callBridge("dispose_signal", () => {
      this.bridge.dispose_signal(state.value.raw);
    });
    if (!result.ok) {
      return result;
    }
    state.value.live = false;
    this.signalStates.delete(state.value);
    releaseWasmResource(state.value.raw, "dispose_signal.free");
    return success(undefined);
  }

  createComputation(): CoreResult<ComputationHandle> {
    if (this.disposed) {
      return failure(makeError("disposed_instance", "create_computation"));
    }
    const created = callBridge("create_computation", () => this.bridge.create_computation());
    if (!created.ok) {
      return created;
    }
    if (!isWasmHandleBinding(created.value)) {
      return failure(makeError("internal_invariant", "create_computation", { kind: "internal" }));
    }

    const identity = callBridge("computation_identity", () =>
      this.bridge.computation_identity(created.value),
    );
    if (!identity.ok) {
      this.cleanupUnregisteredComputation(created.value);
      return identity;
    }
    const pair = this.validateIdentity(identity.value);
    if (!pair.ok) {
      this.cleanupUnregisteredComputation(created.value);
      return pair;
    }
    const key = identityKey(pair.value.slot, pair.value.generation);
    if (this.computationsByIdentity.has(key)) {
      this.cleanupUnregisteredComputation(created.value);
      return failure(makeError("internal_invariant", "computation_identity", { kind: "internal" }));
    }

    const handle = createComputationHandle();
    const state: ComputationState = {
      owner: this,
      raw: created.value,
      key,
      slot: pair.value.slot,
      generation: pair.value.generation,
      handle,
      live: true,
    };
    COMPUTATION_STATES.set(handle, state);
    this.computationStates.add(state);
    this.computationsByIdentity.set(key, state);
    return success(handle);
  }

  disposeComputation(computation: ComputationHandle): CoreResult<void> {
    const state = this.requireComputation(computation, "dispose_computation");
    if (!state.ok) {
      return state;
    }
    const result = callBridge("dispose_computation", () => {
      this.bridge.dispose_computation(state.value.raw);
    });
    if (!result.ok) {
      return result;
    }
    state.value.live = false;
    this.computationStates.delete(state.value);
    this.computationsByIdentity.delete(state.value.key);
    releaseWasmResource(state.value.raw, "dispose_computation.free");
    return success(undefined);
  }

  subscribe<T extends SupportedScalar>(
    signal: SignalHandle<T>,
    computation: ComputationHandle,
  ): CoreResult<boolean> {
    const signalState = this.requireSignal(signal, "subscribe");
    if (!signalState.ok) {
      return signalState;
    }
    const computationState = this.requireComputation(computation, "subscribe");
    if (!computationState.ok) {
      return computationState;
    }
    return callBridge("subscribe", () =>
      this.bridge.subscribe(signalState.value.raw, computationState.value.raw),
    );
  }

  unsubscribe<T extends SupportedScalar>(
    signal: SignalHandle<T>,
    computation: ComputationHandle,
  ): CoreResult<boolean> {
    const signalState = this.requireSignal(signal, "unsubscribe");
    if (!signalState.ok) {
      return signalState;
    }
    const computationState = this.requireComputation(computation, "unsubscribe");
    if (!computationState.ok) {
      return computationState;
    }
    return callBridge("unsubscribe", () =>
      this.bridge.unsubscribe(signalState.value.raw, computationState.value.raw),
    );
  }

  replaceDependencies(
    computation: ComputationHandle,
    dependencies: readonly SignalHandle<SupportedScalar>[],
  ): CoreResult<void> {
    const computationState = this.requireComputation(computation, "replace_dependencies");
    if (!computationState.ok) {
      return computationState;
    }
    if (!Array.isArray(dependencies)) {
      return failure(makeError("invalid_argument", "replace_dependencies"));
    }

    const signals: SignalState[] = [];
    for (const dependency of dependencies) {
      const signalState = this.requireSignal(dependency, "replace_dependencies");
      if (!signalState.ok) {
        return signalState;
      }
      signals.push(signalState.value);
    }

    const listResult = callBridge("create_dependency_list", () =>
      this.bridge.create_dependency_list(),
    );
    if (!listResult.ok) {
      return listResult;
    }
    if (!isWasmDependencyListBinding(listResult.value)) {
      if (isWasmHandleBinding(listResult.value)) {
        releaseWasmResource(listResult.value, "create_dependency_list.free");
      }
      return failure(makeError("internal_invariant", "create_dependency_list", { kind: "internal" }));
    }
    const list = listResult.value;
    try {
      for (const signal of signals) {
        const pushed = callBridge("dependency_list_push", () => {
          list.push(signal.raw);
        });
        if (!pushed.ok) {
          return pushed;
        }
      }
      return callBridge("replace_dependencies", () => {
        this.bridge.replace_dependencies(computationState.value.raw, list);
      });
    } finally {
      releaseWasmResource(list, "replace_dependencies.free");
    }
  }

  beginBatch(): CoreResult<void> {
    return this.callIfActive("begin_batch", () => this.bridge.begin_batch());
  }

  endBatch(): CoreResult<void> {
    return this.callIfActive("end_batch", () => this.bridge.end_batch());
  }

  drainPendingComputations(): CoreResult<readonly ComputationHandle[]> {
    if (this.disposed) {
      return failure(makeError("disposed_instance", "drain_pending_computations"));
    }
    const result = callBridge("drain_pending_computations", () =>
      this.bridge.drain_pending_computations(),
    );
    if (!result.ok) {
      return result;
    }
    if (!isUint32Array(result.value) || result.value.length % 2 !== 0) {
      return failure(makeError("internal_invariant", "drain_pending_computations", { kind: "internal" }));
    }

    const pending: ComputationHandle[] = [];
    for (let index = 0; index < result.value.length; index += 2) {
      const key = identityKey(result.value[index], result.value[index + 1]);
      const state = this.computationsByIdentity.get(key);
      if (state === undefined || !state.live || state.owner !== this) {
        return failure(makeError("internal_invariant", "drain_pending_computations", { kind: "internal" }));
      }
      pending.push(state.handle);
    }
    return success(pending);
  }

  dispose(): CoreResult<void> {
    if (this.disposed) {
      return failure(makeError("disposed_instance", "dispose"));
    }
    const result = callBridge("dispose", () => this.bridge.dispose());
    if (!result.ok) {
      return result;
    }
    this.disposed = true;
    for (const state of this.signalStates) {
      state.live = false;
      releaseWasmResource(state.raw, "dispose_signal.free");
    }
    for (const state of this.computationStates) {
      state.live = false;
      releaseWasmResource(state.raw, "dispose_computation.free");
    }
    this.signalStates.clear();
    this.computationStates.clear();
    this.computationsByIdentity.clear();
    releaseWasmResource(this.bridge, "dispose.free");
    return success(undefined);
  }

  private callIfActive<T>(operation: string, callback: () => T): CoreResult<T> {
    return this.disposed
      ? failure(makeError("disposed_instance", operation))
      : callBridge(operation, callback);
  }

  private requireSignal<T extends SupportedScalar>(
    handle: SignalHandle<T>,
    operation: string,
  ): CoreResult<SignalState> {
    if (this.disposed) {
      return failure(makeError("disposed_instance", operation));
    }
    const state = SIGNAL_STATES.get(handle as SignalHandle<SupportedScalar>);
    if (state === undefined) {
      return handleError("invalid_signal", operation, "signal");
    }
    if (state.owner !== this) {
      return handleError("foreign_instance", operation, "signal");
    }
    if (!state.live) {
      return handleError("stale_handle", operation, "signal");
    }
    return success(state);
  }

  private requireComputation(
    handle: ComputationHandle,
    operation: string,
  ): CoreResult<ComputationState> {
    if (this.disposed) {
      return failure(makeError("disposed_instance", operation));
    }
    const state = COMPUTATION_STATES.get(handle);
    if (state === undefined) {
      return handleError("invalid_computation", operation, "computation");
    }
    if (state.owner !== this) {
      return handleError("foreign_instance", operation, "computation");
    }
    if (!state.live) {
      return handleError("stale_handle", operation, "computation");
    }
    return success(state);
  }

  private validateIdentity(value: unknown): CoreResult<{ slot: number; generation: number }> {
    if (!isUint32Array(value) || value.length !== 2) {
      return failure(makeError("internal_invariant", "computation_identity", { kind: "internal" }));
    }
    return success({ slot: value[0], generation: value[1] });
  }

  private cleanupUnregisteredComputation(raw: WasmHandleBinding): void {
    try {
      this.bridge.dispose_computation(raw);
      raw.free();
    } catch (error) {
      throw new UnexpectedCoreError("create_computation.cleanup", error);
    }
  }
}

export async function createReactiveCore(
  loadWasm: WasmModuleLoader,
): Promise<CoreResult<ReactiveCore>> {
  let moduleValue: unknown;
  try {
    moduleValue = await loadWasm();
  } catch {
    return failure(makeError("initialization_failed", "initialize", { kind: "internal" }));
  }
  const core = loadWasmCore(moduleValue);
  return core.ok ? success(new ReactiveCoreImpl(core.value)) : core;
}
