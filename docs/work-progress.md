# Work progress (branch-local)

## Branch and baseline

- Branch: `feature/m2.3-typescript-runtime`
- Framework commit/version consumed by examples: not applicable; examples stay in the separate repository
- Baseline: `origin/develop` at `89336ba9256467abc2447204cb4f0da24b772554`
- Last verified on: Linux x86_64, 2026-11-18 for M2.3; M1.1–M1.5 and the
  reviewed M2.1 ABI design were already merged into this baseline

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
- [x] Implemented M1.3 changed-signal dirty propagation with deterministic first-dirtied ordering, queue deduplication, explicit draining, and computation disposal cleanup.
- [x] Added deterministic M1.3 tests for propagation, unchanged writes, repeated changes, drain boundaries, dependency changes while pending, signal disposal, graph isolation, invalid handles, and generational computation reuse.
- [x] Documented M1.3 queue ownership, ordering, disposal, and deferred execution/batching decisions in `docs/architecture.md` and `README.md`.
- [x] Implemented M1.4 explicit nested batching with checked depth, gated draining, preserved queue ordering, and safe boundary errors.
- [x] Added deterministic M1.4 tests for single and nested batches, active-batch drains, deduplication, unchanged writes, disposal, invalid boundaries, consecutive batches, and post-batch updates.
- [x] Documented M1.4 lifecycle, nested semantics, drain behavior, error handling, and deferred execution responsibilities in `docs/architecture.md` and `README.md`.
- [x] Added M1.5 invariant checks for bidirectional dependency edges, live pending IDs, dirty flags, active-slot counts, and generation validity.
- [x] Added M1.5 atomic dependency-replacement failure coverage, a 1,500-operation deterministic reference-model stress test, and 256-cycle lifecycle/identity churn coverage.
- [x] Added the dependency-free `core_baseline` Cargo benchmark for signal, dependency, dirty-queue, batching, and cleanup operations at 16-, 64-, and 256-signal sizes.
- [x] Documented M1.5 verification coverage, measured native benchmark results, architecture findings, and limitations.
- [x] Added mandatory README maintenance, lifecycle states, conservative risk classification, and fail-closed recovery rules.
- [x] Added README, risk, manual API verification, idempotency, and protected promotion checks.
- [x] Disabled remote automatic merge and promotion workflows and removed their repository definitions.
- [x] Reconfigured publication and promotion skills for explicit human approval only.
- [x] Audited the M1 RustReactiveCore APIs and the currently empty WASM and TypeScript package boundaries for M2.1.
- [x] Added the documentation-only M2.1 WASM ABI proposal covering handles, values, ownership, errors, pending-ID transfer, validation, and performance measurement.
- [x] Recorded M2.1 alternatives and decisions requiring human architecture approval; no runtime code or dependency was added.
- [x] Implemented the approved M2.2 `wasm-bindgen` bridge with explicit graph
  ownership, opaque validated handles, scalar signals, metadata computations,
  dependency operations, nested batching, structured errors, and copied
  pending-ID transfer.
- [x] Added native bridge tests and a real generated Node/WASM smoke test for
  scalar round trips, equality, isolation, lifecycle, dependencies, batching,
  stale handles, and pending FIFO behavior.
- [x] Updated the README and architecture documents with the implemented ABI,
  build commands, limitations, and the M2.3 handoff.
- [x] Added the approved M2.2.1 `WasmCore.computation_identity()` export,
  reusing live computation validation and returning copied `(slot, generation)`
  metadata without constructing handles.
- [x] Added native identity, stale-generation, foreign-instance, wrong-resource,
  disposal, queue-preservation, and slot-reuse coverage plus real WASM smoke
  assertions for the new export.
- [x] Documented the M2.3 per-instance handle-registry handoff and the
  prohibition on numeric handle construction.
- [x] Implemented the M2.3 TypeScript runtime bridge with explicit generated
  WASM-module loading, opaque instance-owned handles, scalar operations,
  dependency management, batching, normalized errors, and deterministic
  pending-computation registry resolution.
- [x] Added a real Node/WASM integration harness covering initialization,
  multiple instances, scalar validation/equality, dependencies, nested
  batching, FIFO identity mapping, disposal, generation reuse, and fail-closed
  unknown pending identities.
- [x] Updated the README, architecture decision, ABI design, and this progress
  record with the M2.3 public contract and M2.4 browser handoff.

## In progress / next

- [x] Specify the Rust-to-JavaScript ABI before adding WASM exports.
- [x] Obtain explicit approval for the M2.1 MVP decisions.
- [x] Implement and test the approved WASM bridge in M2.2.
- [x] Add the narrowly scoped M2.2.1 computation identity bridge needed for
  safe pending-computation handle mapping.
- [x] Build the M2.3 public TypeScript wrapper; preserve the M2.2 opaque-handle
  and structured-error contract.
- [ ] Validate browser bundler loading and host integration in M2.4.
- [ ] Design compiler and DOM renderer milestones; do not add them to M0.
- [x] Verified active required checks, squash-only rulesets, and disabled native auto-merge.
- [x] Reviewed and merged the manual-approval workflow configuration PR; its protected rulesets remain active.
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

- `git fetch origin --prune` — PASS; `origin/develop` verified at `e4310e8a554a2cc28130bbd33862c11a19b08f2f`.
- `git switch -c feature/m2.1-wasm-abi-design origin/develop` — PASS; clean documentation-only feature branch created.

- `cargo fmt --all -- --check` — PASS (Linux; Rust `1.99.0`, M1.3 v2).
- `cargo clippy --workspace --all-targets --locked -- -D warnings` — PASS (Linux; Rust `1.99.0`, M1.3 v2).
- `cargo test -p ruseact-core --locked` — PASS; 22 core unit tests, 0 doc tests (Linux; Rust `1.99.0`, M1.3 v2).
- `cargo test --workspace --locked` — PASS; 22 core tests, 0 WASM tests, 0 doc tests (Linux; Rust `1.99.0`, M1.3 v2).
- `cargo check --workspace --target wasm32-unknown-unknown --locked` — PASS (Linux; Rust `1.99.0`, M1.3 v2).

- `cargo fmt --all -- --check` — PASS (Linux; Rust `1.99.0`, M1.4).
- `cargo clippy --workspace --all-targets --locked -- -D warnings` — PASS (Linux; Rust `1.99.0`, M1.4).
- `cargo test -p ruseact-core --locked` — PASS; 32 core unit tests, 0 doc tests (Linux; Rust `1.99.0`, M1.4).
- `cargo test --workspace --locked` — PASS; 32 core tests, 0 WASM tests, 0 doc tests (Linux; Rust `1.99.0`, M1.4).
- `cargo check --workspace --target wasm32-unknown-unknown --locked` — PASS (Linux; Rust `1.99.0`, M1.4).

- `cargo fmt --all -- --check` — PASS (Linux; Rust `1.99.0`, M1.5).
- `cargo clippy --workspace --all-targets --locked -- -D warnings` — PASS (Linux; Rust `1.99.0`, M1.5).
- `cargo test -p ruseact-core --locked` — PASS; 35 core tests, 0 doc tests (Linux; Rust `1.99.0`, M1.5).
- `cargo test --workspace --locked` — PASS; 35 core tests, 0 WASM tests, 0 doc tests (Linux; Rust `1.99.0`, M1.5).
- `cargo check --workspace --target wasm32-unknown-unknown --locked` — PASS (Linux; Rust `1.99.0`, M1.5).
- `cargo bench -p ruseact-core --bench core_baseline --locked -- --nocapture` — PASS; five measured trials after two warmups for each of 33 operation/size cases. Results: `docs/benchmarks/m1.5-core-baseline.md`.

- M2.1 documentation-only validation — PASS: `cargo fmt --all -- --check`,
  `cargo clippy --workspace --all-targets --locked -- -D warnings`,
  `cargo test --workspace --locked` (35 core tests; 0 WASM tests; 0 doc
  tests), `cargo check --workspace --target wasm32-unknown-unknown --locked`,
  `pnpm typecheck` (host Node `22.23.3`), `git diff --check`,
  `python3 scripts/validate_skills.py`, `python3 scripts/test_workflow_policy.py`,
  and `python3 scripts/test_automation_gate.py`.

- M2.2 validation — PASS: `cargo fmt --all -- --check`, `cargo clippy
  --workspace --all-targets --locked -- -D warnings`, `cargo test
  --workspace --locked` (35 core tests and 6 bridge tests; 41 total; 0 doc
  tests), `cargo check --workspace --target wasm32-unknown-unknown --locked`,
  `pnpm typecheck` (host Node `22.23.3`), and `git diff --check`.
- M2.2 real bridge verification — PASS: `cargo build -p ruseact-wasm
  --target wasm32-unknown-unknown --release --locked`, `wasm-bindgen-cli
  0.2.130` generation for the Node target, and
  `RUSEACT_WASM_BINDGEN_OUT=/tmp/ruseact-m2.2-bindgen node
  scripts/test_wasm_bridge.mjs`. The smoke test invoked generated WASM and
  passed scalar, dependency, batch, pending-transfer, isolation, stale-handle,
  and disposal scenarios.
- M2.2 policy validation — PASS: repository skill, workflow, automation, README,
  and risk checks were run against the final feature diff; generated WASM
  outputs remained outside the repository.
- M2.2.1 validation — PASS: `cargo fmt --all -- --check`, `cargo clippy
  --workspace --all-targets --locked -- -D warnings`, `cargo test
  --workspace --locked` (35 core tests and 10 bridge tests; 45 total; 0 doc
  tests), `cargo check --workspace --target wasm32-unknown-unknown --locked`,
  `pnpm typecheck` (host Node `22.23.3`), and `git diff --check`.
- M2.2.1 real bridge verification — PASS: release `ruseact-wasm` build for
  `wasm32-unknown-unknown`, `wasm-bindgen-cli 0.2.130` generation for the Node
  target, generated declaration inspection, and
  `RUSEACT_WASM_BINDGEN_OUT=/tmp/ruseact-m2.2.1-bindgen node
  scripts/test_wasm_bridge.mjs`. The smoke test passed identity retrieval,
  pair-format compatibility, wrong-kind, foreign-instance, stale-handle, and
  post-disposal rejection scenarios without changing pending FIFO behavior.
- M2.3 TypeScript validation — PASS: pinned `corepack pnpm install
  --frozen-lockfile`, `corepack pnpm typecheck`, and
  `RUSEACT_WASM_BINDGEN_OUT=/tmp/ruseact-m2.3-baseline-bindgen corepack pnpm
  test:runtime`. The real generated Node/WASM integration test passed runtime
  initialization, scalar and equality behavior, dependency atomicity, nested
  batching, FIFO registry mapping, disposal, generation reuse, cross-instance
  rejection, and unknown-identity fail-closed behavior.

## Blockers / decisions

- M0 intentionally has no runtime API, compiler, DOM renderer, or complex scheduler.
- No files are added to the separate `ruseact-examples` repository.
- The committed `.nvmrc` and CI configuration pin Node `24.22.3` for reproducible CI.
- M1.4 exposes batch boundaries only; it does not execute computations or define scheduling priority, compiler tracking, DOM behavior, or a WASM ABI.
- M1.5 found no correctness defect in the established M1.1–M1.4 APIs. The benchmark records Rust-native microbehavior only; dependency replacement and disposal retain `Vec`-scan complexity and were not speculatively optimized.
- GitHub native auto-merge is disabled; the active `develop` and `main` rulesets enforce required reviews, required CI contexts, and squash merging.
- Automatic merge and promotion workflow records are disabled in GitHub Actions and their workflow files are removed from the repository. Future promotion requires explicit user invocation and manual merging of the protected promotion PR.
- Linux verification used the repository-pinned Rust `1.99.0` toolchain and a user-space Ubuntu linker/sysroot because the host did not provide a global `cc` linker; no global packages or repository-generated toolchain files were added.
- M2.1 was design-only; its graph-disposal boundary, handle layout,
  value/equality policy, error surface, binding technology, and worker-transfer
  policy were explicitly approved before M2.2 implementation. The public
  TypeScript wrapper and worker transfer remain future work.
- M2.2 is limited to the Rust/WASM adapter. It does not provide the M2.3
  TypeScript wrapper, computation execution, scheduling, DOM/compiler
  integration, arbitrary JavaScript object storage, or worker handle transfer.
- The generated bindings used for verification require a matching user-space
  `wasm-bindgen-cli 0.2.130`; the CLI was installed under `/data/tmp` and no
  generated artifact is committed. Browser and cross-worker execution remain
  future integration work.
- M2.2.1 intentionally does not change `ruseact-core` or implement the M2.3
  TypeScript registry. The existing bridge drain checks its registry after the
  core has consumed pending work; a theoretical registry mismatch could lose
  work, so transfer atomicity remains a separate follow-up decision rather than
  being silently changed here.
- M2.3 uses an explicit generated-module loader because no WASM artifact is
  committed and browser bundler initialization is deferred to M2.4. The host
  Node is `22.23.3`; the repository pin remains Node `24.22.3`, while
  `corepack pnpm` provided the pinned pnpm `12.16.1` for verification.
- The TypeScript wrapper fails closed on malformed or unknown pending pairs, but
  the underlying M2.2 drain remains destructive before its bridge-registry
  consistency check. No unapproved rollback or acknowledgement protocol was
  introduced in M2.3.
