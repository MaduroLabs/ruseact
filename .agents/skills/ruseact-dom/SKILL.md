---
name: ruseact-dom
description: Implement, test, or review Ruseact's browser renderer, createRoot, event handlers, targeted DOM mutation batches, mount/unmount, and cleanup in packages/ruseact-dom.
---
# Browser DOM adapter

## Procedure
1. Inspect the host mutation protocol and the current public API before changing renderer behavior.
2. Keep DOM references and event callbacks in JavaScript. Apply Rust-provided mutation intents or compiler-emitted bindings with minimal crossings.
3. Support text/attribute/property updates separately from keyed structural inserts/moves/removals.
4. Handle event handler replacement, disposal, root ownership, accessibility semantics, and escaped text safely.
5. Verify with focused DOM tests and at least one browser consumer check in the **separate** `ruseact-examples` repository when available.

## Guardrails
No React/Reconciler dependency; no general Fiber port. Do not mutate DOM during speculative state calculations unless semantics explicitly permit it. No example application files inside the library repo. Never bypass RustReactiveCore to invent a second scheduler without an architecture decision.
