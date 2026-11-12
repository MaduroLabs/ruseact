# Ruseact — Agent Instructions

## Product / architecture
Ruseact is a **React-inspired** TypeScript/JSX UI framework using a **RustReactiveCore** implemented in Rust, compiled to WASM for the browser. It does not use React Fiber or wrap React's reconciler. The compiler may generate static templates, binding metadata, and a dynamic fallback. JavaScript executes user component closures and DOM operations; Rust owns the reactive dependency graph, scheduling data, and structural mutation planning only where justified.

Do **not** claim React API compatibility or performance superiority unless tests and benchmarks prove it. `useState`-style syntax without component re-execution requires a compiler strategy for stale closures, effect ownership, and dynamic dependencies; do not silently implement a semantically incompatible approximation.

## Ownership boundaries
- `crates/ruseact-core`: platform-independent graph/signal/scheduler; **no DOM, wasm-bindgen, or browser imports**.
- `crates/ruseact-wasm`: thin, explicit Rust ↔ JS ABI bridge; avoid per-binding crossings.
- `packages/ruseact`: public TSX API and compiler integration, when implemented.
- `packages/ruseact-dom`: browser host adapter and event lifecycle, when implemented.
- `ruseact-examples`: a **separate GitHub repository**. Do not add example applications to this repository.

## Working rules
1. Inspect the relevant code and tests before changing behavior; preserve existing repo setup.
2. Keep changes scoped to the requested milestone; do not implement all modules speculatively.
3. Prefer deterministic Rust unit tests for core invariants; add integration tests where an API crosses layers.
4. Do not allocate DOM nodes or call JS from `ruseact-core`.
5. Distinguish architectural hypotheses from observed benchmark results.
6. Use GitHub branches/PRs for nontrivial changes; do not push, publish, release, or modify the sibling repo without user authorization.
7. Before completing, report code changed, commands actually run, test results, and the corresponding example consumer impact.

## Platform
Support Ubuntu Linux and Apple macOS (including Apple Silicon). Use relative paths, Rust toolchain metadata, Node/pnpm lockfiles, and GitHub CI; never commit `target`, `node_modules`, generated WASM, machine-local links, or secrets. Do not assume GNU-only flags or OS-specific shell paths. Read `docs/development-workflow.md` when modifying tooling or package integration.

## Codex skills
Use a focused skill in `.agents/skills/` when the task matches its description. Do not invoke every skill for an unrelated change.

## Branch resume across Ubuntu and macOS
Use `$ruseact-branch-resume` when fetching/checking out work from another machine or restoring a branch-specific environment. Read the checked-out branch's `.ruseact/branch-env.json` (if present) and `docs/work-progress.md`; never assume every branch runs the same setup. Inspect working-tree status before switching and do not force-reset or auto-stash. `docs/work-progress.md` is branch-local and must be committed/pushed to appear on the other machine.
