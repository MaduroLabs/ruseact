# Work progress (branch-local)

## Branch and baseline

- Branch: `feature/manual-approval-git-workflow`
- Framework commit/version consumed by examples: not applicable; examples stay in the separate repository
- Last verified on: Linux x86_64, 2026-11-17 for the CI-gated workflow; M1.2 was verified on Linux x86_64, 2026-11-16

## Completed

- [x] Created the Cargo workspace for `ruseact-core` and `ruseact-wasm`.
- [x] Created the pnpm workspace for `ruseact` and `ruseact-dom`.
- [x] Added pinned workspace metadata for Rust, Node, pnpm, and TypeScript.
- [x] Added minimal crate and package entry points without compiler, DOM renderer, or scheduler behavior.
- [x] Added cross-platform CI for Rust, TypeScript, and skill validation.
- [x] Documented the M0 architecture boundaries and decisions.
- [x] Implemented M1.1 signal storage with typed handles, graph-scoped generational node IDs, equality-aware writes, and explicit disposal.
- [x] Added deterministic Rust unit tests for initialization, create/read/write, unchanged values, stale handles, cross-graph misuse, type mismatch, slot reuse, and generation exhaustion.
- [x] Documented M1.1 ownership, equality, graph identity, generation exhaustion, and lifecycle decisions in `docs/architecture.md`.
- [x] Implemented M1.2 graph-scoped generational computation IDs with explicit bidirectional dependency metadata.
- [x] Added idempotent subscribe/unsubscribe, duplicate-free dependency replacement, signal/computation disposal cleanup, and stale/cross-graph validation.
- [x] Documented M1.2 dependency ownership and compiler-assisted tracking boundary in `docs/architecture.md`.
- [x] Added mandatory README maintenance, lifecycle states, conservative risk classification, and fail-closed recovery rules.
- [x] Added README, risk, manual API verification, idempotency, and protected promotion checks.
- [x] Disabled remote automatic merge and promotion workflows and removed their repository definitions.
- [x] Reconfigured publication and promotion skills for explicit human approval only.

## In progress / next

- [ ] Define dirty propagation, batching, and scheduling invariants in the next milestone.
- [ ] Specify the Rust-to-JavaScript ABI before adding WASM exports.
- [ ] Design compiler and DOM renderer milestones; do not add them to M0.
- [x] Verified active required checks, squash-only rulesets, and disabled native auto-merge.
- [ ] Review and merge this manual-approval workflow configuration PR.
- [ ] Add consumer verification in `ruseact-examples` after package output exists.

## Commands verified

- `cargo fmt --all -- --check` — PASS (Linux; Rust `1.99.0`).
- `cargo clippy --workspace --all-targets --locked -- -D warnings` — PASS (Linux; Rust `1.99.0`).
- `cargo test -p ruseact-core --locked` — PASS; 15 core unit tests, 0 doc tests (Linux; Rust `1.99.0`).
- `cargo test --workspace --locked` — PASS; 15 core tests, 0 WASM tests, 0 doc tests (Linux; Rust `1.99.0`).
- `cargo check --workspace --target wasm32-unknown-unknown --locked` — PASS (Linux; Rust `1.99.0`).

- `pnpm install --lockfile-only` — PASS (macOS Apple Silicon; pnpm `12.16.1`).
- `pnpm install --frozen-lockfile` — PASS (macOS Apple Silicon; pnpm `12.16.1`).
- `pnpm typecheck` — PASS (macOS Apple Silicon; host Node `22.23.2`; CI uses `.nvmrc` Node `24.22.3`).
- `python3 scripts/validate_skills.py` — PASS; 8 skills validated.
- `python3 scripts/test_workflow_policy.py` — PASS; 7 policy tests.
- `python3 -m py_compile scripts/workflow_policy.py scripts/validate_readme_update.py scripts/classify_changed_files.py scripts/automation_gate.py scripts/test_workflow_policy.py` — PASS.
- `git diff --check` — PASS.

## Blockers / decisions

- M0 intentionally has no runtime API, compiler, DOM renderer, or complex scheduler.
- No files are added to the separate `ruseact-examples` repository.
- The committed `.nvmrc` and CI configuration pin Node `24.22.3` for reproducible CI.
- GitHub native auto-merge is disabled; the active `develop` and `main` rulesets enforce required reviews, required CI contexts, and squash merging.
- Automatic merge and promotion workflow records are disabled in GitHub Actions and their workflow files are removed from the repository. Future promotion requires explicit user invocation and manual merging of the protected promotion PR.
- Linux verification used the repository-pinned Rust `1.99.0` toolchain and a user-space Ubuntu linker/sysroot because the host did not provide a global `cc` linker; no global packages or repository-generated toolchain files were added.
