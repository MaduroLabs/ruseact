---
name: ruseact-core
description: Implement or review the RustReactiveCore signal graph, subscriptions, dirty propagation, batching, computed nodes, lifecycle cleanup, or scheduling; use for changes inside crates/ruseact-core.
---
# RustReactiveCore implementation

## Architecture contract
Implement a platform-independent Rust engine: Signal ID → subscribers → dirty queue → computation/binding IDs → mutation intents. No React Fiber, browser DOM, or `wasm-bindgen` in this crate. JS callbacks are opaque references, not Rust-executable closures.

## Procedure
1. Identify current invariants and the **one** behavior requested; inspect tests and interfaces.
2. Specify ownership/lifetime, ordering, duplicate-update handling and cleanup expectations.
3. Implement the minimal graph data structures, considering generational IDs for reused slots. Separate explicit `set` operations from notification/flush.
4. Add deterministic tests for create/read/write, idempotent subscriptions, deduplication, dependency changes, unmount cleanup and stale IDs **as relevant to the change**.
5. Run `cargo fmt --check`, targeted tests, and Clippy when configured; report actual commands and failures.

## Acceptance rules
Unsubscribed bindings are never scheduled; each dirty computation is coalesced within a batch unless semantics require more; invalid IDs fail safely; no component tree or global VDOM diff is introduced by default. Do not claim faster-than-React without the benchmark skill.
