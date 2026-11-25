# M4.1 Public renderer and compiler contract design

Status: design-only proposal. The contracts in this document are **not yet
approved** and are not implemented by the current packages.

This document defines a candidate public renderer and a future JSX/TSX
compiler boundary for Ruseact. It starts from the actual M3.5 implementation:
Rust owns reactive state and dirty identities, the WASM bridge validates and
transfers those identities, TypeScript owns opaque handles and JavaScript
execution, and the DOM adapter owns browser objects. It does not introduce a
public API, compiler, scheduler, component runtime, virtual DOM, or new WASM
ABI.

Ruseact remains an experimental React-inspired framework. This proposal does
not claim React API compatibility or performance superiority.

Implementation status note: the original M4.1 recommendations are historical
design input, not an independent protocol. M4.2 implemented version 1 and
M4.4.2 implemented version 2 static component placement. M4.4.3 uses version
3 for conditional regions so the changed anchor, branch ownership, rollback,
and flush semantics are not silently added to older plans. Version 3 remains
narrow and does not include keyed lists or a mutable view tree.

## 1. Executive summary

The recommended path is a small public façade over the existing internal root
lifecycle, paired with a hybrid view representation:

1. M4.2 should expose a deliberately narrow root façade for one-time mount,
   explicit flush, unmount, and disposal. It should accept an explicitly
   supplied `ReactiveCore` while runtime loading remains a separate concern.
2. The first public view contract should be a static template plan with
   targeted binding slots. A small imperative descriptor fallback may be used
   while compiler output is unavailable, but both paths must share host,
   ownership, and cleanup rules.
3. M4.3 should define a versioned compiler output containing static node
   instructions, stable binding slots, operation kinds, dependency metadata,
   structural anchors, and source locations. Generated JavaScript remains the
   owner of lexical evaluation and callbacks; the IR must not contain WASM
   handles or DOM objects.
4. M4.4 should add component instances and anchored structural regions in
   separate, narrowly tested steps. Keyed lists should be selected before
   unkeyed reconciliation if identity preservation is required.
5. Automatic scheduling and automatic dependency tracking should remain
   separate approvals. The first public renderer should preserve the current
   explicit flush semantics.

The central design rule is that a dirty computation identifies JavaScript work;
it is not itself a component, callback, render tree, or scheduler task. The
public renderer must keep this distinction visible.

## 2. Verified baseline architecture

### 2.1 RustReactiveCore

`crates/ruseact-core` currently provides a platform-independent
`ReactiveGraph` with:

- typed, graph-owned signal storage;
- graph-scoped generational signal and computation identities;
- `PartialEq`-based changed/unchanged writes;
- explicit computation metadata with no executable body;
- bidirectional dependency edges;
- idempotent subscription and unsubscription;
- atomic dependency replacement with duplicate removal;
- deterministic first-dirtied pending computation order;
- queue deduplication while a computation is dirty;
- explicit nested batch boundaries; and
- disposal and stale-identity validation.

The Rust core does not know about JavaScript closures, DOM nodes, component
instances, view descriptors, JSX, or browser event timing. It does not execute
computation callbacks. A computation ID is an invalidation identity only.

### 2.2 Rust/WASM bridge

`crates/ruseact-wasm` owns one graph per `WasmCore`. Opaque handles carry
instance, graph, resource-kind, slot, and generation metadata. The bridge
exposes scalar signal operations, computation identity creation and lookup,
dependency operations, batching, disposal, and copied pending identity pairs.

The bridge does not accept callbacks, retain DOM references, construct
JavaScript handles from caller-supplied numbers, or schedule browser work.
Pending transfer is a destructive identity snapshot. A future public renderer
must not assume that it can restore a snapshot after a failed drain.

### 2.3 TypeScript runtime

`packages/ruseact` currently exports `createReactiveCore`, opaque
`SignalHandle` and `ComputationHandle` types, `CoreResult`, and the
`ReactiveCore` interface. The interface includes:

```ts
interface ReactiveCore {
  createSignal<T extends SupportedScalar>(initial: T): CoreResult<SignalHandle<T>>;
  get<T extends SupportedScalar>(signal: SignalHandle<T>): CoreResult<T>;
  set<T extends SupportedScalar>(signal: SignalHandle<T>, value: T): CoreResult<SignalUpdate>;
  disposeSignal<T extends SupportedScalar>(signal: SignalHandle<T>): CoreResult<void>;
  createComputation(): CoreResult<ComputationHandle>;
  disposeComputation(computation: ComputationHandle): CoreResult<void>;
  subscribe<T extends SupportedScalar>(signal: SignalHandle<T>, computation: ComputationHandle): CoreResult<boolean>;
  unsubscribe<T extends SupportedScalar>(signal: SignalHandle<T>, computation: ComputationHandle): CoreResult<boolean>;
  replaceDependencies(computation: ComputationHandle, dependencies: readonly SignalHandle<SupportedScalar>[]): CoreResult<void>;
  beginBatch(): CoreResult<void>;
  endBatch(): CoreResult<void>;
  drainPendingComputations(): CoreResult<readonly ComputationHandle[]>;
  dispose(): CoreResult<void>;
}
```

The current scalar boundary is `boolean | number | string`, with finite
numbers only. Objects, arrays, functions, symbols, promises, and arbitrary
JavaScript values are not signal values in the current runtime. `CoreResult`
normalizes operational and internal errors with an error kind, code,
operation, and optional resource or identity fields.

The TypeScript runtime owns the per-instance handle registry. It rejects
foreign, stale, malformed, or disposed handles. It does not expose a callback
execution primitive.

### 2.4 DOM host, bindings, and root

The package entry point `packages/ruseact-dom/src/index.ts` is intentionally
empty. The following modules are internal:

- `host.ts` claims an `Element` or `DocumentFragment`, creates owned HTML and
  text nodes, validates insertion ancestry, performs text/attribute/narrow
  property updates, manages native listeners, and cleans up owned resources.
- `bindings.ts` creates legitimate runtime computations, records explicit
  signal dependencies, executes JavaScript-owned updates once at registration,
  drains one pending snapshot, dispatches in FIFO order, and disposes only
  renderer-owned computations and subscriptions.
- `root.ts` owns the internal root state machine. `createRootContext()` claims
  one container, borrows the runtime and container, mounts through an
  imperative scope, delegates flush to the binding context, and performs
  deterministic rollback, unmount, and disposal.

M3.4 requires one dedicated `ReactiveCore` per active mounted binding context.
The pending queue is global to a runtime and draining is destructive, so a
public renderer cannot silently allow independent roots to share a runtime.
Signals passed by an application are borrowed; unmount does not dispose them
or the borrowed runtime.

### 2.5 Verified testing and benchmark boundaries

M3.5 exercises the actual Rust/WASM → TypeScript → binding → DOM path in
hosted Chromium. Its correctness fixture uses imperative setup and explicit
`root.flush()`. Its benchmark separates mount, signal invalidation, explicit
flush, targeted mutation, native-DOM reference work, and teardown. The M2.5
and M3.5 reports intentionally distinguish measured results from theoretical
cost attribution and do not claim comparison with another framework.

The current InstaBox cannot be treated as authoritative for local Chromium
loopback execution. Hosted GitHub Chromium remains the browser verification
environment.

## 3. Goals and non-goals for the public contract

### Goals

The first public contract should:

- provide a small, typed façade over already-tested root ownership and cleanup;
- preserve DOM node identity for static structure and targeted bindings;
- make explicit flush and error behavior observable;
- keep runtime, signal, computation, DOM, and component ownership distinct;
- give a compiler a versioned, inspectable output boundary;
- preserve JavaScript lexical scoping and evaluation order;
- support deterministic browser tests and benchmark phase separation; and
- leave structural rendering and scheduling available for later milestones.

### Non-goals

M4.1 does not:

- add public exports or runtime code;
- implement JSX/TSX parsing or transforms;
- implement components, hooks, effects, or local state cells;
- implement automatic dependency tracking;
- implement microtask, animation-frame, priority, or concurrent scheduling;
- add a virtual DOM or React Fiber;
- define hydration, server rendering, worker transfer, or async rendering;
- expand scalar signals to arbitrary JavaScript values;
- define a compatibility layer for React APIs; or
- modify `ruseact-examples`.

## 4. Candidate public renderer API

The following interfaces are candidates for human approval only.

### 4.1 Option A: explicit root façade

```ts
interface RendererRoot {
  readonly state: RendererRootState;
  mount(view: ViewDescription): RendererResult<void>;
  flush(): RendererResult<FlushReport>;
  unmount(): RendererResult<void>;
  dispose(): RendererResult<void>;
}

function createRoot(
  container: Element | DocumentFragment,
  runtime: ReactiveCore,
  options?: RootOptions,
): RendererResult<RendererRoot>;
```

This option is a public façade over the internal M3.4 lifecycle. `mount` is
one-time for a root instance. Signal changes update bound slots only after an
explicit `flush`; no hidden microtask is implied. `unmount` is idempotent
after successful cleanup, and `dispose` permanently closes the root.

The explicit runtime parameter makes WASM loading, runtime ownership, and the
dedicated-runtime restriction visible. A later convenience initializer could
construct a runtime, but it must not hide whether the root borrows or owns it.

### 4.2 Option B: render function plus returned controller

```ts
interface RenderController {
  flush(): RendererResult<FlushReport>;
  unmount(): RendererResult<void>;
  dispose(): RendererResult<void>;
}

function render(
  container: Element | DocumentFragment,
  view: ViewDescription,
  runtime: ReactiveCore,
): RendererResult<RenderController>;
```

This is terser for a one-shot application and makes initial mounting the
primary action. It hides root creation and provides less room for an explicit
created-versus-mounted lifecycle. A later `render` call would need an
identity rule for replacing a view and could accidentally introduce an
implicit structural reconciler.

### 4.3 Recommendation

Recommend Option A for M4.2, with the following restrictions:

- `createRoot` returns a structured result or throws only according to an
  approved public error policy; it must not silently claim a duplicate
  container.
- The root borrows the supplied runtime and container by default.
- A mounted root has one view instance. M4.2 should not add `update(view)`;
  signal-driven binding updates are the only update path until structural
  identity is defined.
- `flush` processes one pending snapshot and reports work generated during
  the pass as deferred. It does not drain to quiescence.
- Multiple active roots require distinct runtime instances unless a future
  scoped-drain contract is approved.
- The public package must not expose `HostContext`, `BindingContext`, raw
  computation maps, or numeric WASM identities.

This is a recommendation, not an approval. The public result/error types,
runtime initialization shape, options, and whether the public package should
accept a runtime directly require human review.

## 5. View representation alternatives

### A. Imperative construction API

An application calls `createElement`, `appendChild`, and `bind` from a setup
function.

**Strengths:** closest to the verified M3.4 path, easy to debug, no compiler
dependency, and straightforward ownership accounting.

**Costs:** verbose application code, weak static analysis, no stable compiler
slot metadata, and no natural JSX source mapping. It should be a test and
fallback representation, not the long-term authoring model.

### B. Runtime view descriptors

An application creates a data structure describing elements, text, bindings,
listeners, and regions.

**Strengths:** inspectable, serializable in principle, easy to validate before
mount, and suitable for hand-authored tests.

**Costs:** dynamic JavaScript expressions require closures or evaluator
objects; careless descriptors become a virtual DOM; and a descriptor update
operation immediately needs structural identity and diff semantics.

### C. Compiler-generated static templates with slots

The compiler emits a static creation plan and fixed dynamic slots. Generated
JavaScript evaluates expressions and supplies runtime signal handles and
callbacks at instance creation.

**Strengths:** stable target locations, compact mount code, source locations,
and a direct fit for fine-grained DOM bindings. Static structure is not
recreated for scalar changes.

**Costs:** compiler output becomes a compatibility boundary, dynamic
dependencies need explicit metadata, and unsupported JavaScript constructs
need a conservative fallback.

### D. Recommended hybrid

Use compiler-generated static templates and binding slots as the primary path,
with a narrow descriptor/factory fallback that produces the same internal
mount plan. Do not add a global virtual DOM. Structural regions should be
explicit instructions with anchors and ownership records rather than an
implicit tree diff.

The fallback must not be a second renderer. Both paths should lower to one
internal mount protocol: create owned nodes, register owned slots/listeners,
attach the staged subtree, and release resources in reverse ownership order.

## 6. Recommended view contract

The first approved view contract should represent a **mount plan**, not a
mutable application tree. A plan contains static structure and update slots;
it does not promise that an arbitrary new plan can be reconciled with an old
one.

Illustrative, not implemented:

```ts
type TemplateProtocol = "ruseact.template";

interface ViewDescription {
  readonly protocol: TemplateProtocol;
  readonly version: 1;
  readonly templateId: string;
  readonly instantiate: (environment: ViewEnvironment) => ViewInstancePlan;
}

interface ViewEnvironment {
  readonly runtime: ReactiveCore;
  readonly source?: string;
}

interface ViewInstancePlan {
  readonly nodes: readonly StaticNodePlan[];
  readonly bindings: readonly BindingPlan[];
  readonly listeners: readonly ListenerPlan[];
  readonly regions: readonly RegionPlan[];
}
```

`instantiate` is JavaScript code and may close over application values. The
renderer owns the returned plan for the lifetime of the root instance. It
must not call it again merely because a scalar signal changed.

Static nodes need stable local IDs within one instance. Binding targets refer
to those IDs, not to DOM nodes embedded in the descriptor. A binding operation
must distinguish text, attribute, and supported property writes. Listeners
carry JavaScript function identity and options; they are never passed to Rust.

An M4.2 static-only plan should allow `nodes`, `bindings`, and `listeners`,
while rejecting or deferring `regions`. A region is not just a binding: it
owns anchors, child instances, keys, and cleanup records.

## 7. Proposed compiler-to-renderer contract

### 7.1 Contract principles

The future compiler output must:

- carry a protocol name and integer version;
- use stable template and slot IDs, scoped to a template instance;
- describe DOM operations without storing DOM objects;
- describe dependencies without inventing signal or computation handles;
- preserve JavaScript evaluation order and lexical closures;
- identify attributes versus properties explicitly;
- retain source locations for runtime errors and diagnostics;
- declare cleanup and region ownership boundaries; and
- be rejected when the renderer does not support its version or operation.

It must not:

- construct opaque WASM handles from numbers;
- place DOM references or JavaScript callbacks in Rust;
- classify every identifier as reactive;
- transform arbitrary JavaScript into a Fiber-like scheduler;
- change the order of user expression evaluation; or
- silently substitute a weaker operation when a requested namespace,
  property, or dependency form is unsupported.

### 7.2 Candidate IR v0.1

This is a candidate schema, not a committed TypeScript type.

```ts
interface TemplateIRV1 {
  readonly protocol: "ruseact.template";
  readonly version: 1;
  readonly templateId: string;
  readonly nodes: readonly NodeInstruction[];
  readonly bindings: readonly BindingInstruction[];
  readonly listeners: readonly ListenerInstruction[];
  readonly regions: readonly RegionInstruction[];
  readonly sourceMap?: readonly SourceLocation[];
}

type NodeInstruction =
  | { readonly kind: "element"; readonly id: string; readonly parent: string | null;
      readonly name: string; readonly namespace?: "html"; }
  | { readonly kind: "text"; readonly id: string; readonly parent: string;
      readonly value: string };

type BindingInstruction =
  | { readonly kind: "text"; readonly slot: string; readonly target: string;
      readonly expression: string; readonly dependencies: readonly DependencySlot[] }
  | { readonly kind: "attribute"; readonly slot: string; readonly target: string;
      readonly name: string; readonly namespace?: "html";
      readonly expression: string; readonly dependencies: readonly DependencySlot[] }
  | { readonly kind: "property"; readonly slot: string; readonly target: string;
      readonly property: "value" | "checked" | "disabled";
      readonly expression: string; readonly dependencies: readonly DependencySlot[] };

interface DependencySlot {
  readonly source: string;
  readonly mode: "explicit" | "conservative";
}

interface ListenerInstruction {
  readonly slot: string;
  readonly target: string;
  readonly type: string;
  readonly handler: string;
  readonly options?: { readonly capture?: boolean; readonly once?: boolean };
}

interface RegionInstruction {
  readonly id: string;
  readonly startAnchor: string;
  readonly endAnchor: string;
  readonly mode: "conditional" | "keyed-list";
  readonly owner: string;
}
```

The strings in this sketch are stable compiler references, not executable
JavaScript source that the renderer evaluates with `eval`. A generated module
would pair the IR with trusted JavaScript functions:

```ts
interface GeneratedTemplateModule {
  readonly ir: TemplateIRV1;
  readonly expressions: Readonly<Record<string, (scope: ExpressionScope) => ScalarValue>>;
  readonly dependencies: Readonly<Record<string, (scope: ExpressionScope) => SignalHandle<SupportedScalar>[]>>;
  readonly handlers: Readonly<Record<string, (event: Event) => void>>;
}
```

The actual expression and handler functions are emitted JavaScript closures
whose lexical captures remain in JavaScript. The renderer invokes them only at
the approved lifecycle points. `SignalHandle` values are resolved from the
mount environment; they are not serialized in `TemplateIRV1` and are never
forged by the compiler.

### 7.3 Dependency metadata

An `explicit` dependency is a compiler-proven or author-declared signal slot
resolved by the generated module. A `conservative` dependency means the
compiler deliberately subscribes to a safe superset because it cannot prove a
conditional or indirect read. It does not mean that arbitrary identifiers are
signals.

M4.3 should reject a binding whose dependencies cannot be resolved rather than
silently subscribe to the whole runtime. A later dynamic-tracking milestone
may add a distinct protocol version and runtime scope; it must define reads
inside nested functions, aliases, callbacks, and conditional branches first.

### 7.4 Versioning and diagnostics

The renderer should reject unsupported protocol versions, duplicate IDs,
unknown operation kinds, duplicate binding slots, invalid parent references,
unsupported namespaces/properties, and unresolved dependency slots before
mutating the container. Errors should include template ID, slot/region ID,
source location when available, operation, and root lifecycle state.

A compiler output version is independent from the package version. The
renderer may support multiple IR versions temporarily, but it must not accept
an unknown version by guessing.

## 8. Component execution model

### 8.1 Candidate models

**A. One-time component setup plus fine-grained bindings.** A component
function runs once per instance and creates static structure plus bindings.
Signal changes update slots without re-running the component.

- Correctly preserves JavaScript closure identity and DOM identity.
- Closures must read current signal values at update time, or use generated
  accessors, to avoid stale captured values.
- Structural changes need explicit regions rather than an implicit rerender.

**B. Component re-execution with targeted structural updates.** A changed prop
or signal reruns a component function and produces a plan that is patched into
the existing instance.

- More expressive for conditionals and arbitrary JavaScript.
- Requires component identity, plan identity, child ownership, keyed moves,
  event replacement, and error rollback before it is safe.
- Re-execution can add component and allocation cost unrelated to the changed
  DOM slot.

**C. Conservative hybrid.** Static component setup is the M4.2/M4.3 path;
explicit compiler-emitted bindings handle scalar changes; only approved
structural regions can request a component or branch re-execution later.

### 8.2 Recommendation

Recommend C. Treat a component instance as a JavaScript-owned lifecycle
record with:

- a stable instance ID scoped to its parent region;
- component type identity supplied by the generated module;
- immutable or snapshot props for initial setup;
- a child resource owner for nodes, bindings, listeners, and nested instances;
- explicit cleanup before parent removal; and
- optional structural update entry points introduced only by M4.4.

Component identity must not be conflated with a Rust `ComputationHandle`.
Multiple bindings may belong to one component, and one binding must not imply a
component rerender.

The first public milestone should not add `useState`-like syntax. If a future
syntax is considered, the compiler must allocate a stable state cell per
component instance and make closures read that cell or an accessor on every
use. Re-running a function by itself is not proof that existing closures see
fresh state. Effects, cleanup order, and conditional state placement require a
separate semantic contract; React Hooks compatibility must not be claimed.

## 9. Reactive dependency semantics

### 9.1 Explicit dependencies now

The current runtime supports only explicit subscription. A public binding
description should therefore accept or receive resolved signal dependencies at
registration time. A `runtime.get(signal)` call does not automatically
subscribe the current binding.

This is safe, inspectable, and compatible with M3.3. It makes dynamic code
verbose, but a missing dependency fails as an observable stale update rather
than being hidden behind incorrect compiler guesses.

### 9.2 Compiler-assisted dependencies

The compiler may identify reads only when the language and transform can prove
what value is a signal. It must not infer that every variable named `count`,
every function call, or every property access is reactive. Aliases, nested
closures, function boundaries, collection iteration, and imported helpers can
hide reads.

For M4.3, generated code should resolve explicitly marked signal slots. A
conditional expression may use a conservative union of its statically known
signals. This can over-invalidate but preserves correctness. If even the union
cannot be established, the compiler should require an explicit author fallback
or emit a non-reactive binding with a diagnostic.

### 9.3 Dynamic tracking later

Automatic tracking would require a runtime scope around expression execution:

1. establish the currently evaluating binding;
2. make signal reads report the current signal to that scope;
3. replace dependencies atomically after evaluation;
4. define nested scopes and cleanup after exceptions; and
5. define conditional reads and writes during evaluation.

The current `ReactiveCore.get` has no tracking scope and the M2 ABI has no
read notification. M4.1 therefore recommends a future protocol/milestone for
tracking rather than silently extending `get` or the WASM ABI.

## 10. Structural rendering design

### 10.1 Regions and anchors

A structural region should own a start anchor, an end anchor, its current
branch or item records, and all nested resources. Insertion and removal must
use the existing host ownership boundary. A region update is not a scalar
binding update and must have a separate operation kind.

### 10.2 Conditional content

For a conditional region, the renderer should evaluate the branch selector,
dispose the old branch's bindings/listeners/computations before or as its nodes
are removed, then create and insert the new branch between stable anchors. The
exact cleanup-before-insert order requires tests when a branch update can
write signals or dispatch browser events.

### 10.3 Keyed lists

The recommended first list contract is keyed-only:

- keys are unique within one list region;
- duplicate keys are an error before mutation;
- key equality is `SameValueZero` or another explicitly documented rule;
- a key identifies an item instance, not a DOM id;
- an item retains its node and resource identity when its key remains;
- moves use native `insertBefore` and do not recreate retained nodes;
- removed keys dispose their subtree resources; and
- inserted keys create fresh child ownership records.

Unkeyed lists should be deferred or explicitly documented as position-based
with weaker identity guarantees. A full virtual-DOM diff is not required: the
region can maintain a key-to-item map and a deterministic ordered sequence.

### 10.4 Structural MVP boundary

M4.2 should support static structure and scalar binding slots only. M4.3 may
emit anchors in the IR but should reject them at runtime until region ownership
tests exist. M4.4 can implement conditional regions and keyed lists one at a
time. Hydration, portals, cross-root movement, and async structural updates
remain deferred.

## 11. Scheduling boundary

### 11.1 Current explicit flush

The only semantics supported by the current implementation are:

- signal writes dirty Rust computation identities synchronously;
- unchanged writes do not create pending work;
- batching gates draining until the outermost batch ends;
- `flush()` drains one destructive snapshot;
- pending identities dispatch in Rust FIFO order and are deduplicated;
- a binding write during flush is deferred to a later explicit flush; and
- reentrant flush is rejected.

These semantics should be the M4.2 public baseline. They are deterministic and
can be tested without inventing an event loop policy.

### 11.2 Scheduling alternatives

**Manual only:** simplest ordering and lowest hidden work, but applications
must call `flush` after writes.

**Microtask scheduler:** convenient event-to-render behavior, but it changes
when DOM becomes observable, requires a scheduler ownership rule, and needs a
safe notification hook around signal writes. It must define whether multiple
writes coalesce and how errors surface.

**Animation-frame scheduler:** suitable for visual batching but adds frame
latency, browser lifecycle concerns, and tests that depend on rendering frames.

**Priority/concurrent scheduling:** not justified by the current queue or
runtime contract and risks recreating Fiber-like semantics.

Recommend manual flush for M4.2. A separately approved microtask scheduler
could be added after end-to-end workloads establish its value and after the
runtime defines how a dirty write notifies JavaScript without polling or
cross-root queue theft. No scheduler should be added in M4.1.

## 12. Ownership and lifecycle contract

### 12.1 Public root ownership

The root borrows the container and supplied `ReactiveCore`. It owns only:

- nodes created or explicitly registered by that root;
- binding computations created for its view;
- signal subscriptions created for those computations;
- native listeners registered through its host context; and
- child component/region records introduced by the root.

It does not clear a container, adopt arbitrary existing children, dispose
application signals, or dispose a borrowed runtime on unmount.

### 12.2 Lifecycle states

The public façade should expose or diagnose states equivalent to the internal
`created`, `mounting`, `mounted`, `unmounting`, `unmounted`, `cleanup_failed`,
and `disposed` states. A public API may hide the enum while preserving the
same transition rules.

Mount must establish all resources and perform initial updates before reporting
`mounted`. Failure rolls back registered resources in reverse ownership order
and preserves the original error plus cleanup diagnostics. Unmount marks the
root busy, invalidates binding records, disposes renderer computations and
subscriptions, removes listeners and owned nodes, then releases the container
claim. Disposal is permanent. A root that was successfully unmounted cannot
be remounted; a new root may claim the released container.

### 12.3 External DOM changes

The host must validate ancestry and ownership before a binding or structural
operation. If application code removes or moves an owned node, the renderer
must fail closed rather than recreate or mutate a guessed target. A future
diagnostic observer may improve reporting, but garbage collection or
`isConnected` alone cannot define ownership.

## 13. TypeScript package and compiler integration

### 13.1 Package responsibilities

`packages/ruseact` should remain responsible for the runtime bridge,
`ReactiveCore`, signal/computation types, and future compiler-facing shared
types that do not import DOM classes.

`packages/ruseact-dom` should own the public renderer façade, DOM host
operations, root ownership, binding/region execution, listeners, and browser
errors once M4.2 is approved. Its public exports should not expose internal
host records, raw WASM bindings, or numeric identities.

A future compiler package or build plugin should emit the versioned template
module. It should not own DOM objects and should not import private host
modules. Keeping compiler output as ordinary JavaScript plus metadata avoids
requiring Rust to understand lexical closures.

### 13.2 JSX/TSX integration options

Possible future integration paths include:

1. a TypeScript `jsxImportSource` runtime that lowers JSX calls to a compiler
   template factory;
2. a standalone transform that emits `TemplateIRV1` plus generated expression
   functions; or
3. a build plugin that selects compiled templates and a conservative runtime
   fallback for unsupported syntax.

Recommend starting with a standalone transform or explicit build plugin so
the emitted output can be snapshot-tested before adding a package-level JSX
namespace. No JSX namespace, `jsx-runtime`, TypeScript transformer, Babel
dependency, or compiler dependency is added in M4.1.

### 13.3 Runtime initialization

The current `createReactiveCore(loadWasm)` keeps WASM loading explicit. M4.2
should accept a ready `ReactiveCore` and leave module loading to application
bootstrap. A later package may provide a browser loader, but it must preserve
the ability to report initialization errors and the ownership of the runtime.

## 14. Conceptual developer examples

All examples in this section are proposed syntax. None is currently
executable as a public Ruseact API.

### Static Hello World

```ts
const root = createRoot(container, runtime);
root.mount(template(() => text("Hello, world!")));
```

Currently executable equivalent: the internal M3.4 imperative mount scope can
create and append a text node in a hosted test, but `createRoot` and
`template` are not public.

### Reactive counter

```ts
const count = runtime.createSignal(0).value;
const view = template(() => dynamicText({
  read: () => runtime.get(count),
  dependsOn: [count],
}));

root.mount(view);
runtime.set(count, 1);
root.flush();
```

The explicit dependency and flush match the current internal semantics. The
public façade, `template`, and compiler-generated slot do not yet exist.

### Native button event

```ts
button({
  text: "Increment",
  on: { click: () => increment() },
});
```

Handlers remain JavaScript closures and are removed with exact identity during
unmount. The host can do this internally today; the public helper is deferred.

### Reactive text

```ts
dynamicText({ read: () => runtime.get(message), dependsOn: [message] });
```

This is a proposed lowering of the existing explicit binding model, not
automatic tracking.

### Conditional rendering

```ts
when(() => runtime.get(isVisible), {
  then: () => template(() => text("Visible")),
  else: () => template(() => text("Hidden")),
});
```

This requires anchored regions, branch ownership, and structural cleanup. It
is deferred to the proposed M4.4 milestone.

### Keyed list

```ts
keyed(items, item => item.id, item => rowTemplate(item));
```

This requires an approved key equality rule, duplicate-key error, move policy,
and per-item cleanup. It is not a promise of unkeyed or React-compatible list
semantics.

### Nested component

```ts
function Counter(props: CounterProps): ViewDescription {
  return template(() => counterView(props.initial));
}
```

Component functions and instance identity are proposed only. M4.2 should not
execute general components before the ownership and closure rules are approved.

## 15. Benchmark-informed design review

### Verified evidence

The M2.5 report separates Rust-native, direct-WASM, TypeScript-wrapper, and
real-Chromium layers. The M3.5 report separates mount, invalidation, explicit
flush, targeted mutation, native-DOM reference, lifecycle, and cleanup phases.
Both suites require warmups, bounded calibration, raw samples, actual
operation counts, and strict integrity validation. Hosted Chromium is the
authoritative browser environment.

These reports verify measurement boundaries and valid artifact production;
they do not establish a framework-wide performance ranking. The native DOM
reference omits graph propagation, WASM conversion, binding lookup, and root
ownership, so it cannot be used as a Ruseact-versus-framework claim.

### Design implications

The following are architectural hypotheses to validate in later benchmarks:

- every binding slot adds JavaScript registry, dependency, and cleanup state;
- compiler-generated stable slots may reduce repeated structure work compared
  with a rerun-and-diff model;
- a public façade can add little cost if it delegates to the existing root,
  but descriptor validation and component instance allocation must be measured;
- structural regions may cost more than scalar bindings because they allocate
  anchors, child ownership records, and cleanup records; and
- automatic scheduling can change the measured signal-to-DOM phase by adding
  queueing and event-loop latency.

None of these hypotheses is a measured performance result. Future benchmarks
should record binding count, component count, dependency edges, DOM mutation
count, JS/WASM calls, flush count, and lifecycle cleanup separately. They
should compare only equivalent observable behavior on the same hosted browser
and toolchain.

### Required future measurements

Before selecting a compiler optimization or scheduler, measure:

- static mount with and without generated template metadata;
- one scalar binding versus grouped binding records;
- explicit dependency registration and dynamic dependency replacement;
- component setup and prop-driven updates;
- conditional branch creation/removal;
- keyed insertion, removal, and movement with focus/input state checks;
- root cleanup and retained resource counts using supported instrumentation;
- explicit flush versus an approved microtask policy; and
- compiler transform time separately from browser runtime time.

## 16. Risks and trade-offs

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| Public façade leaks internal M3 contracts | Future API compatibility burden | Approve result, ownership, and lifecycle types before export |
| Descriptor fallback diverges from compiler output | Different cleanup or identity behavior | Lower both paths to one internal mount plan and shared tests |
| Static dependency analysis misses reads | Stale DOM updates | Require explicit metadata or conservative fallback; never guess |
| Conservative dependency unions over-invalidate | Extra binding execution | Measure before optimizing; add tracking only with semantics |
| Re-executed components capture stale state | Incorrect closure behavior | Stable instance cells/accessors; defer hooks-like syntax |
| Structural identity is underspecified | Focus, selection, or input state loss | Keyed region contract and browser identity tests |
| Global destructive drain is shared | One root can consume another's work | Dedicated runtime per mounted root until scoped drain exists |
| Hidden scheduler changes ordering | Flaky or surprising updates | Manual flush baseline and explicit scheduling milestone |
| Compiler IR becomes ABI-like | Versioning and migration cost | Protocol/version fields, validation, source maps, rejection of unknown versions |
| Browser host rejects external mutation | Application integration failures | Fail closed, report target/root state, provide diagnostics later |

## 17. Open architecture decisions requiring human approval

The following choices must not be finalized by M4.1:

1. Whether to approve the explicit `createRoot(container, runtime)` façade.
2. Whether the first public root accepts only a `ReactiveCore` or also owns a
   runtime created from a loader.
3. Whether `mount` is permanently one-shot and whether a future `update(view)`
   exists at all.
4. The exact `ViewDescription` and `TemplateIRV1` shape, including whether
   generated expression functions are part of the module contract.
5. Whether static dependencies use explicit lists, compiler metadata, or a
   conservative union in the first compiler.
6. Whether and how dynamic tracking is added without changing `get` semantics.
7. Component identity, props snapshots, local state cells, closure freshness,
   and cleanup ordering.
8. Conditional region anchors, keyed-list equality, duplicate keys, moves,
   unkeyed behavior, and structural error recovery.
9. Manual flush as the permanent public default versus a later microtask
   scheduler and its signal-write notification mechanism.
10. Whether a future ABI can provide scoped or recoverable pending drains for
    shared-runtime roots.
11. Public error classes and whether errors are returned as `CoreResult`-
    compatible values, thrown exceptions, or a documented combination.
12. JSX runtime/package entry points and compiler version compatibility.

## 18. Proposed M4.2–M4.5 roadmap

These are proposed milestones, not approved implementation commitments.

### M4.2 — Public Renderer MVP

**Objective:** expose a narrow public façade over the verified internal root
and static/binding path.

**Prerequisites:** approval of root API, runtime borrowing, error shape,
static view plan, explicit dependencies, and one-pass flush semantics.

**Scope:** public `createRoot` façade, static element/text plan, scalar text,
attribute, and supported property slots, native listener ownership, explicit
flush, unmount, disposal, and typed diagnostics.

**Out of scope:** JSX compiler, general components, structural regions,
automatic tracking, scheduling, hydration, arbitrary signal values, and
`update(view)`.

**Correctness:** public duplicate-container rejection, stable node identity,
foreign/stale handle rejection, mount rollback, borrowed-resource survival,
explicit flush ordering, and browser cleanup.

**CI/acceptance:** existing Rust/TypeScript/WASM checks plus hosted Chromium
public-façade tests; no public API is released until the API review passes.

**Risk:** accidentally freezing an internal prototype as a permanent API.

### M4.3 — JSX/TSX Compiler MVP

**Objective:** emit versioned static templates and explicit binding metadata.

**Prerequisites:** approved IR version, source-location format, dependency
metadata policy, package boundary, and unsupported-syntax fallback.

**Scope:** static JSX elements/text, supported attributes/properties, explicit
dynamic slots, event handler closures, source maps, snapshots, and runtime
version validation.

**Out of scope:** arbitrary dynamic component trees, automatic tracking,
keyed lists, hooks, hydration, and scheduler transforms.

**Correctness:** preserve evaluation order, lexical scoping, text escaping,
attribute/property distinctions, explicit dependency behavior, and cleanup.

**CI/acceptance:** compiler snapshots plus hosted Chromium tests consuming the
generated module; transform output must not contain forged handles or DOM
objects.

**Risk:** incorrect static dependency inference or compiler/runtime version
drift.

### M4.4 — Components and Structural Rendering

**Objective:** add component instances, conditional regions, and a keyed list
algorithm with explicit ownership.

**Prerequisites:** component identity, child ownership, anchor order, key
equality, duplicate-key behavior, and structural error recovery approval.

**Scope:** one-time component setup, nested ownership, conditional branches,
keyed insert/remove/move, resource cleanup, and stable DOM identity tests.

**Out of scope:** unkeyed compatibility promises, hooks, concurrent rendering,
hydration, portals, and automatic scheduling.

**Correctness:** focus/input preservation for retained nodes, listener and
binding cleanup, duplicate-key rejection, deterministic moves, and rollback.

**CI/acceptance:** real Chromium structural tests, bounded identity benchmarks,
and explicit mutation-count reporting.

**Risk:** structural complexity can recreate a hidden reconciliation engine.

### M4.5 — Consumer and Runtime Integration

**Objective:** validate the approved public packages in the separate
`ruseact-examples` repository and measure realistic application behavior.

**Prerequisites:** published or pinned package output, stable public API,
compiler/runtime version policy, and example-repository coordination.

**Scope:** external Counter and small list consumers, package initialization,
browser loading, documentation, and end-to-end benchmark fixtures.

**Out of scope:** adding examples to this repository, React compatibility
claims, or cross-framework performance claims without equivalent workloads.

**Correctness:** consumer build, hosted browser behavior, cleanup, and version
compatibility.

**CI/acceptance:** separate repository PRs linked to the framework PR; artifact
versions and benchmark environments recorded.

**Risk:** consumer needs may pressure unresolved contracts prematurely.

## 19. M4.1 implementation boundary and handoff

M4.1 should change documentation only. It must not add exports, TypeScript
source, compiler transforms, package dependencies, WASM exports, Rust code,
browser tests, or example applications.

The M4.2 implementation handoff is the approved subset of the proposed
`RendererRoot` façade, static `ViewDescription`, explicit binding slots, and
manual flush. M4.2 must re-check the actual M3 APIs at implementation time and
stop if any required contract would need a runtime or ABI change.

The compiler team should not begin M4.3 until M4.2 proves that the public
façade can consume a plan without leaking private host or binding records. The
structural team should not begin M4.4 until keyed identity and cleanup are
approved. Example integration remains outside this repository until M4.5.

## 20. M4.2 approved subset implemented

The project owner approved the following M4.2 subset of this design:

- `ruseact-dom` exports `createRoot(container, runtime)` and typed
  `RendererRoot` lifecycle operations.
- `ViewDescription` is an immutable, one-shot `ruseact.template` version 1
  mount plan with stable local node IDs and explicit parent references.
- Static HTML elements/text, supported attributes/properties, native listeners,
  and scalar binding slots are supported.
- Binding dependencies are explicit signal-handle lists, while JavaScript
  retains evaluator closures and Rust remains responsible for invalidation.
- `RendererResult<T>` preserves the `CoreResult` shape and structured
  diagnostics.
- The façade delegates to the existing M3.2 host, M3.3 binding, and M3.4 root
  implementations; it does not create a second ownership registry, reactive
  graph, or lifecycle engine.

The implementation intentionally does not add `update(view)`, structural
regions, keyed lists, components, JSX/TSX transformation, automatic tracking,
microtask/frame scheduling, priority lanes, a virtual DOM, or React Fiber.
The M3.3 dedicated-runtime restriction and destructive pending-drain contract
remain part of the public MVP's documented limitations. M4.3 must define and
obtain approval for compiler output before generating plans automatically.

## 21. M4.3 compiler MVP implementation

M4.3 implements the narrow compiler direction needed by the approved M4.2
contract. The private `packages/ruseact-compiler` module parses TSX with the
TypeScript Compiler API and emits executable ESM containing `ViewDescription`
version 1 objects. It uses AST traversal and TypeScript emission rather than
regex parsing, `eval`, `Function`, or a JSX runtime.

The implemented syntax is lowercase HTML intrinsic JSX with static text,
static string attributes, `value`/`checked`/`disabled`, native event closures,
and explicit text/attribute/property binding slots. The compiler-only markers
`ruseact.bindText`, `ruseact.bindAttribute`, and `ruseact.bindProperty` require
explicit signal-reference arrays and structured-result evaluator closures.
They preserve lexical captures and read current signal values when the public
renderer executes a binding. They are provisional source syntax, not new
public runtime exports.

Generated templates have deterministic local node, slot, listener, and
template IDs and source metadata. Unsupported components, fragments,
conditional/list structure, spreads, unsupported namespaces/properties, and
implicit dependencies produce source-located compile diagnostics. The real
browser fixture compiles Hello World and a Counter and runs the generated
modules through M4.2 and Rust/WASM; component and structural semantics remain
the M4.4 handoff.

## M4.4.4 compatibility note

The later approved M4.4.4 subset adds protocol version 4 for keyed-only list
regions. It is implemented by the existing renderer rather than the generic
structural IR proposed earlier in this document. The version-4 capability uses
one explicit JavaScript collection revision signal, SameValueZero keys,
pre-mutation snapshot validation, private item/list anchors, retained
item-owned scalar signals, and deterministic native range movement. Unkeyed
lists, implicit dependency inference, and generic mutable-tree reconciliation
remain unsupported. The authoritative detail is in
[docs/m4.4.4-keyed-lists.md](m4.4.4-keyed-lists.md).

## M4.5.1 package distribution note

The existing renderer/compiler contracts are packaged for isolated
verification as private synchronized `0.1.0-alpha.0` tarballs. `ruseact` and
`ruseact-dom` remain the runtime package boundary, while `ruseact-compiler`
remains build-time tooling. The package build emits ESM, declarations, source
maps, and the release WASM assets without changing template protocols 1–4,
manual flush, ownership, or error semantics. The compiler is not imported by
the browser runtime.

The distribution pipeline preserves canonical runtime identity by making DOM
runtime imports resolve through the installed `ruseact` package. It keeps WASM
initialization explicit through `createReactiveCore(loadWasm)` and verifies
installed artifacts in a temporary external consumer, including real Node and
Chromium execution. Tarball production, manifest checksums, and local
verification are described in
[docs/m4.5-package-distribution.md](m4.5-package-distribution.md). This is not
npm publication or a long-term API-stability claim.
