---
name: ruseact-wasm-bridge
description: Implement or diagnose Rust↔JavaScript WASM APIs, handle IDs, serialization, initialization, buffer transfer, or cross-browser interop for Ruseact.
---
# Rust/WASM ABI and integration

## Procedure
1. Start from the core's **platform-agnostic** operations; keep `wasm-bindgen` in `crates/ruseact-wasm`.
2. Define ABI shapes (IDs, batches, errors, lifecycle) and make JS ownership of functions/DOM objects explicit.
3. Prefer bounded batches, compact numeric IDs or typed arrays over one bridge call per UI binding. Measure overhead before optimizing.
4. Implement robust init and dispose paths; guard against stale IDs, double-free and forgotten callbacks.
5. Test JS↔WASM calls in a real JS environment; add browser verification for DOM-facing behavior when available.
6. Record exact toolchain, target, bundler assumptions and test commands.

## Guardrails
Never put a `web_sys::Node` or DOM dependency in RustReactiveCore. Avoid exposing raw memory pointers without carefully documented ownership. Avoid unstable or OS-specific WASM build instructions.
