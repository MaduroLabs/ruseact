import type { ComputationHandle, SignalHandle } from "../../ruseact/src/handles.js";
import type {
  CoreError,
  CoreResult,
  ReactiveCore,
  SupportedScalar,
} from "../../ruseact/src/types.js";
import type { HostContext } from "./host.js";

export type BindingErrorCode =
  | "binding_cleanup_failed"
  | "binding_update_failed"
  | "context_busy"
  | "disposed_binding_context"
  | "duplicate_binding"
  | "invalid_binding"
  | "invalid_update_result"
  | "reentrant_flush"
  | "runtime_in_use"
  | "unknown_pending_binding";

export class DomBindingError extends Error {
  readonly code: BindingErrorCode;
  readonly operation: string;

  constructor(code: BindingErrorCode, operation: string, message: string) {
    super(`${operation}: ${message}`);
    this.name = "DomBindingError";
    this.code = code;
    this.operation = operation;
  }
}

export interface BindingRegistration {
  readonly target: Node;
  readonly dependencies: readonly SignalHandle<SupportedScalar>[];
  readonly update: () => CoreResult<unknown>;
  /** A target may host multiple bindings when each uses a distinct slot key. */
  readonly key?: string;
}

export interface BindingFlushReport {
  readonly drainedCount: number;
  readonly executedCount: number;
  readonly skippedCount: number;
  /** The existing runtime has no non-destructive pending-count operation. */
  readonly pendingAfter: "not-inspected";
}

export interface BindingContext {
  registerBinding(registration: BindingRegistration): CoreResult<BindingHandle>;
  disposeBinding(binding: BindingHandle): CoreResult<void>;
  flush(): CoreResult<BindingFlushReport>;
  dispose(): CoreResult<void>;
}

/** Internal opaque binding identity; it is not part of the package entry point. */
export class BindingHandle {
  private constructor() {}

  static create(): BindingHandle {
    return new BindingHandle();
  }
}

interface BindingRecord {
  readonly binding: BindingHandle;
  readonly computation: ComputationHandle;
  readonly dependencies: readonly SignalHandle<SupportedScalar>[];
  readonly target: Node;
  readonly key: string;
  readonly update: () => CoreResult<unknown>;
  live: boolean;
}

interface ProgressFields {
  readonly pendingCount: number;
  readonly processedCount: number;
  readonly remainingCount: number;
}

const ACTIVE_RUNTIME_CONTEXTS = new WeakMap<object, BindingContext>();

function success<T>(value: T): CoreResult<T> {
  return { ok: true, value };
}

function failure<T>(error: CoreError): CoreResult<T> {
  return { ok: false, error };
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isCoreError(value: unknown): value is CoreError {
  if (!isObject(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.kind === "operational" || candidate.kind === "internal") &&
    typeof candidate.code === "string" &&
    typeof candidate.operation === "string"
  );
}

function isCoreResult(value: unknown): value is CoreResult<unknown> {
  if (!isObject(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.ok === true) {
    return "value" in candidate;
  }
  return candidate.ok === false && isCoreError(candidate.error);
}

function internalError(
  code: BindingErrorCode | "internal_invariant",
  operation: string,
  message: string,
  progress?: Partial<ProgressFields>,
): CoreError {
  return {
    kind: "internal",
    code,
    operation,
    resource: "computation",
    ...progress,
    message,
  } as CoreError;
}

function operationalError(
  code: string,
  operation: string,
  message: string,
  progress?: Partial<ProgressFields>,
): CoreError {
  return {
    kind: "operational",
    code,
    operation,
    resource: "computation",
    ...progress,
    message,
  } as CoreError;
}

function errorFromThrown(
  error: unknown,
  operation: string,
  progress?: Partial<ProgressFields>,
): CoreError {
  if (isObject(error)) {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.code === "string" && typeof candidate.operation === "string") {
      return operationalError(
        candidate.code,
        candidate.operation,
        error instanceof Error ? error.message : "host operation failed",
        progress,
      );
    }
  }
  return internalError(
    "binding_update_failed",
    operation,
    error instanceof Error ? error.message : "binding operation threw",
    progress,
  );
}

function callCore<T>(
  operation: string,
  callback: () => CoreResult<T>,
): CoreResult<T> {
  try {
    const result: unknown = callback();
    if (!isCoreResult(result)) {
      return failure(internalError("internal_invariant", operation, "runtime returned a malformed CoreResult"));
    }
    return result as CoreResult<T>;
  } catch (error) {
    return failure(errorFromThrown(error, operation));
  }
}

function callHost(
  operation: string,
  callback: () => void,
): CoreResult<void> {
  try {
    callback();
    return success(undefined);
  } catch (error) {
    return failure(errorFromThrown(error, operation));
  }
}

function progressError(error: CoreError, progress: ProgressFields): CoreError {
  return { ...error, ...progress } as CoreError;
}

function validateRuntime(runtime: ReactiveCore): void {
  if (
    !isObject(runtime) ||
    typeof runtime.createComputation !== "function" ||
    typeof runtime.replaceDependencies !== "function" ||
    typeof runtime.drainPendingComputations !== "function" ||
    typeof runtime.unsubscribe !== "function" ||
    typeof runtime.disposeComputation !== "function"
  ) {
    throw new DomBindingError("invalid_binding", "create_binding_context", "a compatible ReactiveCore is required");
  }
}

function validateHost(host: HostContext): void {
  if (!isObject(host) || typeof host.assertOwned !== "function") {
    throw new DomBindingError("invalid_binding", "create_binding_context", "a compatible HostContext is required");
  }
}

export function createBindingContext(host: HostContext, runtime: ReactiveCore): BindingContext {
  validateHost(host);
  validateRuntime(runtime);

  const runtimeObject = runtime as object;
  if (ACTIVE_RUNTIME_CONTEXTS.has(runtimeObject)) {
    throw new DomBindingError(
      "runtime_in_use",
      "create_binding_context",
      "a ReactiveCore can have only one active binding context",
    );
  }

  let context!: BindingContext;
  let disposed = false;
  let flushing = false;
  const recordsByComputation = new Map<ComputationHandle, BindingRecord>();
  const recordsByBinding = new Map<BindingHandle, BindingRecord>();
  const keysByTarget = new Map<Node, Set<string>>();

  function contextFailure<T>(code: BindingErrorCode, operation: string, message: string): CoreResult<T> {
    return failure(internalError(code, operation, message));
  }

  function active<T>(operation: string): CoreResult<T> | undefined {
    if (disposed) {
      return contextFailure("disposed_binding_context", operation, "binding context is disposed");
    }
    return undefined;
  }

  function freeKey(record: BindingRecord): void {
    const keys = keysByTarget.get(record.target);
    if (keys === undefined) {
      return;
    }
    keys.delete(record.key);
    if (keys.size === 0) {
      keysByTarget.delete(record.target);
    }
  }

  function cleanupRecord(record: BindingRecord): CoreResult<void> {
    if (!record.live) {
      return success(undefined);
    }
    record.live = false;
    recordsByComputation.delete(record.computation);
    recordsByBinding.delete(record.binding);
    freeKey(record);

    let firstError: CoreError | undefined;
    for (const dependency of record.dependencies) {
      const unsubscribed = callCore("unsubscribe_binding", () => runtime.unsubscribe(dependency, record.computation));
      if (!unsubscribed.ok && firstError === undefined) {
        firstError = unsubscribed.error;
      }
    }
    const disposedComputation = callCore(
      "dispose_binding_computation",
      () => runtime.disposeComputation(record.computation),
    );
    if (!disposedComputation.ok && firstError === undefined) {
      firstError = disposedComputation.error;
    }
    return firstError === undefined
      ? success(undefined)
      : failure({
        ...firstError,
        code: "binding_cleanup_failed",
        operation: "dispose_binding",
        resource: "computation",
      });
  }

  function validateTarget(target: Node, operation: string): CoreResult<void> {
    if (!isObject(target) || typeof (target as Node).nodeType !== "number") {
      return contextFailure("invalid_binding", operation, "a DOM target is required");
    }
    return callHost(operation, () => host.assertOwned(target));
  }

  function execute(record: BindingRecord, progress?: ProgressFields): CoreResult<void> {
    const target = validateTarget(record.target, "binding_target");
    if (!target.ok) {
      return failure(progress === undefined ? target.error : progressError(target.error, progress));
    }

    let result: unknown;
    try {
      result = record.update();
    } catch (error) {
      const converted = errorFromThrown(error, "execute_binding", progress);
      return failure(converted);
    }
    if (!isCoreResult(result)) {
      return failure(
        internalError(
          "invalid_update_result",
          "execute_binding",
          "binding update must return a CoreResult",
          progress,
        ),
      );
    }
    if (!result.ok) {
      return failure(progress === undefined ? result.error : progressError(result.error, progress));
    }
    return success(undefined);
  }

  function registerBinding(registration: BindingRegistration): CoreResult<BindingHandle> {
    const unavailable = active<BindingHandle>("register_binding");
    if (unavailable !== undefined) {
      return unavailable;
    }
    if (flushing) {
      return contextFailure("context_busy", "register_binding", "binding registration is not allowed during flush");
    }
    if (
      !isObject(registration) ||
      typeof registration.update !== "function" ||
      !Array.isArray(registration.dependencies)
    ) {
      return contextFailure("invalid_binding", "register_binding", "binding registration is malformed");
    }
    const key = registration.key ?? "default";
    if (typeof key !== "string" || key.length === 0) {
      return contextFailure("invalid_binding", "register_binding", "binding key must be non-empty");
    }

    const target = validateTarget(registration.target, "register_binding_target");
    if (!target.ok) {
      return target as CoreResult<BindingHandle>;
    }
    const keys = keysByTarget.get(registration.target) ?? new Set<string>();
    if (keys.has(key)) {
      return contextFailure("duplicate_binding", "register_binding", "target and key are already registered");
    }

    const computation = callCore("create_binding_computation", () => runtime.createComputation());
    if (!computation.ok) {
      return computation as CoreResult<BindingHandle>;
    }
    const dependencies = Array.from(registration.dependencies);
    const replaced = callCore(
      "replace_binding_dependencies",
      () => runtime.replaceDependencies(computation.value, dependencies),
    );
    if (!replaced.ok) {
      const cleanup = callCore(
        "dispose_failed_binding_computation",
        () => runtime.disposeComputation(computation.value),
      );
      return cleanup.ok ? replaced as CoreResult<BindingHandle> : failure({
        ...replaced.error,
        code: "binding_cleanup_failed",
        operation: "register_binding",
        resource: "computation",
      });
    }

    const binding = BindingHandle.create();
    const record: BindingRecord = {
      binding,
      computation: computation.value,
      dependencies,
      target: registration.target,
      key,
      update: registration.update,
      live: true,
    };
    const initial = execute(record);
    if (!initial.ok) {
      const cleanup = cleanupRecord(record);
      return cleanup.ok ? initial as CoreResult<BindingHandle> : failure({
        ...initial.error,
        code: "binding_cleanup_failed",
        operation: "register_binding",
        resource: "computation",
      });
    }

    keys.add(key);
    keysByTarget.set(registration.target, keys);
    recordsByComputation.set(record.computation, record);
    recordsByBinding.set(binding, record);
    return success(binding);
  }

  function disposeBinding(binding: BindingHandle): CoreResult<void> {
    const unavailable = active<void>("dispose_binding");
    if (unavailable !== undefined) {
      return unavailable;
    }
    if (flushing) {
      return contextFailure("context_busy", "dispose_binding", "binding disposal is not allowed during flush");
    }
    const record = recordsByBinding.get(binding);
    if (record === undefined) {
      return contextFailure("invalid_binding", "dispose_binding", "binding is unknown or already disposed");
    }
    return cleanupRecord(record);
  }

  function flush(): CoreResult<BindingFlushReport> {
    const unavailable = active<BindingFlushReport>("flush");
    if (unavailable !== undefined) {
      return unavailable;
    }
    if (flushing) {
      return contextFailure("reentrant_flush", "flush", "flush cannot be called reentrantly");
    }

    flushing = true;
    try {
      const drained = callCore("drain_pending_bindings", () => runtime.drainPendingComputations());
      if (!drained.ok) {
        return drained as CoreResult<BindingFlushReport>;
      }
      const pending = Array.from(drained.value);
      const records: BindingRecord[] = [];
      for (let index = 0; index < pending.length; index += 1) {
        const record = recordsByComputation.get(pending[index]);
        if (record === undefined || !record.live) {
          return failure(
            internalError(
              "unknown_pending_binding",
              "flush",
              "pending computation is not owned by this binding context",
              { pendingCount: pending.length, processedCount: 0, remainingCount: pending.length - index },
            ),
          );
        }
        records.push(record);
      }

      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        const progress: ProgressFields = {
          pendingCount: records.length,
          processedCount: index,
          remainingCount: records.length - index - 1,
        };
        const updated = execute(record, progress);
        if (!updated.ok) {
          const cleanup = cleanupRecord(record);
          const error = cleanup.ok ? updated.error : {
            ...updated.error,
            cleanupCode: cleanup.error.code,
          };
          return failure(error);
        }
      }

      return success({
        drainedCount: records.length,
        executedCount: records.length,
        skippedCount: 0,
        pendingAfter: "not-inspected",
      });
    } finally {
      flushing = false;
    }
  }

  function dispose(): CoreResult<void> {
    const unavailable = active<void>("dispose_binding_context");
    if (unavailable !== undefined) {
      return unavailable;
    }
    if (flushing) {
      return contextFailure("context_busy", "dispose_binding_context", "binding context cannot be disposed during flush");
    }
    disposed = true;
    ACTIVE_RUNTIME_CONTEXTS.delete(runtimeObject);
    let firstError: CoreError | undefined;
    for (const record of Array.from(recordsByBinding.values())) {
      const cleaned = cleanupRecord(record);
      if (!cleaned.ok && firstError === undefined) {
        firstError = cleaned.error;
      }
    }
    recordsByComputation.clear();
    recordsByBinding.clear();
    keysByTarget.clear();
    return firstError === undefined ? success(undefined) : failure(firstError);
  }

  context = { registerBinding, disposeBinding, flush, dispose };
  ACTIVE_RUNTIME_CONTEXTS.set(runtimeObject, context);
  return context;
}
