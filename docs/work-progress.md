# Work progress (branch-local)

## Branch and baseline

- Branch: `feature/m1-reactive-core`
- Framework commit/version consumed by examples: not applicable; examples stay in the separate repository
- Last verified on: Linux x86_64, 2026-11-16 for M1.1; M0 baseline was verified on macOS Apple Silicon, 2026-11-14

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

## In progress / next

- [ ] Define subscriptions, dirty propagation, and batching invariants in the next milestone.
- [ ] Specify the Rust-to-JavaScript ABI before adding WASM exports.
- [ ] Design compiler and DOM renderer milestones; do not add them to M0.
- [ ] Add consumer verification in `ruseact-examples` after package output exists.

## Commands verified

- `cargo fmt --all -- --check` — PASS (Linux; Rust `1.99.0`).
- `cargo clippy --workspace --all-targets --locked -- -D warnings` — PASS (Linux; Rust `1.99.0`).
- `cargo test -p ruseact-core --locked` — PASS; 8 core unit tests, 0 doc tests (Linux; Rust `1.99.0`).
- `cargo test --workspace --locked` — PASS; 8 core tests, 0 WASM tests, 0 doc tests (Linux; Rust `1.99.0`).
- `cargo check --workspace --target wasm32-unknown-unknown --locked` — PASS (Linux; Rust `1.99.0`).

- `pnpm install --lockfile-only` — PASS (macOS Apple Silicon; pnpm `12.16.1`).
- `pnpm install --frozen-lockfile` — PASS (macOS Apple Silicon; pnpm `12.16.1`).
- `pnpm typecheck` — PASS (macOS Apple Silicon; host Node `22.23.2`; CI uses `.nvmrc` Node `24.22.3`).
- `python3 scripts/validate_skills.py` — PASS; 6 skills validated.
- `git diff --check` — PASS.

## Blockers / decisions

- M0 intentionally has no runtime API, compiler, DOM renderer, or complex scheduler.
- No files are added to the separate `ruseact-examples` repository.
- The committed `.nvmrc` and CI configuration pin Node `24.22.3` for reproducible CI.
- Linux verification used the repository-pinned Rust `1.99.0` toolchain and a user-space Ubuntu linker/sysroot because the host did not provide a global `cc` linker; no global packages or repository-generated toolchain files were added.
