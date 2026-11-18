import type { ComputationHandle, SignalHandle } from "./handles.js";

export type SupportedScalar = boolean | number | string;

export type SignalUpdate = "changed" | "unchanged";

export type CoreErrorKind = "operational" | "internal";

export interface CoreError {
  readonly kind: CoreErrorKind;
  readonly code: string;
  readonly operation: string;
  readonly resource?: string;
  readonly index?: number;
  readonly generation?: number;
}

export type CoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CoreError };

/**
 * The loading boundary deliberately accepts the generated module without
 * exposing its raw classes through the ReactiveCore API. Node, bundler, and
 * future browser loaders can each supply their own ES-module integration.
 */
export interface WasmModule {
  readonly WasmCore: new () => object;
}

export type WasmModuleLoader =
  () => WasmModule | Promise<WasmModule>;

export interface ReactiveCore {
  createSignal<T extends SupportedScalar>(
    initial: T,
  ): CoreResult<SignalHandle<T>>;

  get<T extends SupportedScalar>(
    signal: SignalHandle<T>,
  ): CoreResult<T>;

  set<T extends SupportedScalar>(
    signal: SignalHandle<T>,
    value: T,
  ): CoreResult<SignalUpdate>;

  disposeSignal<T extends SupportedScalar>(
    signal: SignalHandle<T>,
  ): CoreResult<void>;

  createComputation(): CoreResult<ComputationHandle>;

  disposeComputation(computation: ComputationHandle): CoreResult<void>;

  subscribe<T extends SupportedScalar>(
    signal: SignalHandle<T>,
    computation: ComputationHandle,
  ): CoreResult<boolean>;

  unsubscribe<T extends SupportedScalar>(
    signal: SignalHandle<T>,
    computation: ComputationHandle,
  ): CoreResult<boolean>;

  replaceDependencies(
    computation: ComputationHandle,
    dependencies: readonly SignalHandle<SupportedScalar>[],
  ): CoreResult<void>;

  beginBatch(): CoreResult<void>;
  endBatch(): CoreResult<void>;

  drainPendingComputations(): CoreResult<readonly ComputationHandle[]>;

  dispose(): CoreResult<void>;
}
