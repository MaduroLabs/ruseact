import type {
  CoreError,
  CoreResult,
  ReactiveCore,
  SupportedScalar,
} from "../../ruseact/src/types.js";
import {
  BindingHandle,
  createBindingContext,
  type BindingContext,
  type BindingFlushReport,
  type BindingRegistration,
  type StructuralHandle,
  type StructuralRegistration,
} from "./bindings.js";
import { createHostContext, type HostContext } from "./host.js";

type ListenerOptions = boolean | AddEventListenerOptions | undefined;

export type RootContainer = Element | DocumentFragment;

export type RootLifecycleState =
  | "created"
  | "mounting"
  | "mounted"
  | "unmounting"
  | "unmounted"
  | "cleanup_failed"
  | "disposed";

/**
 * The M3.4 construction boundary is intentionally imperative and internal.
 * It delegates every DOM mutation to the existing HostContext and every
 * reactive registration to the existing BindingContext. It is not a public
 * view descriptor or renderer API.
 */
export interface RootMountScope {
  readonly container: RootContainer;
  readonly createElement: HostContext["createElement"];
  readonly createTextNode: HostContext["createTextNode"];
  readonly createAnchor: HostContext["createAnchor"];
  readonly assertOwned: HostContext["assertOwned"];
  readonly insertBefore: HostContext["insertBefore"];
  readonly appendChild: HostContext["appendChild"];
  readonly removeChild: HostContext["removeChild"];
  readonly setText: HostContext["setText"];
  readonly setAttribute: HostContext["setAttribute"];
  readonly removeAttribute: HostContext["removeAttribute"];
  readonly setProperty: HostContext["setProperty"];
  readonly addEventListener: HostContext["addEventListener"];
  readonly removeEventListener: HostContext["removeEventListener"];
  readonly registerBinding: (
    registration: BindingRegistration,
  ) => CoreResult<BindingHandle>;
  readonly disposeBinding: (binding: BindingHandle) => CoreResult<void>;
  readonly registerStructural: (
    registration: StructuralRegistration,
  ) => CoreResult<StructuralHandle>;
  readonly disposeStructural: (structural: StructuralHandle) => CoreResult<void>;
  /** Internal renderer cleanup registration; not exported from ruseact-dom. */
  readonly registerCleanup: (cleanup: () => CoreResult<unknown> | void) => void;
}

export type RootMountSetup =
  (scope: RootMountScope) => CoreResult<unknown> | void;

export interface RootContext {
  readonly state: RootLifecycleState;
  mount(setup: RootMountSetup): CoreResult<void>;
  flush(): CoreResult<BindingFlushReport>;
  unmount(): CoreResult<void>;
  dispose(): CoreResult<void>;
}

interface RootErrorFields {
  readonly causeCode?: string;
  readonly causeOperation?: string;
  readonly cleanupCode?: string;
  readonly cleanupOperation?: string;
}

// This registry is intentionally separate from the host node registry. The
// host owns DOM nodes; this map owns the active root claim for a container.
// Neither ownership token is exposed through a DOM attribute or property.
const ROOT_OWNERS = new WeakMap<RootContainer, RootContext>();

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isRootContainer(value: unknown): value is RootContainer {
  if (!isObject(value)) {
    return false;
  }
  const candidate = value as Node;
  return (
    (candidate.nodeType === 1 || candidate.nodeType === 11) &&
    candidate.ownerDocument !== null &&
    candidate.ownerDocument !== undefined
  );
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

function success<T>(value: T): CoreResult<T> {
  return { ok: true, value };
}

function failure<T>(error: CoreError): CoreResult<T> {
  return { ok: false, error };
}

function rootError(
  code: string,
  operation: string,
  message: string,
  fields: RootErrorFields = {},
): CoreError {
  return {
    kind: "internal",
    code,
    operation,
    resource: "root",
    message,
    ...fields,
  } as CoreError;
}

function errorFromThrown(error: unknown, operation: string): CoreError {
  if (isObject(error)) {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.code === "string" && typeof candidate.operation === "string") {
      return {
        kind: "operational",
        code: candidate.code,
        operation: candidate.operation,
        resource: "root",
        message: error instanceof Error ? error.message : "root operation failed",
      } as CoreError;
    }
  }
  return rootError(
    "root_operation_failed",
    operation,
    error instanceof Error ? error.message : "root operation threw",
  );
}

function validRuntime(runtime: ReactiveCore): boolean {
  if (!isObject(runtime)) {
    return false;
  }
  const candidate = runtime as unknown as Record<string, unknown>;
  return (
    typeof candidate.createComputation === "function" &&
    typeof candidate.replaceDependencies === "function" &&
    typeof candidate.drainPendingComputations === "function" &&
    typeof candidate.unsubscribe === "function" &&
    typeof candidate.disposeComputation === "function"
  );
}

function rootStateFailure<T>(
  state: RootLifecycleState,
  operation: string,
  allowed: string,
): CoreResult<T> {
  if (state === "disposed") {
    return failure(rootError("disposed_root", operation, "root context is disposed"));
  }
  if (state === "mounting" || state === "unmounting") {
    return failure(rootError("root_busy", operation, "root lifecycle transition is in progress"));
  }
  return failure(
    rootError(
      "invalid_root_state",
      operation,
      `root is in state ${state}; expected ${allowed}`,
    ),
  );
}

export function createRootContext(
  container: RootContainer,
  runtime: ReactiveCore,
): CoreResult<RootContext> {
  if (!isRootContainer(container)) {
    return failure(rootError("invalid_root", "create_root", "an Element or DocumentFragment is required"));
  }
  if (!validRuntime(runtime)) {
    return failure(rootError("invalid_root", "create_root", "a compatible ReactiveCore is required"));
  }
  if (ROOT_OWNERS.has(container)) {
    return failure(rootError("duplicate_root", "create_root", "container is already owned by an active root"));
  }

  let host: HostContext | undefined;
  try {
    host = createHostContext(container.ownerDocument);
    host.claimContainer(container);
  } catch (error) {
    if (host !== undefined) {
      try {
        host.dispose();
      } catch {
        // There are no root-owned nodes before the claim succeeds. Preserve
        // the original claim failure as the actionable result.
      }
    }
    return failure(errorFromThrown(error, "create_root"));
  }
  if (host === undefined) {
    return failure(rootError("root_invariant", "create_root", "host context was not initialized"));
  }
  const rootHost = host;

  let root!: RootContext;
  let lifecycle: RootLifecycleState = "created";
  let bindingContext: BindingContext | undefined;
  let hostDisposed = false;
  const cleanupCallbacks: Array<{
    readonly cleanup: () => CoreResult<unknown> | void;
    completed: boolean;
  }> = [];

  function releaseContainer(): void {
    if (ROOT_OWNERS.get(container) === root) {
      ROOT_OWNERS.delete(container);
    }
  }

  function cleanup(operation: string): CoreResult<void> {
    let firstError: CoreError | undefined;

    for (let index = cleanupCallbacks.length - 1; index >= 0; index -= 1) {
      const registration = cleanupCallbacks[index];
      if (registration.completed) {
        continue;
      }
      try {
        const result = registration.cleanup();
        if (result !== undefined && !isCoreResult(result)) {
          if (firstError === undefined) {
            firstError = rootError(
              "root_cleanup_failed",
              operation,
              "registered root cleanup returned a malformed result",
            );
          }
          continue;
        }
        if (result !== undefined && !result.ok) {
          if (firstError === undefined) {
            firstError = result.error;
          }
          continue;
        }
        registration.completed = true;
      } catch (error) {
        if (firstError === undefined) {
          firstError = errorFromThrown(error, operation);
        }
      }
    }

    if (bindingContext !== undefined) {
      const bindingsContext = bindingContext;
      bindingContext = undefined;
      try {
        const bindings = bindingsContext.dispose();
        if (!bindings.ok) {
          firstError = bindings.error;
        }
      } catch (error) {
        firstError = errorFromThrown(error, operation);
      }
    }

    if (!hostDisposed) {
      try {
        rootHost.dispose();
      } catch (error) {
        if (firstError === undefined) {
          firstError = errorFromThrown(error, operation);
        }
      } finally {
        // HostContext marks itself disposed before it begins cleanup. A
        // second dispose cannot safely retry a partially failed cleanup.
        hostDisposed = true;
      }
    }

    if (firstError !== undefined) {
      lifecycle = "cleanup_failed";
      return failure(
        rootError(
          "root_cleanup_failed",
          operation,
          "root cleanup did not complete",
          {
            cleanupCode: firstError.code,
            cleanupOperation: firstError.operation,
          },
        ),
      );
    }

    releaseContainer();
    lifecycle = "unmounted";
    return success(undefined);
  }

  function scopeFor(bindings: BindingContext): RootMountScope {
    return {
      container,
      createElement: (name, namespace) => rootHost.createElement(name, namespace),
      createTextNode: (text) => rootHost.createTextNode(text),
      createAnchor: () => rootHost.createAnchor(),
      assertOwned: (node) => rootHost.assertOwned(node),
      insertBefore: (parent, child, anchor) => rootHost.insertBefore(parent, child, anchor),
      appendChild: (parent, child) => rootHost.appendChild(parent, child),
      removeChild: (parent, child) => rootHost.removeChild(parent, child),
      setText: (textNode, value) => rootHost.setText(textNode, value),
      setAttribute: (element, name, value, namespace) =>
        rootHost.setAttribute(element, name, value, namespace),
      removeAttribute: (element, name, namespace) =>
        rootHost.removeAttribute(element, name, namespace),
      setProperty: (element, property, value) => rootHost.setProperty(element, property, value),
      addEventListener: (element, type, listener, options) =>
        rootHost.addEventListener(element, type, listener, options),
      removeEventListener: (element, type, listener, options) =>
        rootHost.removeEventListener(element, type, listener, options),
      registerBinding: (registration) => bindings.registerBinding(registration),
      disposeBinding: (binding) => bindings.disposeBinding(binding),
      registerStructural: (registration) => bindings.registerStructural(registration),
      disposeStructural: (structural) => bindings.disposeStructural(structural),
      registerCleanup: (cleanupRegistration) => {
        if (typeof cleanupRegistration !== "function") {
          throw rootError("invalid_mount", "register_cleanup", "cleanup must be a function");
        }
        cleanupCallbacks.push({ cleanup: cleanupRegistration, completed: false });
      },
    };
  }

  function mount(setup: RootMountSetup): CoreResult<void> {
    if (lifecycle !== "created") {
      return rootStateFailure(lifecycle, "mount", "created");
    }
    if (typeof setup !== "function") {
      return failure(rootError("invalid_mount", "mount", "mount setup must be a function"));
    }

    lifecycle = "mounting";
    let mountFailure: CoreError | undefined;
    try {
      bindingContext = createBindingContext(rootHost, runtime);
      const result = setup(scopeFor(bindingContext));
      if (result !== undefined) {
        if (!isCoreResult(result)) {
          mountFailure = rootError(
            "invalid_mount_result",
            "mount",
            "mount setup must return a CoreResult or undefined",
          );
        } else if (!result.ok) {
          mountFailure = result.error;
        }
      }
    } catch (error) {
      mountFailure = errorFromThrown(error, "mount");
    }

    if (mountFailure !== undefined) {
      const cleaned = cleanup("mount_cleanup");
      if (!cleaned.ok) {
        return failure(
          rootError(
            "mount_cleanup_failed",
            "mount",
            "mount failed and cleanup also failed",
            {
              causeCode: mountFailure.code,
              causeOperation: mountFailure.operation,
              cleanupCode: cleaned.error.code,
              cleanupOperation: cleaned.error.operation,
            },
          ),
        );
      }
      return failure(mountFailure);
    }

    lifecycle = "mounted";
    return success(undefined);
  }

  function flush(): CoreResult<BindingFlushReport> {
    if (lifecycle !== "mounted") {
      return rootStateFailure(lifecycle, "flush", "mounted");
    }
    if (bindingContext === undefined) {
      return failure(rootError("root_invariant", "flush", "mounted root has no binding context"));
    }
    try {
      return bindingContext.flush();
    } catch (error) {
      return failure(errorFromThrown(error, "flush"));
    }
  }

  function unmount(): CoreResult<void> {
    if (lifecycle === "unmounted") {
      return success(undefined);
    }
    if (lifecycle !== "created" && lifecycle !== "mounted") {
      return rootStateFailure(lifecycle, "unmount", "created or mounted");
    }
    lifecycle = "unmounting";
    return cleanup("unmount");
  }

  function dispose(): CoreResult<void> {
    if (lifecycle === "disposed") {
      return success(undefined);
    }
    if (lifecycle === "mounting" || lifecycle === "unmounting") {
      return rootStateFailure(lifecycle, "dispose", "created, mounted, or unmounted");
    }
    if (lifecycle === "cleanup_failed") {
      return failure(rootError("root_cleanup_failed", "dispose", "root is already in cleanup_failed state"));
    }
    if (lifecycle === "created" || lifecycle === "mounted") {
      const unmounted = unmount();
      if (!unmounted.ok) {
        return unmounted;
      }
    }
    lifecycle = "disposed";
    releaseContainer();
    return success(undefined);
  }

  root = {
    get state(): RootLifecycleState {
      return lifecycle;
    },
    mount,
    flush,
    unmount,
    dispose,
  };
  ROOT_OWNERS.set(container, root);
  return success(root);
}
