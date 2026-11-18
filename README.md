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
| Scheduling and execution   | Not implemented |
| WASM integration           | Not implemented |
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

Computation execution, automatic dependency tracking, and scheduling are not
yet implemented.

## Repository structure

- `crates/ruseact-core` — Platform-independent Rust reactive core.
- `crates/ruseact-wasm` — Planned WASM bridge.
- `packages/ruseact` — Future TypeScript/JSX framework interface.
- `packages/ruseact-dom` — Future DOM integration.
- `docs` — Architecture decisions and technical documentation.

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
```

These commands verify the workspace and current Rust core; they are not a
consumer application quickstart.

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
