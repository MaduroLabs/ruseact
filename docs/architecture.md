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
