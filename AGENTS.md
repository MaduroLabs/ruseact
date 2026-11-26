# Ruseact — Agent Instructions

## Product / architecture
Ruseact is a **React-inspired** TypeScript/JSX UI framework using a **RustReactiveCore** implemented in Rust, compiled to WASM for the browser. It does not use React Fiber or wrap React's reconciler. The compiler may generate static templates, binding metadata, and a dynamic fallback. JavaScript executes user component closures and DOM operations; Rust owns the reactive dependency graph, scheduling data, and structural mutation planning only where justified.

Do **not** claim React API compatibility or performance superiority unless tests and benchmarks prove it. `useState`-style syntax without component re-execution requires a compiler strategy for stale closures, effect ownership, and dynamic dependencies; do not silently implement a semantically incompatible approximation.

## Ownership boundaries
- `crates/ruseact-core`: platform-independent graph/signal/scheduler; **no DOM, wasm-bindgen, or browser imports**.
- `crates/ruseact-wasm`: thin, explicit Rust ↔ JS ABI bridge; avoid per-binding crossings.
- `packages/ruseact`: public TSX API and compiler integration, when implemented.
- `packages/ruseact-dom`: browser host adapter and event lifecycle, when implemented.
- `ruseact-example`: a **separate GitHub repository**. Do not add example applications to this repository.

## Working rules
1. Inspect the relevant code and tests before changing behavior; preserve existing repo setup.
2. Keep changes scoped to the requested milestone; do not implement all modules speculatively.
3. Prefer deterministic Rust unit tests for core invariants; add integration tests where an API crosses layers.
4. Do not allocate DOM nodes or call JS from `ruseact-core`.
5. Distinguish architectural hypotheses from observed benchmark results.
6. Use GitHub branches/PRs for nontrivial changes; do not push, publish, release, or modify the sibling repo without user authorization.
7. Before completing, report code changed, commands actually run, test results, and the corresponding example consumer impact.

## Mandatory Git workflow

### Lifecycle states

Every task is tracked through these states:

`TASK_READY` → `IMPLEMENTING` → `DOCUMENTING` → `VALIDATING` →
`SELF_REVIEW` → `PR_OPEN` → `CI_PENDING` → `CI_FAILED` or `CI_PASSED` →
`MANUAL_APPROVAL_REQUIRED` → `MERGED_DEVELOP` → `PROMOTING_MAIN` →
`PROMOTED_MAIN`.

`BLOCKED` and `MANUAL_APPROVAL_REQUIRED` are terminal states for the current
run until the blocking condition is removed or a human explicitly authorizes
the next action.

Valid transitions and gates:

- `TASK_READY` → `IMPLEMENTING`: the task scope and acceptance criteria are
  known, the worktree is clean, and the task branch starts at the latest
  `origin/develop`.
- `IMPLEMENTING` → `DOCUMENTING`: implementation and task-scoped tests are
  complete enough to describe accurately.
- `DOCUMENTING` → `VALIDATING`: the root `README.md` and any relevant module
  documentation are updated in the same branch.
- `VALIDATING` → `SELF_REVIEW`: all required local checks pass.
- `SELF_REVIEW` → `PR_OPEN`: the complete diff is reviewed, risk is classified,
  no secrets or unrelated changes are present, and the feature branch is
  pushed with a PR targeting `develop`.
- `PR_OPEN` → `CI_PENDING`: GitHub has accepted the PR and its head SHA is
  recorded.
- `CI_PENDING` → `CI_FAILED`: a required check fails, is cancelled, is stale,
  or the README gate fails. Fix the branch and return to `VALIDATING`; never
  merge around a failure.
- `CI_PENDING` → `CI_PASSED`: all enforced checks passed for the current PR
  head SHA and the required README gate passed.
- `CI_PASSED` → `MANUAL_APPROVAL_REQUIRED`: every PR takes this transition.
  CI success never authorizes an agent or workflow to merge. A human must
  review and squash-merge the PR through GitHub's protected `develop` path.
- `MANUAL_APPROVAL_REQUIRED` → `MERGED_DEVELOP`: only after the human has
  merged the PR and the merge is visible in GitHub. The agent never merges an
  implementation PR and no workflow requests native auto-merge.
- `MERGED_DEVELOP` → `PROMOTING_MAIN`: only after the user explicitly invokes
  `$ruseact-main-promote`, provides the exact merged PR number, and confirms
  that the task is complete. The exact squash SHA must be the current tip of
  `origin/develop` and must not already be on `main`.
- `PROMOTING_MAIN` → `PROMOTED_MAIN`: the verified commit passes main
  validation and is accepted through the configured protected promotion path.
- Any failed safety check, ambiguous identity, API outage after bounded retry,
  diverged history, conflict, or missing permission → `BLOCKED`.
- `PROMOTED_MAIN` returns the checkout to a clean, synchronized `develop` and
  then awaits the next `TASK_READY`.

### Branch creation and implementation

- `develop` is the only permitted starting branch for new implementation tasks.
- Before starting, inspect the worktree, fetch `origin`, switch to local
  `develop`, and synchronize it with `git pull --ff-only origin develop`. If
  local `develop` does not exist, create it from `origin/develop` first.
- Every task or sub-milestone uses its own branch from the latest
  `origin/develop`, named `feature/<milestone>-<description>`.
- Never create a task branch from `main` or another feature branch.
- Do not start a dependent task until its prerequisite changes are present on
  `develop`.
- Keep implementation scope assigned; do not add examples to this repository.

### Mandatory README maintenance

Every new implementation task, milestone, or sub-milestone **must** update the
root `README.md` in the same feature branch and PR. Before implementation,
read the existing README and identify affected sections. The update must
accurately describe completed behavior, usage, architecture, or milestone
status and must not make speculative performance or compatibility claims.

The README gate rejects a missing, empty, whitespace-only, or unrelated
mechanical touch. The CI check verifies a meaningful non-whitespace diff; the
author and self-review must additionally verify semantic relevance and factual
accuracy. Update module-specific README files when the affected module has
one. Infrastructure maintenance, automated dependency updates, and emergency
fixes may use an exception only when the trusted repository policy and an
appropriate human approval explicitly record why a README update is not
appropriate. A PR author cannot create an arbitrary label to bypass this rule.

### Validation, publication, and merge

For every task:

1. Implement only the assigned scope and add or update appropriate tests.
2. Update the root README and relevant module documentation.
3. Run Rust formatting, Clippy, workspace tests, and package-specific checks.
4. Self-review the complete diff, including README relevance and risk.
5. Commit the completed changes and push only the feature branch.
6. Open a PR targeting `develop` with the head SHA, base SHA, acceptance
   criteria, README summary, checks, risk classification, and limitations.
7. Wait for enforced CI and review gates. A human must manually squash-merge
   the implementation PR through GitHub. Codex and repository workflows must
   never enable auto-merge or merge the implementation PR.

The former `auto-merge-develop.yml` and `promote-main.yml` workflows are
disabled in GitHub Actions and removed from the repository. They must not be
reintroduced as event-driven automation. `ruseact-pr-publish` stops after
opening the PR. `$ruseact-main-promote` is a manual, user-invoked recovery and
promotion helper only; it verifies one exact squash SHA, prepares a protected
promotion PR to `main`, and stops for a human merge. Neither path bypasses
branch protection or directly updates a protected branch.

### Risk classification and approval

The repository-maintained path policy is conservative. Low-risk candidates
include tested documentation changes and ordinary implementation work within
an already approved architecture when no protected paths are changed. High-risk
work always requires explicit human approval and includes:

- `AGENTS.md`, `.agents/skills/**`, `.github/**`, or workflow/ruleset changes;
- GitHub Actions permissions, branch protection, rulesets, credentials, or
  secret handling;
- release or publishing infrastructure, dependency/toolchain security
  changes, public API compatibility, or Rust/JavaScript ABI changes;
- RustReactiveCore architectural changes or changes that weaken tests or CI;
- any unexpected, ambiguous, or unclassified change.

Risk is determined from trusted changed-file inspection and repository policy,
not from labels alone. This workflow-configuration task is high risk and must
not auto-merge or auto-promote itself.

### Human approval and main promotion

No implementation task pushes directly to `main`, and no agent or workflow
merges any PR automatically. Promotion requires an actually merged,
squash-only PR, the exact GitHub merge SHA, a current `origin/develop` tip
match, duplicate-promotion checks, main validation, and a protected promotion
PR. If a direct push would bypass branch protection, use the promotion PR path
and stop for the user's manual merge, or report the blocker. Never force-push,
rewrite shared history, reset or discard local work, or silently select
whichever commit happens to be `HEAD`.

After a successful promotion, return to a clean synchronized `develop`. If the
PR uses a merge commit, rebase merge, multiple ambiguous commits, a stale SHA,
failed validation, missing required checks, a cherry-pick conflict, an API
outage, or insufficient permissions, enter `BLOCKED` or
`MANUAL_APPROVAL_REQUIRED` and report recovery instructions.

## Platform
Support Ubuntu Linux and Apple macOS (including Apple Silicon). Use relative paths, Rust toolchain metadata, Node/pnpm lockfiles, and GitHub CI; never commit `target`, `node_modules`, generated WASM, machine-local links, or secrets. Do not assume GNU-only flags or OS-specific shell paths. Read `docs/development-workflow.md` when modifying tooling or package integration.

## Codex skills
Use a focused skill in `.agents/skills/` when the task matches its description. Do not invoke every skill for an unrelated change.

## Branch resume across Ubuntu and macOS
Use `$ruseact-branch-resume` when fetching/checking out work from another machine or restoring a branch-specific environment. Read the checked-out branch's `.ruseact/branch-env.json` (if present) and `docs/work-progress.md`; never assume every branch runs the same setup. Inspect working-tree status before switching and do not force-reset or auto-stash. `docs/work-progress.md` is branch-local and must be committed/pushed to appear on the other machine.
