# Ruseact

**An experimental React-inspired runtime powered by Rust.**

Ruseact explores alternative approaches to building a reactive frontend
framework, with a Rust-based reactive core and a TypeScript/JSX-facing API.

The goal is to investigate reactivity, scheduling, and rendering architectures
without relying on React Fiber.

> **Experimental / Early development**
>
> Ruseact is a research-oriented engineering project, not a production-ready
> framework or a drop-in replacement for React.

## Why Ruseact?

Modern frontend frameworks make different architectural trade-offs around
state management, scheduling, and rendering.

Ruseact explores a different separation of responsibilities:

- **Rust:** Reactive graph, signal identity, dependency management, and future
  scheduling.
- **TypeScript/JavaScript:** Component execution and browser-facing integration.
- **DOM adapter:** Planned browser rendering and event handling.

The project is an architectural experiment. No performance advantage or React
API compatibility is claimed.

## Development status

| Milestone                  | Status          |
| -------------------------- | --------------- |
| M0 — Workspace foundation  | Complete        |
| M1.1 — Signal foundation   | Complete        |
| M1.2 — Dependency tracking | Complete        |
| M1.3 — Dirty propagation | Complete        |
| M1.4 — Batching            | Complete        |
| M1.5 — Core verification and benchmark baseline | Complete |
| M2.1 — WASM ABI design | Reviewed and approved |
| M2.2 — Rust WASM exports | Implemented; pending review |
| Scheduling and execution   | Not implemented |
| WASM integration           | M2.2 Rust bridge implemented; TypeScript wrapper not implemented |
| DOM renderer               | Not implemented |
| Compiler integration       | Not implemented |
| Manual-approval development workflow | Implemented; CI and protected rulesets remain enabled |

### Currently implemented

The Rust reactive core supports:

- Typed signals with graph-owned storage.
- Graph-scoped generational identities.
- Change detection using `PartialEq`.
- Explicit computation registration.
- Bidirectional signal-computation dependencies.
- Subscription, unsubscription, and dependency replacement.
- Dependency cleanup on disposal.
- Validation of stale and foreign handles.
- Changed-signal dirty propagation with deterministic, deduplicated pending
  computation IDs.
- Explicit pending-work draining without computation execution.
- Explicit nested batching that keeps pending work gated until the outermost
  batch ends.
- Deterministic reference-model stress coverage for dependency, queue,
  lifecycle, batching, graph-isolation, and generational-identity invariants.
- A dependency-free Rust-native benchmark baseline for core graph operations;
  these measurements are not browser, JavaScript, WASM-bridge, or rendering
  benchmarks.
- A first `wasm-bindgen` bridge in `crates/ruseact-wasm` with explicit graph
  disposal, opaque validated signal and computation handles, scalar signal
  operations, dependency metadata operations, nested batching, and copied
  pending-computation IDs. The bridge does not execute computations.

Computation execution, automatic dependency tracking, and scheduling are not
yet implemented. The M2.3 TypeScript runtime wrapper, DOM renderer, compiler,
and worker handle transfer are also not implemented.

## Repository structure

- `crates/ruseact-core` — Platform-independent Rust reactive core.
- `crates/ruseact-wasm` — Rust-to-JavaScript WASM bridge for the approved M2.2
  scalar and reactive-identity ABI.
- `packages/ruseact` — Future TypeScript/JSX framework interface.
- `packages/ruseact-dom` — Future DOM integration.
- `docs` — Architecture decisions and technical documentation.

The [M2.1 WASM ABI design](docs/wasm-abi-design.md) records the reviewed
handle, value, ownership, error, and pending-work contract. M2.2 implements the
approved Rust bridge portion; the public TypeScript wrapper remains a later
M2.3 milestone.

Example applications are maintained in a separate repository.

## Development

Use the Rust toolchain pinned in `rust-toolchain.toml` and the Node.js version
specified in `.nvmrc`.

Run the project checks:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --locked
python3 scripts/validate_skills.py
cargo bench -p ruseact-core --bench core_baseline --locked -- --nocapture
```

These commands verify the workspace and current Rust core; they are not a
consumer application quickstart.

## M1.5 core verification and benchmark baseline

M1.5 verifies the M1.1–M1.4 RustReactiveCore contracts without adding runtime
features. The core tests cover signal and computation lifecycle cleanup,
bidirectional dependency consistency, atomic dependency replacement failures,
deterministic dirty ordering and deduplication, nested batch drain gating,
cross-graph isolation, stale-handle rejection, slot reuse, and generation
exhaustion. A bounded deterministic stress test runs 1,500 mixed operations
over 96 signals and 48 computations against an independent reference model;
the lifecycle churn test performs 256 allocation/disposal cycles.

Run the reproducible native baseline manually with:

```bash
cargo bench -p ruseact-core --bench core_baseline --locked -- --nocapture
```

The benchmark uses five warmed trials for small, medium, and large Rust graph
fixtures and reports median/p95 elapsed nanoseconds, nanoseconds per operation,
throughput, graph size, dependency edges, and affected computations. Results
and the measured environment are recorded in
[docs/benchmarks/m1.5-core-baseline.md](docs/benchmarks/m1.5-core-baseline.md).
They establish a reproducible Rust-native baseline only; they do not support
claims about React, Solid, Leptos, browser rendering, JavaScript execution,
WASM crossings, or end-to-end application performance.

## M2.2 Rust WASM bridge

The approved M2.2 bridge is implemented in `crates/ruseact-wasm` using
`wasm-bindgen` `0.2.130` and `js-sys` `0.3.107`. Each `WasmCore` owns one
RustReactiveCore graph and must be explicitly disposed. Handles are opaque
WASM objects; the bridge validates their instance, graph, resource kind, slot,
and generation before every operation. The bridge never exposes Rust pointers
or executes computation bodies.

The MVP accepts only booleans, finite `f64` numbers, and UTF-8 strings. Arrays,
objects, functions, symbols, `null`, `undefined`, `NaN`, and infinities are
rejected. Numeric equality follows Rust `f64` `PartialEq`, so `+0.0` and
`-0.0` are equal and an equal write does not create dirty work. Expected
operational failures are surfaced as generated JavaScript exceptions whose
value is a structured object containing a stable `code` and `operation` (and
resource identity fields where applicable).

Dependency lists are instance-bound and replace dependencies atomically. Batch
boundaries preserve M1.4 nested semantics. `drain_pending_computations()`
returns a copied `Uint32Array` containing FIFO `(slot, generation)` pairs;
the bridge does not transfer Rust references or invoke JavaScript callbacks.
Cross-worker handle transfer, automatic disposal, computation execution,
scheduling, and the public TypeScript wrapper remain future work.

Build and run the bridge smoke test with a user-space `wasm-bindgen` CLI that
matches the crate version:

```bash
cargo build -p ruseact-wasm --target wasm32-unknown-unknown --release --locked
wasm-bindgen target/wasm32-unknown-unknown/release/ruseact_wasm.wasm \
  --target nodejs --out-dir /tmp/ruseact-m2.2-bindgen
RUSEACT_WASM_BINDGEN_OUT=/tmp/ruseact-m2.2-bindgen \
  node scripts/test_wasm_bridge.mjs
```

The generated bindings and WASM artifact are verification outputs and are not
committed. See [docs/wasm-abi-design.md](docs/wasm-abi-design.md) for the
boundary contract and [docs/work-progress.md](docs/work-progress.md) for the
verified command results and current M2.3 handoff.

## Manual-approval development workflow

Ruseact uses a strictly manual, protected workflow for every development task:

```text
Task → feature branch from develop → implementation → README update →
validation → self-review → PR to develop → required CI → human squash merge →
explicit main-promotion request → verified promotion PR to main →
human squash merge → return to develop
```

Every new implementation task, milestone, and sub-milestone must update this
root README in the same branch and pull request. The CI documentation gate
rejects missing, empty, or whitespace-only updates; self-review must also
confirm that the changed documentation is relevant and factually consistent
with the implementation and tests.

The repository provides these workflow components:

- `Ruseact CI` runs Rust formatting, Clippy, workspace tests, WASM checks,
  TypeScript checks, skill validation, risk classification, and the README
  gate.
- The former `auto-merge-develop.yml` and `promote-main.yml` workflows are
  disabled in GitHub Actions and removed from the repository. They have no
  event-driven merge or promotion authority.

Use `$ruseact-pr-publish` to validate and publish a feature branch. It commits,
pushes the feature branch, opens a PR targeting `develop`, records the checked
SHA, and then stops. Codex must never merge that PR or enable auto-merge.

Use `$ruseact-main-promote` only after explicitly providing the merged PR
number and confirming that the task is complete. The skill verifies the exact
single-parent squash SHA, confirms it is the current `origin/develop` tip,
checks for duplicate promotion, creates a traceable promotion branch and PR to
`main`, validates it, and stops for the user's manual merge. It never selects
arbitrary `HEAD`, directly pushes `main`, or enables auto-merge.

CI and branch protection remain enabled. The active `develop` and `main`
rulesets require review, squash merging, and the configured `Ruseact CI`
contexts. Repository native auto-merge is disabled. Any future request to
re-enable merge or promotion automation requires a separate, explicitly
approved security and repository-settings change.

For a failure, preserve local and remote history and record the PR number,
source squash SHA, source and target branches, resulting main SHA if any,
failed operation, and whether a remote write completed. Resolve the cause,
rerun the exact manual verification, and never force-push, bypass protection,
or merge around a failed check.

## Architecture

See [Architecture Decisions](docs/architecture.md) for the design rationale,
ownership boundaries, reactive graph contracts, and implemented milestones.

## Contributing

Ruseact is in early development. Technical feedback, architecture discussions,
bug reports, and suggestions are welcome.

The public API and implementation may change substantially during development.

## License

MIT License.
