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
| Dirty propagation          | Not implemented |
| Scheduling and batching    | Not implemented |
| WASM integration           | Not implemented |
| DOM renderer               | Not implemented |
| Compiler integration       | Not implemented |
| CI-gated development workflow | Implemented fail-closed; GitHub activation settings pending |

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

Computation execution and automatic dependency tracking are not yet
implemented.

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

## Autonomous development workflow

Ruseact uses a fail-closed workflow for approved development tasks:

```text
Task → feature branch from develop → implementation → README update →
validation → self-review → PR to develop → required CI → squash merge →
verified promotion PR to main → main validation → return to develop
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
- `Ruseact Auto Merge Develop` inspects trusted GitHub metadata and changed
  paths. Only low-risk PRs with enforced current checks, required reviews,
  squash-only policy, no conflicts, and native auto-merge enabled may request
  GitHub-native squash auto-merge.
- `Ruseact Promote Main` verifies one exact squash merge from `develop`,
  prevents duplicate or out-of-order promotion, creates a traceable promotion
  PR to `main`, dispatches bounded validation when needed, and requests native
  squash auto-merge. It never bypasses branch protection.

Use `$ruseact-pr-publish` to validate and publish a feature branch. Use
`$ruseact-main-promote` for authorized manual recovery when a trusted
promotion event is missed or a promotion needs human-controlled verification.
Inspect the GitHub Actions run summary, PR checks, source squash SHA, and
promotion PR before taking recovery action. To stop automation, disable the
corresponding workflows or remove the repository ruleset configuration through
an authorized GitHub administrator; do not edit around a failed check.

The workflows intentionally remain inactive for automatic merging or promotion
until repository settings are configured. At the time of this documentation,
native auto-merge is disabled and the active `develop` and `main` rulesets do
not enforce required status checks. Maintainers must enable native auto-merge,
configure stable required checks for the CI jobs, require squash merges, and
configure a protected promotion path for `main`. The automation fails closed
until those settings are present. This configuration PR itself changes
repository policy, skills, and privileged workflows, so it requires explicit
human review and must not auto-merge or auto-promote.

For recovery, preserve the worktree and remote history, record the PR number,
source branch, source squash SHA, target branch, resulting main SHA if any,
and the failed operation. Re-run only after the exact cause is resolved. Never
force-push, reset shared branches, or select an arbitrary `develop` HEAD.

## Architecture

See [Architecture Decisions](docs/architecture.md) for the design rationale,
ownership boundaries, reactive graph contracts, and implemented milestones.

## Contributing

Ruseact is in early development. Technical feedback, architecture discussions,
bug reports, and suggestions are welcome.

The public API and implementation may change substantially during development.

## License

MIT License.
