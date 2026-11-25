import { SignalHandle } from "../../ruseact/src/handles.js";
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
import { createRootOwner, type ComponentOwner } from "./ownership.js";

export type RendererRootState = RootLifecycleState;
export type RendererContainer = Element | DocumentFragment;

export type RendererErrorCode =
  | "invalid_root" | "duplicate_root" | "invalid_root_state" | "disposed_root" | "root_busy"
  | "root_invariant" | "root_cleanup_failed" | "mount_cleanup_failed" | "invalid_mount"
  | "runtime_in_use" | "invalid_renderer_result" | "invalid_view" | "unsupported_view_protocol"
  | "unsupported_view_version" | "invalid_template_id" | "invalid_view_plan" | "duplicate_node_id"
  | "invalid_parent_reference" | "invalid_parent_kind" | "cyclic_view_plan" | "invalid_root_order"
  | "duplicate_binding_slot" | "invalid_binding_target" | "invalid_binding_dependencies"
  | "unsupported_binding_kind" | "duplicate_listener_id" | "invalid_listener_target"
  | "unsupported_property" | "view_instantiation_failed" | "binding_evaluation_failed"
  | "host_mutation_failed" | "invalid_node" | "detached_node" | "foreign_document" | "foreign_node"
  | "invalid_attribute" | "invalid_attribute_value" | "invalid_element_name" | "invalid_insertion_anchor"
  | "invalid_listener" | "invalid_listener_options" | "invalid_parent" | "invalid_parent_child"
  | "invalid_property" | "invalid_property_value" | "unsupported_namespace"
  | "invalid_component_type" | "invalid_component_instance" | "duplicate_component_identity"
  | "invalid_component_props" | "invalid_component_plan" | "child_mount_failed"
  | "child_cleanup_failed" | "foreign_owner";

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

export interface ViewEnvironment { readonly runtime: ReactiveCore; }
export interface ComponentEnvironment extends ViewEnvironment {
  readonly identity: string;
}

export type ComponentPropValue = SupportedScalar | SignalHandle<SupportedScalar> | undefined;
export type ComponentProps = Readonly<Record<string, ComponentPropValue>>;

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
  readonly order?: number;
  readonly name: string;
  readonly namespace?: string;
  readonly attributes?: readonly StaticAttributePlan[];
  readonly properties?: readonly StaticPropertyPlan[];
}

export interface StaticTextPlan {
  readonly id: string;
  readonly kind: "text";
  readonly parentId?: string;
  readonly order?: number;
  readonly text: string;
}

export type StaticNodePlan = StaticElementPlan | StaticTextPlan;

export interface BindingEvaluationContext { readonly runtime: ReactiveCore; }

export interface TextBindingPlan {
  readonly kind: "text";
  readonly slot: string;
  readonly targetId: string;
  readonly dependencies: readonly SignalHandle<SupportedScalar>[];
  readonly evaluate: (context: BindingEvaluationContext) => RendererResult<string>;
}

export interface AttributeBindingPlan {
  readonly kind: "attribute";
  readonly slot: string;
  readonly targetId: string;
  readonly name: string;
  readonly namespace?: string;
  readonly dependencies: readonly SignalHandle<SupportedScalar>[];
  readonly evaluate: (context: BindingEvaluationContext) => RendererResult<string>;
}

export interface PropertyBindingPlan {
  readonly kind: "property";
  readonly slot: string;
  readonly targetId: string;
  readonly property: SupportedProperty;
  readonly dependencies: readonly SignalHandle<SupportedScalar>[];
  readonly evaluate: (context: BindingEvaluationContext) => RendererResult<string | boolean>;
}

export type BindingPlan = TextBindingPlan | AttributeBindingPlan | PropertyBindingPlan;
export type RendererListenerOptions = boolean | (AddEventListenerOptions & { readonly signal?: never });

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

export interface ComponentPlacementPlan {
  readonly kind: "component";
  readonly id: string;
  readonly parentId?: string;
  readonly order: number;
  readonly component: ComponentDefinition;
  readonly props?: ComponentProps;
}

export interface ViewInstancePlanV2 extends ViewInstancePlan {
  readonly components: readonly ComponentPlacementPlan[];
}

export type ComponentView = ViewDescription | ViewInstancePlan | ViewInstancePlanV2;

export interface ComponentDefinition {
  readonly typeId: string;
  readonly setup: (
    props: ComponentProps,
    environment: ComponentEnvironment,
  ) => RendererResult<ComponentView>;
}

export function defineComponent(typeId: string, setup: ComponentDefinition["setup"]): ComponentDefinition {
  if (typeof typeId !== "string" || typeId.trim().length === 0) {
    throw new TypeError("component typeId must be a non-empty string");
  }
  if (typeof setup !== "function") {
    throw new TypeError("component setup must be a function");
  }
  return Object.freeze({ typeId, setup });
}

export interface ViewDescriptionV1 {
  readonly protocol: "ruseact.template";
  readonly version: 1;
  readonly templateId: string;
  readonly instantiate: (environment: ViewEnvironment) => ViewInstancePlan;
}

export interface ViewDescriptionV2 {
  readonly protocol: "ruseact.template";
  readonly version: 2;
  readonly templateId: string;
  readonly instantiate: (environment: ViewEnvironment) => ViewInstancePlanV2;
}

export type ViewDescription = ViewDescriptionV1 | ViewDescriptionV2;

interface PlanValidation {
  readonly version: 1 | 2;
  readonly plan: ViewInstancePlan | ViewInstancePlanV2;
  readonly nodesById: ReadonlyMap<string, StaticNodePlan>;
  readonly componentsById: ReadonlyMap<string, ComponentPlacementPlan>;
}

function success<T>(value: T): RendererResult<T> { return { ok: true, value }; }
function failure<T>(error: RendererError): RendererResult<T> { return { ok: false, error }; }

function rendererError(code: string, operation: string, message: string, fields: Partial<RendererError> = {}): RendererError {
  return { kind: "internal", code, operation, resource: "renderer", message, ...fields };
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value as Record<string, unknown> : undefined;
}

function isCoreError(value: unknown): value is CoreError {
  if (!isObject(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.kind === "operational" || candidate.kind === "internal") &&
    typeof candidate.code === "string" && typeof candidate.operation === "string";
}

function isCoreResult(value: unknown): value is CoreResult<unknown> {
  if (!isObject(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.ok === true ? "value" in candidate : candidate.ok === false && isCoreError(candidate.error);
}

function normalizeThrown(thrown: unknown, code: string, operation: string): RendererError {
  if (isObject(thrown)) {
    const candidate = thrown as Record<string, unknown>;
    if (typeof candidate.code === "string" && typeof candidate.operation === "string") {
      return {
        kind: candidate.kind === "operational" ? "operational" : "internal",
        code: candidate.code,
        operation: candidate.operation,
        resource: typeof candidate.resource === "string" ? candidate.resource : "renderer",
        message: thrown instanceof Error ? thrown.message : "renderer operation failed",
      };
    }
  }
  return rendererError(code, operation, thrown instanceof Error ? thrown.message : "renderer operation threw");
}

function normalizeResult<T>(value: unknown, operation: string): RendererResult<T> {
  if (!isCoreResult(value)) return failure(rendererError("invalid_renderer_result", operation, "renderer operation returned a malformed CoreResult"));
  return value as RendererResult<T>;
}

function validIdentifier(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function validNamespace(namespace: unknown): namespace is string | undefined { return namespace === undefined || namespace === HTML_NAMESPACE; }
function supportedProperty(property: unknown): property is SupportedProperty { return property === "value" || property === "checked" || property === "disabled"; }
function supportedPropertyValue(property: SupportedProperty, value: unknown): value is string | boolean { return property === "value" ? typeof value === "string" : typeof value === "boolean"; }
function validOrder(value: unknown): value is number | undefined { return value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0); }
function validComponentPropValue(value: unknown): value is ComponentPropValue {
  return value === undefined || typeof value === "boolean" || typeof value === "number" || typeof value === "string" || value instanceof SignalHandle;
}

function validatePlan(version: 1 | 2, planValue: unknown, operation = "validate_view"): RendererResult<PlanValidation> {
  if (!isObject(planValue)) return failure(rendererError("invalid_view_plan", operation, "view instantiate() must return a plan"));
  const plan = planValue as Partial<ViewInstancePlanV2>;
  if (!Array.isArray(plan.nodes) || !Array.isArray(plan.bindings) || !Array.isArray(plan.listeners)) return failure(rendererError("invalid_view_plan", operation, "view plan arrays are required"));
  if (version === 2 && !Array.isArray(plan.components)) return failure(rendererError("invalid_component_plan", operation, "version 2 plans require a components array"));

  const nodesById = new Map<string, StaticNodePlan>();
  for (const nodeValue of plan.nodes) {
    const nodeRecord = asRecord(nodeValue);
    if (nodeRecord === undefined || !validIdentifier(nodeRecord.id)) return failure(rendererError("invalid_view_plan", operation, "every node needs a non-empty id"));
    const node = nodeRecord as unknown as StaticNodePlan;
    if (nodesById.has(node.id)) return failure(rendererError("duplicate_node_id", operation, `node id ${node.id} is duplicated`));
    if (node.kind !== "element" && node.kind !== "text") return failure(rendererError("invalid_view_plan", operation, `node ${nodeRecord.id} has an unsupported kind`));
    if (!validOrder(node.order)) return failure(rendererError("invalid_root_order", operation, `node ${node.id} has an invalid order`));
    if (node.parentId !== undefined && !validIdentifier(node.parentId)) return failure(rendererError("invalid_parent_reference", operation, `node ${node.id} has an invalid parent id`));
    if (node.kind === "text") {
      if (typeof node.text !== "string") return failure(rendererError("invalid_view_plan", operation, `text node ${node.id} needs text`));
      nodesById.set(node.id, node);
      continue;
    }
    if (typeof node.name !== "string" || node.name.length === 0 || /\s/.test(node.name)) return failure(rendererError("invalid_view_plan", operation, `element ${node.id} has an invalid name`));
    if (!validNamespace(node.namespace)) return failure(rendererError("invalid_view_plan", operation, `element ${node.id} uses an unsupported namespace`));
    if (node.attributes !== undefined) {
      if (!Array.isArray(node.attributes)) return failure(rendererError("invalid_view_plan", operation, `element ${node.id} attributes must be an array`));
      const attributes = new Set<string>();
      for (const attribute of node.attributes) {
        const record = asRecord(attribute);
        if (record === undefined || typeof record.name !== "string" || typeof record.value !== "string" || !validNamespace(record.namespace)) return failure(rendererError("invalid_view_plan", operation, `element ${node.id} has an invalid attribute`));
        const key = `${record.namespace ?? ""}:${record.name}`;
        if (attributes.has(key)) return failure(rendererError("invalid_view_plan", operation, `element ${node.id} repeats attribute ${record.name}`));
        attributes.add(key);
      }
    }
    if (node.properties !== undefined) {
      if (!Array.isArray(node.properties)) return failure(rendererError("invalid_view_plan", operation, `element ${node.id} properties must be an array`));
      const properties = new Set<string>();
      for (const property of node.properties) {
        const record = asRecord(property);
        if (record === undefined || !supportedProperty(record.property) || !supportedPropertyValue(record.property, record.value)) return failure(rendererError("invalid_property_value", operation, `element ${node.id} has an invalid property`));
        if (properties.has(record.property)) return failure(rendererError("invalid_view_plan", operation, `element ${node.id} repeats property ${record.property}`));
        properties.add(record.property);
      }
    }
    nodesById.set(node.id, node);
  }

  for (const node of nodesById.values()) {
    if (node.parentId === undefined) continue;
    const parent = nodesById.get(node.parentId);
    if (parent === undefined) return failure(rendererError("invalid_parent_reference", operation, `node ${node.id} references missing parent ${node.parentId}`));
    if (parent.kind !== "element") return failure(rendererError("invalid_parent_kind", operation, `node ${node.id} cannot be inserted into text node ${parent.id}`));
  }
  for (const node of nodesById.values()) {
    const seen = new Set<string>();
    let current: StaticNodePlan | undefined = node;
    while (current?.parentId !== undefined) {
      if (seen.has(current.id)) return failure(rendererError("cyclic_view_plan", operation, `node ${node.id} is part of a cycle`));
      seen.add(current.id);
      current = nodesById.get(current.parentId);
    }
  }

  const bindingSlots = new Set<string>();
  for (const bindingValue of plan.bindings) {
    const record = asRecord(bindingValue);
    if (record === undefined || !validIdentifier(record.slot)) return failure(rendererError("invalid_view_plan", operation, "every binding needs a non-empty slot"));
    const binding = record as unknown as BindingPlan;
    if (bindingSlots.has(binding.slot)) return failure(rendererError("duplicate_binding_slot", operation, `binding slot ${binding.slot} is duplicated`));
    bindingSlots.add(binding.slot);
    const target = typeof binding.targetId === "string" ? nodesById.get(binding.targetId) : undefined;
    if (target === undefined) return failure(rendererError("invalid_binding_target", operation, `binding ${binding.slot} targets an unknown node`));
    if (binding.kind !== "text" && binding.kind !== "attribute" && binding.kind !== "property") return failure(rendererError("unsupported_binding_kind", operation, `binding ${record.slot} has an unsupported kind`));
    if (binding.kind === "text" && target.kind !== "text") return failure(rendererError("invalid_binding_target", operation, `text binding ${binding.slot} needs a text target`));
    if (binding.kind !== "text" && target.kind !== "element") return failure(rendererError("invalid_binding_target", operation, `binding ${binding.slot} needs an element target`));
    if (!Array.isArray(binding.dependencies) || typeof binding.evaluate !== "function") return failure(rendererError("invalid_binding_dependencies", operation, `binding ${binding.slot} needs explicit dependencies and an evaluator`));
    if (binding.kind === "attribute" && (typeof binding.name !== "string" || !validNamespace(binding.namespace))) return failure(rendererError("invalid_view_plan", operation, `binding ${binding.slot} has an invalid attribute`));
    if (binding.kind === "property" && !supportedProperty(binding.property)) return failure(rendererError("unsupported_property", operation, `binding ${binding.slot} uses an unsupported property`));
  }

  const listenerIds = new Set<string>();
  for (const listenerValue of plan.listeners) {
    const record = asRecord(listenerValue);
    if (record === undefined || !validIdentifier(record.id) || typeof record.type !== "string" || typeof record.listener !== "function") return failure(rendererError("invalid_view_plan", operation, "listener metadata is invalid"));
    const listener = record as unknown as ListenerPlan;
    if (listenerIds.has(listener.id)) return failure(rendererError("duplicate_listener_id", operation, `listener id ${listener.id} is duplicated`));
    listenerIds.add(listener.id);
    const target = nodesById.get(listener.targetId);
    if (target === undefined || target.kind !== "element") return failure(rendererError("invalid_listener_target", operation, `listener ${listener.id} needs an element target`));
    if (listener.options !== undefined && typeof listener.options === "object" && listener.options.signal !== undefined) return failure(rendererError("invalid_listener_options", operation, `listener ${listener.id} cannot use AbortSignal`));
  }

  const componentsById = new Map<string, ComponentPlacementPlan>();
  if (version === 2) {
    for (const componentValue of plan.components ?? []) {
      const record = asRecord(componentValue);
      if (record === undefined || record.kind !== "component" || !validIdentifier(record.id) || !validOrder(record.order)) return failure(rendererError("invalid_component_plan", operation, "component placement metadata is invalid"));
      const component = record as unknown as ComponentPlacementPlan;
      if (componentsById.has(component.id) || nodesById.has(component.id)) return failure(rendererError("duplicate_component_identity", operation, `component placement ${component.id} is duplicated`));
      if (component.parentId !== undefined) {
        const parent = nodesById.get(component.parentId);
        if (parent === undefined) return failure(rendererError("invalid_parent_reference", operation, `component ${component.id} references missing parent ${component.parentId}`));
        if (parent.kind !== "element") return failure(rendererError("invalid_parent_kind", operation, `component ${component.id} needs an element parent`));
      }
      const definition = asRecord(component.component);
      if (definition === undefined || !validIdentifier(definition.typeId) || typeof definition.setup !== "function") return failure(rendererError("invalid_component_type", operation, `component ${component.id} has an invalid definition`));
      if (component.props !== undefined) {
        const props = asRecord(component.props);
        if (props === undefined || Object.values(props).some((value) => !validComponentPropValue(value))) return failure(rendererError("invalid_component_props", operation, `component ${component.id} has invalid props`));
      }
      componentsById.set(component.id, component);
    }
  }
  return success({ version, plan: plan as ViewInstancePlan | ViewInstancePlanV2, nodesById, componentsById });
}

function validateView(view: unknown): RendererResult<ViewDescription> {
  if (!isObject(view)) return failure(rendererError("invalid_view", "mount", "a view description is required"));
  const candidate = view as Partial<ViewDescription>;
  if (candidate.protocol !== "ruseact.template") return failure(rendererError("unsupported_view_protocol", "mount", "unsupported view protocol"));
  if (candidate.version !== 1 && candidate.version !== 2) return failure(rendererError("unsupported_view_version", "mount", "unsupported view version"));
  if (!validIdentifier(candidate.templateId)) return failure(rendererError("invalid_template_id", "mount", "templateId must be non-empty"));
  if (typeof candidate.instantiate !== "function") return failure(rendererError("invalid_view", "mount", "view instantiate() must be a function"));
  return success(candidate as ViewDescription);
}

function updateBinding(scope: RootMountScope, runtime: ReactiveCore, plan: BindingPlan, nodesById: ReadonlyMap<string, Node>): CoreResult<unknown> {
  const target = nodesById.get(plan.targetId);
  if (target === undefined) return failure(rendererError("invalid_binding_target", "register_binding", `binding ${plan.slot} targets an unknown node`));
  try {
    const evaluated = plan.evaluate({ runtime });
    if (!isCoreResult(evaluated)) return failure(rendererError("binding_evaluation_failed", "execute_binding", `binding ${plan.slot} returned a malformed result`));
    if (!evaluated.ok) return evaluated as CoreResult<unknown>;
    if (plan.kind === "text") {
      if (typeof evaluated.value !== "string") return failure(rendererError("binding_evaluation_failed", "execute_binding", `text binding ${plan.slot} must evaluate to a string`));
      return success(scope.setText(target, evaluated.value));
    }
    if (plan.kind === "attribute") {
      if (typeof evaluated.value !== "string") return failure(rendererError("binding_evaluation_failed", "execute_binding", `attribute binding ${plan.slot} must evaluate to a string`));
      return success(scope.setAttribute(target, plan.name, evaluated.value, plan.namespace));
    }
    if (!supportedPropertyValue(plan.property, evaluated.value)) return failure(rendererError("binding_evaluation_failed", "execute_binding", `property binding ${plan.slot} has an invalid value`));
    return success(scope.setProperty(target, plan.property, evaluated.value));
  } catch (error) {
    return failure(normalizeThrown(error, "host_mutation_failed", "execute_binding"));
  }
}

function isViewDescription(value: unknown): value is ViewDescription {
  const record = asRecord(value);
  return record?.protocol === "ruseact.template" && (record.version === 1 || record.version === 2) && typeof record.instantiate === "function";
}

function componentFailure(code: RendererErrorCode, message: string, cause?: CoreError): RendererError {
  return rendererError(code, "mount_component", message, cause === undefined ? {} : { causeCode: cause.code, causeOperation: cause.operation });
}

function materializeComponentView(value: unknown, runtime: ReactiveCore): RendererResult<PlanValidation> {
  if (isViewDescription(value)) {
    const valid = validateView(value);
    if (!valid.ok) return valid;
    let planValue: unknown;
    try {
      planValue = value.instantiate({ runtime });
    } catch (error) {
      return failure(normalizeThrown(error, "view_instantiation_failed", "instantiate_component_view"));
    }
    return validatePlan(value.version, planValue, "validate_component_view");
  }
  const record = asRecord(value);
  if (record === undefined || !Array.isArray(record.nodes) || !Array.isArray(record.bindings) || !Array.isArray(record.listeners)) return failure(rendererError("invalid_component_plan", "mount_component", "component setup must return a supported view or plan"));
  return validatePlan(Array.isArray(record.components) ? 2 : 1, value, "validate_component_plan");
}

function orderedItems(plan: PlanValidation, parentId: string | undefined): Array<{ readonly order: number; readonly index: number; readonly node?: StaticNodePlan; readonly component?: ComponentPlacementPlan }> {
  const items: Array<{ order: number; index: number; node?: StaticNodePlan; component?: ComponentPlacementPlan }> = [];
  plan.plan.nodes.forEach((node, index) => { if (node.parentId === parentId) items.push({ order: node.order ?? index, index, node }); });
  for (const [index, component] of Array.from(plan.componentsById.values()).entries()) {
    if (component.parentId === parentId) items.push({ order: component.order, index: plan.plan.nodes.length + index, component });
  }
  items.sort((left, right) => left.order - right.order || left.index - right.index);
  return items;
}

function executeChildren(scope: RootMountScope, runtime: ReactiveCore, plan: PlanValidation, owner: ComponentOwner, parentId: string, parent: Node, nodes: ReadonlyMap<string, Node>): CoreResult<void> {
  for (const item of orderedItems(plan, parentId)) {
    if (item.node !== undefined) {
      scope.appendChild(parent, nodes.get(item.node.id)!);
      if (item.node.kind === "element") {
        const nested = executeChildren(scope, runtime, plan, owner, item.node.id, nodes.get(item.node.id)!, nodes);
        if (!nested.ok) return nested;
      }
    } else if (item.component !== undefined) {
      const mounted = mountComponent(scope, runtime, owner, item.component, parent);
      if (!mounted.ok) return mounted;
    }
  }
  return success(undefined);
}

function executePlan(scope: RootMountScope, runtime: ReactiveCore, plan: PlanValidation, owner: ComponentOwner, parent: Node = scope.container): CoreResult<void> {
  const nodes = new Map<string, Node>();
  try {
    for (const nodePlan of plan.plan.nodes) {
      nodes.set(nodePlan.id, nodePlan.kind === "text" ? scope.createTextNode(nodePlan.text) : scope.createElement(nodePlan.name, nodePlan.namespace));
    }
    for (const nodePlan of plan.plan.nodes) {
      const node = nodes.get(nodePlan.id)!;
      if (nodePlan.kind === "element") {
        for (const attribute of nodePlan.attributes ?? []) scope.setAttribute(node, attribute.name, attribute.value, attribute.namespace);
        for (const property of nodePlan.properties ?? []) scope.setProperty(node, property.property, property.value);
      }
    }
    for (const listener of plan.plan.listeners) scope.addEventListener(nodes.get(listener.targetId)!, listener.type, listener.listener, listener.options);
    for (const binding of plan.plan.bindings) {
      const registered = scope.registerBinding({ target: nodes.get(binding.targetId)!, dependencies: binding.dependencies, key: binding.slot, update: () => updateBinding(scope, runtime, binding, nodes) });
      if (!registered.ok) return registered;
      const owned = owner.trackBinding(registered.value, () => scope.disposeBinding(registered.value));
      if (!owned.ok) {
        scope.disposeBinding(registered.value);
        return owned;
      }
    }
    for (const item of orderedItems(plan, undefined)) {
      if (item.node !== undefined) {
        scope.appendChild(parent, nodes.get(item.node.id)!);
        if (item.node.kind === "element") {
          const nested = executeChildren(scope, runtime, plan, owner, item.node.id, nodes.get(item.node.id)!, nodes);
          if (!nested.ok) return nested;
        }
      } else if (item.component !== undefined) {
        const mounted = mountComponent(scope, runtime, owner, item.component, parent);
        if (!mounted.ok) return mounted;
      }
    }
    return success(undefined);
  } catch (error) {
    return failure(normalizeThrown(error, "host_mutation_failed", "mount_view"));
  }
}

function snapshotProps(value: ComponentProps | undefined): RendererResult<ComponentProps> {
  if (value === undefined) return success(Object.freeze({}));
  const record = asRecord(value);
  if (record === undefined || Object.values(record).some((entry) => !validComponentPropValue(entry))) return failure(rendererError("invalid_component_props", "mount_component", "component props must contain only supported scalar values or signal handles"));
  return success(Object.freeze({ ...record }) as ComponentProps);
}

function mountComponent(scope: RootMountScope, runtime: ReactiveCore, parentOwner: ComponentOwner, placement: ComponentPlacementPlan, parent: Node): CoreResult<void> {
  const definition = asRecord(placement.component);
  if (definition === undefined || !validIdentifier(definition.typeId) || typeof definition.setup !== "function") return failure(componentFailure("invalid_component_type", `component ${placement.id} has an invalid definition`));
  const props = snapshotProps(placement.props);
  if (!props.ok) return props;
  const child = parentOwner.createChild(`${placement.id}[${definition.typeId}]`);
  if (!child.ok) return child;
  const owner = child.value;
  let initialized: RendererResult<ComponentView>;
  try {
    const result = definition.setup(props.value, { runtime, identity: owner.id });
    if (!isCoreResult(result)) initialized = failure(componentFailure("invalid_component_instance", `component ${placement.id} setup returned a malformed result`));
    else if (!result.ok) initialized = failure(componentFailure("child_mount_failed", `component ${placement.id} setup failed`, result.error));
    else initialized = success(result.value as ComponentView);
  } catch (error) {
    initialized = failure(componentFailure("child_mount_failed", `component ${placement.id} setup threw: ${error instanceof Error ? error.message : "unknown error"}`));
  }
  if (!initialized.ok) {
    const cleaned = owner.dispose();
    return cleaned.ok ? initialized : failure(componentFailure("child_cleanup_failed", `component ${placement.id} failed and cleanup failed`, cleaned.error));
  }
  const childPlan = materializeComponentView(initialized.value, runtime);
  if (!childPlan.ok) {
    const cleaned = owner.dispose();
    return cleaned.ok ? failure(componentFailure("invalid_component_plan", `component ${placement.id} returned an invalid plan`, childPlan.error)) : failure(componentFailure("child_cleanup_failed", `component ${placement.id} plan validation failed and cleanup failed`, cleaned.error));
  }
  const mounted = executePlan(scope, runtime, childPlan.value, owner, parent);
  if (!mounted.ok) {
    const cleaned = owner.dispose();
    return cleaned.ok ? failure(componentFailure("child_mount_failed", `component ${placement.id} mount failed`, mounted.error)) : failure(componentFailure("child_cleanup_failed", `component ${placement.id} mount failed and cleanup failed`, cleaned.error));
  }
  const published = owner.publish();
  if (!published.ok) {
    const cleaned = owner.dispose();
    return cleaned.ok ? published : failure(componentFailure("child_cleanup_failed", `component ${placement.id} publication failed and cleanup failed`, cleaned.error));
  }
  return success(undefined);
}

function instantiateAndValidate(view: ViewDescription, runtime: ReactiveCore): RendererResult<PlanValidation> {
  let instance: unknown;
  try { instance = view.instantiate({ runtime }); }
  catch (error) { return failure(normalizeThrown(error, "view_instantiation_failed", "instantiate_view")); }
  return validatePlan(view.version, instance);
}

export function createRoot(container: RendererContainer, runtime: ReactiveCore): RendererResult<RendererRoot> {
  let created: CoreResult<RootContext>;
  try { created = createRootContext(container, runtime); }
  catch (error) { return failure(normalizeThrown(error, "invalid_root", "create_root")); }
  if (!created.ok) return created as RendererResult<RendererRoot>;
  const context = created.value;
  const root: RendererRoot = {
    get state(): RendererRootState { return context.state; },
    mount(view: ViewDescription): RendererResult<void> {
      const valid = validateView(view);
      if (!valid.ok) return valid;
      const mounted = context.mount((scope) => {
        const owner = createRootOwner();
        scope.registerCleanup(() => owner.dispose());
        const plan = instantiateAndValidate(valid.value, runtime);
        if (!plan.ok) return plan;
        return executePlan(scope, runtime, plan.value, owner);
      });
      return normalizeResult<void>(mounted, "mount");
    },
    flush(): RendererResult<FlushReport> { return normalizeResult<FlushReport>(context.flush(), "flush"); },
    unmount(): RendererResult<void> { return normalizeResult<void>(context.unmount(), "unmount"); },
    dispose(): RendererResult<void> { return normalizeResult<void>(context.dispose(), "dispose"); },
  };
  return success(root);
}
