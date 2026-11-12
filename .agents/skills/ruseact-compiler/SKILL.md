---
name: ruseact-compiler
description: Design or implement TSX compile-time static templates, dynamic bindings, dependency analysis, control flow transforms, or React-like hooks/closure semantics for the Ruseact compiler.
---
# Ruseact TSX compiler

## Procedure
1. Inspect existing AST tooling, generated output, runtime API and tests before selecting a transform.
2. List which dependencies are statically provable and which require runtime tracking; do not guess identifiers are reactive.
3. Emit stable binding/template metadata with source locations if possible; preserve JS evaluation order, branch behavior, and lexical scoping.
4. For React-like `useState` syntax, prove how closures read fresh state **without** component rerender, or explicitly document unsupported syntax/fallback.
5. Add compile snapshots and runtime behavior tests for text interpolation, props, conditionals, loops, nested closures, function calls, and dynamic dependency changes as the feature warrants.
6. Verify generated JS is valid and interoperates with the DOM adapter and Rust bridge.

## Guardrails
Do not simply run React Babel transforms or import React Fiber. The compiler is an optional optimizer only until semantics are proven; conservative fallback is preferable to incorrect updates. Never optimize away cleanup or effect ordering.
