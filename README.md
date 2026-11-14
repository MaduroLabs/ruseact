# Ruseact

Ruseact is a React-inspired TypeScript/JSX framework built around a planned
RustReactiveCore. Rust owns the platform-independent reactive graph and
scheduling data; JavaScript owns component closures and browser objects. Ruseact
does not use React Fiber or wrap React's reconciler.

## M0 foundation

The repository currently contains workspace boundaries and reproducible tooling
only. The compiler, DOM renderer, reactive graph implementation, and WASM ABI
are intentionally deferred to later milestones. See
[`docs/architecture.md`](docs/architecture.md) for the ownership decisions.

## Checks

From the repository root, use the pinned Rust toolchain and the Node version in
`.nvmrc`, then run:

```text
pnpm install --frozen-lockfile
pnpm typecheck
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --locked
python3 scripts/validate_skills.py
```

The `ruseact-examples` applications are maintained in a separate repository.
