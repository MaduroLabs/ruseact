# Ruseact architecture decisions

This document records the M0 foundation and M1.1 signal decisions. It describes
architecture boundaries, constraints, and the runtime contracts completed so
far.

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
