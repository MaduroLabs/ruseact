# Work progress (branch-local)

## Branch and baseline

- Branch: `feature/m4.3-jsx-compiler`
- Framework commit/version consumed by examples: not applicable; examples stay in the separate repository
- Baseline: `origin/develop` at `fe77b8da03801e6c575b1c0b6e8536abf4d3bc81`
- Last verified on: Linux x86_64, 2026-11-23 for M4.3 JSX/TSX compiler MVP;
  M4.1 hosted checks and M3.5 hosted browser correctness and benchmark
  integrity passed before this implementation branch;
  M1.1–M1.5, M2.1, M2.2, M2.2.1, M2.3, M2.4, and M2.5 are merged into this baseline

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
- [x] Preserved the M2.4 browser harness at
  `scripts/test_browser_runtime.mjs`; it serves generated web bindings, waits
  for a dynamic HTTP port, and runs bounded real-Chromium assertions.
- [x] Added the `test:browser` package command and a GitHub-hosted Ubuntu
  browser job that builds matching web bindings and runs the harness with
  pinned Node, pnpm, Rust, and `wasm-bindgen` versions.
- [x] Documented the browser loading path, CI authority, and the InstaBox
  localhost networking limitation without weakening browser verification.
- [x] Added the M2.5 test-only direct-WASM and public-TypeScript benchmark
  workload harness for 16-, 64-, and 256-signal fixtures, including signal,
  dependency, dirty propagation, batching, pending transfer, initialization,
  and lifecycle measurements.
- [x] Added structured JSON/Markdown result export, independent correctness
  checks, result-format validation, and a manually dispatched Ubuntu Chromium
  benchmark workflow with artifact upload.
- [x] Corrected M2.5 Chromium completion and timing measurement: removed
  virtual-time/DOM-dump completion, added real-time DevTools Protocol polling,
  browser timer-resolution metadata, calibrated short workloads, and fail-closed
  result-integrity checks for unresolved rows.
- [x] Added bounded adaptive per-workload calibration: prepared independent
  states are measured before official trials toward a conservative
  `max(2 ms, 16 * timer_resolution)` target, with 64 prepared states and a
  50 ms calibration-sample bound. Official zero/non-finite samples trigger a
  complete warmup/trial retry at least twice as large, capped at three
  attempts; discarded attempts and operation counts remain in diagnostics.
- [x] Added dependency-free deterministic calibration regression tests for
  quantized timers, intermittent zero samples, bounded retries, limit
  exhaustion, operation-count reporting, and reproducibility.
- [x] Stabilized intermittent Chromium benchmark samples with a conservative
  2 ms timer target and bounded whole-attempt recalibration; no benchmark
  operation definitions or runtime semantics changed.
- [x] Separated the preferred M2.5 calibration floor from measurement validity;
  capped rows are accepted only when official samples clear timer safety and
  the quantization-aware four-timer-quantum IQR gate, while unreliable capped
  rows remain unresolved with explicit metadata and validator checks.
- [x] Verified the bounded calibration-cap policy in final hosted workflow
  `44688529334`: Node and Chromium each produced 263/263 valid benchmark rows
  with no unresolved or zero-sample measurements; Chromium exercised two
  `capped_reliable` rows; artifact `14608145275`.
- [x] Inspected the implemented M2 RustReactiveCore, WASM bridge, TypeScript
  runtime, browser harness, and empty DOM package boundary for M3.1.
- [x] Drafted the documentation-only M3.1 DOM renderer architecture covering
  ownership, rendering alternatives, explicit reactive bindings, lifecycle,
  host operations, compiler/component boundaries, tests, performance, and the
  separate examples-repository handoff.
- [x] Implemented the internal M3.2 DOM host context with owned HTML/text
  creation, deterministic insertion/removal, safe text/attribute mutation,
  narrow native properties, native event lifecycle, ownership validation, and
  explicit cleanup without a public renderer API.
- [x] Added the real Chromium M3.2 host test command and preserved the existing
  M2 browser/WASM integration command in the hosted CI job.
- [x] Implemented the internal M3.3 binding context with explicit dependency
  registration, legitimate computation-handle mapping, initial JavaScript
  updates, one-pass FIFO flush, reentrancy rejection, and deterministic
  binding/context cleanup.
- [x] Added the real-WASM Chromium binding harness for text, attribute,
  property, batching, ordering, write-during-flush, disposal, foreign-instance,
  detached-target, and unknown-pending behavior.
- [x] Implemented the internal M3.4 root context with private container
  ownership, imperative mount scope, explicit flush delegation, deterministic
  unmount/disposal, borrowed runtime preservation, and fail-closed rollback.
- [x] Added the real-WASM Chromium root lifecycle harness covering static and
  reactive mount, batching, FIFO ordering, reentrancy, event cleanup, duplicate
  containers, runtime isolation, rollback, detached targets, disposal, and
  container reuse.
- [x] Added the M3.5 real-WASM Chromium end-to-end harness covering the
  imperative counter interaction, explicit flush boundaries, batching,
  ordering, stable DOM identity, event cleanup, rollback, runtime isolation,
  ownership failures, and container reuse.
- [x] Added the M3.5 browser benchmark harness for separate mount, write,
  flush, binding-dispatch, native-host, and teardown phases at 1/10/100/1000
  bindings, with bounded calibration, operation counts, integrity metadata,
  JSON output, and Markdown summaries.
- [x] Added bounded M3.5 repetition floors for the fastest browser workloads
  and made the result validator accept the conventional pnpm `--` separator;
  measured operation counts remain explicit and strict integrity validation is
  unchanged.
- [x] Completed M3.5 through PR #44 into `develop` and promotion PR #45 into
  `main`; hosted Chromium correctness and M2.5/M3.5 benchmark integrity passed.
- [x] Audited the verified M3 runtime and documented the M4.1 candidate public
  renderer façade, view representation, compiler IR, component model,
  dependency strategy, structural regions, scheduling boundary, ownership
  restrictions, open decisions, and M4.2–M4.5 roadmap.
- [x] Implemented the approved M4.2 public `ruseact-dom` renderer façade with
  structured `RendererResult` diagnostics, one-shot `RendererRoot` lifecycle,
  immutable versioned static mount plans, stable node IDs, explicit binding
  slots, supported attributes/properties, and native listener instructions.
- [x] Delegated public mounting, flushing, unmounting, and disposal to the
  existing M3.2 host, M3.3 binding, and M3.4 root contexts without adding a
  second lifecycle engine, reactive graph, scheduler, or ownership registry.
- [x] Added the real-WASM Chromium public renderer harness covering Hello
  World, reactive counter behavior, explicit flush, plan validation, rollback,
  listener cleanup, one-shot mount, borrowed-resource survival, and container
  reuse. Hosted Chromium remains authoritative because InstaBox cannot route
  Chromium to its temporary loopback server.
- [x] Implemented the private M4.3 TypeScript Compiler API transform for the
  supported TSX subset. It emits deterministic M4.2 `ViewDescription` v1
  plans, explicit compiler-only binding markers, JavaScript event closures,
  and source-located diagnostics without a JSX runtime, evaluator inference,
  structural reconciliation, or public compiler export.
- [x] Added compiler unit/snapshot-style tests and a real-WASM Chromium
  compiled Hello World and Counter fixture. Hosted browser verification remains
  the authoritative final check for this branch.

## In progress / next

- [x] Specify the Rust-to-JavaScript ABI before adding WASM exports.
- [x] Obtain explicit approval for the M2.1 MVP decisions.
- [x] Implement and test the approved WASM bridge in M2.2.
- [x] Add the narrowly scoped M2.2.1 computation identity bridge needed for
  safe pending-computation handle mapping.
- [x] Build the M2.3 public TypeScript wrapper; preserve the M2.2 opaque-handle
  and structured-error contract.
- [x] Validate browser bundler loading and host integration in M2.4; the
  authoritative GitHub-hosted Chromium job passed for this feature revision.
- [x] Complete the corrected authoritative M2.5 Node 24 and Chromium benchmark
  workflow; run `44460980319` passed the Benchmark and Browser jobs with
  263/263 valid workload rows in each report. Artifact `14499858517` was
  created; per-workload numeric values remain artifact-only because its ZIP
  endpoint was unavailable from this InstaBox session.
- [x] Obtain human approval for the M3.1 hybrid renderer direction and open
  decisions before starting M3.2 implementation.
- [x] Implement the approved internal M3.3 explicit reactive-binding prototype
  without finalizing public view, root, or lifecycle APIs; do not add automatic
  tracking or a scheduler.
- [x] Define and implement the approved internal M3.4 root/lifecycle boundary;
  the public renderer/view lifecycle remains deferred and shared-runtime
  binding managers remain unsupported.
- [x] Define the candidate public renderer/view lifecycle and compiler
  integration contract in M4.1; the narrow M4.2 subset was then approved for
  implementation.
- [x] Obtain approval for the M4.2 façade, static mount plan, dependency,
  one-shot lifecycle, structured-result, and manual-flush subset; compiler,
  component, structural, and scheduling extensions remain deferred.
- [x] Run hosted Chromium public-renderer verification and promote the M4.2
  implementation through PR #48 into `develop` and PR #49 into `main`.
- [ ] Obtain human review of the M4.3 compiler implementation PR before any
  promotion.
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
- M2.4 local-supported validation — browser execution is intentionally not
  claimed here: the InstaBox Chromium process cannot connect to the harness's
  loopback HTTP server and the server receives no browser requests. The
  browser harness syntax, web-bindings preparation, Rust checks, TypeScript
  checks, Node/WASM regression path, and policy checks are run locally; real
  browser assertions are authoritative only on the GitHub-hosted Ubuntu job.
- M2.4 hosted browser validation — PASS: GitHub Actions run `44426020307`,
  `Browser (chromium)`, used Google Chrome `157.0.8103.50` on Ubuntu 26.04.1,
  generated `wasm-bindgen --target web` bindings, loaded the actual WASM
  module through `createReactiveCore(loadWasm)`, and passed 94 assertions.
- M2.5 local Node benchmark diagnostic — PASS on InstaBox with Node `22.23.3`:
  263/263 structured result rows across direct WASM and TypeScript layers after
  adaptive calibration; zero unresolved, zero-median, zero-sample,
  non-finite, and calibration-limit rows; the integrity and result-format
  validators passed. The
  authoritative pinned Node 24 and hosted Chromium results are recorded after
  the corrected pull-request benchmark workflow completes.
- M2.5 hosted benchmark validation — PASS: run `44460980319`, Benchmark and
  Browser jobs passed; Node and Chromium each produced 263/263 valid rows with
  no unresolved, zero-median, zero-sample, non-finite, or calibration-limit
  rows. Artifact `14499858517` was uploaded.
- M3.1 design-only validation — PASS on Linux x86_64: Rust formatting, Clippy,
  workspace tests (35 core and 10 WASM tests), the wasm32 workspace check,
  TypeScript typecheck, diff checks, skill validation, workflow policy, and
  automation-gate checks. The optimized WASM build, matching
  `wasm-bindgen-cli 0.2.130` Node bindings, and existing real Node/WASM
  TypeScript integration test also passed. No local Chromium result is claimed;
  the existing hosted Ubuntu browser job remains authoritative.
- M3.2 local validation — PASS for Rust formatting, Clippy, workspace tests,
  wasm32 workspace check, TypeScript typecheck, strict host-module compilation,
  browser-test script syntax, skill validation, workflow policy, automation
  gate, and the existing optimized Node/WASM runtime integration test. The
  required frozen pnpm install was attempted twice but the InstaBox pnpm store
  operation lock is on a read-only filesystem; no dependency or lockfile
  change was made. The new real Chromium DOM test remains authoritative in
  hosted CI.
- M3.3 local validation — PASS for Rust formatting, Clippy, workspace tests,
  wasm32 workspace check, TypeScript typecheck, binding/browser-harness strict
  compilation and syntax, synthetic binding lifecycle sanity, optimized
  release WASM build, matching `wasm-bindgen-cli 0.2.130`, existing Node/WASM
  bridge and runtime tests, README validation, skill validation, workflow
  policy, automation gate, and risk classification. The required frozen pnpm
  install was blocked by the known read-only InstaBox pnpm store lock; no
  dependency or lockfile change was made. Hosted Chromium binding validation
  is authoritative and pending the feature PR workflow.
- M3.4 local validation — TypeScript typecheck, root harness syntax, release
  WASM build, matching `wasm-bindgen-cli 0.2.130` generation, and diff checks
  pass on Linux x86_64. The local Chromium harness cannot bind its temporary
  loopback server in this InstaBox (`listen EPERM`); hosted GitHub Chromium is
  authoritative. Full Rust, package, policy, and hosted browser results are
  recorded after the feature PR workflow completes.
- M4.1 design-only validation — PASS on Linux x86_64: `cargo fmt --all --
  --check`, workspace Clippy, workspace tests (35 core and 10 WASM tests), the
  wasm32 workspace check, `corepack pnpm typecheck`, `git diff --check`, README
  validation, skill validation, workflow policy, automation-gate, and LOW risk
  classification. No runtime, compiler, package-export, WASM, or browser test
  changes were made. The repository pin is Node `24.22.3`; this box's active
  Node is `22.23.3`, while the TypeScript check completed successfully.
- M4.2 local validation — TypeScript typecheck, public browser harness syntax,
  release WASM build, matching `wasm-bindgen-cli 0.2.130` generation, and
  `git diff --check` pass on Linux x86_64. The public Chromium harness reached
  the known InstaBox `listen EPERM` loopback restriction; no local browser pass
  is claimed and hosted GitHub Chromium remains authoritative.

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
- M2.4 local browser execution remains unavailable because this InstaBox
  Chromium cannot reach local HTTP servers. The hosted Ubuntu job is therefore
  the authoritative execution environment. The `Browser (chromium)` context
  currently passes but is not yet listed in the active develop or main
  required-check rulesets; repository administrators must add it if browser
  verification is intended to gate merges.
- M2.5 benchmark timing has no performance pass/fail threshold, but its
  integrity gate rejects missing, non-finite, zero-sample, all-zero,
  zero-median, or unreliable rows. A calibration-cap row is valid only when
  its official samples clear the timer-safety median and quantization-aware
  four-quantum IQR gate; target-reached dispersion remains diagnostic, and the
  cap decision and quality metadata remain machine-readable.
  Browser completion uses real-time DevTools Protocol polling rather than
  Chromium virtual time or `--dump-dom`. The hosted benchmark workflow uploads
  results as artifacts; local Node diagnostics use host Node `22.23.3` when the
  pinned Node `24.22.3` binary is unavailable. No memory metric or
  cross-machine speed claim is made.
- M3.1 is design-only. The proposed hybrid DOM architecture requires human
  approval before M3.2. No runtime source, WASM ABI, public TypeScript API,
  compiler, scheduler, DOM operation, or example application is added by this
  milestone.
- M3.2 deliberately keeps host operations internal. The public root lifecycle,
  component identity, view descriptors, and public flush lifecycle remain
  deferred. M3.3 adds only the approved internal explicit binding context.
- M3.3 requires one dedicated ReactiveCore per active binding context because
  the existing pending drain is global and destructive. Unknown pending
  computations fail closed, but the current ABI cannot restore a consumed
  snapshot; scoped draining and rollback remain future decisions.
- M3.4 keeps the public root/view lifecycle unresolved. Its internal root
  context borrows the ReactiveCore and container, owns only renderer-created
  resources, and requires a dedicated runtime per active binding context. A
  cleanup failure enters a fail-closed state and retains the container claim;
  no recovery protocol or new ABI was added.
- M3.5 adds real-WASM Chromium end-to-end correctness and performance
  harnesses. The browser path is authoritative only in hosted CI because the
  InstaBox loopback browser limitation prevents claiming local Chromium
  execution. Numeric benchmark results remain CI artifacts until the hosted
  workflow completes; no values are fabricated in this progress record.
