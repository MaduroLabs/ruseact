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
