#![forbid(unsafe_code)]
#![doc = "Thin RustReactiveCore to JavaScript/WASM bridge for Ruseact."]

// M0 intentionally defines no ABI or wasm-bindgen exports. The bridge will be
// added only after the core operation shapes and ownership rules are designed.
