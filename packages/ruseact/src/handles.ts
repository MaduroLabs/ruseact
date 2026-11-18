import type { SupportedScalar } from "./types.js";

/** Opaque public signal handle. Rust owns the signal value and identity. */
export class SignalHandle<T extends SupportedScalar> {
  protected constructor() {}

  private readonly __signalType!: T;
}

/** Opaque public computation handle. Rust owns the computation identity. */
export class ComputationHandle {
  protected constructor() {}
}

class RuntimeSignalHandle<T extends SupportedScalar> extends SignalHandle<T> {
  constructor() {
    super();
  }
}

class RuntimeComputationHandle extends ComputationHandle {
  constructor() {
    super();
  }
}

// These factories are intentionally not re-exported from the package entry
// point. Runtime code is the only supported creator of public handles.
export function createSignalHandle<T extends SupportedScalar>(): SignalHandle<T> {
  return new RuntimeSignalHandle<T>();
}

export function createComputationHandle(): ComputationHandle {
  return new RuntimeComputationHandle();
}
