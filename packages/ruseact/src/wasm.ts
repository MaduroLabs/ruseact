import type { CoreError, CoreResult, WasmModule } from "./types.js";

export interface WasmHandleBinding {
  free(): void;
}

export interface WasmDependencyListBinding {
  free(): void;
  push(signal: WasmHandleBinding): void;
}

export interface WasmCoreBinding {
  free(): void;
  begin_batch(): void;
  computation_identity(computation: WasmHandleBinding): unknown;
  create_computation(): WasmHandleBinding;
  create_dependency_list(): WasmDependencyListBinding;
  create_signal(value: unknown): WasmHandleBinding;
  dispose(): void;
  dispose_computation(computation: WasmHandleBinding): void;
  dispose_signal(signal: WasmHandleBinding): void;
  drain_pending_computations(): unknown;
  end_batch(): void;
  read_signal(signal: WasmHandleBinding): unknown;
  replace_dependencies(
    computation: WasmHandleBinding,
    dependencies: WasmDependencyListBinding,
  ): void;
  set_signal(signal: WasmHandleBinding, value: unknown): boolean;
  subscribe(signal: WasmHandleBinding, computation: WasmHandleBinding): boolean;
  unsubscribe(signal: WasmHandleBinding, computation: WasmHandleBinding): boolean;
}

export function isWasmHandleBinding(value: unknown): value is WasmHandleBinding {
  return isRecord(value) && hasFunction(value, "free");
}

export function isWasmDependencyListBinding(
  value: unknown,
): value is WasmDependencyListBinding {
  return isRecord(value) && hasFunction(value, "free") && hasFunction(value, "push");
}

const OPERATIONAL_CODES = new Set([
  "batch_depth_overflow",
  "batch_not_active",
  "disposed_instance",
  "foreign_instance",
  "graph_id_exhausted",
  "invalid_argument",
  "invalid_computation",
  "invalid_graph",
  "invalid_signal",
  "node_id_exhausted",
  "resource_exhausted",
  "stale_handle",
  "type_mismatch",
  "unsupported_value",
]);

const REQUIRED_CORE_METHODS = [
  "begin_batch",
  "computation_identity",
  "create_computation",
  "create_dependency_list",
  "create_signal",
  "dispose",
  "dispose_computation",
  "dispose_signal",
  "drain_pending_computations",
  "end_batch",
  "read_signal",
  "replace_dependencies",
  "set_signal",
  "subscribe",
  "unsubscribe",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasFunction(value: object, name: string): boolean {
  return typeof (value as Record<string, unknown>)[name] === "function";
}

function isWasmCoreBinding(value: unknown): value is WasmCoreBinding {
  if (!isRecord(value) || !hasFunction(value, "free")) {
    return false;
  }
  return REQUIRED_CORE_METHODS.every((method) => hasFunction(value, method));
}

export function success<T>(value: T): CoreResult<T> {
  return { ok: true, value };
}

export function failure<T>(error: CoreError): CoreResult<T> {
  return { ok: false, error };
}

export function makeError(
  code: string,
  operation: string,
  options: Partial<Pick<CoreError, "kind" | "resource" | "index" | "generation">> = {},
): CoreError {
  return {
    kind: options.kind ?? (OPERATIONAL_CODES.has(code) ? "operational" : "internal"),
    code,
    operation,
    ...(options.resource === undefined ? {} : { resource: options.resource }),
    ...(options.index === undefined ? {} : { index: options.index }),
    ...(options.generation === undefined ? {} : { generation: options.generation }),
  };
}

export function normalizeBridgeError(
  value: unknown,
  operation: string,
): CoreError | undefined {
  if (!isRecord(value) || typeof value.code !== "string") {
    return undefined;
  }

  const errorOperation =
    typeof value.operation === "string" ? value.operation : operation;
  const metadata = {
    ...(typeof value.resource === "string" ? { resource: value.resource } : {}),
    ...(typeof value.index === "number" && Number.isInteger(value.index) && value.index >= 0
      ? { index: value.index }
      : {}),
    ...(typeof value.generation === "number" &&
    Number.isInteger(value.generation) &&
    value.generation >= 0
      ? { generation: value.generation }
      : {}),
  };

  return makeError(value.code, errorOperation, {
    ...metadata,
    kind: value.code === "internal_invariant" || !OPERATIONAL_CODES.has(value.code)
      ? "internal"
      : "operational",
  });
}

export class UnexpectedCoreError extends Error {
  readonly operation: string;
  readonly cause: unknown;

  constructor(operation: string, cause: unknown) {
    super(`Unexpected failure during ${operation}`);
    this.name = "UnexpectedCoreError";
    this.operation = operation;
    this.cause = cause;
  }
}

export function callBridge<T>(
  operation: string,
  callback: () => T,
): CoreResult<T> {
  try {
    return success(callback());
  } catch (error) {
    const normalized = normalizeBridgeError(error, operation);
    if (normalized !== undefined) {
      return failure(normalized);
    }
    throw new UnexpectedCoreError(operation, error);
  }
}

export function loadWasmCore(moduleValue: unknown): CoreResult<WasmCoreBinding> {
  if (!isRecord(moduleValue) || typeof moduleValue.WasmCore !== "function") {
    return failure(makeError("unsupported_abi", "initialize", { kind: "internal" }));
  }

  let core: unknown;
  try {
    core = new (moduleValue.WasmCore as new () => object)();
  } catch (error) {
    const normalized = normalizeBridgeError(error, "initialize");
    if (normalized !== undefined) {
      return failure(normalized);
    }
    return failure(makeError("initialization_failed", "initialize", { kind: "internal" }));
  }

  if (!isWasmCoreBinding(core)) {
    if (isRecord(core) && hasFunction(core, "free")) {
      try {
        (core.free as () => void)();
      } catch {
        // The ABI is already invalid; retain the deterministic ABI error.
      }
    }
    return failure(makeError("unsupported_abi", "initialize", { kind: "internal" }));
  }
  return success(core);
}

export function releaseWasmResource(
  resource: { free(): void },
  operation: string,
): void {
  try {
    resource.free();
  } catch (error) {
    throw new UnexpectedCoreError(operation, error);
  }
}

export function isUint32Array(value: unknown): value is Uint32Array {
  return value instanceof Uint32Array;
}
