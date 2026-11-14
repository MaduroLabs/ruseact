# Work progress (branch-local)

## Branch and baseline

- Branch: `feature/m0-project-foundation`
- Framework commit/version consumed by examples: not applicable; examples stay in the separate repository
- Last verified on: macOS Apple Silicon, 2026-11-14

## Completed

- [x] Created the Cargo workspace for `ruseact-core` and `ruseact-wasm`.
- [x] Created the pnpm workspace for `ruseact` and `ruseact-dom`.
- [x] Added pinned workspace metadata for Rust, Node, pnpm, and TypeScript.
- [x] Added minimal crate and package entry points without compiler, DOM renderer, or scheduler behavior.
- [x] Added cross-platform CI for Rust, TypeScript, and skill validation.
- [x] Documented the M0 architecture boundaries and decisions.

## In progress / next

- [ ] Define RustReactiveCore signal and subscription invariants in a later milestone.
- [ ] Specify the Rust-to-JavaScript ABI before adding WASM exports.
- [ ] Design compiler and DOM renderer milestones; do not add them to M0.
- [ ] Add consumer verification in `ruseact-examples` after package output exists.

## Commands verified

- `pnpm install --lockfile-only` — PASS (macOS Apple Silicon; pnpm `12.16.1`).
- `pnpm install --frozen-lockfile` — PASS (macOS Apple Silicon; pnpm `12.16.1`).
- `pnpm typecheck` — PASS (macOS Apple Silicon; host Node `22.23.2`; CI uses `.nvmrc` Node `24.22.3`).
- `cargo fmt --all -- --check` — PASS (Rust `1.99.0`).
- `cargo check --workspace --all-targets --locked` — PASS (Rust `1.99.0`).
- `cargo clippy --workspace --all-targets --locked -- -D warnings` — PASS (Rust `1.99.0`).
- `cargo test --workspace --locked` — PASS; 0 tests currently (Rust `1.99.0`).
- `cargo check --workspace --target wasm32-unknown-unknown --locked` — PASS (Rust `1.99.0`).
- `python3 scripts/validate_skills.py` — PASS; 6 skills validated.
- `git diff --check` — PASS.

## Blockers / decisions

- M0 intentionally has no runtime API, compiler, DOM renderer, or complex scheduler.
- No files are added to the separate `ruseact-examples` repository.
- The current machine has Node `22.23.2`; the committed `.nvmrc` and CI configuration pin Node `24.22.3` for reproducible CI.
