import { hostError, DomHostError, type DomHostErrorCode } from "./errors.js";

export const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

type OwnedNodeKind = "container" | "created";
type ListenerOptions = boolean | AddEventListenerOptions | undefined;

interface NodeRecord {
  readonly context: HostContext;
  readonly node: Node;
  readonly kind: OwnedNodeKind;
  readonly removable: boolean;
  inserted: boolean;
  detached: boolean;
}

interface ListenerRecord {
  readonly context: HostContext;
  readonly target: Element;
  readonly type: string;
  readonly listener: EventListener;
  readonly wrapped: EventListener;
  readonly options: ListenerOptions;
  readonly capture: boolean;
  readonly once: boolean;
}

interface HostState {
  readonly document: Document;
  readonly nodes: Set<NodeRecord>;
  readonly listeners: Set<ListenerRecord>;
  disposed: boolean;
}

/**
 * Internal DOM host operations. This type is intentionally not re-exported
 * from the package entry point; a future renderer will own this boundary.
 */
export interface HostContext {
  claimContainer(container: Element | DocumentFragment): void;
  assertOwned(node: Node): void;
  createElement(name: string, namespace?: string): Element;
  createTextNode(text: string): Text;
  insertBefore(parent: Node, child: Node, anchor?: Node | null): void;
  appendChild(parent: Node, child: Node): void;
  removeChild(parent: Node, child: Node): void;
  setText(textNode: Node, value: string): boolean;
  setAttribute(element: Node, name: string, value: string, namespace?: string): boolean;
  removeAttribute(element: Node, name: string, namespace?: string): boolean;
  setProperty(element: Node, property: string, value: string | boolean): boolean;
  addEventListener(
    element: Node,
    type: string,
    listener: EventListener,
    options?: ListenerOptions,
  ): boolean;
  removeEventListener(
    element: Node,
    type: string,
    listener: EventListener,
    options?: ListenerOptions,
  ): void;
  dispose(): void;
}

// This module-private registry is the ownership boundary. A context cannot
// mistake an unknown node for one that it owns, even when two contexts use
// identical DOM shapes.
const NODE_OWNERS = new WeakMap<Node, NodeRecord>();

const ATTRIBUTE_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const EVENT_TYPE = /^\S+$/;

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function nodeType(node: Node): number {
  return node.nodeType;
}

function isElement(node: Node): node is Element {
  return nodeType(node) === Node.ELEMENT_NODE;
}

function isText(node: Node): node is Text {
  return nodeType(node) === Node.TEXT_NODE;
}

function isContainer(node: Node): boolean {
  return (
    nodeType(node) === Node.ELEMENT_NODE ||
    nodeType(node) === Node.DOCUMENT_FRAGMENT_NODE
  );
}

function isInsertableChild(node: Node): boolean {
  return nodeType(node) === Node.ELEMENT_NODE || nodeType(node) === Node.TEXT_NODE;
}

function tagName(element: Element): string {
  return element.tagName.toLowerCase();
}

function isSameCapture(left: ListenerOptions, right: ListenerOptions): boolean {
  const leftCapture = typeof left === "boolean" ? left : left?.capture === true;
  const rightCapture = typeof right === "boolean" ? right : right?.capture === true;
  return leftCapture === rightCapture;
}

function listenerCapture(options: ListenerOptions): boolean {
  return typeof options === "boolean" ? options : options?.capture === true;
}

function listenerOnce(options: ListenerOptions): boolean {
  return typeof options === "object" && options !== null && options.once === true;
}

function validateListenerOptions(options: ListenerOptions, operation: string): void {
  if (typeof options !== "object" || options === null) {
    return;
  }
  // AbortSignal removal happens outside the host registry. Rejecting it keeps
  // listener ownership deterministic until a future signal-aware contract is
  // approved.
  if (options.signal !== undefined) {
    throw hostError(
      "invalid_listener_options",
      operation,
      "AbortSignal options are not supported by the internal host",
    );
  }
}

function validateEventType(type: string, operation: string): void {
  if (typeof type !== "string" || !EVENT_TYPE.test(type)) {
    throw hostError("invalid_listener", operation, "event type must be non-empty");
  }
}

function validateAttributeName(name: string, operation: string): void {
  if (typeof name !== "string" || !ATTRIBUTE_NAME.test(name)) {
    throw hostError("invalid_attribute", operation, `invalid attribute name ${String(name)}`);
  }
}

function validateNamespace(namespace: string | undefined, operation: string): void {
  if (namespace !== undefined && namespace !== HTML_NAMESPACE) {
    throw hostError(
      "unsupported_namespace",
      operation,
      `namespace ${String(namespace)} is not supported`,
    );
  }
}

function validateNodeDocument(document: Document, node: Node, operation: string): void {
  if (node.ownerDocument !== document) {
    throw hostError("foreign_document", operation, "node belongs to another document");
  }
}

function nodeDepth(node: Node): number {
  let depth = 0;
  let current = node.parentNode;
  while (current !== null) {
    depth += 1;
    current = current.parentNode;
  }
  return depth;
}

function hasForeignChildren(node: Node, context: HostContext): boolean {
  for (const child of Array.from(node.childNodes)) {
    const record = NODE_OWNERS.get(child);
    if (record === undefined || record.context !== context) {
      return true;
    }
  }
  return false;
}

function markInsertedSubtree(node: Node, context: HostContext): void {
  const record = NODE_OWNERS.get(node);
  if (record !== undefined && record.context === context) {
    record.inserted = true;
    record.detached = false;
  }
  for (const child of Array.from(node.childNodes)) {
    markInsertedSubtree(child, context);
  }
}

function markDetachedSubtree(node: Node, context: HostContext): void {
  const record = NODE_OWNERS.get(node);
  if (record !== undefined && record.context === context) {
    record.inserted = true;
    record.detached = true;
  }
  for (const child of Array.from(node.childNodes)) {
    markDetachedSubtree(child, context);
  }
}

export function createHostContext(document: Document): HostContext {
  if (
    !isObject(document) ||
    typeof document.createElement !== "function" ||
    typeof document.createTextNode !== "function"
  ) {
    throw hostError("invalid_node", "create_host_context", "a DOM Document is required");
  }

  let context!: HostContext;
  const state: HostState = {
    document,
    nodes: new Set<NodeRecord>(),
    listeners: new Set<ListenerRecord>(),
    disposed: false,
  };

  function active(operation: string): void {
    if (state.disposed) {
      throw hostError("disposed_context", operation, "host context is disposed");
    }
  }

  function owned(node: Node, operation: string): NodeRecord {
    active(operation);
    if (!isObject(node)) {
      throw hostError("invalid_node", operation, "a DOM node is required");
    }
    const record = NODE_OWNERS.get(node);
    if (record === undefined) {
      throw hostError("invalid_node", operation, "node is not managed by a host context");
    }
    if (record.context !== context) {
      throw hostError("foreign_node", operation, "node belongs to another host context");
    }
    if (record.detached) {
      throw hostError("detached_node", operation, "node was detached or removed");
    }

    if (record.kind === "created" && record.inserted) {
      let top = node;
      while (true) {
        const topRecord = NODE_OWNERS.get(top);
        if (topRecord?.context === context && topRecord.kind === "container") {
          break;
        }

        const parent = top.parentNode;
        if (parent === null) {
          markDetachedSubtree(top, context);
          throw hostError(
            "detached_node",
            operation,
            "created node is no longer inside a claimed host container",
          );
        }
        const parentRecord = NODE_OWNERS.get(parent);
        if (parentRecord?.context !== context) {
          markDetachedSubtree(top, context);
          throw hostError(
            "detached_node",
            operation,
            "created node is no longer inside its owning host context",
          );
        }
        top = parent;
      }
    }
    return record;
  }

  function ownedElement(node: Node, operation: string): NodeRecord & { node: Element } {
    const record = owned(node, operation);
    if (!isElement(record.node)) {
      throw hostError("invalid_node", operation, "an Element is required");
    }
    return record as NodeRecord & { node: Element };
  }

  function ownedText(node: Node, operation: string): NodeRecord & { node: Text } {
    const record = owned(node, operation);
    if (!isText(record.node)) {
      throw hostError("invalid_node", operation, "a Text node is required");
    }
    return record as NodeRecord & { node: Text };
  }

  function registerNode(node: Node, kind: OwnedNodeKind, removable: boolean): void {
    NODE_OWNERS.set(node, {
      context,
      node,
      kind,
      removable,
      inserted: false,
      detached: false,
    });
    state.nodes.add(NODE_OWNERS.get(node)!);
  }

  function claimContainer(container: Element | DocumentFragment): void {
    active("claim_container");
    validateNodeDocument(document, container, "claim_container");
    if (!isContainer(container)) {
      throw hostError("invalid_node", "claim_container", "an Element or DocumentFragment is required");
    }
    const existing = NODE_OWNERS.get(container);
    if (existing !== undefined) {
      if (existing.context !== context) {
        throw hostError("foreign_node", "claim_container", "container belongs to another host context");
      }
      return;
    }
    registerNode(container, "container", false);
  }

  function assertOwned(node: Node): void {
    owned(node, "assert_owned");
  }

  function createElement(name: string, namespace?: string): Element {
    active("create_element");
    validateNamespace(namespace, "create_element");
    if (typeof name !== "string" || name.length === 0 || /\s/.test(name)) {
      throw hostError("invalid_element_name", "create_element", `invalid element name ${String(name)}`);
    }

    let element: Element;
    try {
      element = namespace === undefined
        ? document.createElement(name)
        : document.createElementNS(namespace, name);
    } catch (error) {
      throw new DomHostError(
        "invalid_element_name",
        "create_element",
        error instanceof Error ? error.message : "browser rejected element name",
      );
    }
    registerNode(element, "created", true);
    return element;
  }

  function createTextNode(text: string): Text {
    active("create_text_node");
    if (typeof text !== "string") {
      throw hostError("invalid_node", "create_text_node", "text must be a string");
    }
    const node = document.createTextNode(text);
    registerNode(node, "created", true);
    return node;
  }

  function insertBefore(parent: Node, child: Node, anchor: Node | null = null): void {
    const parentRecord = owned(parent, "insert_before");
    if (!isContainer(parentRecord.node)) {
      throw hostError("invalid_parent", "insert_before", "parent cannot contain child nodes");
    }
    const childRecord = owned(child, "insert_before");
    if (!isInsertableChild(childRecord.node)) {
      throw hostError("invalid_parent_child", "insert_before", "only owned elements and text nodes may be inserted");
    }
    if (childRecord.node === parentRecord.node) {
      throw hostError("invalid_parent_child", "insert_before", "a node cannot contain itself");
    }

    if (anchor !== null) {
      const anchorRecord = owned(anchor, "insert_before");
      if (anchorRecord.node === childRecord.node || anchorRecord.node.parentNode !== parentRecord.node) {
        throw hostError("invalid_insertion_anchor", "insert_before", "anchor is not a child of parent");
      }
    }

    const currentParent = childRecord.node.parentNode;
    if (currentParent !== null && currentParent !== parentRecord.node) {
      const currentParentRecord = NODE_OWNERS.get(currentParent);
      if (currentParentRecord?.context !== context) {
        childRecord.detached = true;
        throw hostError("foreign_node", "insert_before", "child is attached outside its owning context");
      }
    }

    try {
      parentRecord.node.insertBefore(childRecord.node, anchor);
    } catch (error) {
      throw new DomHostError(
        "invalid_parent_child",
        "insert_before",
        error instanceof Error ? error.message : "browser rejected node insertion",
      );
    }
    markInsertedSubtree(childRecord.node, context);
  }

  function appendChild(parent: Node, child: Node): void {
    insertBefore(parent, child, null);
  }

  function removeChild(parent: Node, child: Node): void {
    const parentRecord = owned(parent, "remove_child");
    if (!isContainer(parentRecord.node)) {
      throw hostError("invalid_parent", "remove_child", "parent cannot contain child nodes");
    }
    const childRecord = owned(child, "remove_child");
    if (childRecord.node.parentNode === null) {
      childRecord.detached = true;
      throw hostError("detached_node", "remove_child", "child is already detached");
    }
    if (childRecord.node.parentNode !== parentRecord.node) {
      throw hostError("invalid_parent_child", "remove_child", "child does not belong to parent");
    }
    try {
      parentRecord.node.removeChild(childRecord.node);
    } catch (error) {
      throw new DomHostError(
        "invalid_parent_child",
        "remove_child",
        error instanceof Error ? error.message : "browser rejected node removal",
      );
    }
    markDetachedSubtree(childRecord.node, context);
  }

  function setText(textNode: Node, value: string): boolean {
    const record = ownedText(textNode, "set_text");
    if (typeof value !== "string") {
      throw hostError("invalid_node", "set_text", "text value must be a string");
    }
    if (record.node.nodeValue === value) {
      return false;
    }
    record.node.nodeValue = value;
    return true;
  }

  function setAttribute(element: Node, name: string, value: string, namespace?: string): boolean {
    const record = ownedElement(element, "set_attribute");
    validateNamespace(namespace, "set_attribute");
    validateAttributeName(name, "set_attribute");
    if (typeof value !== "string") {
      throw hostError("invalid_attribute_value", "set_attribute", "attribute value must be a string");
    }
    const current = namespace === undefined
      ? record.node.getAttribute(name)
      : record.node.getAttributeNS(namespace, name);
    if (current === value) {
      return false;
    }
    try {
      if (namespace === undefined) {
        record.node.setAttribute(name, value);
      } else {
        record.node.setAttributeNS(namespace, name, value);
      }
    } catch (error) {
      throw new DomHostError(
        "invalid_attribute",
        "set_attribute",
        error instanceof Error ? error.message : "browser rejected attribute",
      );
    }
    return true;
  }

  function removeAttribute(element: Node, name: string, namespace?: string): boolean {
    const record = ownedElement(element, "remove_attribute");
    validateNamespace(namespace, "remove_attribute");
    validateAttributeName(name, "remove_attribute");
    const present = namespace === undefined
      ? record.node.hasAttribute(name)
      : record.node.hasAttributeNS(namespace, name);
    if (!present) {
      return false;
    }
    if (namespace === undefined) {
      record.node.removeAttribute(name);
    } else {
      record.node.removeAttributeNS(namespace, name);
    }
    return true;
  }

  function setProperty(element: Node, property: string, value: string | boolean): boolean {
    const record = ownedElement(element, "set_property");
    const name = tagName(record.node);

    if (property === "value") {
      if (!(name === "input" || name === "textarea" || name === "select")) {
        throw hostError("invalid_property", "set_property", "value is not supported on this element");
      }
      if (typeof value !== "string") {
        throw hostError("invalid_property_value", "set_property", "value must be a string");
      }
      const target = record.node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (target.value === value) {
        return false;
      }
      target.value = value;
      return true;
    }

    if (property === "checked") {
      if (name !== "input") {
        throw hostError("invalid_property", "set_property", "checked is only supported on input");
      }
      if (typeof value !== "boolean") {
        throw hostError("invalid_property_value", "set_property", "checked must be boolean");
      }
      const target = record.node as HTMLInputElement;
      if (target.checked === value) {
        return false;
      }
      target.checked = value;
      return true;
    }

    if (property === "disabled") {
      if (!(name === "button" || name === "fieldset" || name === "input" ||
        name === "optgroup" || name === "option" || name === "select" || name === "textarea")) {
        throw hostError("invalid_property", "set_property", "disabled is not supported on this element");
      }
      if (typeof value !== "boolean") {
        throw hostError("invalid_property_value", "set_property", "disabled must be boolean");
      }
      const target = record.node as HTMLButtonElement | HTMLFieldSetElement |
        HTMLInputElement | HTMLOptGroupElement | HTMLOptionElement |
        HTMLSelectElement | HTMLTextAreaElement;
      if (target.disabled === value) {
        return false;
      }
      target.disabled = value;
      return true;
    }

    throw hostError("invalid_property", "set_property", `property ${property} is not supported`);
  }

  function addEventListener(
    element: Node,
    type: string,
    listener: EventListener,
    options?: ListenerOptions,
  ): boolean {
    const record = ownedElement(element, "add_event_listener");
    validateEventType(type, "add_event_listener");
    validateListenerOptions(options, "add_event_listener");
    if (typeof listener !== "function") {
      throw hostError("invalid_listener", "add_event_listener", "listener must be a function");
    }
    const capture = listenerCapture(options);
    for (const existing of state.listeners) {
      if (existing.target === record.node && existing.type === type &&
        existing.listener === listener && existing.capture === capture) {
        return false;
      }
    }

    let registered!: ListenerRecord;
    const wrapped: EventListener = (event) => {
      if (state.disposed) {
        return;
      }
      if (registered.once) {
        state.listeners.delete(registered);
      }
      listener.call(record.node, event);
    };
    registered = {
      context,
      target: record.node,
      type,
      listener,
      wrapped,
      options,
      capture,
      once: listenerOnce(options),
    };
    try {
      record.node.addEventListener(type, wrapped, options);
    } catch (error) {
      throw new DomHostError(
        "invalid_listener",
        "add_event_listener",
        error instanceof Error ? error.message : "browser rejected listener",
      );
    }
    state.listeners.add(registered);
    return true;
  }

  function removeEventListener(
    element: Node,
    type: string,
    listener: EventListener,
    options?: ListenerOptions,
  ): void {
    const record = ownedElement(element, "remove_event_listener");
    validateEventType(type, "remove_event_listener");
    validateListenerOptions(options, "remove_event_listener");
    if (typeof listener !== "function") {
      throw hostError("invalid_listener", "remove_event_listener", "listener must be a function");
    }
    const registered = Array.from(state.listeners).find((candidate) =>
      candidate.target === record.node && candidate.type === type &&
      candidate.listener === listener && isSameCapture(candidate.options, options));
    if (registered === undefined) {
      throw hostError("invalid_listener", "remove_event_listener", "listener was not registered");
    }
    record.node.removeEventListener(type, registered.wrapped, registered.options);
    state.listeners.delete(registered);
  }

  function cleanupNode(record: NodeRecord): void {
    if (record.removable && record.node.parentNode !== null) {
      const parentRecord = NODE_OWNERS.get(record.node.parentNode);
      if (parentRecord?.context === context && !hasForeignChildren(record.node, context)) {
        try {
          record.node.parentNode.removeChild(record.node);
        } catch {
          // Cleanup never removes an unrelated subtree after the browser has
          // changed the relationship. The ownership record is still invalidated.
        }
      }
    }
    if (NODE_OWNERS.get(record.node) === record) {
      NODE_OWNERS.delete(record.node);
    }
    state.nodes.delete(record);
  }

  function dispose(): void {
    active("dispose");
    state.disposed = true;

    for (const listener of Array.from(state.listeners)) {
      try {
        listener.target.removeEventListener(listener.type, listener.wrapped, listener.options);
      } finally {
        state.listeners.delete(listener);
      }
    }

    const records = Array.from(state.nodes)
      .filter((record) => record.removable)
      .sort((left, right) => nodeDepth(right.node) - nodeDepth(left.node));
    for (const record of records) {
      cleanupNode(record);
    }
    for (const record of Array.from(state.nodes)) {
      if (NODE_OWNERS.get(record.node) === record) {
        NODE_OWNERS.delete(record.node);
      }
      state.nodes.delete(record);
    }
  }

  context = {
    claimContainer,
    assertOwned,
    createElement,
    createTextNode,
    insertBefore,
    appendChild,
    removeChild,
    setText,
    setAttribute,
    removeAttribute,
    setProperty,
    addEventListener,
    removeEventListener,
    dispose,
  };
  return context;
}

export { DomHostError, type DomHostErrorCode } from "./errors.js";
