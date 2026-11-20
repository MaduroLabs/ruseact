# M3.1 DOM renderer architecture design

Status: design-only proposal, pending human architecture approval.

This document defines a possible first DOM renderer for Ruseact. It is a
boundary document for a later implementation milestone; it does not add DOM
operations, computation execution, automatic dependency tracking, scheduling,
JSX compilation, or a public renderer API.

The proposal is intentionally based on the APIs that exist in M2. Ruseact is
an experimental React-inspired framework, not a React implementation. It does
not use React Fiber, and this document makes no performance or React API
compatibility claim.

## 1. Goals and non-goals

### Goals

The first renderer should provide:

- deterministic creation, insertion, update, and removal of browser DOM nodes;
- fine-grained updates for explicitly registered dynamic bindings;
- explicit ownership of roots, nodes, event listeners, subscriptions, and
  computation handles;
- predictable mount, update, flush, unmount, and disposal behavior;
- a small host-operation surface that can be tested in a real browser;
- an integration point for future compiler-emitted templates and binding
  metadata;
- clear separation between Rust graph state, the WASM bridge, TypeScript
  runtime ownership, and browser DOM objects;
- failure behavior that prevents stale reactive work from mutating detached
  nodes; and
- measurements that can distinguish reactive-graph work, bridge work, and DOM
  mutation work once an implementation exists.

### Non-goals

M3.1 does not:

- implement `packages/ruseact-dom`;
- add or change RustReactiveCore, the WASM ABI, or the public M2 runtime;
- execute computation callbacks or treat computation metadata as a callback;
- infer dependencies from signal reads;
- add an automatic scheduler, priority system, concurrent rendering, or
  effect queue;
- implement a virtual DOM, React Fiber, React Hooks, hydration, server
  rendering, or React component compatibility;
- define a complete JSX grammar or compiler implementation;
- add example applications to this repository; or
- claim that fine-grained updates are faster than another framework.

The first implementation milestone after this design must obtain explicit
approval for any choice that changes these boundaries.

## 2. Existing M2 capabilities

### RustReactiveCore

`crates/ruseact-core` currently provides a platform-independent graph with:

- typed, graph-owned signal storage;
- graph-scoped generational signal and computation identities;
- equality-aware signal writes;
- explicit computation metadata registration;
- bidirectional signal-to-computation dependency edges;
- idempotent subscribe and unsubscribe operations;
- atomic dependency replacement with duplicate removal;
- deterministic dirty propagation and FIFO pending computation IDs;
- queue deduplication while a computation is dirty;
- explicit nested batch boundaries; and
- explicit signal and computation disposal with stale-identity rejection.

The core does not own DOM nodes, JavaScript closures, component trees, or
browser scheduling. A computation is metadata plus an identity. It has no
body, callback, or execution method.

### Rust/WASM bridge

`crates/ruseact-wasm` owns one `ReactiveGraph` per `WasmCore` instance and
validates opaque handles using instance, graph, resource, slot, and generation
metadata. It exposes scalar signal operations, metadata computation
operations, dependency operations, batching, disposal, computation identity
lookup, and copied pending `(slot, generation)` pairs.

The bridge does not accept JavaScript callbacks, retain DOM references, invoke
computation bodies, or schedule work. Pending transfer is an identity
notification, not an instruction to execute a render function.

### TypeScript runtime

`packages/ruseact` exposes `createReactiveCore(loadWasm)` and a synchronous
`ReactiveCore` after initialization. Its current operations are:

| Capability | Current boundary | Renderer implication |
| --- | --- | --- |
| Signal creation/read/write | `createSignal`, `get`, `set` | A binding can explicitly read and write scalar state. |
| Signal disposal | `disposeSignal` | The owner must know whether a signal is renderer-owned or borrowed. |
| Computation identity | `createComputation` | A renderer can create an opaque identity for a binding. |
| Dependency edges | `subscribe`, `unsubscribe`, `replaceDependencies` | Dependencies must be registered explicitly. |
| Dirty work | `drainPendingComputations` | JavaScript can map pending handles to binding records. |
| Batching | `beginBatch`, `endBatch` | Writes can be grouped, but no callback is executed automatically. |
| Runtime lifecycle | `dispose` | A root must not dispose a borrowed runtime implicitly. |
| Validation | `CoreResult` and instance-owned handles | Detached or foreign resources can fail closed. |

The TypeScript registry returns the same opaque `ComputationHandle` object that
was created for a live computation. This makes a JavaScript `Map` keyed by the
handle a possible binding lookup without forging numeric WASM handles. The
registry is not a scheduler and the handle is not a callback.

### Browser harness

M2.4 proves that the generated web bindings can be initialized by the current
TypeScript runtime in real Chromium on the hosted Ubuntu runner. The harness
currently verifies signals, dependencies, batching, pending identity mapping,
instance isolation, errors, stale handles, and disposal. It does not render
DOM. The M3.2 browser tests should extend this architecture rather than
replace it or assume that InstaBox's loopback Chromium limitation is absent.

## 3. Missing execution and lifecycle capabilities

The following capabilities are required before a useful renderer exists:

1. A JavaScript-side binding record containing an update function or a
   compiler-emitted update plan.
2. An explicit association between that binding and a runtime computation
   handle.
3. A defined flush boundary that drains pending identities and invokes only
   live binding records in deterministic order.
4. A way to create and dispose DOM nodes and event listeners under one root
   owner.
5. Explicit dependency registration for the first implementation.
6. A later decision for automatic dependency tracking when component or
   compiler execution needs dynamic dependencies.
7. Error and reentrancy behavior when a binding update writes another signal.
8. A component/view representation that can preserve node identity across
   updates and keyed list changes.

M3.1 does not fill these gaps in runtime code. It specifies contracts and
  the implementation boundaries for the later M3.2 host and M3.3 binding
  milestones.

## 4. Responsibility boundaries

The following ownership split is proposed:

| Layer | Owns | Must not own |
| --- | --- | --- |
| RustReactiveCore | Signal values, graph identities, dependency metadata, dirty bits, FIFO pending IDs, explicit batch state | DOM objects, JS callbacks, components, browser scheduling |
| Rust/WASM bridge | Handle validation, ABI conversion, graph instance lifecycle, copied pending transfer, structured bridge errors | DOM nodes, callback invocation, arbitrary JS object storage |
| TypeScript runtime | Public opaque handles, per-instance registries, scalar/result validation, bridge initialization, explicit resource release | DOM tree structure, event listener identity, automatic scheduling unless separately approved |
| DOM renderer | Root and node ownership, host calls, binding records, event listeners, explicit flush/update execution, subtree cleanup | Reactive graph storage, forged handles, hidden second reactive engine |
| Future compiler | Static template plans, binding locations, explicit dependency metadata, stable component/list structure where specified | Rust graph implementation, browser DOM calls at compile time |
| Browser | Actual DOM tree and event dispatch | Ruseact ownership decisions |

Rust may eventually produce compact mutation intents if a later milestone
justifies that boundary, but M3.1 does not select or implement a Rust mutation
protocol. The initial renderer should keep DOM references and JavaScript
callbacks in JavaScript, consistent with the WASM bridge contract.

## 5. Rendering model alternatives

The alternatives below are architectural choices, not measured performance
results.

### A. Virtual DOM reconciliation

Each render produces a tree description. The renderer compares the new tree
with the previous tree and applies a DOM patch.

**Advantages**

- familiar component-level mental model;
- a single representation can express arbitrary structural changes;
- a dynamic fallback does not require compiler support; and
- testing can compare tree descriptions before touching the DOM.

**Costs and risks**

- every update may execute and compare more tree structure than the changed
  signal requires;
- node identity, keyed lists, event replacement, and component ownership still
  require explicit rules;
- it introduces a second tree and diff lifecycle in addition to the Rust
  dependency graph;
- it does not solve computation execution or dependency tracking by itself;
- large tree diffs can hide which DOM operations actually occurred; and
- a Fiber-like implementation must not be smuggled in as an optimization.

This is viable as a later fallback, but it is not the smallest first consumer
of the M2 dirty-identity API.

### B. Fine-grained DOM bindings

The renderer creates the static DOM structure once. Each dynamic text,
attribute, property, or event slot has a binding record and an explicit set of
signal dependencies. A dirty computation identity selects only that binding.

**Advantages**

- maps directly to the existing dirty computation identity and pending queue;
- can update one text node or property without rebuilding an ancestor tree;
- makes DOM mutation counts observable and testable;
- keeps node references and callbacks in JavaScript; and
- does not require a general-purpose diff for simple updates.

**Costs and risks**

- dynamic structure needs anchors, explicit insertion/removal rules, or a
  fallback representation;
- binding cleanup and dependency replacement are more visible responsibilities;
- manual dependency registration is awkward for arbitrary component code;
- compiler-emitted metadata becomes important for compact and stable plans; and
- binding order and reentrancy must be specified rather than inferred.

This model is the closest match to the current M2 architecture, provided that
the first version remains explicit and does not pretend to have automatic
tracking.

### C. Compiler-assisted static templates with dynamic bindings

The compiler emits a static DOM creation plan plus binding slots. Static
elements and text are created once; dynamic slots carry target-node identity,
operation kind, and explicit dependency/binding metadata.

**Advantages**

- reduces repeated runtime tree construction for known templates;
- provides stable locations for targeted updates;
- can keep dynamic work close to the signal that invalidated it;
- fits the separate `packages/ruseact` compiler boundary; and
- leaves DOM ownership in `packages/ruseact-dom`.

**Costs and risks**

- requires a compiler contract before arbitrary JSX can be supported;
- compiler output becomes part of the renderer ABI and needs versioning;
- dynamic expressions and conditionals need explicit anchors and ownership;
- source-level debugging may be less direct; and
- a compiler must not invent automatic tracking semantics without approval.

This is a strong primary representation for static and mostly-static views,
but it cannot be the only representation until compiler and dynamic fallback
contracts exist.

### D. Hybrid model

Use compiler-assisted static templates and fine-grained binding slots as the
primary path. Provide an explicit runtime view/binding descriptor fallback for
cases that cannot yet be compiled. Use a localized structural representation
for conditionals and keyed lists rather than a global virtual DOM by default.

**Advantages**

- uses the M2 identity queue for targeted updates;
- supports future compiler output without blocking a hand-authored first
  implementation;
- keeps static DOM creation separate from dynamic updates;
- allows the fallback to be tested and replaced independently; and
- avoids committing Ruseact to a global reconciliation algorithm before
  workloads justify one.

**Costs and risks**

- two view representations need equivalent lifecycle and ownership semantics;
- compiler and runtime plans must agree on node identity and cleanup;
- keyed structural updates are still an unresolved algorithmic area; and
- performance must be measured end-to-end rather than inferred from fewer
  theoretical operations.

## 6. Recommended rendering strategy

The recommended direction, pending human approval, is **D: a hybrid whose
primary path is compiler-assisted static templates with fine-grained DOM
bindings**. The first implementation should begin with a small explicit
binding descriptor that can be produced by hand or by a future compiler. It
should not begin with a general virtual DOM or a scheduler.

The recommendation follows from the actual architecture:

1. M2 already reports a deterministic pending `ComputationHandle`, so a
   JavaScript binding map can be selected without numeric handle construction.
2. The DOM and event objects are already assigned to JavaScript by the ABI
   design.
3. The graph currently represents invalidation metadata, not render trees or
   executable functions.
4. Static template creation and targeted update operations have different
   lifecycles and should remain observable separately.
5. A fallback descriptor gives M3.2 a testable path while compiler work is
   still deferred.

This is a proposed architecture, not an approved public API. Human review is
required for the view representation, dynamic dependency semantics, flush
behavior, keyed list algorithm, and compiler output contract before M3.2
implementation begins.

## 7. DOM host operation contracts

The host adapter should expose a deliberately small internal operation set.
Names below are conceptual and are not yet public signatures.

| Operation | Contract | Ownership and failure behavior |
| --- | --- | --- |
| `createElement(name, namespace?)` | Create an element using `document.createElement` or `createElementNS`. Names are validated by the host adapter. | The current renderer root owns the returned node. Unsupported namespace/name errors are reported; no fallback to HTML is silent. |
| `createTextNode(text)` | Create a text node from a string. | Text is escaped by the DOM API; HTML is never interpreted. The root owns the node. |
| `insertBefore(parent, child, anchor?)` | Insert an owned child before an owned anchor, or append when anchor is null. | Parent, child, and anchor must be compatible with the same root. Invalid ownership or anchor state is an error. |
| `appendChild(parent, child)` | Equivalent to `insertBefore(parent, child, null)`. | The operation is explicit and deterministic; it must not move a node owned by another root. |
| `removeChild(parent, child)` | Remove a child that the renderer inserted or currently owns. | A missing or externally moved child is reported as a detached-node condition; cleanup still invalidates its bindings. |
| `setText(textNode, text)` | Set `nodeValue` or text content on a text-node binding. | Only text targets are accepted. The text is not parsed as markup. |
| `setAttribute(element, name, value, namespace?)` | Set a string attribute, with namespace-aware handling when specified. | Attribute names and namespace mapping are validated. Property semantics are never substituted silently. |
| `removeAttribute(element, name, namespace?)` | Remove an attribute previously owned by the binding. | Removing a missing attribute is idempotent; wrong-root targets fail. |
| `setProperty(element, name, value)` | Assign a DOM property for explicitly supported property names. | Properties are distinct from attributes. The initial design should define an allowlist or generated property metadata rather than accept arbitrary names without review. |
| `addEventListener(element, type, listener, options?)` | Register one renderer-owned listener record. | Listener identity is stored by the renderer. The callback remains in JavaScript and is never passed to Rust. |
| `removeEventListener(element, type, listener, options?)` | Remove the exact listener record registered by the renderer. | Replacement and unmount must use the same function/options identity; cleanup is idempotent. |

The host adapter should avoid `innerHTML` for ordinary text or dynamic values.
Raw HTML, if ever supported, requires a separate reviewed security and
ownership contract. HTML and SVG namespaces should share the operation shape
but not silently share element-creation semantics. Full SVG coverage is
deferred; M3.2 should at least preserve an explicit namespace field.

Attributes describe serialized markup state. Properties address live DOM
object state such as `value`, `checked`, or `disabled`. A compiler or view
descriptor must identify which operation is intended. Event handlers are
JavaScript closures with stable replacement/removal records; they are not
signal values and are not stored in Rust.

## 8. Reactive DOM binding model

The conceptual path is:

```text
signal value
    |
    v
RustReactiveCore dependency edge
    |
    v
dirty ComputationId / pending pair
    |
    v
TypeScript computation registry
    |
    v
renderer binding record
    |
    v
targeted DOM host operation
```

### Explicit binding registration with current M2 APIs

The smallest model that can work with M2 is explicit:

1. The root creates a computation through `runtime.createComputation()` for
   each independently updateable binding or small binding group.
2. The renderer registers the returned opaque handle in a JavaScript `Map`.
3. The binding record stores its target node, operation kind, update function or
   plan, ownership token, and explicit signal dependencies.
4. The renderer calls `runtime.subscribe(signal, computation)` for each
   dependency, or uses `replaceDependencies` for the complete set.
5. Initial rendering invokes the binding update once during mount.
6. An explicit renderer flush calls `runtime.drainPendingComputations()` and
   resolves each returned handle through the map. It applies live binding
   updates in pending FIFO order.
7. The binding may read current signal values through `runtime.get()` while
   executing its JavaScript update plan. The renderer then performs the one
   targeted host mutation.
8. Unmount unsubscribes every dependency and disposes every computation owned
   by the binding before the binding record is removed from the map.

This model makes no claim that a computation was executed by Rust. Rust only
marks its identity dirty. The JavaScript renderer owns the later update step,
and the explicit flush boundary is required because M2 has no scheduler.

### Binding record invariants

A future binding record should contain, conceptually:

```text
BindingRecord {
  ownerRoot
  computationHandle
  targetNode or target descriptor
  operation kind
  explicit dependency handles
  update plan or JavaScript update function
  listener records, if any
  live state
}
```

The record is not a second reactive graph. It is a lookup and lifecycle record
for DOM work. One renderer instance must never use a handle from another
`ReactiveCore` instance. The root must reject a binding whose computation is
disposed, foreign, or no longer registered.

### Dependency replacement and dynamic expressions

With current M2 APIs, dependencies are known only when the renderer or
compiler registers them. If a conditional expression changes which signals
are relevant, the update plan must explicitly call
`replaceDependencies(computation, nextSignals)` outside or at a defined point
in the update transaction. That behavior needs a later contract for what
happens to a notification already pending when dependencies change; M1 keeps
such a live notification valid.

Automatic tracking would require a later execution model that can establish a
current binding while JavaScript evaluates an expression, record every signal
read, replace dependencies atomically, and define nested/computed ownership.
It also needs an error policy for reads outside a tracking scope and a rule for
conditional reads. M3.1 deliberately does not add those semantics.

### Flush and reentrancy

M2 provides no scheduler, so the first renderer must expose an explicit flush
boundary rather than update DOM in a hidden microtask. The proposed baseline is
that a flush takes a deterministic snapshot of pending identities, applies
each live binding once, and reports any new pending work for a later explicit
flush. A binding that writes signals during its update must not cause an
unbounded implicit loop. Whether a later implementation drains to quiescence,
uses a bounded pass count, or exposes a separate scheduler is an open decision.

## 9. Root and node ownership

### Root container

`createRoot(container, runtime)` should borrow the supplied container and
runtime by default. It owns the nodes and resources that it inserts below the
container, not the container element itself and not arbitrary pre-existing
children. A root must record an ownership token that is not a DOM property
visible to application code.

Only one active Ruseact root should own a given container unless an explicitly
approved composition mode says otherwise. A duplicate mount attempt should
return a renderer error instead of silently replacing another root.

### Mounted nodes

Every created node belongs to one root for its lifetime. A subtree record must
retain parent/child or anchor relationships needed for deterministic removal.
Moving a node between roots is not supported by the initial design. A node
created outside the renderer may be adopted only through an explicit reviewed
API; ordinary host operations should reject it.

The root removes only nodes it inserted. Unmounting must not clear unrelated
container children. Container reuse after unmount is allowed only after the
root has released its ownership token and all owned nodes/listeners/bindings
are gone.

### Runtime ownership

The root owns renderer-created computation handles and subscriptions. Signals
passed into a binding are borrowed unless a later API explicitly marks them as
renderer-owned. Unmount therefore unsubscribes and disposes renderer-owned
computations, but does not dispose application signals or a shared runtime by
default. A root created with an owned runtime may optionally dispose that
runtime after all renderer resources are released; this option requires API
approval.

## 10. Mount, update, unmount, and disposal lifecycle

The lifecycle contract proposed for M3.2 is:

### Initial mount

1. Validate that the container is a supported element/document fragment and is
   not already owned by an active root.
2. Create a root ownership token and an empty renderer resource registry.
3. Materialize the static view structure and anchors.
4. Register explicit binding records and event listener records.
5. Register dependency edges and perform initial binding updates.
6. Insert the owned subtree in deterministic order.
7. Mark the root mounted only after all required setup succeeds.

If a step fails, remove only nodes and listeners created by this attempt,
unsubscribe/dispose resources already registered by the attempt, and leave the
container in its prior state as far as the browser permits. Partial mount
cleanup is part of the implementation test contract.

### Repeated updates

An explicit `update(view)` may update a root-owned view plan. A minimal first
implementation should keep static node identity stable and use binding records
for scalar text/attribute/property changes. Structural changes must use
explicit anchors or a later approved structural plan; they must not be hidden
inside an arbitrary property update.

`flush()` is the explicit bridge from pending computation identities to binding
execution. It must be deterministic, must skip records marked dead, and must
not execute a callback for a disposed or foreign handle. Errors should identify
the binding/root and preserve the runtime's `CoreResult` or renderer error
classification rather than silently continuing with a detached node.

### Unmount

Unmount is idempotent after the first successful unmount. It should:

1. mark the root as unmounting so reentrant updates fail;
2. stop accepting new binding registrations;
3. remove event listeners using their exact stored identities;
4. unsubscribe all renderer subscriptions;
5. dispose all renderer-owned computations;
6. remove owned nodes and anchors in reverse structural order;
7. clear binding, node, and listener registries; and
8. release the container ownership token.

The root must invalidate its records before or during cleanup so a pending
identity drained after unmount cannot update a detached node. Garbage
collection is not a lifecycle protocol.

### Partial subtree cleanup

Conditional branches and keyed list items need subtree resource registries.
Removing one branch must clean only its nodes, listeners, computations, and
subscriptions. Parent bindings remain live if their target subtree remains
live. A child cleanup must be safe when the browser has already detached the
node.

### External DOM removal

The browser can remove or move a node without the renderer knowing. The
initial correctness contract should check that a target remains owned and
connected to its expected parent before applying a mutation. If it is detached,
the binding must fail closed and be disposed or reported according to the
renderer error policy; it must never recreate or mutate an unrelated node by
guessing. A `MutationObserver` may provide diagnostics later, but it is not a
substitute for explicit ownership cleanup.

## 11. Component and JSX/compiler integration

### Component functions

A future component function should execute in JavaScript and return a view
descriptor or compiler-produced plan. Rust receives no JavaScript closure.
Component identity must be explicit in the view/renderer layer; a reactive
computation identity is an update record, not automatically a component
identity.

Inputs should be passed as an immutable render snapshot or an explicitly
defined object contract. Whether a changed input re-executes a component or
updates only a binding is a later lifecycle decision.

### Static and dynamic content

Static elements and text should be represented in a template plan. Dynamic
text, attributes, and properties should identify exact target slots. Event
handlers remain JavaScript records and can be replaced without changing the
node identity.

### Conditional rendering

Conditional views need stable anchor positions and a branch-owned resource
registry. A branch change must dispose the old branch before or during its
removal and must not leave pending bindings pointing at detached nodes. The
precise order of branch cleanup versus insertion requires an M3.2 decision and
tests.

### Lists and keys

List rendering needs a stable-key contract before it can promise node identity.
Keys should be scoped to a list owner, compared with a defined equality rule,
and must not be used as global DOM IDs. Unkeyed list behavior, duplicate keys,
moves, and item disposal require explicit semantics. M3.1 recommends a small
keyed structural plan later, not a full reconciliation algorithm today.

### Compiler boundary

The future compiler may emit:

- static element/text creation instructions;
- namespace and attribute/property operation kinds;
- stable binding slot identifiers;
- explicit signal dependency metadata or a later tracking marker;
- anchors for conditional and list regions; and
- source locations for diagnostics.

It must not emit forged WASM handles, call private runtime factories, or make
Rust execute JavaScript. The exact emitted format, versioning, and fallback
behavior are open decisions. No compiler code is added in M3.1.

## 12. Candidate public API

The following is a conceptual proposal only. It is not an approved signature
and must not be implemented as part of M3.1.

```ts
interface RendererRoot {
  mount(view: ViewDescription): RendererResult<void>;
  update(view: ViewDescription): RendererResult<void>;
  flush(): RendererResult<FlushReport>;
  unmount(): RendererResult<void>;
  dispose(): RendererResult<void>;
}

function createRoot(
  container: Element | DocumentFragment,
  runtime: ReactiveCore,
  options?: RootOptions,
): RendererRoot;
```

Proposed semantics:

- `createRoot` validates the container and borrows the runtime unless an
  explicitly approved ownership option says otherwise.
- `mount` is allowed once and performs initial creation plus initial binding
  execution. A second mount is an error.
- `update` changes the root's view plan while preserving stable nodes when the
  plan says they are the same; it does not imply an asynchronous scheduler.
- `flush` drains the current pending computation identities and invokes live
  binding records in deterministic order. It does not promise automatic
  quiescence or animation-frame scheduling.
- `unmount` releases root-owned DOM and reactive resources and is idempotent.
- `dispose` permanently closes the root. A disposed root cannot be mounted
  again; container reuse requires a new root after ownership is released.
- Renderer errors should be structured enough to identify operation, root
  lifecycle state, target ownership, and underlying runtime failure.

### Conceptual examples

These examples describe future descriptors, not currently executable APIs.

#### Static text

```ts
const view = template(() => text("Hello"));
root.mount(view);
```

The renderer creates one text node and owns it until unmount. No computation is
needed for a fully static node.

#### Reactive text

```ts
const view = template(() => dynamicText({
  read: () => runtime.get(count),
  dependsOn: [count],
}));
root.mount(view);
runtime.set(count, 1);
root.flush();
```

The explicit dependency list is the only semantics available from M2. The
example does not imply that `runtime.get` automatically subscribes the
binding.

#### Reactive attribute

```ts
const view = template(() => element("button", {
  attributes: { "aria-label": () => runtime.get(label) },
  dependsOn: [label],
}));
```

The plan must distinguish `setAttribute` from a property assignment and must
update only the target attribute when `label` is dirty.

#### Button event handler

```ts
const view = template(() => element("button", {
  text: "Increment",
  on: { click: () => runtime.set(count, currentCount() + 1) },
}));
```

The handler remains a JavaScript callback owned by the root. It is registered
and removed with exact identity; it is not stored in Rust or treated as a
computation callback.

#### Counter with an explicit update cycle

```ts
const root = createRoot(container, runtime);
root.mount(counterView);

function increment() {
  runtime.set(count, currentCount() + 1);
  root.flush();
}
```

This is intentionally explicit. Automatic event-to-render flushing,
microtasks, batching policy, and component re-execution require later
milestones and approval.

## 13. Renderer testing strategy

M3.2 should add tests without introducing a new test dependency. The existing
TypeScript compilation path and hosted Chromium harness are sufficient for the
first browser consumer checks.

### Host and renderer behavior

The test matrix should cover:

- element and text-node creation;
- static initial rendering;
- text, attribute, and property updates;
- attribute/property distinction and boolean properties;
- event registration, replacement, and cleanup;
- deterministic DOM ordering and anchor placement;
- repeated updates with stable node identity;
- conditional branch insertion/removal;
- keyed item identity, moves, duplicate-key rejection, and cleanup;
- multiple independent roots and runtime instances;
- duplicate mount attempts and container reuse;
- external node removal behavior;
- partial subtree cleanup;
- stale computation prevention after unmount;
- renderer and runtime disposal; and
- browser errors and failed partial mounts.

### Reactive integration

Tests should explicitly verify that:

- a changed signal dirties the intended binding;
- an unchanged signal does not cause a host mutation;
- multiple writes before flush are deduplicated according to the M2 queue;
- FIFO pending identities produce deterministic binding order;
- a binding can be unsubscribed and disposed without future DOM writes;
- multiple roots cannot resolve each other's handles;
- a borrowed signal survives root unmount when the runtime remains live; and
- pending work drained after unmount is skipped or rejected, never applied to
  detached DOM.

### Browser execution

Browser-specific tests should run in the existing GitHub-hosted Chromium job
using generated `wasm-bindgen --target web` bindings. The local InstaBox
loopback limitation must remain documented. A renderer test page should report
structured assertions and browser errors using the current harness pattern.
When a separate example consumer becomes available, at least one browser test
should exercise the published or explicitly pinned package output there.

## 14. Performance validation strategy

No renderer benchmark is implemented in M3.1. Once M3.2 exists, the benchmark
plan should retain the M1.5/M2.5 layer separation and add DOM-specific rows:

- cold module and root initialization;
- warm root creation;
- initial static mount;
- initial mount with dynamic bindings;
- single text update latency;
- attribute and property update latency;
- event registration/replacement/removal;
- DOM insertion, move, and removal;
- number and type of DOM mutations;
- signal-to-binding lookup;
- JS/WASM crossing count and combined wrapper cost;
- fan-out with many affected bindings;
- explicit batch and flush behavior;
- conditional and keyed-list updates; and
- resource retention after unmount.

Use real Chromium for browser timing, fixed deterministic fixtures, warmups,
independent trials, raw samples, and a timer-resolution-aware integrity gate.
Record mutation counts separately from elapsed time. Do not compare against
React or another framework until equivalent end-to-end workloads, lifecycle
semantics, browser version, and measurement boundaries exist.

Memory retention requires a separate supported memory-instrumentation method;
timing alone cannot establish leak freedom. Any bridge overhead conclusion
must use genuinely equivalent workloads and be labeled combined when it cannot
be isolated.

## 15. Separate example repository handoff

Example applications belong in the separate `ruseact-examples` repository.
M3.1 adds no Counter demo, fixture application, sibling path dependency, or
example workflow here.

After a usable M3 implementation is published or packaged, the examples
repository should:

1. consume a released package or an explicitly pinned framework/DOM adapter
   commit, rather than importing this repository through an implicit sibling
   path;
2. provide a small Counter consumer that uses the approved public API and
   explicit update semantics;
3. run its browser checks against the same generated-WASM loading assumptions
   documented by M2.4;
4. record the framework and DOM adapter versions consumed; and
5. report application-level renderer results separately from M1.5 and M2.5
   microbenchmarks.

The handoff must wait until the renderer API, package output, and lifecycle
semantics are approved. No example repository change is part of M3.1.

## 16. Architectural risks and trade-offs

- Explicit dependencies are safe and testable now, but dynamic component code
  will be verbose until tracking semantics are designed.
- Per-binding computation records make targeted updates possible, but increase
  registry and cleanup work; this cost must be measured rather than assumed
  away.
- Static template plans can reduce repeated structure work, but introduce a
  compiler-to-renderer contract that needs versioning and source mapping.
- A fallback descriptor improves early usability, but two view paths can drift
  unless they share host and lifecycle contracts.
- DOM identity is observable application state. Replacing nodes for convenience
  can break focus, selection, browser state, and event identity.
- External DOM mutation cannot be made safe by garbage collection alone;
  ownership checks and explicit disposal are required.
- Flush behavior is intentionally synchronous and explicit at first. Hidden
  microtasks or a scheduler would change observable ordering and require a new
  architecture decision.
- Rust mutation intents might reduce some crossings in a future workload, but
  could also obscure browser object ownership. No such protocol is selected.
- A hybrid design can still become complex around keyed lists and conditional
  branches. Those features must remain scoped and tested.

## 17. Decisions requiring human approval

The following decisions are intentionally unresolved:

1. Approve or reject the hybrid recommendation and its fine-grained binding
   primary path.
2. Approve the shape and ownership of the first view/template descriptor.
3. Decide whether M3.2 exposes an explicit `flush()` API and whether one flush
   processes one pending snapshot or repeats to a defined bound.
4. Decide whether explicit binding dependencies are sufficient for the first
   renderer and define a later automatic-tracking milestone.
5. Define component identity, child ownership, conditional anchors, keyed-list
   behavior, duplicate-key errors, and structural update order.
6. Decide whether roots borrow or may own the supplied `ReactiveCore` and
   whether signals can ever be renderer-owned.
7. Define renderer error propagation and behavior after external DOM removal.
8. Approve the attribute/property allowlist or compiler metadata strategy.
9. Define the compiler output versioning and runtime fallback contract.
10. Decide whether any future Rust mutation-intent protocol is justified by
    measured end-to-end workloads.

These decisions remain unresolved for the public renderer. The approved M3.3
prototype does not change M2 runtime semantics or add public DOM APIs; it is
limited to an internal explicit binding context and one requested flush pass.

## 18. Proposed M3.2 implementation boundaries

Subject to the approvals above, M3.2 should be limited to:

- a small internal host-operation adapter in `packages/ruseact-dom`;
- root creation, explicit mount, explicit flush, unmount, and disposal;
- static text/element creation;
- explicitly registered reactive text, attribute, and property bindings;
- JavaScript-owned event listener registration and replacement;
- deterministic binding lookup from existing `ComputationHandle` objects;
- explicit subscription and computation cleanup;
- focused Node-level contract tests where the host can be modeled without a
  new dependency; and
- real Chromium tests through the existing hosted browser infrastructure.

M3.2 should not add automatic dependency tracking, concurrent scheduling,
hydration, a general virtual DOM, React Hooks, broad SVG support, server
rendering, or a compiler implementation unless a separate milestone expands
the approved scope.

## 19. M3.2 implementation note

M3.2 implements the first internal host subset without resolving the public
renderer decisions above. `packages/ruseact-dom/src/host.ts` provides
`createHostContext(document)` and an internal `HostContext` with explicit
container claiming, HTML element/text creation, insertion/removal, text and
attribute mutation, narrow native property writes, event registration, and
cleanup. `packages/ruseact-dom/src/index.ts` remains non-exporting.

The host uses a module-private `WeakMap<Node, NodeRecord>` to associate a DOM
node with one context. Contexts can move owned nodes within that context, but
cannot adopt unknown or foreign nodes. Created nodes that are externally moved
or removed become unusable; explicit host removal marks a subtree detached.
Context cleanup removes only safe owned nodes and preserves unrelated children
of a claimed container. Listener records retain native wrapper identity and
are released on exact removal, `once` delivery, or context disposal.

The supported property set is intentionally limited to `value` on input,
textarea, and select elements; `checked` on input; and `disabled` on the
compatible native controls. HTML is the only supported namespace. There is no
raw HTML operation, arbitrary property writer, SVG implementation, synthetic
event system, virtual DOM, reactive binding execution, scheduler, or public
root lifecycle.

The hosted browser command is `corepack pnpm test:browser:dom`, added beside
the existing M2 browser integration in CI. It tests real DOM APIs, ownership,
detachment, ordering, properties, event dispatch/cleanup, disposal, and
preservation of unrelated nodes. Local InstaBox Chromium is not authoritative
because of its documented loopback HTTP limitation.

M3.3 builds on this host boundary for the approved internal explicit reactive
binding execution only. The public view descriptor, root ownership, public
flush semantics, and component lifecycle decisions remain unresolved; M3.2
and M3.3 do not make those decisions.

## 20. M3.3 explicit binding implementation note

M3.3 implements the narrow explicit binding model described above in the
internal `packages/ruseact-dom/src/bindings.ts` module. Its factory borrows a
`ReactiveCore` and M3.2 `HostContext`, and one active binding context is
allowed per dedicated runtime. The module is not re-exported from
`packages/ruseact-dom/src/index.ts`; no public root or view descriptor is
approved by this implementation.

Each registration creates a real opaque `ComputationHandle`, replaces an
explicit dependency list through the existing runtime, validates the target,
executes a JavaScript-owned update function once, and records the binding in a
private map keyed by the computation object. A registration failure cleans up
the computation and subscriptions. The update function must return a valid
`CoreResult`; it is not a Rust computation callback and dependencies are not
inferred from `get()` calls.

The explicit `flush()` operation drains the runtime once, validates the whole
pending handle snapshot, resolves it in FIFO order, and executes live binding
updates once each. Reentrant flush calls are rejected. Updates that write
signals can create pending work for a later flush, but never trigger a
recursive drain. Binding and context disposal unsubscribe and dispose only
renderer-created computations; borrowed signals, runtime, host context, and
DOM nodes remain alive.

The runtime's pending queue is global and destructive. An unknown pending
computation therefore fails closed with progress metadata, but the existing
ABI cannot restore the consumed snapshot. This is why the MVP requires a
dedicated runtime and does not support multiple independent binding managers
sharing one runtime. A scoped drain or rollback protocol is deferred to a
future ABI decision.

The hosted browser binding harness verifies initial and targeted text,
attribute, and property updates, explicit dependencies, FIFO ordering,
deduplication, batching, write-during-flush behavior, reentrancy, failed
registration cleanup, binding/context disposal, foreign instances, detached
targets, unknown pending work, and preservation of borrowed resources.

## 21. M3.4 internal root lifecycle implementation note

M3.4 implements the first internal root coordinator in
`packages/ruseact-dom/src/root.ts`. It is deliberately narrower than the
public renderer design described above: it does not publish `createRoot`,
accept a view descriptor, execute components, reconcile structure, schedule
updates, or infer dependencies.

`createRootContext(container, runtime)` claims one Element or DocumentFragment
through a module-private root registry and an existing HostContext. The root
borrows both the container and ReactiveCore. Its imperative mount callback
receives a restricted scope that delegates DOM mutations and explicit binding
registration to the already-tested M3.2 and M3.3 contexts. No second DOM
ownership registry or reactive graph is introduced.

The internal states are `created`, `mounting`, `mounted`, `unmounting`,
`unmounted`, `cleanup_failed`, and `disposed`. Mount creates a BindingContext,
executes setup and initial binding updates, and marks the root mounted only
after setup succeeds. Failed setup disposes bindings before the HostContext,
removes only renderer-created nodes/listeners, preserves unrelated container
children, and returns the original error when cleanup succeeds. A cleanup
failure is reported separately and retains the container claim fail-closed.

Root flush is valid only while mounted and delegates one existing binding
flush pass. Unmount disposes renderer-created computations and subscriptions
before host listener/node cleanup, releases the container claim, and is
idempotent. The old root cannot be remounted; a new root may reuse the
container after successful cleanup. Root disposal is permanent and never
disposes borrowed application signals or the ReactiveCore.

Because M3.3's pending drain is global and destructive, each active mounted
root requires a dedicated ReactiveCore. A second root can be constructed with
the same runtime, but mounting it while another binding context is active fails
with `runtime_in_use`; pending work is never silently shared or stolen. The
hosted `test:browser:root` command verifies this restriction, real WASM
updates, rollback, detachment, event cleanup, unmount, disposal, and container
reuse. Public lifecycle, component, compiler, keyed-list, and scheduling
decisions remain future milestones.

## 22. Summary

M2 supplies a deterministic reactive invalidation substrate, not a renderer.
The safest first DOM architecture is therefore an explicitly owned
JavaScript-side binding layer that consumes pending computation identities and
performs targeted host operations. Compiler-assisted static templates are a
natural future producer of those binding records, while a small explicit
fallback can make the first implementation testable. The design remains
deliberately incomplete where computation execution, dependency tracking,
scheduling, components, and compiler semantics have not yet been approved.
