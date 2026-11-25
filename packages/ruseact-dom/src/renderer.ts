import { SignalHandle } from "ruseact";
import type {
  CoreError,
  CoreResult,
  ReactiveCore,
  SupportedScalar,
} from "ruseact";
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
  | "child_cleanup_failed" | "foreign_owner" | "invalid_conditional_plan"
  | "duplicate_region_id" | "invalid_region_parent" | "invalid_region_dependencies"
  | "invalid_selector_result" | "invalid_branch_factory" | "invalid_anchor"
  | "invalid_region_range" | "structural_update_failed" | "invalid_keyed_plan"
  | "invalid_key" | "duplicate_key" | "invalid_item_descriptor"
  | "invalid_item_schema" | "invalid_item_factory" | "invalid_item_range"
  | "item_cleanup_failed" | "keyed_update_failed";

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

export interface ConditionalBranchEnvironment extends ViewEnvironment {
  readonly identity: string;
}

export type ConditionalBranchFactory = (
  environment: ConditionalBranchEnvironment,
) => RendererResult<ComponentView>;

export interface ConditionalRegionPlan {
  readonly kind: "conditional";
  readonly id: string;
  readonly parentId?: string;
  readonly order: number;
  readonly dependencies: readonly SignalHandle<SupportedScalar>[];
  readonly evaluate: (context: BindingEvaluationContext) => RendererResult<boolean>;
  readonly whenTrue: ConditionalBranchFactory;
  readonly whenFalse: ConditionalBranchFactory;
}

export type StructuralKey = string | number | boolean;
export type KeyedItemFields = Readonly<Record<string, SupportedScalar>>;

export interface KeyedItemDescriptor {
  readonly key: StructuralKey;
  readonly fields: KeyedItemFields;
}

export interface KeyedItemEnvironment extends ComponentEnvironment {
  readonly key: StructuralKey;
  readonly data: KeyedItemFields;
  readonly fields: Readonly<Record<string, SignalHandle<SupportedScalar>>>;
}

export type KeyedItemFactory = (
  environment: KeyedItemEnvironment,
) => RendererResult<ComponentView>;

export interface KeyedListPlan {
  readonly kind: "keyed";
  readonly id: string;
  readonly parentId?: string;
  readonly order: number;
  readonly dependencies: readonly SignalHandle<SupportedScalar>[];
  readonly evaluate: (context: BindingEvaluationContext) => RendererResult<readonly KeyedItemDescriptor[]>;
  readonly createItem: KeyedItemFactory;
}

export interface ViewInstancePlanV2 extends ViewInstancePlan {
  readonly components: readonly ComponentPlacementPlan[];
}

export interface ViewInstancePlanV3 extends ViewInstancePlanV2 {
  readonly conditions: readonly ConditionalRegionPlan[];
}

export interface ViewInstancePlanV4 extends ViewInstancePlanV3 {
  readonly keyedLists: readonly KeyedListPlan[];
}

export type ComponentView = ViewDescription | ViewInstancePlan | ViewInstancePlanV2 | ViewInstancePlanV3 | ViewInstancePlanV4;

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

export interface ViewDescriptionV3 {
  readonly protocol: "ruseact.template";
  readonly version: 3;
  readonly templateId: string;
  readonly instantiate: (environment: ViewEnvironment) => ViewInstancePlanV3;
}

export interface ViewDescriptionV4 {
  readonly protocol: "ruseact.template";
  readonly version: 4;
  readonly templateId: string;
  readonly instantiate: (environment: ViewEnvironment) => ViewInstancePlanV4;
}

export type ViewDescription = ViewDescriptionV1 | ViewDescriptionV2 | ViewDescriptionV3 | ViewDescriptionV4;

interface PlanValidation {
  readonly version: 1 | 2 | 3 | 4;
  readonly plan: ViewInstancePlan | ViewInstancePlanV2 | ViewInstancePlanV3 | ViewInstancePlanV4;
  readonly nodesById: ReadonlyMap<string, StaticNodePlan>;
  readonly componentsById: ReadonlyMap<string, ComponentPlacementPlan>;
  readonly conditionsById: ReadonlyMap<string, ConditionalRegionPlan>;
  readonly keyedListsById: ReadonlyMap<string, KeyedListPlan>;
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

function validSupportedScalar(value: unknown): value is SupportedScalar {
  return typeof value === "boolean" || typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value));
}

function validStructuralKey(value: unknown): value is StructuralKey {
  return typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value));
}

function structuralKeyIdentity(key: StructuralKey): string {
  return `${typeof key}:${JSON.stringify(key)}`;
}

function validatePlan(version: 1 | 2 | 3 | 4, planValue: unknown, operation = "validate_view"): RendererResult<PlanValidation> {
  if (!isObject(planValue)) return failure(rendererError("invalid_view_plan", operation, "view instantiate() must return a plan"));
  const plan = planValue as Partial<ViewInstancePlanV2>;
  if (!Array.isArray(plan.nodes) || !Array.isArray(plan.bindings) || !Array.isArray(plan.listeners)) return failure(rendererError("invalid_view_plan", operation, "view plan arrays are required"));
  if (version >= 2 && !Array.isArray(plan.components)) return failure(rendererError("invalid_component_plan", operation, `version ${version} plans require a components array`));
  if (version >= 3 && !Array.isArray((planValue as Partial<ViewInstancePlanV3>).conditions)) return failure(rendererError("invalid_conditional_plan", operation, `version ${version} plans require a conditions array`));
  if (version < 3 && Array.isArray((planValue as Partial<ViewInstancePlanV3>).conditions) && (planValue as Partial<ViewInstancePlanV3>).conditions!.length > 0) return failure(rendererError("invalid_conditional_plan", operation, "conditional regions require view protocol version 3"));
  if (version === 4 && !Array.isArray((planValue as Partial<ViewInstancePlanV4>).keyedLists)) return failure(rendererError("invalid_keyed_plan", operation, "version 4 plans require a keyedLists array"));
  if (version < 4 && Array.isArray((planValue as Partial<ViewInstancePlanV4>).keyedLists) && (planValue as Partial<ViewInstancePlanV4>).keyedLists!.length > 0) return failure(rendererError("invalid_keyed_plan", operation, "keyed lists require view protocol version 4"));

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
  if (version >= 2) {
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
  const conditionsById = new Map<string, ConditionalRegionPlan>();
  if (version >= 3) {
    for (const conditionValue of (planValue as Partial<ViewInstancePlanV3>).conditions ?? []) {
      const record = asRecord(conditionValue);
      if (record === undefined || record.kind !== "conditional" || !validIdentifier(record.id) || !validOrder(record.order)) {
        return failure(rendererError("invalid_conditional_plan", operation, "conditional region metadata is invalid"));
      }
      const condition = record as unknown as ConditionalRegionPlan;
      if (conditionsById.has(condition.id) || nodesById.has(condition.id) || componentsById.has(condition.id)) {
        return failure(rendererError("duplicate_region_id", operation, `conditional region ${condition.id} is duplicated`));
      }
      if (condition.parentId !== undefined) {
        const parent = nodesById.get(condition.parentId);
        if (parent === undefined) return failure(rendererError("invalid_region_parent", operation, `conditional region ${condition.id} references missing parent ${condition.parentId}`));
        if (parent.kind !== "element") return failure(rendererError("invalid_region_parent", operation, `conditional region ${condition.id} needs an element parent`));
      }
      if (!Array.isArray(condition.dependencies) || condition.dependencies.length !== 1 || !(condition.dependencies[0] instanceof SignalHandle)) {
        return failure(rendererError("invalid_region_dependencies", operation, `conditional region ${condition.id} requires exactly one explicit signal dependency`));
      }
      if (typeof condition.evaluate !== "function" || typeof condition.whenTrue !== "function" || typeof condition.whenFalse !== "function") {
        return failure(rendererError("invalid_conditional_plan", operation, `conditional region ${condition.id} requires an evaluator and two branch factories`));
      }
      conditionsById.set(condition.id, condition);
    }
  }
  const keyedListsById = new Map<string, KeyedListPlan>();
  if (version === 4) {
    for (const listValue of (planValue as Partial<ViewInstancePlanV4>).keyedLists ?? []) {
      const record = asRecord(listValue);
      if (record === undefined || record.kind !== "keyed" || !validIdentifier(record.id) || !validOrder(record.order)) {
        return failure(rendererError("invalid_keyed_plan", operation, "keyed-list metadata is invalid"));
      }
      const list = record as unknown as KeyedListPlan;
      if (keyedListsById.has(list.id) || nodesById.has(list.id) || componentsById.has(list.id) || conditionsById.has(list.id)) {
        return failure(rendererError("duplicate_region_id", operation, `keyed-list region ${list.id} is duplicated`));
      }
      if (list.parentId !== undefined) {
        const parent = nodesById.get(list.parentId);
        if (parent === undefined || parent.kind !== "element") return failure(rendererError("invalid_region_parent", operation, `keyed-list region ${list.id} needs an element parent`));
      }
      if (!Array.isArray(list.dependencies) || list.dependencies.length !== 1 || !(list.dependencies[0] instanceof SignalHandle)) {
        return failure(rendererError("invalid_region_dependencies", operation, `keyed-list region ${list.id} requires exactly one explicit revision dependency`));
      }
      if (typeof list.evaluate !== "function" || typeof list.createItem !== "function") {
        return failure(rendererError("invalid_keyed_plan", operation, `keyed-list region ${list.id} requires an evaluator and item factory`));
      }
      keyedListsById.set(list.id, list);
    }
  }
  return success({ version, plan: plan as ViewInstancePlan | ViewInstancePlanV2 | ViewInstancePlanV3 | ViewInstancePlanV4, nodesById, componentsById, conditionsById, keyedListsById });
}

function validateView(view: unknown): RendererResult<ViewDescription> {
  if (!isObject(view)) return failure(rendererError("invalid_view", "mount", "a view description is required"));
  const candidate = view as Partial<ViewDescription>;
  if (candidate.protocol !== "ruseact.template") return failure(rendererError("unsupported_view_protocol", "mount", "unsupported view protocol"));
  if (candidate.version !== 1 && candidate.version !== 2 && candidate.version !== 3 && candidate.version !== 4) return failure(rendererError("unsupported_view_version", "mount", "unsupported view version"));
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
  return record?.protocol === "ruseact.template" && (record.version === 1 || record.version === 2 || record.version === 3 || record.version === 4) && typeof record.instantiate === "function";
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
  return validatePlan(Array.isArray(record.keyedLists) ? 4 : Array.isArray(record.conditions) ? 3 : Array.isArray(record.components) ? 2 : 1, value, "validate_component_plan");
}

interface ConditionalRegionRecord {
  readonly id: string;
  readonly owner: ComponentOwner;
  readonly parent: Node;
  readonly start: Comment;
  readonly end: Comment;
  readonly plan: ConditionalRegionPlan;
  activeSelector: boolean | undefined;
  activeBranch: ComponentOwner | undefined;
  activeRoots: readonly Node[];
  activation: number;
  state: "initializing" | "active" | "updating" | "empty" | "disposing" | "disposed" | "cleanup_failed";
}

interface KeyedItemRecord {
  readonly key: StructuralKey;
  readonly identity: string;
  readonly owner: ComponentOwner;
  readonly parent: Node;
  readonly start: Comment;
  readonly end: Comment;
  readonly fields: ReadonlyMap<string, SignalHandle<SupportedScalar>>;
  readonly fieldValues: Map<string, SupportedScalar>;
  readonly schema: ReadonlyMap<string, "boolean" | "number" | "string">;
  readonly activation: number;
  rangeNodes: readonly Node[];
  state: "initializing" | "active" | "disposing" | "disposed" | "cleanup_failed";
}

interface KeyedListRegionRecord {
  readonly id: string;
  readonly owner: ComponentOwner;
  readonly parent: Node;
  readonly start: Comment;
  readonly end: Comment;
  readonly plan: KeyedListPlan;
  readonly items: Map<StructuralKey, KeyedItemRecord>;
  order: StructuralKey[];
  activation: number;
  state: "initializing" | "active" | "updating" | "disposing" | "disposed" | "cleanup_failed";
}

type OrderedItem = {
  readonly order: number;
  readonly index: number;
  readonly node?: StaticNodePlan;
  readonly component?: ComponentPlacementPlan;
  readonly condition?: ConditionalRegionPlan;
  readonly keyedList?: KeyedListPlan;
};

function orderedItems(plan: PlanValidation, parentId: string | undefined): OrderedItem[] {
  const items: Array<{ order: number; index: number; node?: StaticNodePlan; component?: ComponentPlacementPlan; condition?: ConditionalRegionPlan; keyedList?: KeyedListPlan }> = [];
  plan.plan.nodes.forEach((node, index) => { if (node.parentId === parentId) items.push({ order: node.order ?? index, index, node }); });
  for (const [index, component] of Array.from(plan.componentsById.values()).entries()) {
    if (component.parentId === parentId) items.push({ order: component.order, index: plan.plan.nodes.length + index, component });
  }
  for (const [index, condition] of Array.from(plan.conditionsById.values()).entries()) {
    if (condition.parentId === parentId) items.push({ order: condition.order, index: plan.plan.nodes.length + plan.componentsById.size + index, condition });
  }
  for (const [index, keyedList] of Array.from(plan.keyedListsById.values()).entries()) {
    if (keyedList.parentId === parentId) items.push({ order: keyedList.order, index: plan.plan.nodes.length + plan.componentsById.size + plan.conditionsById.size + index, keyedList });
  }
  items.sort((left, right) => left.order - right.order || left.index - right.index);
  return items;
}

function removeOwnedNode(scope: RootMountScope, parent: Node, node: Node): CoreResult<void> {
  try {
    if (node.parentNode !== parent) {
      return failure(rendererError("invalid_region_range", "remove_owned_node", "owned node is no longer attached to its expected parent"));
    }
    scope.removeChild(parent, node);
    return success(undefined);
  } catch (error) {
    return failure(normalizeThrown(error, "host_mutation_failed", "remove_owned_node"));
  }
}

function retireOwnedNode(scope: RootMountScope, parent: Node, node: Node): CoreResult<void> {
  try {
    if (node.parentNode === null) {
      scope.retireNode(node);
      return success(undefined);
    }
    const removed = removeOwnedNode(scope, parent, node);
    if (!removed.ok) return removed;
    scope.retireNode(node);
    return success(undefined);
  } catch (error) {
    return failure(normalizeThrown(error, "host_mutation_failed", "retire_owned_node"));
  }
}

function validateOwnedSubtree(scope: RootMountScope, node: Node): CoreResult<void> {
  try {
    scope.assertOwned(node);
    for (const child of Array.from(node.childNodes)) {
      const valid = validateOwnedSubtree(scope, child);
      if (!valid.ok) return valid;
    }
    return success(undefined);
  } catch (error) {
    return failure(normalizeThrown(error, "invalid_region_range", "validate_region_range"));
  }
}

function validateRegionRange(scope: RootMountScope, record: ConditionalRegionRecord): CoreResult<void> {
  try {
    scope.assertOwned(record.parent);
    scope.assertOwned(record.start);
    scope.assertOwned(record.end);
    if (record.start.parentNode !== record.parent || record.end.parentNode !== record.parent) {
      return failure(rendererError("invalid_region_range", "validate_region_range", "conditional anchors do not share their expected parent"));
    }
    if ((record.start.compareDocumentPosition(record.end) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) {
      return failure(rendererError("invalid_region_range", "validate_region_range", "conditional anchors are not ordered"));
    }
    for (const root of record.activeRoots) {
      if (root.parentNode !== record.parent) {
        return failure(rendererError("invalid_region_range", "validate_region_range", "active branch root moved outside its region"));
      }
      const valid = validateOwnedSubtree(scope, root);
      if (!valid.ok) return valid;
    }
    let current = record.start.nextSibling;
    while (current !== null && current !== record.end) {
      const valid = validateOwnedSubtree(scope, current);
      if (!valid.ok) return valid;
      current = current.nextSibling;
    }
    if (current !== record.end) {
      return failure(rendererError("invalid_region_range", "validate_region_range", "conditional end anchor is unreachable from the start anchor"));
    }
    return success(undefined);
  } catch (error) {
    return failure(normalizeThrown(error, "invalid_region_range", "validate_region_range"));
  }
}

function collectOwnedRange(
  scope: RootMountScope,
  owner: ComponentOwner,
  parent: Node,
  start: Node,
  end: Node,
  errorCode: RendererErrorCode = "invalid_item_range",
): RendererResult<readonly Node[]> {
  try {
    scope.assertOwned(parent);
    scope.assertOwned(start);
    scope.assertOwned(end);
    if (start.parentNode !== parent || end.parentNode !== parent) {
      return failure(rendererError(errorCode, "validate_owned_range", "range anchors do not share their expected parent"));
    }
    const nodes: Node[] = [];
    let current: Node | null = start;
    while (current !== null) {
      scope.assertOwned(current);
      if (!owner.containsNode(current)) {
        return failure(rendererError(errorCode, "validate_owned_range", "range contains a node outside its owner hierarchy"));
      }
      nodes.push(current);
      if (current === end) return success(nodes);
      if (current.parentNode !== parent) {
        return failure(rendererError(errorCode, "validate_owned_range", "range node is not a direct child of its expected parent"));
      }
      current = current.nextSibling;
    }
    return failure(rendererError(errorCode, "validate_owned_range", "range end anchor is unreachable"));
  } catch (error) {
    return failure(normalizeThrown(error, errorCode, "validate_owned_range"));
  }
}

function validateKeyedRange(
  scope: RootMountScope,
  record: KeyedListRegionRecord,
  items: ReadonlyMap<StructuralKey, KeyedItemRecord> = record.items,
  order: readonly StructuralKey[] = record.order,
): RendererResult<void> {
  try {
    scope.assertOwned(record.parent);
    scope.assertOwned(record.start);
    scope.assertOwned(record.end);
    if (record.start.parentNode !== record.parent || record.end.parentNode !== record.parent) {
      return failure(rendererError("invalid_item_range", "validate_keyed_range", "keyed-list anchors do not share their expected parent"));
    }
    const expected = new Map<Node, KeyedItemRecord>();
    for (const key of order) {
      const item = items.get(key);
      if (item === undefined || item.state !== "active") {
        return failure(rendererError("invalid_item_range", "validate_keyed_range", "published keyed-list order references a missing item"));
      }
      const range = collectOwnedRange(scope, item.owner, record.parent, item.start, item.end);
      if (!range.ok) return range;
      item.rangeNodes = range.value;
      for (const node of range.value) {
        if (expected.has(node)) {
          return failure(rendererError("invalid_item_range", "validate_keyed_range", "keyed item ranges overlap"));
        }
        expected.set(node, item);
      }
    }
    let current = record.start.nextSibling;
    while (current !== null && current !== record.end) {
      const item = expected.get(current);
      if (item === undefined) {
        return failure(rendererError("invalid_item_range", "validate_keyed_range", "keyed-list range contains an unexpected node"));
      }
      current = current.nextSibling;
    }
    if (current !== record.end) {
      return failure(rendererError("invalid_item_range", "validate_keyed_range", "keyed-list end anchor is unreachable"));
    }
    let actualCount = 0;
    current = record.start.nextSibling;
    while (current !== null && current !== record.end) {
      actualCount += 1;
      current = current.nextSibling;
    }
    if (actualCount !== expected.size) {
      return failure(rendererError("invalid_item_range", "validate_keyed_range", "keyed-list range membership is inconsistent"));
    }
    return success(undefined);
  } catch (error) {
    return failure(normalizeThrown(error, "invalid_item_range", "validate_keyed_range"));
  }
}

function rangeIsImmediatelyBefore(parent: Node, nodes: readonly Node[], anchor: Node): boolean {
  let current: Node | null = anchor.previousSibling;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (current !== nodes[index]) return false;
    current = current.previousSibling;
  }
  return true;
}

function moveOwnedRange(scope: RootMountScope, parent: Node, item: KeyedItemRecord, anchor: Node): CoreResult<void> {
  try {
    if (!rangeIsImmediatelyBefore(parent, item.rangeNodes, anchor)) {
      for (const node of item.rangeNodes) {
        scope.insertBefore(parent, node, anchor);
      }
    }
    return success(undefined);
  } catch (error) {
    return failure(normalizeThrown(error, "host_mutation_failed", "move_keyed_range"));
  }
}

function snapshotFields(value: unknown): RendererResult<KeyedItemFields> {
  if (!isObject(value) || Array.isArray(value)) {
    return failure(rendererError("invalid_item_schema", "snapshot_keyed_items", "item fields must be an object"));
  }
  const source = value as Record<string, unknown>;
  const copy = Object.create(null) as Record<string, SupportedScalar>;
  for (const name of Object.keys(source)) {
    if (!validIdentifier(name) || !validSupportedScalar(source[name])) {
      return failure(rendererError("invalid_item_schema", "snapshot_keyed_items", `item field ${name} must be a supported scalar`));
    }
    copy[name] = source[name] as SupportedScalar;
  }
  return success(Object.freeze(copy));
}

function snapshotKeyedItems(value: unknown): RendererResult<readonly KeyedItemDescriptor[]> {
  if (!Array.isArray(value)) {
    return failure(rendererError("invalid_item_descriptor", "snapshot_keyed_items", "keyed-list evaluator must return an array"));
  }
  const seen = new Map<StructuralKey, number>();
  const snapshot: KeyedItemDescriptor[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = asRecord(value[index]);
    if (descriptor === undefined || !validStructuralKey(descriptor.key)) {
      return failure(rendererError("invalid_key", "snapshot_keyed_items", `item ${index} has an invalid structural key`));
    }
    if (seen.has(descriptor.key as StructuralKey)) {
      return failure(rendererError("duplicate_key", "snapshot_keyed_items", `structural key ${String(descriptor.key)} is duplicated`));
    }
    const fields = snapshotFields(descriptor.fields);
    if (!fields.ok) return fields;
    seen.set(descriptor.key as StructuralKey, index);
    snapshot.push(Object.freeze({ key: descriptor.key as StructuralKey, fields: fields.value }));
  }
  return success(Object.freeze(snapshot));
}

function fieldKind(value: SupportedScalar): "boolean" | "number" | "string" {
  return typeof value as "boolean" | "number" | "string";
}

function itemSchema(fields: KeyedItemFields): ReadonlyMap<string, "boolean" | "number" | "string"> {
  return new Map(Object.keys(fields).map((name) => [name, fieldKind(fields[name])] as const));
}

function compatibleItemSchema(item: KeyedItemRecord, fields: KeyedItemFields): RendererResult<void> {
  const names = Object.keys(fields);
  if (names.length !== item.schema.size) {
    return failure(rendererError("invalid_item_schema", "validate_retained_item", `retained key ${String(item.key)} changed its field schema`));
  }
  for (const name of names) {
    if (item.schema.get(name) !== fieldKind(fields[name])) {
      return failure(rendererError("invalid_item_schema", "validate_retained_item", `retained key ${String(item.key)} changed field ${name} type`));
    }
  }
  return success(undefined);
}

function trackOwnedNode(scope: RootMountScope, owner: ComponentOwner, parent: Node, node: Node): CoreResult<void> {
  const tracked = owner.trackNode(node);
  if (!tracked.ok) return tracked;
  return owner.trackResource(() => retireOwnedNode(scope, parent, node));
}

function disposeBranch(record: ConditionalRegionRecord): CoreResult<void> {
  const branch = record.activeBranch;
  if (branch === undefined) {
    record.activeRoots = [];
    return success(undefined);
  }
  const disposed = branch.dispose();
  if (!disposed.ok) return disposed;
  const released = record.owner.releaseChild(branch);
  if (!released.ok) return released;
  record.activeBranch = undefined;
  record.activeRoots = [];
  return success(undefined);
}

function mountBranch(
  scope: RootMountScope,
  runtime: ReactiveCore,
  record: ConditionalRegionRecord,
  factory: ConditionalBranchFactory,
  selected: boolean,
): CoreResult<void> {
  const localIdentity = `branch:${record.activation}:${selected ? "true" : "false"}`;
  const child = record.owner.createChild(localIdentity);
  if (!child.ok) return child;
  const owner = child.value;
  let created: RendererResult<ComponentView>;
  try {
    created = factory({ runtime, identity: owner.id });
  } catch (error) {
    created = failure(rendererError("invalid_branch_factory", "mount_branch", error instanceof Error ? error.message : "branch factory threw"));
  }
  if (!isCoreResult(created)) {
    created = failure(rendererError("invalid_branch_factory", "mount_branch", "branch factory returned a malformed result"));
  }
  if (!created.ok) {
    const cleaned = owner.dispose();
    if (cleaned.ok) {
      record.owner.releaseChild(owner);
      return created;
    }
    return failure(rendererError("child_cleanup_failed", "mount_branch", "branch factory failed and cleanup also failed", { cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
  }
  const branchPlan = materializeComponentView(created.value, runtime);
  if (!branchPlan.ok) {
    const cleaned = owner.dispose();
    if (cleaned.ok) {
      record.owner.releaseChild(owner);
      return failure(rendererError("invalid_branch_factory", "mount_branch", "branch factory returned an invalid view plan", { causeCode: branchPlan.error.code, causeOperation: branchPlan.error.operation }));
    }
    return failure(rendererError("child_cleanup_failed", "mount_branch", "branch plan validation failed and cleanup also failed", { cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
  }
  const mounted = executePlan(scope, runtime, branchPlan.value, owner, record.parent, record.end);
  if (!mounted.ok) {
    const cleaned = owner.dispose();
    if (cleaned.ok) {
      record.owner.releaseChild(owner);
      return failure(rendererError("child_mount_failed", "mount_branch", "branch mount failed", { causeCode: mounted.error.code, causeOperation: mounted.error.operation }));
    }
    return failure(rendererError("child_cleanup_failed", "mount_branch", "branch mount failed and cleanup also failed", { causeCode: mounted.error.code, causeOperation: mounted.error.operation, cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
  }
  const published = owner.publish();
  if (!published.ok) {
    const cleaned = owner.dispose();
    if (cleaned.ok) record.owner.releaseChild(owner);
    return cleaned.ok ? published : failure(rendererError("child_cleanup_failed", "mount_branch", "branch publication failed and cleanup also failed", { cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
  }
  record.activeBranch = owner;
  record.activeRoots = mounted.value;
  record.activation += 1;
  return success(undefined);
}

function mountConditional(
  scope: RootMountScope,
  runtime: ReactiveCore,
  parentOwner: ComponentOwner,
  condition: ConditionalRegionPlan,
  parent: Node,
  insertionAnchor: Node | null = null,
): CoreResult<void> {
  const ownerResult = parentOwner.createChild(`region:${condition.id}`);
  if (!ownerResult.ok) return ownerResult;
  const owner = ownerResult.value;
  let start: Comment | undefined;
  let end: Comment | undefined;
  try {
    start = scope.createAnchor();
    end = scope.createAnchor();
    const trackedStart = owner.trackNode(start);
    if (!trackedStart.ok) throw trackedStart.error;
    const trackedEnd = owner.trackNode(end);
    if (!trackedEnd.ok) throw trackedEnd.error;
    const startCleanup = owner.trackResource(() => retireOwnedNode(scope, parent, start!));
    if (!startCleanup.ok) throw startCleanup.error;
    const endCleanup = owner.trackResource(() => retireOwnedNode(scope, parent, end!));
    if (!endCleanup.ok) throw endCleanup.error;
    scope.insertBefore(parent, start, insertionAnchor);
    scope.insertBefore(parent, end, insertionAnchor);
  } catch (error) {
    const cleaned = owner.dispose();
    let firstError: RendererError | undefined = cleaned.ok ? undefined : rendererError("child_cleanup_failed", "mount_conditional", "anchor creation failed and cleanup also failed", { cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation });
    for (const anchor of [start, end]) {
      if (anchor !== undefined && anchor.parentNode === null) {
        try {
          scope.retireNode(anchor);
        } catch (retireError) {
          if (firstError === undefined) firstError = normalizeThrown(retireError, "child_cleanup_failed", "retire_conditional_anchor");
        }
      }
    }
    return firstError === undefined ? failure(normalizeThrown(error, "invalid_anchor", "mount_conditional")) : failure(firstError);
  }
  const record: ConditionalRegionRecord = {
    id: condition.id,
    owner,
    parent,
    start: start!,
    end: end!,
    plan: condition,
    activeSelector: undefined,
    activeBranch: undefined,
    activeRoots: [],
    activation: 0,
    state: "initializing",
  };
  const update = (): CoreResult<unknown> => {
    if (record.state === "disposing" || record.state === "disposed" || record.state === "cleanup_failed") {
      return failure(rendererError("foreign_owner", "update_conditional", `conditional region ${record.id} is not active`));
    }
    let evaluated: RendererResult<boolean>;
    try {
      evaluated = condition.evaluate({ runtime });
    } catch (error) {
      return failure(normalizeThrown(error, "invalid_selector_result", "evaluate_conditional"));
    }
    if (!isCoreResult(evaluated)) return failure(rendererError("invalid_selector_result", "evaluate_conditional", `conditional region ${record.id} evaluator returned a malformed result`));
    if (!evaluated.ok) return evaluated;
    if (typeof evaluated.value !== "boolean") return failure(rendererError("invalid_selector_result", "evaluate_conditional", `conditional region ${record.id} selector must return a boolean`));
    const selected = evaluated.value;
    if (record.activeSelector !== undefined && record.activeSelector === selected) return success(undefined);
    if (record.activeSelector !== undefined) {
      const range = validateRegionRange(scope, record);
      if (!range.ok) {
        record.state = "cleanup_failed";
        return range;
      }
      record.state = "updating";
      const disposed = disposeBranch(record);
      if (!disposed.ok) {
        record.state = "cleanup_failed";
        return disposed;
      }
    }
    const mounted = mountBranch(scope, runtime, record, selected ? condition.whenTrue : condition.whenFalse, selected);
    record.activeSelector = selected;
    if (!mounted.ok) {
      record.state = "empty";
      return mounted;
    }
    record.state = "active";
    return success(undefined);
  };

  const structural = scope.registerStructural({ dependencies: condition.dependencies, key: condition.id, update });
  if (!structural.ok) {
    const cleaned = owner.dispose();
    return cleaned.ok ? structural : failure(rendererError("child_cleanup_failed", "mount_conditional", "structural registration failed and cleanup also failed", { cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
  }
  const structuralCleanup = owner.trackResource(() => scope.disposeStructural(structural.value));
  if (!structuralCleanup.ok) {
    const cleaned = owner.dispose();
    return cleaned.ok ? structuralCleanup : failure(rendererError("child_cleanup_failed", "mount_conditional", "structural ownership failed and cleanup also failed", { cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
  }
  const published = owner.publish();
  if (!published.ok) {
    const cleaned = owner.dispose();
    return cleaned.ok ? published : failure(rendererError("child_cleanup_failed", "mount_conditional", "conditional owner publication failed and cleanup also failed", { cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
  }
  return success(undefined);
}

function cleanupKeyedOwner(
  scope: RootMountScope,
  parentOwner: ComponentOwner,
  owner: ComponentOwner,
  extraNodes: readonly Node[] = [],
): CoreResult<void> {
  const cleaned = owner.dispose();
  let firstError: RendererError | undefined;
  if (!cleaned.ok) firstError = rendererError("item_cleanup_failed", "dispose_keyed_item", "keyed item cleanup failed", { cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation });
  for (const node of extraNodes) {
    if (node.parentNode === null) {
      try {
        scope.retireNode(node);
      } catch (error) {
        if (firstError === undefined) firstError = normalizeThrown(error, "item_cleanup_failed", "retire_keyed_item");
      }
    }
  }
  if (firstError !== undefined) return failure(firstError);
  const released = parentOwner.releaseChild(owner);
  if (!released.ok) return released;
  return success(undefined);
}

function mountKeyedItem(
  scope: RootMountScope,
  runtime: ReactiveCore,
  region: KeyedListRegionRecord,
  descriptor: KeyedItemDescriptor,
): RendererResult<KeyedItemRecord> {
  const activation = region.activation++;
  const identity = `item:${structuralKeyIdentity(descriptor.key)}#${activation}`;
  const child = region.owner.createChild(identity);
  if (!child.ok) return child;
  const owner = child.value;
  let start: Comment | undefined;
  let end: Comment | undefined;
  try {
    start = scope.createAnchor();
    end = scope.createAnchor();
    const trackedStart = owner.trackNode(start);
    if (!trackedStart.ok) throw trackedStart.error;
    const trackedEnd = owner.trackNode(end);
    if (!trackedEnd.ok) throw trackedEnd.error;
    const startCleanup = owner.trackResource(() => retireOwnedNode(scope, region.parent, start!));
    if (!startCleanup.ok) throw startCleanup.error;
    const endCleanup = owner.trackResource(() => retireOwnedNode(scope, region.parent, end!));
    if (!endCleanup.ok) throw endCleanup.error;
    scope.insertBefore(region.parent, start, region.end);
    scope.insertBefore(region.parent, end, region.end);
  } catch (error) {
    const cleaned = cleanupKeyedOwner(scope, region.owner, owner, [start, end].filter((node): node is Comment => node !== undefined));
    return cleaned.ok ? failure(normalizeThrown(error, "invalid_anchor", "mount_keyed_item")) : failure(rendererError("item_cleanup_failed", "mount_keyed_item", "item anchor creation failed and cleanup also failed", { cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
  }

  const fields = new Map<string, SignalHandle<SupportedScalar>>();
  const fieldValues = new Map<string, SupportedScalar>();
  const schema = itemSchema(descriptor.fields);
  for (const name of Object.keys(descriptor.fields)) {
    const created = runtime.createSignal(descriptor.fields[name]);
    if (!created.ok) {
      const cleaned = cleanupKeyedOwner(scope, region.owner, owner);
      return cleaned.ok ? created : failure(rendererError("item_cleanup_failed", "mount_keyed_item", "item signal creation failed and cleanup also failed", { causeCode: created.error.code, causeOperation: created.error.operation, cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
    }
    const tracked = owner.trackResource(() => runtime.disposeSignal(created.value));
    if (!tracked.ok) {
      const cleaned = cleanupKeyedOwner(scope, region.owner, owner);
      return cleaned.ok ? tracked : failure(rendererError("item_cleanup_failed", "mount_keyed_item", "item signal ownership failed and cleanup also failed", { causeCode: tracked.error.code, causeOperation: tracked.error.operation, cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
    }
    fields.set(name, created.value);
    fieldValues.set(name, descriptor.fields[name]);
  }

  const fieldObject = Object.freeze(Object.fromEntries(fields.entries())) as Readonly<Record<string, SignalHandle<SupportedScalar>>>;
  let initialized: RendererResult<ComponentView>;
  try {
    const created = region.plan.createItem({
      runtime,
      identity: owner.id,
      key: descriptor.key,
      data: descriptor.fields,
      fields: fieldObject,
    });
    initialized = isCoreResult(created)
      ? created as RendererResult<ComponentView>
      : failure(rendererError("invalid_item_factory", "mount_keyed_item", "item factory returned a malformed result"));
  } catch (error) {
    initialized = failure(normalizeThrown(error, "invalid_item_factory", "mount_keyed_item"));
  }
  if (!initialized.ok) {
    const cleaned = cleanupKeyedOwner(scope, region.owner, owner);
    return cleaned.ok ? initialized : failure(rendererError("item_cleanup_failed", "mount_keyed_item", "item factory failed and cleanup also failed", { causeCode: initialized.error.code, causeOperation: initialized.error.operation, cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
  }

  const childPlan = materializeComponentView(initialized.value, runtime);
  if (!childPlan.ok) {
    const cleaned = cleanupKeyedOwner(scope, region.owner, owner);
    return cleaned.ok ? failure(rendererError("invalid_item_factory", "mount_keyed_item", "item factory returned an invalid view plan", { causeCode: childPlan.error.code, causeOperation: childPlan.error.operation })) : failure(rendererError("item_cleanup_failed", "mount_keyed_item", "item plan validation failed and cleanup also failed", { causeCode: childPlan.error.code, causeOperation: childPlan.error.operation, cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
  }
  const mounted = executePlan(scope, runtime, childPlan.value, owner, region.parent, end!);
  if (!mounted.ok) {
    const cleaned = cleanupKeyedOwner(scope, region.owner, owner);
    return cleaned.ok ? failure(rendererError("child_mount_failed", "mount_keyed_item", "item mount failed", { causeCode: mounted.error.code, causeOperation: mounted.error.operation })) : failure(rendererError("item_cleanup_failed", "mount_keyed_item", "item mount failed and cleanup also failed", { causeCode: mounted.error.code, causeOperation: mounted.error.operation, cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
  }

  const provisional: KeyedItemRecord = {
    key: descriptor.key,
    identity: owner.id,
    owner,
    parent: region.parent,
    start: start!,
    end: end!,
    fields,
    fieldValues,
    schema,
    activation,
    rangeNodes: [],
    state: "initializing",
  };
  const range = collectOwnedRange(scope, owner, region.parent, provisional.start, provisional.end);
  if (!range.ok) {
    const cleaned = cleanupKeyedOwner(scope, region.owner, owner);
    return cleaned.ok ? range : failure(rendererError("item_cleanup_failed", "mount_keyed_item", "item range validation failed and cleanup also failed", { causeCode: range.error.code, causeOperation: range.error.operation, cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
  }
  provisional.rangeNodes = range.value;
  const published = owner.publish();
  if (!published.ok) {
    const cleaned = cleanupKeyedOwner(scope, region.owner, owner);
    return cleaned.ok ? published : failure(rendererError("item_cleanup_failed", "mount_keyed_item", "item publication failed and cleanup also failed", { causeCode: published.error.code, causeOperation: published.error.operation, cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
  }
  provisional.state = "active";
  return success(provisional);
}

function disposeKeyedItem(scope: RootMountScope, region: KeyedListRegionRecord, item: KeyedItemRecord): CoreResult<void> {
  item.state = "disposing";
  const cleaned = item.owner.dispose();
  if (!cleaned.ok) {
    item.state = "cleanup_failed";
    return failure(rendererError("item_cleanup_failed", "dispose_keyed_item", `keyed item ${String(item.key)} cleanup failed`, { cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
  }
  const released = region.owner.releaseChild(item.owner);
  if (!released.ok) {
    item.state = "cleanup_failed";
    return released;
  }
  item.state = "disposed";
  return success(undefined);
}

function updateRetainedItem(runtime: ReactiveCore, item: KeyedItemRecord, fields: KeyedItemFields): CoreResult<void> {
  const compatible = compatibleItemSchema(item, fields);
  if (!compatible.ok) return compatible;
  for (const name of Object.keys(fields)) {
    const previous = item.fieldValues.get(name);
    const next = fields[name];
    if (previous === next) continue;
    const updated = runtime.set(item.fields.get(name)!, next);
    if (!updated.ok) return updated;
    item.fieldValues.set(name, next);
  }
  return success(undefined);
}

function updateKeyedList(
  scope: RootMountScope,
  runtime: ReactiveCore,
  record: KeyedListRegionRecord,
): CoreResult<unknown> {
  if (record.state === "disposing" || record.state === "disposed" || record.state === "cleanup_failed") {
    return failure(rendererError("foreign_owner", "update_keyed_list", `keyed-list region ${record.id} is not active`));
  }
  let evaluated: RendererResult<readonly KeyedItemDescriptor[]>;
  try {
    evaluated = record.plan.evaluate({ runtime });
  } catch (error) {
    return failure(normalizeThrown(error, "invalid_item_descriptor", "evaluate_keyed_list"));
  }
  if (!isCoreResult(evaluated)) return failure(rendererError("invalid_item_descriptor", "evaluate_keyed_list", `keyed-list region ${record.id} evaluator returned a malformed result`));
  if (!evaluated.ok) return evaluated;
  const snapshot = snapshotKeyedItems(evaluated.value);
  if (!snapshot.ok) return snapshot;

  if (record.state === "active") {
    const currentRange = validateKeyedRange(scope, record);
    if (!currentRange.ok) {
      record.state = "cleanup_failed";
      return currentRange;
    }
  }

  const nextItems = new Map<StructuralKey, KeyedItemRecord>();
  const removed: KeyedItemRecord[] = [];
  const nextKeys = new Set<StructuralKey>(snapshot.value.map((descriptor) => descriptor.key));
  for (const key of record.order) {
    const item = record.items.get(key);
    if (item !== undefined && !nextKeys.has(key)) removed.push(item);
  }
  for (const descriptor of snapshot.value) {
    const existing = record.items.get(descriptor.key);
    if (existing !== undefined) {
      const compatible = compatibleItemSchema(existing, descriptor.fields);
      if (!compatible.ok) return compatible;
    }
  }
  const inserted: KeyedItemRecord[] = [];
  record.state = "updating";
  for (const descriptor of snapshot.value) {
    const existing = record.items.get(descriptor.key);
    if (existing !== undefined) {
      nextItems.set(descriptor.key, existing);
      continue;
    }
    const created = mountKeyedItem(scope, runtime, record, descriptor);
    if (!created.ok) {
      let cleanupError: RendererError | undefined;
      for (let index = inserted.length - 1; index >= 0; index -= 1) {
        const cleaned = disposeKeyedItem(scope, record, inserted[index]);
        if (!cleaned.ok && cleanupError === undefined) cleanupError = cleaned.error;
      }
      record.state = cleanupError === undefined ? "active" : "cleanup_failed";
      return cleanupError === undefined ? created : failure(rendererError("item_cleanup_failed", "update_keyed_list", "new item initialization failed and rollback also failed", { causeCode: created.error.code, causeOperation: created.error.operation, cleanupCode: cleanupError.code, cleanupOperation: cleanupError.operation }));
    }
    inserted.push(created.value);
    nextItems.set(descriptor.key, created.value);
  }

  for (const item of removed) {
    const cleaned = disposeKeyedItem(scope, record, item);
    if (!cleaned.ok) {
      record.state = "cleanup_failed";
      return cleaned;
    }
  }
  for (const descriptor of snapshot.value) {
    const item = nextItems.get(descriptor.key)!;
    if (inserted.includes(item)) continue;
    const updated = updateRetainedItem(runtime, item, descriptor.fields);
    if (!updated.ok) {
      record.state = "cleanup_failed";
      return updated;
    }
  }

  const desiredKeys = snapshot.value.map((descriptor) => descriptor.key);
  const nextAnchor = record.end;
  for (let index = desiredKeys.length - 1; index >= 0; index -= 1) {
    const item = nextItems.get(desiredKeys[index])!;
    const moved = moveOwnedRange(scope, record.parent, item, index === desiredKeys.length - 1 ? nextAnchor : nextItems.get(desiredKeys[index + 1])!.start);
    if (!moved.ok) {
      record.state = "cleanup_failed";
      return moved;
    }
  }

  const verified = validateKeyedRange(scope, record, nextItems, desiredKeys);
  if (!verified.ok) {
    record.state = "cleanup_failed";
    return verified;
  }
  record.items.clear();
  for (const [key, item] of nextItems) record.items.set(key, item);
  record.order = desiredKeys;
  record.state = "active";
  return success(undefined);
}

function mountKeyedList(
  scope: RootMountScope,
  runtime: ReactiveCore,
  parentOwner: ComponentOwner,
  plan: KeyedListPlan,
  parent: Node,
  insertionAnchor: Node | null = null,
): CoreResult<readonly Node[]> {
  const ownerResult = parentOwner.createChild(`keyed:${plan.id}`);
  if (!ownerResult.ok) return ownerResult;
  const owner = ownerResult.value;
  let start: Comment | undefined;
  let end: Comment | undefined;
  try {
    start = scope.createAnchor();
    end = scope.createAnchor();
    const trackedStart = owner.trackNode(start);
    if (!trackedStart.ok) throw trackedStart.error;
    const trackedEnd = owner.trackNode(end);
    if (!trackedEnd.ok) throw trackedEnd.error;
    const startCleanup = owner.trackResource(() => retireOwnedNode(scope, parent, start!));
    if (!startCleanup.ok) throw startCleanup.error;
    const endCleanup = owner.trackResource(() => retireOwnedNode(scope, parent, end!));
    if (!endCleanup.ok) throw endCleanup.error;
    scope.insertBefore(parent, start, insertionAnchor);
    scope.insertBefore(parent, end, insertionAnchor);
  } catch (error) {
    const cleaned = cleanupKeyedOwner(scope, parentOwner, owner, [start, end].filter((node): node is Comment => node !== undefined));
    return cleaned.ok ? failure(normalizeThrown(error, "invalid_anchor", "mount_keyed_list")) : failure(rendererError("item_cleanup_failed", "mount_keyed_list", "keyed-list anchor creation failed and cleanup also failed", { cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
  }

  const record: KeyedListRegionRecord = {
    id: plan.id,
    owner,
    parent,
    start: start!,
    end: end!,
    plan,
    items: new Map(),
    order: [],
    activation: 0,
    state: "initializing",
  };
  const structural = scope.registerStructural({
    dependencies: plan.dependencies,
    key: `keyed:${owner.id}:${plan.id}`,
    update: () => updateKeyedList(scope, runtime, record),
  });
  if (!structural.ok) {
    const cleaned = cleanupKeyedOwner(scope, parentOwner, owner);
    return cleaned.ok ? structural : failure(rendererError("item_cleanup_failed", "mount_keyed_list", "keyed-list registration failed and cleanup also failed", { cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
  }
  const structuralCleanup = owner.trackResource(() => scope.disposeStructural(structural.value));
  if (!structuralCleanup.ok) {
    const cleaned = cleanupKeyedOwner(scope, parentOwner, owner);
    return cleaned.ok ? structuralCleanup : failure(rendererError("item_cleanup_failed", "mount_keyed_list", "keyed-list ownership failed and cleanup also failed", { cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
  }
  const published = owner.publish();
  if (!published.ok) {
    const cleaned = cleanupKeyedOwner(scope, parentOwner, owner);
    return cleaned.ok ? published : failure(rendererError("item_cleanup_failed", "mount_keyed_list", "keyed-list publication failed and cleanup also failed", { cleanupCode: cleaned.error.code, cleanupOperation: cleaned.error.operation }));
  }
  return success([start!, end!]);
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
    } else if (item.condition !== undefined) {
      const mounted = mountConditional(scope, runtime, owner, item.condition, parent);
      if (!mounted.ok) return mounted;
    } else if (item.keyedList !== undefined) {
      const mounted = mountKeyedList(scope, runtime, owner, item.keyedList, parent);
      if (!mounted.ok) return mounted;
    }
  }
  return success(undefined);
}

function executePlan(
  scope: RootMountScope,
  runtime: ReactiveCore,
  plan: PlanValidation,
  owner: ComponentOwner,
  parent: Node = scope.container,
  insertionAnchor: Node | null = null,
): CoreResult<readonly Node[]> {
  const nodes = new Map<string, Node>();
  const roots: Node[] = [];
  try {
    for (const nodePlan of plan.plan.nodes) {
      nodes.set(nodePlan.id, nodePlan.kind === "text" ? scope.createTextNode(nodePlan.text) : scope.createElement(nodePlan.name, nodePlan.namespace));
    }
    for (const nodePlan of plan.plan.nodes) {
      const node = nodes.get(nodePlan.id)!;
      const nodeParent = nodePlan.parentId === undefined ? parent : nodes.get(nodePlan.parentId)!;
      const tracked = trackOwnedNode(scope, owner, nodeParent, node);
      if (!tracked.ok) return tracked;
      if (nodePlan.kind === "element") {
        for (const attribute of nodePlan.attributes ?? []) scope.setAttribute(node, attribute.name, attribute.value, attribute.namespace);
        for (const property of nodePlan.properties ?? []) scope.setProperty(node, property.property, property.value);
      }
    }
    for (const item of orderedItems(plan, undefined)) {
      if (item.node !== undefined) {
        scope.insertBefore(parent, nodes.get(item.node.id)!, insertionAnchor);
        const rootNode = nodes.get(item.node.id)!;
        roots.push(rootNode);
        if (item.node.kind === "element") {
          const nested = executeChildren(scope, runtime, plan, owner, item.node.id, nodes.get(item.node.id)!, nodes);
          if (!nested.ok) return nested;
        }
      } else if (item.component !== undefined) {
        const mounted = mountComponent(scope, runtime, owner, item.component, parent, insertionAnchor);
        if (!mounted.ok) return mounted;
        roots.push(...mounted.value);
      } else if (item.condition !== undefined) {
        const mounted = mountConditional(scope, runtime, owner, item.condition, parent, insertionAnchor);
        if (!mounted.ok) return mounted;
      } else if (item.keyedList !== undefined) {
        const mounted = mountKeyedList(scope, runtime, owner, item.keyedList, parent, insertionAnchor);
        if (!mounted.ok) return mounted;
        roots.push(...mounted.value);
      }
    }
    for (const listener of plan.plan.listeners) {
      const added = scope.addEventListener(nodes.get(listener.targetId)!, listener.type, listener.listener, listener.options);
      if (added) {
        const tracked = owner.trackResource(() => {
          try {
            scope.removeEventListener(nodes.get(listener.targetId)!, listener.type, listener.listener, listener.options);
            return success(undefined);
          } catch (error) {
            if (listener.options !== undefined && typeof listener.options === "object" && listener.options.once === true && normalizeThrown(error, "invalid_listener", "remove_event_listener").code === "invalid_listener") {
              return success(undefined);
            }
            return failure(normalizeThrown(error, "invalid_listener", "remove_event_listener"));
          }
        });
        if (!tracked.ok) return tracked;
      }
    }
    for (const binding of plan.plan.bindings) {
      const registered = scope.registerBinding({ target: nodes.get(binding.targetId)!, dependencies: binding.dependencies, key: binding.slot, update: () => updateBinding(scope, runtime, binding, nodes) });
      if (!registered.ok) return registered;
      const owned = owner.trackBinding(registered.value, () => scope.disposeBinding(registered.value));
      if (!owned.ok) {
        scope.disposeBinding(registered.value);
        return owned;
      }
    }
    return success(roots);
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

function mountComponent(
  scope: RootMountScope,
  runtime: ReactiveCore,
  parentOwner: ComponentOwner,
  placement: ComponentPlacementPlan,
  parent: Node,
  insertionAnchor: Node | null = null,
): CoreResult<readonly Node[]> {
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
  const mounted = executePlan(scope, runtime, childPlan.value, owner, parent, insertionAnchor);
  if (!mounted.ok) {
    const cleaned = owner.dispose();
    return cleaned.ok ? failure(componentFailure("child_mount_failed", `component ${placement.id} mount failed`, mounted.error)) : failure(componentFailure("child_cleanup_failed", `component ${placement.id} mount failed and cleanup failed`, cleaned.error));
  }
  const published = owner.publish();
  if (!published.ok) {
    const cleaned = owner.dispose();
    return cleaned.ok ? published : failure(componentFailure("child_cleanup_failed", `component ${placement.id} publication failed and cleanup failed`, cleaned.error));
  }
  return success(mounted.value);
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
