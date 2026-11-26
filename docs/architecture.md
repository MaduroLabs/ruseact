# Ruseact architecture decisions

This document records the M0 foundation, M1.1 signal, M1.2 dependency, M1.3
dirty-propagation, and M1.4 batching decisions. It describes architecture
boundaries, constraints, and the runtime contracts completed so far.

## Decision 1: RustReactiveCore is the reactive engine

`crates/ruseact-core` is the future home of platform-independent reactive graph
state: signal identities, subscriptions, dirty propagation, batching, and
mutation intents. It must not import browser APIs, `wasm-bindgen`, or DOM types.

The core does not contain a component tree, a virtual-DOM diff, or React Fiber.
Any scheduling behavior introduced after M0 must be specified with deterministic
Rust tests before it is connected to a host.

## Decision 2: WASM is an explicit bridge

`crates/ruseact-wasm` is a thin adapter between the core and JavaScript. It will
own the ABI, initialization, disposal, stale-handle behavior, and bounded batch
shapes. DOM objects and JavaScript callbacks remain owned by JavaScript. M0
creates the crate boundary but intentionally defines no ABI or
`wasm-bindgen` exports.

## Decision 3: TypeScript packages own the browser-facing surface

`packages/ruseact` is the public TypeScript/JSX and future compiler integration
boundary. `packages/ruseact-dom` is the future browser host adapter for DOM
operations and event lifecycle. M0 creates only package entry points; it does
not implement a compiler, renderer, hooks, or a scheduler.

The package boundaries do not claim React API compatibility. Any compatibility
surface requires an explicit semantic design and tests.

## Decision 4: Examples remain a separate repository

Consumer applications belong in the sibling `ruseact-examples` repository.
This repository contains no example applications and no sibling-path package
dependencies. Consumer checks will use published or explicitly pinned tarballs
once the packages have buildable output.

## Decision 5: Reproducible workspace tooling

- Rust is selected by `rust-toolchain.toml`, currently Rust `1.99.0` with
  `rustfmt`, `clippy`, and `wasm32-unknown-unknown`.
- Node is selected by `.nvmrc`, currently `24.22.3`.
- pnpm is pinned by the root `package.json` `packageManager` field to
  `12.16.1`; `pnpm-lock.yaml` is checked in and CI uses frozen installs.
- CI runs Rust and TypeScript checks on both Ubuntu and macOS. Skill structure
  validation runs as a separate required check.

## Decision 6: M1.1 signal foundation

M1.1 introduces the smallest graph-owned signal API in
`crates/ruseact-core`: `ReactiveGraph::create_signal`, `ReactiveGraph::read`,
`ReactiveGraph::set`, and explicit disposal. `Signal<T>` is a typed,
copyable, non-owning handle; the graph owns the value and its lifecycle. The
core does not infer ownership from a handle drop, and it does not expose
component, hook, or renderer concepts.

`NodeId` contains a process-local `GraphId`, a `u32` slot index, and a `u32`
generation. `GraphId` is allocated atomically when a `ReactiveGraph` is
created, so two graphs cannot have colliding node identities even when both
use the same slot index and generation. `read`, `set`, `dispose`, and the
public `dispose_node` API reject a node whose `GraphId` belongs to another
graph with `SignalError::InvalidNode` before looking up a slot.

A disposed slot increments its generation before it can be reused, so an old
handle is rejected instead of reading or writing a replacement value.
Generations do not wrap: a slot whose generation reaches `u32::MAX` is retired
rather than reused. `ReactiveGraph::try_new` exposes graph-ID allocation
exhaustion as `GraphError::IdExhausted`; `ReactiveGraph::new` remains the
convenience constructor and panics only when that process-wide ID space is
exhausted.

Signal values are type-erased inside the heterogeneous graph and require
`'static` storage. Signal creation and writes require `PartialEq`. `set`
returns `SignalUpdate::Changed` only when the new value is unequal, otherwise
it returns `SignalUpdate::Unchanged` and leaves the stored value untouched.
No subscribers, dirty queue, batching, callbacks, mutation intents, or WASM
exports are part of M1.1; later milestones must define those semantics before
adding them.

## Decision 7: M1.2 explicit dependency metadata

M1.2 adds graph-owned computation metadata without adding computation bodies or
execution. `ReactiveGraph::create_computation` returns a graph-scoped,
generational `ComputationId`; the graph owns its metadata and disposal is
explicit. A disposed computation slot increments its generation and a slot
that reaches `u32::MAX` is retired. The explicit dependency API is
`subscribe`, `unsubscribe`, `replace_dependencies`, and
`dispose_computation`; none of these operations mark work dirty or invoke a
callback.

Each live signal stores its subscriber computation IDs, and each live
computation stores its signal `NodeId` dependencies. The graph updates both
directions together. Subscription and unsubscription are idempotent and return
whether an edge was added or removed. Dependency replacement validates every
requested signal before mutating the old set, removes duplicates while
preserving first-seen order, and replaces both sides of the relationship.

Disposing a signal removes that signal from every computation's dependency set;
disposing a computation removes it from every signal's subscriber set. Both
`GraphId` and generation are validated for every dependency operation, so
foreign and stale signal or computation handles return `DependencyError`.
`replace_dependencies` accepts `NodeId` values rather than one typed signal
slice because a computation may depend on signals of different Rust types;
this also leaves a small identity-level boundary for future compiler-assisted
dynamic tracking. Automatic tracking, scheduling, callback execution, and
WASM exports remain outside M1.2.

## Decision 8: M1.3 deterministic dirty propagation

M1.3 connects M1.1 equality-aware writes to M1.2 subscriber metadata without
adding computation execution. A changed `ReactiveGraph::set` copies the live
subscriber IDs of that signal and marks them dirty. An equal write returns
`SignalUpdate::Unchanged` and does not mark or enqueue any computation.

The graph owns one ordered pending queue and one dirty bit per live
computation. A computation is appended only on its first dirty transition, so
multiple changed signals or multiple writes before a drain produce one queue
entry. Queue order is deterministic: it is the order in which computations are
first marked dirty, following signal write order and each signal's stable
subscriber insertion order. `ReactiveGraph::drain_pending_computations`
removes the queue, clears dirty state for returned live IDs, and returns the
IDs without executing callbacks, computation bodies, DOM work, or JavaScript.

The drain is the explicit coalescing boundary for M1.3. A changed signal after
draining may enqueue the same computation again; an equal write after draining
does not. Dependency edits and signal disposal clean up graph edges but do not
retract an already-pending notification for a still-live computation. This
preserves the identity-level notification already issued while ensuring future
writes use the updated dependency set. Disposing a computation removes its
queued ID before its generation can be reused, so draining never returns stale
computation work. Internal enqueue and drain paths validate graph identity and
computation generation, preserving cross-graph isolation and generational
safety.

M1.3 has no automatic flush, priority, concurrent execution, callback
invocation, mutation intent, WASM ABI, compiler integration, or DOM behavior.
M1.4 defines batching separately below rather than inferring it from the queue.

## Decision 9: M1.4 deterministic nested batching

M1.4 adds the explicit `ReactiveGraph::begin_batch` and
`ReactiveGraph::end_batch` boundaries. The graph stores a checked nesting depth;
`begin_batch` increments it and `end_batch` decrements one level. An
`end_batch` call without a matching begin returns `BatchError::NotActive`, and
an increment that would overflow the depth returns `BatchError::DepthOverflow`.
Neither error mutates graph state or pending work.

Batching does not defer signal writes or dirty marking. Each changed signal
still stores its final value and marks live subscribers immediately, using the
M1.3 dirty bit and deterministic FIFO queue. Multiple writes and multiple
signals therefore retain the existing queue order and deduplication rules.
Signal values remain readable throughout a batch.

While the batch depth is non-zero, `drain_pending_computations` returns an
empty vector without taking the pending queue or clearing any dirty bit. An
inner `end_batch` leaves this gate active. Only the matching outermost
`end_batch` makes all accumulated pending IDs drainable; ending the batch does
not automatically drain or execute them. After draining, later writes may
enqueue the same computation again under the existing M1.3 rules.

Computation and signal disposal retain their M1.3 lifecycle behavior during a
batch: disposed computations are removed from pending work, and signal
disposal removes dependency edges without fabricating stale computation IDs.
Batching adds no computation execution, scheduling priority, concurrent
rendering, effect execution, JavaScript callback, DOM, compiler, or WASM ABI
behavior.

## Decision 10: M1.5 verification and native baseline

M1.5 adds verification coverage and a manually runnable benchmark harness; it
does not add runtime behavior. Core tests include an independent deterministic
reference model for mixed signal writes, dependency replacement, subscription
churn, queue draining, and nested batches. Test-only invariant checks inspect
both directions of every dependency edge, live pending IDs, dirty flags,
active-slot counts, graph identity, and generation validity. A separate
lifecycle stress test exercises 256 signal/computation allocation and disposal
cycles, including cross-graph handle rejection and slot generation changes.

The benchmark at
`crates/ruseact-core/benches/core_baseline.rs` uses only the standard library
and is registered as a custom Cargo bench target. It runs five measured trials
after two warmups for 16-, 64-, and 256-signal fixtures. It reports creation,
read, changed and unchanged write, subscription, unsubscription, dependency
replacement, dirty-propagation plus drain, pending-queue drain, batched update,
and computation-cleanup timings. Setup is excluded from timed sections where
the fixture can be prepared independently; the benchmark records operation
counts and affected computations so results can be reproduced and compared
within the same Rust-native environment.

The measured results are a baseline for this implementation, not a performance
claim against another framework. The design implies linear work in the number
of affected subscribers for propagation and in the pending queue for draining.
Dependency replacement and disposal additionally scan `Vec`-backed edge lists;
their graph-size behavior is recorded as an architectural finding rather than
optimized speculatively. Browser, JavaScript, WASM-bridge, DOM-commit, memory,
and end-to-end application performance remain unmeasured until those layers
exist.

## Decision 11: M2.1 WASM ABI is a documentation-only proposal

M2.1 defines a candidate boundary between the TypeScript runtime, a future
`ruseact-wasm` adapter, and the platform-independent RustReactiveCore. The
focused proposal is in [docs/wasm-abi-design.md](wasm-abi-design.md).

### Verified facts

The current core exposes graph-scoped `NodeId` and `ComputationId` values with
slot generations, typed signal storage behind `Box<dyn Any>`, explicit
dependency operations, deterministic pending computation draining, and nested
batch boundaries. `GraphId` is process-local. The WASM crate has no exports,
and the TypeScript and DOM packages have placeholder entry points. No current
WASM or JavaScript ABI is therefore an existing contract.

### Proposal, pending approval

The recommended boundary uses a Rust-owned graph, explicit disposal, opaque
TypeScript wrappers with an instance owner, fixed-width validated identity
fields, a closed scalar value set, structured error results, and a copied
typed-array representation for internal pending-ID transfer. The public API
must never expose Rust references, pointers, arbitrary `Box<dyn Any>` values,
or computation callbacks. A bridge must preserve M1 equality, generation,
dependency, queue-order, and batch-drain behavior.

### Alternatives and open decisions

Packed numbers, structured handles, and opaque wrappers have different size,
debuggability, and forgery trade-offs. The exact handle layout, scalar value
tags and number semantics, graph-disposal boundary, error result policy,
pending-ID wire layout, WASM binding technology, and worker-transfer policy
require human approval before M2.2. M2.1 does not implement or silently
choose any of these runtime contracts.

## Decision 12: M2.2 approved Rust WASM exports

M2.1 was reviewed and its MVP choices were explicitly approved before this
bridge was implemented. The implementation is limited to the Rust adapter in
`crates/ruseact-wasm`; `ruseact-core` remains independent of JavaScript,
`wasm-bindgen`, the DOM, and browser APIs.

### Implemented boundary

`WasmCore` owns exactly one `ReactiveGraph` and stores the typed signal and
computation records needed to validate opaque handles. `dispose` drops the
graph and clears the bridge registries. A second disposal and every operation
after disposal return the stable `disposed_instance` error; no finalizer is a
correctness mechanism.

Each handle carries private bridge identity fields: a per-`WasmCore` instance
token, the graph ID, resource kind, slot index, and generation. The bridge
validates all of them and then asks the core to validate the live generational
identity. Signal and computation handles therefore cannot be used across core
instances, graphs, resource kinds, or disposed/reused slots. Dependency lists
are also bound to their creating core instance and graph, and all dependency
handles are validated before atomic replacement.

The exposed scalar set is `boolean`, finite `f64`, and UTF-8 string. `null`,
`undefined`, arrays, objects, functions, symbols, `NaN`, and infinities are
rejected. The bridge delegates equality to the existing core, including
`+0.0 == -0.0`; it does not introduce a separate integer representation or
change core `PartialEq` behavior.

The bridge exposes graph disposal, scalar signal create/read/write/dispose,
metadata-only computation create/dispose, subscribe/unsubscribe, dependency
replacement, nested batch boundaries, and pending-work draining. It never
executes computations or accepts JavaScript callbacks. Rust `Result` errors
are mapped to JavaScript exceptions whose thrown value is a plain structured
object with stable `code` and `operation` fields plus optional resource,
index, and generation fields. Internal invariant errors remain distinct from
expected stale, foreign, type, lifecycle, and batch failures.

Pending computation transfer calls the existing core drain operation only after
the active-batch gate has been applied. The result is copied into a
`Uint32Array` as FIFO `(slot, generation)` pairs. No Rust reference or pointer
crosses the boundary, and no computation body runs as part of a drain.

The bridge is built as a `cdylib` and `rlib` for `wasm32-unknown-unknown` using
`wasm-bindgen` `0.2.130` and `js-sys` `0.3.107`. The checked-in
`scripts/test_wasm_bridge.mjs` smoke test exercises real Node/WASM calls for
scalar round trips, equality-aware writes, dependency operations, nested
batching, FIFO pending transfer, stale/foreign handles, and disposal.

### Deliberate limits and handoff

This decision does not add a public TypeScript wrapper, worker serialization,
automatic garbage-collection disposal, computation execution, scheduling,
DOM integration, compiler integration, or arbitrary JavaScript object storage.
M2.3 may build ergonomic TypeScript ownership wrappers on top of this bridge;
it must preserve the opaque-handle and structured-error contracts and add the
broader real-runtime integration matrix. Browser and worker transfer behavior
remain unmeasured and unsupported until those milestones are designed.

## Decision 13: M2.2.1 validated computation identity metadata

M2.3 was blocked because the existing `Uint32Array` pending-drain format could
not be associated with the original opaque computation handles without either
guessing allocation order or adding an unsafe numeric-handle constructor. The
approved M2.2.1 extension adds only a validated identity accessor; it does not
redesign the ABI or change `ruseact-core`.

`WasmCore.computation_identity(computation)` validates the active instance,
graph, resource kind, slot, generation, and live computation registry through
the same `validate_computation` path used by computation operations. It returns
a newly copied `Uint32Array([slot, generation])`. Reading identity metadata is
non-mutating: it does not alter dependencies, dirty state, or the pending
queue. The same pair format is therefore available both from a legitimate
computation handle and from `drain_pending_computations()`.

The pair is metadata scoped to its owning `WasmCore` instance, not an
authenticated handle. The bridge intentionally does not expose
`resolve_computation_handle(slot, generation)`, a public handle constructor, or
writable identity fields. Foreign, stale, wrong-kind, malformed, and
post-disposal inputs continue to produce the existing structured error codes.

The future M2.3 TypeScript wrapper must register the original opaque handle
immediately after `create_computation()` by calling `computation_identity()` and
keying a per-instance map by `(slot, generation)`. It must resolve pending
pairs only by looking them up in that map, remove entries on computation
disposal, and clear the map on graph disposal. An unknown pending pair is an
internal consistency failure and must not be silently dropped or mapped to a
different handle.

The existing bridge drain implementation still checks its bridge registry
after the core has returned (and therefore consumed) pending work. A registry
mismatch is an impossible internal invariant under normal operation, but a
failure at that point could lose already-drained work. M2.2.1 records this as a
separate transfer-atomicity issue and does not silently change the established
drain contract.

## Decision 14: M2.3 TypeScript runtime bridge

M2.3 adds an ergonomic TypeScript boundary over the approved M2.2/M2.2.1
exports. It does not add a second reactive engine. `ReactiveCore` delegates
signal storage, equality, dependencies, dirty propagation, batching, and
pending work to one bridge-owned `WasmCore` instance.

### Initialization and ownership

`createReactiveCore(loadWasm)` is asynchronous and accepts an explicit loader
for a generated wasm-bindgen ES module. The repository does not commit a WASM
artifact or select a browser bundler, so the loader keeps Node and future
browser integration separate without machine-specific paths. Once initialized,
the public operations are synchronous and return `CoreResult<T>`.

The runtime owns exactly one `WasmCore`. Public signal and computation wrappers
are non-owning opaque objects. Internal `WeakMap` state associates each wrapper
with its owning runtime, its raw WASM handle, and its liveness. Strong sets
hold the internal states only long enough to release raw wasm-bindgen wrappers
during explicit graph disposal. No `FinalizationRegistry` is a correctness
mechanism.

### Public values and errors

The runtime accepts only boolean, finite number, and string signal values. It
rejects `NaN`, infinities, `null`, `undefined`, arrays, objects, functions, and
symbols before crossing the boundary. Rust remains authoritative for value
storage and `PartialEq` behavior. Expected bridge exceptions are normalized to
stable `CoreError` objects with `kind`, `code`, `operation`, and optional
resource metadata. Internal invariant failures are returned as `kind: "internal"`;
unknown non-structured exceptions are thrown as unexpected runtime failures.

### Opaque handles and computation registry

`SignalHandle<T>` and `ComputationHandle` have protected constructors and are
created only by the runtime's internal factories. The package entry point does
not export those factories or raw WASM classes. Runtime state checks reject
unknown wrapper objects, foreign runtime ownership, stale resources, and
post-disposal use before bridge calls; Rust independently validates every raw
handle.

On computation creation, the runtime calls `computation_identity()` on the
legitimate raw handle, validates exactly two `Uint32` entries, and registers
the original handle under a per-instance string key `"slot:generation"`.
This representation is collision-free for two `u32` values and is never
exposed as an authenticated public handle. Pending drain pairs are validated
for `Uint32Array` type and even length, then resolved only through this map in
FIFO order. An unknown pair is an internal consistency failure; no new WASM
handle is constructed and no pair is silently skipped.

Disposing a computation first disposes it in Rust, then removes its registry
entry, invalidates the wrapper, and frees the temporary wasm-bindgen handle.
Graph disposal invalidates all wrappers, clears registries, frees raw resource
wrappers, and releases the bridge object. Dependency lists are created for one
atomic replacement and explicitly freed in a `finally` path.

This milestone intentionally does not implement automatic dependency tracking,
computation execution, scheduling, DOM rendering, JSX compilation, browser
bundler packaging, worker transfer, or React Hooks. The M2.4 handoff is a
browser/bundler integration matrix over this loader boundary, including real
browser WASM initialization, package output, and host-renderer integration.

## Decision 18: M2.4 browser and WASM integration verification

M2.4 verifies the existing M2.3 runtime in a browser without changing the
RustReactiveCore or WASM ABI. A release `wasm32-unknown-unknown` artifact is
adapted with the matching `wasm-bindgen` CLI using `--target web`. The generated
ES module and adjacent `.wasm` file are served by a temporary HTTP server with
the required JavaScript and WebAssembly MIME types. The browser harness loads
the module through the existing explicit `createReactiveCore(loadWasm)` boundary,
so runtime operations remain synchronous after asynchronous module
initialization.

The harness uses native browser ES modules and a Chromium executable. It
exercises scalar round trips and equality, dependency operations, nested batch
draining, FIFO pending identity resolution, multiple runtime instances,
structured operational errors, stale handles, and explicit disposal. It does
not implement DOM rendering, computation execution, scheduling, JSX, or
automatic dependency tracking. The browser test is bounded, uses a dynamically
assigned loopback port, waits for the server to bind before launching the
browser, records requests, and cleans up its temporary server, profile, and
generated runtime output.

The authoritative browser environment is the GitHub-hosted `ubuntu-latest`
runner defined by the CI workflow. In the current InstaBox environment,
Chromium can access external HTTPS resources but cannot reach the local HTTP
server; this is recorded as a local-environment limitation rather than treated
as evidence about the runtime. Local Rust, WASM-build, TypeScript, and Node/WASM
checks remain useful, while browser assertions are counted as passing only
when the hosted Chromium job executes them.

M2.4 does not claim compatibility with every browser, bundler, worker, or
packaging mode. The tested web-module path is the handoff for M2.5 performance
measurement; no rendering or browser performance conclusion is made.

## Decision 19: M2.5 measures the existing bridge without changing it

M2.5 adds test-only benchmark scripts and a manually dispatched hosted
workflow. The workload module runs the same deterministic fixtures through
generated direct WASM bindings and the public TypeScript runtime, then reuses
those workloads in real Chromium. The Rust-native M1.5 benchmark remains
unchanged and is reported separately.

The benchmark records signal conversion, dependency metadata, dirty queue
propagation, pending `(slot, generation)` transfer, explicit nested batching,
initialization, and lifecycle behavior for 16-, 64-, and 256-signal graphs.
Fixture construction is outside timed sections where possible; correctness
checks verify values, FIFO ordering, deduplication, generations, and cleanup.
No computation executes, no scheduler is added, and no production export,
algorithm, ABI, or public API is introduced for measurement.

The direct and TypeScript rows are intentionally not collapsed into one
"crossing cost." Public calls include wrapper validation, `CoreResult`
normalization, opaque-handle ownership checks, and pending registry lookup.
Only equivalent workloads may be compared, and combined overhead is labeled as
such. Pending transfer continues to use the existing destructive drain; M2.5
does not add acknowledgement, rollback, or a bulk update protocol.

## Decision 20: M3.1 proposes a DOM renderer boundary without implementing it

M3.1 is a design-only milestone. Its full proposal is in
[docs/dom-renderer-design.md](dom-renderer-design.md). It does not change the
M2 RustReactiveCore, WASM ABI, TypeScript runtime, or `packages/ruseact-dom`
implementation.

The proposal recommends a hybrid rendering model: compiler-assisted static
DOM templates with fine-grained JavaScript-owned bindings as the primary path,
and a small explicit runtime descriptor fallback while compiler work remains
pending. This is a proposed direction requiring human architecture approval,
not an approved public API or a performance claim.

The current M2 runtime can support only an explicit binding experiment. A
renderer could create a computation identity, subscribe it to explicitly
known signals, store the opaque `ComputationHandle` in a JavaScript registry,
drain pending identities at an explicit flush boundary, and apply a targeted
DOM operation. The identity is notification metadata; it is not an executable
callback. M2 still has no computation execution, automatic dependency
tracking, scheduler, component lifecycle, or DOM mutation API.

The proposed ownership boundary keeps graph values, dependency metadata,
dirty state, batching, and pending IDs in RustReactiveCore; handle validation
and transfer in the WASM bridge; public opaque handles and registry resolution
in TypeScript; and DOM nodes, event callbacks, binding records, root
ownership, and cleanup in the DOM adapter. Roots borrow containers and shared
runtime resources by default, own nodes and renderer-created computations,
and must invalidate bindings before unmount completes so stale pending work
cannot update detached nodes.

The design explicitly defers approval of view/template descriptors, explicit
flush semantics, automatic tracking, component identity, conditional and
keyed-list behavior, attribute/property policy, compiler output versioning,
external DOM mutation handling, and any future Rust mutation-intent protocol.
M3.2 must remain limited to the approved subset and must not introduce React
Fiber, a hidden scheduler, JSX compilation, or speculative runtime changes.

## Decision 21: M3.2 implements internal DOM host operations only

M3.2 implements the internal browser mutation layer described by the M3.1
proposal. The implementation is in `packages/ruseact-dom/src/host.ts`; the
package entry point remains empty so `createRoot`, `mount`, `flush`,
`unmount`, view descriptors, and binding APIs are not published or silently
finalized.

`createHostContext(document)` returns an internal host context. A caller must
explicitly `claimContainer` before using an existing element or document
fragment as a host parent. The context creates HTML elements with
`document.createElement`, creates text with `document.createTextNode`, and
uses `document.createElementNS` only for the explicitly supported HTML
namespace. SVG and other namespaces are rejected rather than falling back to
HTML.

The host supports owned `insertBefore`, append, and remove operations. Parent,
child, and anchor records are validated through a module-private `WeakMap`.
Nodes may move within their owning context through insertion, but foreign
parents, foreign documents, invalid anchors, invalid parent-child pairs, and
already-detached nodes fail with structured internal `DomHostError` values.
The host never adopts an unknown node implicitly and never removes an
unrelated container child.

Text and string attributes use native DOM APIs and skip writes when the
existing value is already equal. Attribute operations remain distinct from
property operations. M3.2 permits only the narrow `value`, `checked`, and
`disabled` properties on compatible HTML elements, validates value types, and
rejects arbitrary property names. Ordinary text is never interpreted as HTML.

Event listeners remain JavaScript-owned. The host stores the original handler,
type, capture semantics, options, and native wrapper in a per-context record;
duplicate registrations are idempotent, exact removal is required, and
context disposal removes all remaining native listeners. AbortSignal listener
options are intentionally unsupported until a signal-aware ownership contract
is approved.

Disposal marks the context inactive before cleanup, releases listener records,
removes owned nodes only when their parent and descendants are safe to mutate,
preserves unrelated DOM, and invalidates all ownership records. Later calls
fail with `disposed_context`. This is explicit resource cleanup, not a claim
of memory-leak freedom.

M3.2 changes no RustReactiveCore behavior, WASM ABI, TypeScript runtime
behavior, scheduling, computation execution, dependency tracking, component
execution, JSX compiler, or renderer-root lifecycle. Real DOM correctness is
verified by the separate hosted Chromium test command. M3.3 may consume this
internal host boundary when the public root and reactive-binding contracts
receive explicit approval.

## Decision 22: M3.3 implements an internal explicit binding prototype

M3.3 implements the narrow approved connection between the existing reactive
runtime and the M3.2 host. It does not change RustReactiveCore, the WASM ABI,
the public `ReactiveCore` interface, or the package entry point.

`packages/ruseact-dom/src/bindings.ts` provides the internal
`createBindingContext(host, runtime)` factory. A binding context borrows one
dedicated `ReactiveCore`, one `HostContext`, application-owned signals, and
DOM nodes. It owns only the computation handles and dependency subscriptions
created for its binding records. A module-private runtime ownership map rejects
two active binding contexts for the same runtime.

Registration creates a legitimate computation through `runtime`, replaces its
explicit dependency list atomically, validates the target through the host,
executes the JavaScript-owned update function once, and records the binding by
the opaque `ComputationHandle`. A failed initial update rolls back dependency
subscriptions and the computation. The update function must return a valid
`CoreResult`; it may read signals explicitly and call targeted host operations,
but Rust never receives or executes the JavaScript callback.

`flush()` invokes the existing destructive runtime drain once. It validates the
whole pending snapshot before executing it, resolves each handle through the
private map, and executes live bindings in the FIFO order supplied by Rust.
Reentrant flush, registration during flush, and context disposal during flush
are rejected. A signal write made by an update is not drained recursively and
therefore requires a later explicit flush. The report intentionally states
that pending work after the pass was not inspected because M2 exposes no
non-destructive pending-count operation.

An unknown pending handle fails closed with progress metadata rather than being
silently ignored. Because the existing global drain can consume work owned by
another computation before this check, the MVP requires a dedicated runtime
and does not claim safe shared-runtime renderer support. This limitation is
documented rather than repaired through a new scoped-drain ABI.

Binding disposal marks the record inactive before unsubscribing dependencies
and disposing its computation. Context disposal repeats that cleanup for every
record, releases its runtime ownership marker, and leaves the borrowed runtime,
signals, host context, and DOM nodes alive. A detached target is rejected by
the host ownership boundary and its binding is cleaned up before the flush
reports the failure. No scheduler, automatic dependency tracking, component
execution, compiler, public root API, or virtual DOM is introduced.

## Decision 23: M3.4 implements an internal root lifecycle coordinator

M3.4 adds `packages/ruseact-dom/src/root.ts` as a narrow internal coordinator
over the M3.2 host and M3.3 binding contexts. It does not export a public
`createRoot` API, finalize a view descriptor, or change the RustReactiveCore,
WASM ABI, public TypeScript runtime, or package entry point.

`createRootContext(container, runtime)` validates an Element or
DocumentFragment, records a module-private container ownership token, creates
one HostContext, and claims the container through the existing host ownership
registry. The root borrows the container and ReactiveCore. A second active
root for the same container fails with `duplicate_root`; unrelated existing
container children are never cleared or adopted.

The internal mount boundary is an imperative callback receiving a restricted
`RootMountScope`. The scope delegates node creation, insertion, text,
attribute, property, listener, and explicit binding registration to the
existing host and binding contexts. It does not expose host or binding
disposal, does not define a permanent view/template format, and does not
execute components. A BindingContext is created when mounting begins, so one
active mounted root still consumes at most one dedicated ReactiveCore pending
queue. A second root may be created with the same runtime, but its mount fails
closed with the existing `runtime_in_use` contract while another binding
context is active.

The lifecycle states are `created`, `mounting`, `mounted`, `unmounting`,
`unmounted`, `cleanup_failed`, and `disposed`. Mount performs setup through the
imperative scope and marks the root mounted only after setup and initial
binding updates succeed. On failure, binding-context disposal occurs before
host disposal; host cleanup removes only nodes and listeners owned by the
attempt. The original setup error is returned when cleanup succeeds. If
cleanup fails, the root enters `cleanup_failed`, reports a separate cleanup
error, and retains its container ownership token rather than permitting a
second root to guess whether resources remain.

`flush()` delegates exactly once to the existing M3.3 binding flush and is
valid only in `mounted`. It preserves FIFO ordering, deduplication, one-pass
behavior, reentrancy rejection, and the destructive global-drain limitation.
No scheduler, recursive drain, automatic dependency tracking, or event-to-flush
behavior is added.

Unmount marks the root as transitioning, disposes renderer-created bindings,
subscriptions, and computations, then delegates listener and node cleanup to
HostContext. Successful unmount releases the root container token and is
idempotent. A new root may then reuse the container; the old root cannot be
remounted. Root disposal permanently closes the root but never disposes the
borrowed ReactiveCore or application-owned signals. A failed or externally
detached target remains fail-closed through the existing host ownership checks.

The hosted `test:browser:root` harness verifies static construction, explicit
text/attribute/property bindings, batching and FIFO flush, reentrancy, event
cleanup, duplicate containers, separate runtimes, shared-runtime rejection,
mount rollback, foreign-node rejection, detached targets, unmount, disposal,
borrowed-resource survival, and container reuse. This internal prototype does
not establish public component, compiler, scheduler, keyed-list, hydration,
or React-compatible lifecycle semantics.

## Decision 24: M3.5 validates the existing internal DOM path without extending it

M3.5 adds test-only end-to-end browser coverage and a separate benchmark
harness. The correctness path uses the existing generated Rust/WASM module,
TypeScript `ReactiveCore`, internal M3.4 root context, M3.3 explicit bindings,
and M3.2 native host operations. It verifies the actual transition from a
signal write through dirty propagation and explicit pending-work flush to a
targeted DOM mutation. No second reactive engine, public root API, scheduler,
automatic dependency tracking, compiler, or WASM ABI change is introduced.

The benchmark separates initial mount, no-op writes, changed writes with an
explicit flush, multi-write flushes, fan-out, independent bindings,
attribute/property updates, and teardown. Setup, timed operations,
validation, and cleanup are distinct. Workloads are bounded at 1, 10, 100,
and 1000 bindings and use the established M2.5 adaptive calibration and
integrity rules: warmup, bounded retries, actual operation counts, finite
positive samples, timer-aware acceptance, and explicit unresolved diagnostics.
The benchmark records medians and distribution metadata; it does not impose
performance pass thresholds or make cross-machine speed claims.

A direct native-DOM reference repeats comparable element, text,
attribute/property, and lifecycle mutations. It is a host-operation baseline
only: it has no Rust graph, WASM bridge, binding lookup, explicit flush, or
root ownership semantics. Its values must not be presented as a comparison
against Ruseact or another framework.

The M3.5 browser harness runs in hosted Chromium because the current InstaBox
cannot reliably route Chromium to its temporary loopback HTTP server. Browser
artifacts record the commit, browser, Node, Rust, wasm-bindgen, workload,
calibration, and integrity metadata. Public view descriptors, components,
compiler output, scheduling, and future renderer API decisions remain outside
this validation milestone.

## Decision 25: M4.1 defines a public renderer/compiler contract without implementing it

M4.1 is documentation-only. It starts from the verified M3.5 runtime and
defines candidate public renderer, view, component, structural-region, and
compiler-output contracts. No candidate in the design is an approved public
signature, and no package export, compiler transform, scheduler, WASM export,
Rust change, or example application is added by this milestone.

The recommended direction is a small public façade over the internal M3.4
root lifecycle. The candidate façade accepts a borrowed `ReactiveCore`,
mounts one static view plan, provides explicit one-snapshot `flush`, and
supports deterministic unmount and permanent disposal. M4.2 should not add
`update(view)` until structural identity is defined. A second active mounted
root continues to require a dedicated runtime because the M3.3 pending drain
is global and destructive.

The proposed view direction is a hybrid: compiler-assisted static templates
with stable fine-grained binding slots as the primary path, plus a narrow
imperative/descriptor fallback that lowers to the same internal mount plan.
The design intentionally does not introduce a virtual DOM or a global diff.
Static nodes, text/attribute/property operations, JavaScript listener
closures, explicit dependencies, source locations, and future region anchors
are represented as versioned metadata. Generated JavaScript resolves actual
signal handles and retains lexical closures; the compiler never constructs
opaque WASM handles, stores DOM objects in Rust, or classifies arbitrary
identifiers as reactive.

The first component recommendation is a conservative hybrid: one-time
component setup with targeted binding updates, followed by separately approved
anchored conditional and keyed-list regions. Component identity is a
JavaScript renderer concept and must not be conflated with a Rust computation
identity. Hooks-like state, automatic dependency tracking, unkeyed list
semantics, hydration, and React API compatibility remain deferred.

Manual explicit flush remains the only supported scheduling semantics. A
future microtask or frame scheduler would require a separate decision about
signal-write notification, event ordering, errors, reentrancy, and shared
runtime isolation. The M4.1 design and proposed M4.2–M4.5 roadmap are
recorded in [docs/m4-public-renderer-compiler-design.md](m4-public-renderer-compiler-design.md).

## Decision 26: M4.2 implements the approved public renderer MVP

M4.2 implements the explicitly approved subset of the M4.1 design in
`packages/ruseact-dom/src/renderer.ts` and re-exports it from the package
boundary. The public `createRoot(container, runtime)` function returns a
structured `RendererResult`; the returned `RendererRoot` exposes typed
`state`, `mount(view)`, `flush()`, `unmount()`, and `dispose()` operations.
The façade delegates to the existing M3.4 `RootContext` and does not duplicate
root ownership, DOM host operations, or binding execution.

The public view contract is an immutable one-shot `ViewDescription` with the
`ruseact.template` protocol, version `1`, a template identity, and an
`instantiate({ runtime })` function. The resulting `ViewInstancePlan` contains
static element/text nodes with stable local IDs and explicit parent references,
native listener instructions, and scalar text/attribute/property binding slots.
The executor validates IDs, parent relationships, cycles, supported HTML
namespace and property operations, target kinds, duplicate slots, explicit
dependencies, and listener metadata before applying the plan through the
existing staged-subtree mount scope. It creates nodes once and never compares
or reconciles mutable view trees.

Binding evaluators remain JavaScript-owned. They receive the borrowed
`ReactiveCore`, return the existing structured result shape, and use explicit
signal dependencies. `root.flush()` delegates to the M3.3 one-snapshot FIFO
flush: queue deduplication, reentrancy rejection, deferred work, unknown
pending failure, and the global destructive-drain limitation are unchanged.
No automatic tracking, microtask or frame scheduler, recursive drain, or
priority lane is introduced.

The root borrows the runtime and container and owns only renderer-created
nodes, listener registrations, binding computations, and subscriptions. The
existing one-shot lifecycle and fail-closed cleanup behavior remain in force;
successful unmount permits a new root to claim the container, while the old
root cannot remount. Application signals and the borrowed runtime are never
disposed by the renderer. Each active mounted root still requires a dedicated
ReactiveCore under the current global pending-drain contract.

M4.2 does not implement JSX/TSX compilation, components, structural regions,
keyed lists, `update(view)`, automatic scheduling, a virtual DOM, React Fiber,
or React API compatibility. Compiler output and future structural contracts
remain subject to the M4.3/M4.4 approvals described in
`docs/m4-public-renderer-compiler-design.md`.

## Decision 27: M4.3 implements a private JSX/TSX compiler MVP

M4.3 adds `packages/ruseact-compiler/src/index.ts`, an internal transform that
uses the repository-pinned TypeScript Compiler API in TSX mode. It emits ESM
whose JSX expressions produce the implemented M4.2 `ViewDescription` protocol
and version `1`; it does not introduce another renderer or a new renderer
protocol. The compiler package is private and is not exported from the public
`ruseact` or `ruseact-dom` entry points.

The supported subset is lowercase HTML intrinsic elements, static text and
string attributes, the existing `value`/`checked`/`disabled` property
contract, native event closures, and explicit scalar binding slots. Generated
node, binding, listener, and template IDs are deterministic local metadata.
Generated evaluators retain JavaScript lexical closures and read signal values
at execution time; signal handles are captured as JavaScript values and are
never serialized or constructed by the compiler.

Because M2–M4.2 provide only explicit dependency registration, M4.3 uses the
provisional compiler-only markers `ruseact.bindText`, `bindAttribute`, and
`bindProperty`. Each marker requires a non-empty array of explicit signal
references and an evaluator that returns a structured runtime result. These
markers are not public runtime APIs and do not establish implicit dependency
inference. A dynamic JSX value without a marker is rejected with a
source-located diagnostic.

The compiler rejects components, fragments, conditional structure, lists,
spreads, unsupported namespaces/properties, implicit dependencies, hooks, and
React-specific syntax. It uses AST nodes and TypeScript's printer/transpiler;
it does not use regex parsing, `eval`, `Function`, a JSX runtime, or string
execution. Browser fixtures compile Hello World and a counter and then use the
real M4.2 public renderer and Rust/WASM runtime. Hosted Chromium remains the
authoritative browser environment.

M4.3 does not add automatic tracking, scheduling, component execution,
structural reconciliation, a WASM ABI change, or a public compiler API. M4.4
must separately approve any component, conditional-region, keyed-list, or
dynamic-dependency contract.

## Decision 28: M4.4.1 defines a proposed component and structural contract

M4.4.1 is documentation-only. It audits the implemented M4.2 public static
renderer and M4.3 compiler and proposes a conservative path for future
components, conditional regions, and keyed lists. It does not add component
execution, structural DOM operations, compiler transforms, public exports,
Rust/WASM changes, or a scheduler.

The recommended direction is one-shot JavaScript component setup with
hierarchical owner scopes, followed by explicit anchored conditional regions
and keyed-only lists. A component identity is scoped by its parent region,
component type, and explicit local slot or key; it is never a DOM position or a
Rust `ComputationHandle`. Components borrow the runtime and application
signals while owning their descendants, bindings, computations, listeners,
and created DOM resources. Cleanup is child-first and fail-closed.

The current host supports Element and Text nodes but no dedicated invisible
anchor. Conditional regions therefore require an approved host extension,
preferably renderer-owned comment anchors with the same document, context,
ancestry, and cleanup validation. Structural computations should reuse
legitimate Rust computation identities and the existing FIFO, deduplicated,
one-snapshot manual flush; they must not create a second queue or scheduler.

The proposed keyed-list contract is keyed-only with pre-mutation duplicate
validation, `SameValueZero` equality, stable retained item owners, native DOM
moves, and disposal only for removed keys. The recommendation is not an
approved public API. The anchor node kind, component identity, props update
semantics, structural protocol version, key policy, and recovery behavior
require human approval before M4.4.2–M4.4.4 implementation. See
[docs/m4.4-component-structural-design.md](m4.4-component-structural-design.md).

## Decision 29: M4.4.2 implements one-shot function components and nested ownership

M4.4.2 implements the approved component subset in
`packages/ruseact-dom/src/renderer.ts` and `ownership.ts`. The public
`defineComponent(typeId, setup)` helper creates a validated component
definition. Setup receives an immutable shallow scalar/signal-handle props
snapshot and a narrow environment, executes once per instance, and returns a
structured version-1 or version-2 child view. Signal changes update only the
explicit binding computations; they never rerun component setup.

The existing `ruseact.template` version 1 contract remains unchanged. Version
2 adds only stable static component placements, component definitions, initial
props, and sibling order metadata. Both versions use the same host, binding,
and root lifecycle implementation. Component references and callbacks remain
ordinary JavaScript closures; no handles are serialized or manufactured by the
compiler.

Component identity is a parent-owner path plus local static placement slot and
component type. A component is not a DOM position or a Rust computation. Each
component gets a provisional owner before setup. Owners track renderer-owned
binding computations and child owners; the root host remains the single
authoritative registry for listeners and DOM nodes. Cleanup is child-first and
reverse-registration ordered before root binding/host cleanup. Failures retain
structured cause and cleanup diagnostics and do not dispose borrowed runtimes
or application signals.

M4.4.2 extends the private M4.3 compiler to accept statically named uppercase
component references and emit version-2 placement metadata. It rejects
dynamic component expressions, component children, conditional regions, lists,
spreads, hooks, and implicit dependencies. Conditional regions, anchors,
structural computations, keyed lists, rerendering, and scheduling remain
deferred to separately approved milestones. See
[docs/m4.4.2-function-components.md](m4.4.2-function-components.md).

## Decision 30: M4.4.3 implements approved conditional structural regions

M4.4.3 extends the existing renderer with `ruseact.template` protocol version
3. Version 1 static plans and version 2 component plans remain valid and use
the same root, host, ownership, and binding pipeline. Version 3 adds only
explicit conditional regions; keyed lists and other future structural
capabilities are not accepted.

A conditional region owns two private renderer-created `Comment` anchors. The
host validates their document, ownership context, parent, ancestry, and order
like other owned nodes, but does not expose arbitrary comment creation through
the public API. Anchors are not valid scalar binding targets. A region's
content is the verified owned range strictly between its stable start and end
anchors, so unrelated siblings are not adopted or removed.

Each region has exactly one explicit `SignalHandle` selector dependency. Its
JavaScript evaluator must return a structured boolean result; truthiness
coercion and automatic dependency tracking are rejected. Only the selected
branch factory executes. An unchanged selector preserves the branch,
component setup, listeners, and DOM identities.

Changed selection uses cleanup-first replacement. The active branch owner and
its descendants, bindings, subscriptions, listeners, and DOM resources are
disposed child-first. A fresh branch activation is then created between the
existing anchors. Returning to a previous boolean value creates a new
activation; inactive branches are not cached. If new branch initialization
fails after old cleanup, renderer-managed new resources are rolled back and the
region remains safely empty with its anchors preserved. Incomplete cleanup
retains ownership and fails closed; arbitrary application side effects are not
claimed to be transactional.

Structural records share `BindingContext` with scalar bindings. They use real
RustReactiveCore computation identities, explicit subscriptions, the existing
FIFO pending snapshot, and one manual `root.flush()` pass. Before execution,
the complete pending snapshot is validated. If a structural update
successfully disposes a later exact snapshot record, that record may be
skipped and is counted in `FlushReport.skippedCount`. Foreign, malformed,
unknown, unexpectedly missing, or unsuccessfully disposed records still fail
closed. Newly generated work remains deferred and no second queue, scheduler,
ReactiveCore, or WASM ABI is introduced.

The private compiler marker
`ruseact.conditional([signal], evaluator, whenTrue, whenFalse)` is provisional
and emits version 3 only when conditional metadata is present. It does not
make arbitrary JSX ternaries reactive or infer dependencies. The authoritative
browser command is `corepack pnpm test:browser:conditional`; hosted Chromium
must verify the real Rust/WASM-to-DOM path before this feature is considered
complete. Keyed-list identity and equality remain the M4.4.4 handoff.

## Decision 31: M4.4.4 implements approved keyed-only list regions

M4.4.4 adds `ruseact.template` protocol version 4 while preserving versions 1,
2, and 3. Version 4 uses the existing root, host, ownership, binding, and
structural dispatch pipeline; it is not a second renderer or a mutable view
tree. A version-4 plan adds a keyed-list region with one explicit scalar
revision dependency, a JavaScript collection evaluator, and a lazy item
factory.

Structural keys are only strings, booleans, and finite numbers. A native
`Map` supplies SameValueZero identity, so signed zero is one key while numeric,
string, and boolean representations remain distinct. The complete collection
snapshot is validated before mutation: missing/invalid/duplicate keys,
invalid scalar fields, and retained schema changes preserve the previously
published list. Unkeyed lists and implicit key inference remain rejected.

Each list and item owns private comment anchors and an owner-local DOM range.
Retained item owners, components, listeners, computations, DOM nodes, and
renderer-owned scalar field signal handles are preserved. Changed retained
fields use the existing scalar `set` operation; they do not mutate immutable
props or rerun component setup. Desired order is reconciled deterministically
right-to-left with verified native insertion moves. No LIS optimization or
manual focus restoration is promised; Chromium records the observed native
focus/selection behavior.

List structural records share the existing `BindingContext` and Rust pending
queue with scalar and conditional records. FIFO snapshot dispatch, exact
same-snapshot disposal provenance, deferred generated work, and fail-closed
unknown-computation handling are unchanged. Item cleanup is child-first,
disposes dependent computations before owned field signals, releases completed
records, and never disposes borrowed application signals or the runtime.

The private compiler marker `ruseact.keyed([revision], evaluator, factory)` is
provisional. It emits version 4 only when keyed metadata is present and
preserves lexical closures and lazy factory execution. See
[docs/m4.4.4-keyed-lists.md](m4.4.4-keyed-lists.md). M4.5 consumer integration,
unkeyed behavior, hooks, scheduling, VDOM, and new Rust/WASM ABI remain
deferred.

## Decision 32: M4.5.1 distributes the existing three packages as private tarballs

M4.5.1 adds package production and isolated-consumer verification without
changing renderer semantics. The existing boundaries remain `ruseact` for the
TypeScript runtime and packaged WASM, `ruseact-dom` for the public renderer,
components, and structural plans, and `ruseact-compiler` for build-time TSX
compilation. The dependency graph is `ruseact-dom -> ruseact` and
`ruseact-compiler -> typescript`; runtime packages do not depend on the
compiler.

All three staged packages use private synchronized version `0.1.0-alpha.0`.
The source workspace keeps the DOM package's `workspace:0.1.0-alpha.0`
relationship, while the packed manifest contains the exact runtime package
version and no workspace protocol. Tarballs expose only explicit ESM package
roots and the documented `ruseact/wasm/node` and `ruseact/wasm/web` loader
subpaths. TypeScript emits executable ESM, declarations, and source maps;
runtime packages do not include TypeScript compiler code.

The release `wasm32-unknown-unknown` binary and matching `wasm-bindgen 0.2.130`
Node/web glue are packaged with `ruseact`. Runtime initialization remains
explicit through `createReactiveCore(loadWasm)`, with no import-time singleton
or scheduler. The Node generated glue is isolated under a private nested
CommonJS package boundary; the browser generated glue remains an explicit web
ESM loader. Consumers do not build Rust after installation.

The DOM source imports runtime values and types through the canonical `ruseact`
package identity rather than workspace-relative runtime modules. This keeps
opaque handle definitions and runtime registries canonical when an installed
consumer imports `ruseact` and `ruseact-dom` together. The package pipeline
does not weaken handle validation or embed a duplicate runtime.

`target/distribution/distribution-manifest.json` records the source revision,
dirty-tree status, artifact paths, sizes, SHA-256 checksums, toolchains, WASM
targets, and supported template protocols 1–4. It is provenance metadata, not
a signing or attestation system, and the build does not claim byte-for-byte
reproducibility without an independent clean-build comparison.

The isolated consumer installs copied tarballs outside the workspace, validates
installed declarations, initializes real WASM, compiles supported TSX, and
runs version-1 static, version-2 component, version-3 conditional, and
version-4 keyed fixtures in Chromium. Local artifact production is verified by
the package scripts and CI distribution job; npm publication, tags, releases,
automatic publishing, and the separate examples repository remain out of
scope. See [the M4.5.1 distribution design](m4.5-package-distribution.md).

## Decision 33: M4.4.5 scopes structural registration by owner instance

The M4.4.3/M4.4.4 compiler legitimately reuses template-local structural IDs
such as `r0` in independent component and branch plans. The binding context
must not treat those local IDs as globally unique within a root. The M4.4.5
implementation keeps one shared binding context but uses the exact private
owner object and local region ID as the registration namespace, while retaining
the structural kind (`conditional` or `keyed`) in the record. The private
registry is weakly scoped by owner object and does not use diagnostic owner
strings, random IDs, or a process-wide counter as authoritative identity.

Duplicate local IDs remain rejected within one owner scope, and existing plan
validation continues to reject duplicate region IDs within one plan.
Conditional and keyed registration now use the same identity strategy; keyed
registration no longer encodes `owner.id` into a string key. Computation handles
remain the authoritative pending-dispatch identity and are not replaced by
owner IDs.

Registration reserves its scoped identity before initial structural evaluation,
so nested registration cannot overwrite an active record. Successful cleanup
releases the exact record and scoped identity. Failed dependency or computation
cleanup retains the record and scope reservation and fails closed. This keeps
same-snapshot disposal authorization tied to the exact successfully disposed
computation and preserves FIFO dispatch, one-pass flushing, deferred generated
work, unknown-computation rejection, and all renderer protocol versions 1–4.

The confirmed defect was reproduced through the installed consumer artifacts:
an outer `r0` conditional could not mount a component containing another `r0`
conditional. The real-WASM Chromium regression now covers nested components,
repeated component instances, conditional/keyed composition, fresh activation,
same-snapshot disposal, and same-scope duplicate rejection. See
[the M4.4.5 identity hardening record](m4.4.5-structural-identity.md). The
consumer's existing `0.1.0-alpha.0` tarballs remain unchanged; a new matching
artifact set, preferably `0.1.0-alpha.1`, is required after promotion.
