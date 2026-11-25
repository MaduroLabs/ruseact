import type { CoreError, CoreResult } from "../../ruseact/src/types.js";
import type { BindingHandle } from "./bindings.js";

export type OwnerLifecycleState =
  | "initializing"
  | "active"
  | "disposing"
  | "disposed"
  | "cleanup_failed";

export interface ComponentOwner {
  readonly id: string;
  readonly parent?: ComponentOwner;
  readonly state: OwnerLifecycleState;
  createChild(localIdentity: string): CoreResult<ComponentOwner>;
  releaseChild(child: ComponentOwner): CoreResult<void>;
  trackNode(node: Node): CoreResult<void>;
  containsNode(node: Node): boolean;
  trackBinding(binding: BindingHandle, dispose: () => CoreResult<void>): CoreResult<void>;
  trackResource(cleanup: () => CoreResult<unknown> | void): CoreResult<void>;
  publish(): CoreResult<void>;
  dispose(): CoreResult<void>;
}

function success<T>(value: T): CoreResult<T> {
  return { ok: true, value };
}

function failure<T>(error: CoreError): CoreResult<T> {
  return { ok: false, error };
}

function ownerError(
  code: string,
  operation: string,
  message: string,
  fields: Partial<CoreError> = {},
): CoreError {
  return {
    kind: "internal",
    code,
    operation,
    resource: "component_owner",
    message,
    ...fields,
  } as CoreError;
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
  return candidate.ok === true
    ? "value" in candidate
    : candidate.ok === false && isCoreError(candidate.error);
}

interface ResourceRecord {
  readonly cleanup: () => CoreResult<unknown> | void;
  completed: boolean;
}

function createOwner(
  id: string,
  parent: ComponentOwner | undefined,
): ComponentOwner {
  let state: OwnerLifecycleState = "initializing";
  const children: ComponentOwner[] = [];
  const childIdentities = new Set<string>();
  const nodes = new Set<Node>();
  const resources: ResourceRecord[] = [];

  function activeForRegistration(operation: string): CoreResult<void> | undefined {
    if (state === "disposing" || state === "disposed" || state === "cleanup_failed") {
      return failure(ownerError("foreign_owner", operation, `owner ${id} is not accepting resources`));
    }
    return undefined;
  }

  function createChild(localIdentity: string): CoreResult<ComponentOwner> {
    const unavailable = activeForRegistration("create_component_owner");
    if (unavailable !== undefined) {
      return unavailable as CoreResult<ComponentOwner>;
    }
    if (typeof localIdentity !== "string" || localIdentity.trim().length === 0) {
      return failure(ownerError("invalid_component_instance", "create_component_owner", "component identity must be non-empty"));
    }
    if (childIdentities.has(localIdentity)) {
      return failure(ownerError(
        "duplicate_component_identity",
        "create_component_owner",
        `component identity ${localIdentity} is already owned by ${id}`,
      ));
    }
    childIdentities.add(localIdentity);
    const child = createOwner(`${id}/${localIdentity}`, api);
    children.push(child);
    return success(child);
  }

  function trackResource(cleanup: () => CoreResult<unknown> | void): CoreResult<void> {
    const unavailable = activeForRegistration("track_component_resource");
    if (unavailable !== undefined) {
      return unavailable;
    }
    if (typeof cleanup !== "function") {
      return failure(ownerError("invalid_component_instance", "track_component_resource", "cleanup must be a function"));
    }
    resources.push({ cleanup, completed: false });
    return success(undefined);
  }

  function trackNode(node: Node): CoreResult<void> {
    const unavailable = activeForRegistration("track_component_node");
    if (unavailable !== undefined) return unavailable;
    if (!isObject(node) || typeof (node as Node).nodeType !== "number") {
      return failure(ownerError("invalid_component_instance", "track_component_node", "a DOM node is required"));
    }
    if (nodes.has(node)) {
      return failure(ownerError("invalid_component_instance", "track_component_node", `node is already owned by ${id}`));
    }
    nodes.add(node);
    return success(undefined);
  }

  function containsNode(node: Node): boolean {
    if (nodes.has(node)) return true;
    return children.some((child) => child.containsNode(node));
  }

  function releaseChild(child: ComponentOwner): CoreResult<void> {
    const unavailable = activeForRegistration("release_component_owner");
    if (unavailable !== undefined) {
      return unavailable;
    }
    const index = children.indexOf(child);
    if (index < 0 || child.parent !== api || child.state !== "disposed") {
      return failure(ownerError("foreign_owner", "release_component_owner", `owner ${id} cannot release the supplied child`));
    }
    children.splice(index, 1);
    const prefix = `${id}/`;
    if (child.id.startsWith(prefix)) {
      childIdentities.delete(child.id.slice(prefix.length));
    }
    return success(undefined);
  }

  function trackBinding(binding: BindingHandle, dispose: () => CoreResult<void>): CoreResult<void> {
    if (binding === undefined || typeof dispose !== "function") {
      return failure(ownerError("invalid_component_instance", "track_binding", "binding ownership is malformed"));
    }
    return trackResource(dispose);
  }

  function publish(): CoreResult<void> {
    if (state !== "initializing") {
      return failure(ownerError("invalid_component_instance", "publish_component_owner", `owner ${id} is not initializing`));
    }
    state = "active";
    return success(undefined);
  }

  function dispose(): CoreResult<void> {
    if (state === "disposed") {
      return success(undefined);
    }
    if (state === "disposing") {
      return failure(ownerError("child_cleanup_failed", "dispose_component_owner", `owner ${id} is already disposing`));
    }
    state = "disposing";
    let firstError: CoreError | undefined;

    for (let index = children.length - 1; index >= 0; index -= 1) {
      const cleaned = children[index].dispose();
      if (!cleaned.ok && firstError === undefined) {
        firstError = cleaned.error;
      }
    }

    for (let index = resources.length - 1; index >= 0; index -= 1) {
      const resource = resources[index];
      if (resource.completed) {
        continue;
      }
      try {
        const cleaned = resource.cleanup();
        if (cleaned !== undefined && !isCoreResult(cleaned)) {
          if (firstError === undefined) {
            firstError = ownerError("child_cleanup_failed", "dispose_component_owner", `owner ${id} cleanup returned a malformed result`);
          }
          continue;
        }
        if (cleaned !== undefined && !cleaned.ok) {
          if (firstError === undefined) {
            firstError = cleaned.error;
          }
          continue;
        }
        resource.completed = true;
      } catch (error) {
        if (firstError === undefined) {
          firstError = ownerError(
            "child_cleanup_failed",
            "dispose_component_owner",
            error instanceof Error ? error.message : `owner ${id} cleanup threw`,
          );
        }
      }
    }

    if (firstError !== undefined) {
      state = "cleanup_failed";
      return failure(firstError);
    }
    nodes.clear();
    state = "disposed";
    return success(undefined);
  }

  const api: ComponentOwner = {
    id,
    parent,
    get state(): OwnerLifecycleState {
      return state;
    },
    createChild,
    releaseChild,
    trackNode,
    containsNode,
    trackBinding,
    trackResource,
    publish,
    dispose,
  };
  return api;
}

export function createRootOwner(): ComponentOwner {
  const owner = createOwner("root", undefined);
  owner.publish();
  return owner;
}
