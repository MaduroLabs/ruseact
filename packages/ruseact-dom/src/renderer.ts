import type { SignalHandle } from "../../ruseact/src/handles.js";
import type {
  CoreError,
  CoreResult,
  ReactiveCore,
  SupportedScalar,
} from "../../ruseact/src/types.js";
import {
  createRootContext,
  type RootLifecycleState,
  type RootMountScope,
  type RootContext,
} from "./root.js";
import { HTML_NAMESPACE } from "./host.js";

export type RendererRootState = RootLifecycleState;
export type RendererContainer = Element | DocumentFragment;

export type RendererErrorCode =
  | "invalid_root"
  | "duplicate_root"
  | "invalid_root_state"
  | "disposed_root"
  | "root_busy"
  | "root_invariant"
  | "root_cleanup_failed"
  | "mount_cleanup_failed"
  | "invalid_mount"
  | "runtime_in_use"
  | "invalid_renderer_result"
  | "invalid_view"
  | "unsupported_view_protocol"
  | "unsupported_view_version"
  | "invalid_template_id"
  | "invalid_view_plan"
  | "duplicate_node_id"
  | "invalid_parent_reference"
  | "invalid_parent_kind"
  | "cyclic_view_plan"
  | "invalid_root_order"
  | "duplicate_binding_slot"
  | "invalid_binding_target"
  | "invalid_binding_dependencies"
  | "unsupported_binding_kind"
  | "duplicate_listener_id"
  | "invalid_listener_target"
  | "unsupported_property"
  | "view_instantiation_failed"
  | "binding_evaluation_failed"
  | "host_mutation_failed"
  | "invalid_node"
  | "detached_node"
  | "foreign_document"
  | "foreign_node"
  | "invalid_attribute"
  | "invalid_attribute_value"
  | "invalid_element_name"
  | "invalid_insertion_anchor"
  | "invalid_listener"
  | "invalid_listener_options"
  | "invalid_parent"
  | "invalid_parent_child"
  | "invalid_property"
  | "invalid_property_value"
  | "unsupported_namespace";

export interface RendererError extends CoreError {
  readonly message?: string;
  readonly causeCode?: string;
  readonly causeOperation?: string;
  readonly cleanupCode?: string;
  readonly cleanupOperation?: string;
}

export type RendererResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RendererError };

export interface FlushReport {
  readonly drainedCount: number;
  readonly executedCount: number;
  readonly skippedCount: number;
  readonly pendingAfter: "not-inspected";
}

export interface RendererRoot {
  readonly state: RendererRootState;
  mount(view: ViewDescription): RendererResult<void>;
  flush(): RendererResult<FlushReport>;
  unmount(): RendererResult<void>;
  dispose(): RendererResult<void>;
}

export interface ViewEnvironment {
  readonly runtime: ReactiveCore;
}

export interface StaticAttributePlan {
  readonly name: string;
  readonly value: string;
  readonly namespace?: string;
}

export type SupportedProperty = "value" | "checked" | "disabled";

export interface StaticPropertyPlan {
  readonly property: SupportedProperty;
  readonly value: string | boolean;
}

export interface StaticElementPlan {
  readonly id: string;
  readonly kind: "element";
  readonly parentId?: string;
  readonly name: string;
  readonly namespace?: string;
  readonly attributes?: readonly StaticAttributePlan[];
  readonly properties?: readonly StaticPropertyPlan[];
}

export interface StaticTextPlan {
  readonly id: string;
  readonly kind: "text";
  readonly parentId?: string;
  readonly text: string;
}

export type StaticNodePlan = StaticElementPlan | StaticTextPlan;

export interface BindingEvaluationContext {
  readonly runtime: ReactiveCore;
}

export interface TextBindingPlan {
  readonly kind: "text";
  readonly slot: string;
  readonly targetId: string;
  readonly dependencies: readonly SignalHandle<SupportedScalar>[];
  readonly evaluate: (
    context: BindingEvaluationContext,
  ) => RendererResult<string>;
}

export interface AttributeBindingPlan {
  readonly kind: "attribute";
  readonly slot: string;
  readonly targetId: string;
  readonly name: string;
  readonly namespace?: string;
  readonly dependencies: readonly SignalHandle<SupportedScalar>[];
  readonly evaluate: (
    context: BindingEvaluationContext,
  ) => RendererResult<string>;
}

export interface PropertyBindingPlan {
  readonly kind: "property";
  readonly slot: string;
  readonly targetId: string;
  readonly property: SupportedProperty;
  readonly dependencies: readonly SignalHandle<SupportedScalar>[];
  readonly evaluate: (
    context: BindingEvaluationContext,
  ) => RendererResult<string | boolean>;
}

export type BindingPlan =
  | TextBindingPlan
  | AttributeBindingPlan
  | PropertyBindingPlan;

export type RendererListenerOptions =
  | boolean
  | (AddEventListenerOptions & { readonly signal?: never });

export interface ListenerPlan {
  readonly id: string;
  readonly targetId: string;
  readonly type: string;
  readonly listener: EventListener;
  readonly options?: RendererListenerOptions;
}

export interface ViewInstancePlan {
  readonly nodes: readonly StaticNodePlan[];
  readonly bindings: readonly BindingPlan[];
  readonly listeners: readonly ListenerPlan[];
}

export interface ViewDescription {
  readonly protocol: "ruseact.template";
  readonly version: 1;
  readonly templateId: string;
  readonly instantiate: (
    environment: ViewEnvironment,
  ) => ViewInstancePlan;
}

interface PlanValidation {
  readonly plan: ViewInstancePlan;
  readonly nodesById: ReadonlyMap<string, StaticNodePlan>;
}

function success<T>(value: T): RendererResult<T> {
  return { ok: true, value };
}

function failure<T>(error: RendererError): RendererResult<T> {
  return { ok: false, error };
}

function rendererError(
  code: string,
  operation: string,
  message: string,
  fields: Partial<RendererError> = {},
): RendererError {
  return {
    kind: "internal",
    code,
    operation,
    resource: "renderer",
    message,
    ...fields,
  };
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value as Record<string, unknown> : undefined;
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

function normalizeThrown(
  error: unknown,
  code: string,
  operation: string,
): RendererError {
  if (isObject(error)) {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.code === "string" && typeof candidate.operation === "string") {
      return {
        kind: candidate.kind === "operational" ? "operational" : "internal",
        code: candidate.code,
        operation: candidate.operation,
        resource: typeof candidate.resource === "string" ? candidate.resource : "renderer",
        message: error instanceof Error ? error.message : "renderer operation failed",
      };
    }
  }
  return rendererError(
    code,
    operation,
    error instanceof Error ? error.message : "renderer operation threw",
  );
}

function normalizeResult<T>(
  value: unknown,
  operation: string,
): RendererResult<T> {
  if (!isCoreResult(value)) {
    return failure(
      rendererError(
        "invalid_renderer_result",
        operation,
        "renderer operation returned a malformed CoreResult",
      ),
    );
  }
  return value as RendererResult<T>;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validNamespace(namespace: unknown): namespace is string | undefined {
  return namespace === undefined || namespace === HTML_NAMESPACE;
}

function supportedProperty(property: unknown): property is SupportedProperty {
  return property === "value" || property === "checked" || property === "disabled";
}

function supportedPropertyValue(
  property: SupportedProperty,
  value: unknown,
): value is string | boolean {
  if (property === "value") {
    return typeof value === "string";
  }
  return typeof value === "boolean";
}

function validatePlan(view: ViewDescription, planValue: unknown): RendererResult<PlanValidation> {
  if (!isObject(planValue)) {
    return failure(rendererError("invalid_view_plan", "validate_view", "view instantiate() must return a plan"));
  }
  const plan = planValue as Partial<ViewInstancePlan>;
  if (!Array.isArray(plan.nodes) || !Array.isArray(plan.bindings) || !Array.isArray(plan.listeners)) {
    return failure(rendererError("invalid_view_plan", "validate_view", "view plan arrays are required"));
  }

  const nodesById = new Map<string, StaticNodePlan>();
  for (const nodeValue of plan.nodes) {
    const nodeRecord = asRecord(nodeValue);
    if (nodeRecord === undefined || !validIdentifier(nodeRecord.id)) {
      return failure(rendererError("invalid_view_plan", "validate_view", "every node needs a non-empty id"));
    }
    const node = nodeRecord as unknown as StaticNodePlan;
    if (nodesById.has(node.id)) {
      return failure(rendererError("duplicate_node_id", "validate_view", `node id ${node.id} is duplicated`));
    }
    if (node.kind !== "element" && node.kind !== "text") {
      return failure(rendererError("invalid_view_plan", "validate_view", `node ${nodeRecord.id} has an unsupported kind`));
    }
    if (node.parentId !== undefined && !validIdentifier(node.parentId)) {
      return failure(rendererError("invalid_parent_reference", "validate_view", `node ${node.id} has an invalid parent id`));
    }
    if (node.kind === "text") {
      if (typeof node.text !== "string") {
        return failure(rendererError("invalid_view_plan", "validate_view", `text node ${node.id} needs text`));
      }
      nodesById.set(node.id, node);
      continue;
    }
    if (typeof node.name !== "string" || node.name.length === 0 || /\s/.test(node.name)) {
      return failure(rendererError("invalid_view_plan", "validate_view", `element ${node.id} has an invalid name`));
    }
    if (!validNamespace(node.namespace)) {
      return failure(rendererError("invalid_view_plan", "validate_view", `element ${node.id} uses an unsupported namespace`));
    }
    if (node.attributes !== undefined) {
      if (!Array.isArray(node.attributes)) {
        return failure(rendererError("invalid_view_plan", "validate_view", `element ${node.id} attributes must be an array`));
      }
      const attributes = new Set<string>();
      for (const attribute of node.attributes) {
        const attributeRecord = asRecord(attribute);
        if (attributeRecord === undefined || typeof attributeRecord.name !== "string" ||
          typeof attributeRecord.value !== "string" || !validNamespace(attributeRecord.namespace)) {
          return failure(rendererError("invalid_view_plan", "validate_view", `element ${node.id} has an invalid attribute`));
        }
        const key = `${attributeRecord.namespace ?? ""}:${attributeRecord.name}`;
        if (attributes.has(key)) {
          return failure(rendererError("invalid_view_plan", "validate_view", `element ${node.id} repeats attribute ${attributeRecord.name}`));
        }
        attributes.add(key);
      }
    }
    if (node.properties !== undefined) {
      if (!Array.isArray(node.properties)) {
        return failure(rendererError("invalid_view_plan", "validate_view", `element ${node.id} properties must be an array`));
      }
      const properties = new Set<string>();
      for (const property of node.properties) {
        const propertyRecord = asRecord(property);
        if (propertyRecord === undefined || !supportedProperty(propertyRecord.property) ||
          !supportedPropertyValue(propertyRecord.property, propertyRecord.value)) {
          return failure(rendererError("invalid_property_value", "validate_view", `element ${node.id} has an invalid property`));
        }
        if (properties.has(propertyRecord.property)) {
          return failure(rendererError("invalid_view_plan", "validate_view", `element ${node.id} repeats property ${propertyRecord.property}`));
        }
        properties.add(propertyRecord.property);
      }
    }
    nodesById.set(node.id, node);
  }

  for (const node of nodesById.values()) {
    if (node.parentId === undefined) {
      continue;
    }
    const parent = nodesById.get(node.parentId);
    if (parent === undefined) {
      return failure(rendererError("invalid_parent_reference", "validate_view", `node ${node.id} references missing parent ${node.parentId}`));
    }
    if (parent.kind !== "element") {
      return failure(rendererError("invalid_parent_kind", "validate_view", `node ${node.id} cannot be inserted into text node ${parent.id}`));
    }
  }

  for (const node of nodesById.values()) {
    const seen = new Set<string>();
    let current: StaticNodePlan | undefined = node;
    while (current?.parentId !== undefined) {
      if (seen.has(current.id)) {
        return failure(rendererError("cyclic_view_plan", "validate_view", `node ${node.id} is part of a cycle`));
      }
      seen.add(current.id);
      current = nodesById.get(current.parentId);
    }
  }

  const bindingSlots = new Set<string>();
  for (const bindingValue of plan.bindings) {
    const bindingRecord = asRecord(bindingValue);
    if (bindingRecord === undefined || !validIdentifier(bindingRecord.slot)) {
      return failure(rendererError("invalid_view_plan", "validate_view", "every binding needs a non-empty slot"));
    }
    const binding = bindingRecord as unknown as BindingPlan;
    if (bindingSlots.has(binding.slot)) {
      return failure(rendererError("duplicate_binding_slot", "validate_view", `binding slot ${binding.slot} is duplicated`));
    }
    bindingSlots.add(binding.slot);
    const target = typeof binding.targetId === "string" ? nodesById.get(binding.targetId) : undefined;
    if (target === undefined) {
      return failure(rendererError("invalid_binding_target", "validate_view", `binding ${binding.slot} targets an unknown node`));
    }
    if (binding.kind !== "text" && binding.kind !== "attribute" && binding.kind !== "property") {
      return failure(rendererError("unsupported_binding_kind", "validate_view", `binding ${bindingRecord.slot} has an unsupported kind`));
    }
    if (binding.kind === "text" && target.kind !== "text") {
      return failure(rendererError("invalid_binding_target", "validate_view", `text binding ${binding.slot} needs a text target`));
    }
    if (binding.kind !== "text" && target.kind !== "element") {
      return failure(rendererError("invalid_binding_target", "validate_view", `binding ${binding.slot} needs an element target`));
    }
    if (!Array.isArray(binding.dependencies) || typeof binding.evaluate !== "function") {
      return failure(rendererError("invalid_binding_dependencies", "validate_view", `binding ${binding.slot} needs explicit dependencies and an evaluator`));
    }
    if (binding.kind === "attribute") {
      if (typeof binding.name !== "string" || !validNamespace(binding.namespace)) {
        return failure(rendererError("invalid_view_plan", "validate_view", `binding ${binding.slot} has an invalid attribute`));
      }
    }
    if (binding.kind === "property" && !supportedProperty(binding.property)) {
      return failure(rendererError("unsupported_property", "validate_view", `binding ${binding.slot} uses an unsupported property`));
    }
  }

  const listenerIds = new Set<string>();
  for (const listenerValue of plan.listeners) {
    const listenerRecord = asRecord(listenerValue);
    if (listenerRecord === undefined || !validIdentifier(listenerRecord.id) ||
      typeof listenerRecord.type !== "string" || typeof listenerRecord.listener !== "function") {
      return failure(rendererError("invalid_view_plan", "validate_view", "listener metadata is invalid"));
    }
    const listener = listenerRecord as unknown as ListenerPlan;
    if (listenerIds.has(listener.id)) {
      return failure(rendererError("duplicate_listener_id", "validate_view", `listener id ${listener.id} is duplicated`));
    }
    listenerIds.add(listener.id);
    const target = nodesById.get(listener.targetId);
    if (target === undefined || target.kind !== "element") {
      return failure(rendererError("invalid_listener_target", "validate_view", `listener ${listener.id} needs an element target`));
    }
    if (listener.options !== undefined && typeof listener.options === "object" && listener.options.signal !== undefined) {
      return failure(rendererError("invalid_listener_options", "validate_view", `listener ${listener.id} cannot use AbortSignal`));
    }
  }

  return success({ plan: plan as ViewInstancePlan, nodesById });
}

function validateView(view: ViewDescription): RendererResult<void> {
  if (!isObject(view)) {
    return failure(rendererError("invalid_view", "mount", "a view description is required"));
  }
  if (view.protocol !== "ruseact.template") {
    return failure(rendererError("unsupported_view_protocol", "mount", "unsupported view protocol"));
  }
  if (view.version !== 1) {
    return failure(rendererError("unsupported_view_version", "mount", "unsupported view version"));
  }
  if (!validIdentifier(view.templateId)) {
    return failure(rendererError("invalid_template_id", "mount", "templateId must be non-empty"));
  }
  if (typeof view.instantiate !== "function") {
    return failure(rendererError("invalid_view", "mount", "view instantiate() must be a function"));
  }
  return success(undefined);
}

function updateBinding(
  scope: RootMountScope,
  runtime: ReactiveCore,
  plan: BindingPlan,
  nodesById: ReadonlyMap<string, Node>,
): CoreResult<unknown> {
  const target = nodesById.get(plan.targetId);
  if (target === undefined) {
    return failure(rendererError("invalid_binding_target", "register_binding", `binding ${plan.slot} targets an unknown node`));
  }
  try {
    const evaluated = plan.evaluate({ runtime });
    if (!isCoreResult(evaluated)) {
      return failure(rendererError("binding_evaluation_failed", "execute_binding", `binding ${plan.slot} returned a malformed result`));
    }
    if (!evaluated.ok) {
      return evaluated as CoreResult<unknown>;
    }
    if (plan.kind === "text") {
      if (typeof evaluated.value !== "string") {
        return failure(rendererError("binding_evaluation_failed", "execute_binding", `text binding ${plan.slot} must evaluate to a string`));
      }
      return success(scope.setText(target, evaluated.value));
    }
    if (plan.kind === "attribute") {
      if (typeof evaluated.value !== "string") {
        return failure(rendererError("binding_evaluation_failed", "execute_binding", `attribute binding ${plan.slot} must evaluate to a string`));
      }
      return success(scope.setAttribute(target, plan.name, evaluated.value, plan.namespace));
    }
    if (!supportedPropertyValue(plan.property, evaluated.value)) {
      return failure(rendererError("binding_evaluation_failed", "execute_binding", `property binding ${plan.slot} has an invalid value`));
    }
    return success(scope.setProperty(target, plan.property, evaluated.value));
  } catch (error) {
    return failure(normalizeThrown(error, "host_mutation_failed", "execute_binding"));
  }
}

function executePlan(
  scope: RootMountScope,
  runtime: ReactiveCore,
  plan: PlanValidation,
): CoreResult<void> {
  const nodes = new Map<string, Node>();
  try {
    for (const nodePlan of plan.plan.nodes) {
      const node = nodePlan.kind === "text"
        ? scope.createTextNode(nodePlan.text)
        : scope.createElement(nodePlan.name, nodePlan.namespace);
      nodes.set(nodePlan.id, node);
    }

    for (const nodePlan of plan.plan.nodes) {
      const node = nodes.get(nodePlan.id)!;
      if (nodePlan.kind === "element") {
        for (const attribute of nodePlan.attributes ?? []) {
          scope.setAttribute(node, attribute.name, attribute.value, attribute.namespace);
        }
        for (const property of nodePlan.properties ?? []) {
          scope.setProperty(node, property.property, property.value);
        }
      }
      if (nodePlan.parentId !== undefined) {
        scope.appendChild(nodes.get(nodePlan.parentId)!, node);
      }
    }

    for (const listener of plan.plan.listeners) {
      scope.addEventListener(nodes.get(listener.targetId)!, listener.type, listener.listener, listener.options);
    }

    for (const binding of plan.plan.bindings) {
      const registered = scope.registerBinding({
        target: nodes.get(binding.targetId)!,
        dependencies: binding.dependencies,
        key: binding.slot,
        update: () => updateBinding(scope, runtime, binding, nodes),
      });
      if (!registered.ok) {
        return registered;
      }
    }

    for (const nodePlan of plan.plan.nodes) {
      if (nodePlan.parentId === undefined) {
        scope.appendChild(scope.container, nodes.get(nodePlan.id)!);
      }
    }
    return success(undefined);
  } catch (error) {
    return failure(normalizeThrown(error, "host_mutation_failed", "mount_view"));
  }
}

export function createRoot(
  container: RendererContainer,
  runtime: ReactiveCore,
): RendererResult<RendererRoot> {
  let created: CoreResult<RootContext>;
  try {
    created = createRootContext(container, runtime);
  } catch (error) {
    return failure(normalizeThrown(error, "invalid_root", "create_root"));
  }
  if (!created.ok) {
    return created as RendererResult<RendererRoot>;
  }
  const context = created.value;

  const root: RendererRoot = {
    get state(): RendererRootState {
      return context.state;
    },
    mount(view: ViewDescription): RendererResult<void> {
      const valid = validateView(view);
      if (!valid.ok) {
        return valid;
      }
      const mounted = context.mount((scope) => {
        let instance: unknown;
        try {
          instance = view.instantiate({ runtime });
        } catch (error) {
          return failure(rendererError(
            "view_instantiation_failed",
            "instantiate_view",
            error instanceof Error ? error.message : "view instantiate() threw",
          ));
        }
        const plan = validatePlan(view, instance);
        if (!plan.ok) {
          return plan;
        }
        return executePlan(scope, runtime, plan.value);
      });
      return normalizeResult<void>(mounted, "mount");
    },
    flush(): RendererResult<FlushReport> {
      return normalizeResult<FlushReport>(context.flush(), "flush");
    },
    unmount(): RendererResult<void> {
      return normalizeResult<void>(context.unmount(), "unmount");
    },
    dispose(): RendererResult<void> {
      return normalizeResult<void>(context.dispose(), "dispose");
    },
  };
  return success(root);
}
