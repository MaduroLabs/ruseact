# Ruseact development workflow

GitHub is the source of truth for tracked code, skills, architecture notes,
workflow definitions, and committed lockfiles. The library and
`ruseact-examples` repositories remain independent; this repository never adds
example applications.

## Lifecycle

Tasks move through `TASK_READY`, `IMPLEMENTING`, `DOCUMENTING`, `VALIDATING`,
`SELF_REVIEW`, `PR_OPEN`, `CI_PENDING`, `CI_FAILED` or `CI_PASSED`,
`MANUAL_APPROVAL_REQUIRED`, `MERGED_DEVELOP`, `PROMOTING_MAIN`, and
`PROMOTED_MAIN`. Every PR enters `MANUAL_APPROVAL_REQUIRED` after CI; only a
human may merge it. `BLOCKED` stops the current run until the cause is
resolved. The complete state-transition contract and risk policy live in
`AGENTS.md`.

## Branch and README rules

1. Inspect the worktree, fetch `origin`, switch to `develop`, and run
   `git pull --ff-only origin develop` before starting.
2. Create each task or sub-milestone from the latest `origin/develop` using
   `feature/<milestone>-<description>`.
3. Implement only the assigned scope; do not branch from `main` or another
   feature branch and do not start dependent work before prerequisites land on
   `develop`.
4. Read the root README before implementation and update it meaningfully in
   the same branch and PR for every task. Update module documentation when
   relevant. The CI gate rejects missing, empty, and whitespace-only changes;
   self-review verifies semantic relevance.
5. Use relative paths and committed lockfiles. Do not commit `target`,
   `node_modules`, generated WASM, machine-local paths, or secrets.

## Validation and publication

Run the actual checks required by the changed files. The baseline Rust checks
are:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```

The CI workflow also runs WASM and TypeScript checks, skill validation, risk
classification, and the README gate. Review the complete diff, classify risk
from trusted changed-file inspection, commit task-scoped paths, push only the
feature branch, and open a PR targeting `develop` with the README summary,
acceptance criteria, checks, risk, and limitations.

Every PR requires explicit human review and a protected squash merge. CI
success never authorizes Codex or a workflow to merge. High-risk PRs—including
workflow, skill, ruleset, permissions, security, ABI, public API, and
RustReactiveCore architecture changes—require explicit human approval. Labels
and PR text cannot override the trusted risk policy.

## Manual promotion

The former `auto-merge-develop.yml` and `promote-main.yml` workflows are
disabled in GitHub Actions and removed from the repository. No event-driven
workflow may merge a PR, create a main promotion, or enable native auto-merge.

`$ruseact-pr-publish` validates the feature branch, updates the README,
self-reviews the complete diff, commits, pushes, opens a PR targeting `develop`,
and stops for human review. It never calls `gh pr merge`.

`$ruseact-main-promote` runs only after the user supplies one exact merged PR
number and explicitly confirms completion. It verifies that the PR targets
`develop`, was squash-merged, has one parent, and that its exact merge SHA is
the current `origin/develop` tip. It checks duplicate promotion and main
ruleset state, creates a traceable promotion branch from `main`, cherry-picks
with `-x`, runs validation, opens a protected PR targeting `main`, and stops.
The user must merge that promotion PR manually. Direct pushes, force-pushes,
automatic merge, and arbitrary `HEAD` selection are prohibited.

## Repository configuration required

The repository contains active `develop` and `main` rulesets. Preserve them
without weakening existing rules:

- stable required status checks for the `Ruseact CI` jobs, including
  `README documentation` and `Risk classification` where policy requires;
- at least one required review for implementation PRs and a squash-only
  `develop` merge policy;
- a protected `main` promotion path with required checks and no workflow
  bypass actor; and
- minimal Actions permissions, with privileged workflows limited to trusted
  base-branch code.

Native repository auto-merge must remain disabled for this manual policy. Do
not modify rulesets or permissions automatically from this repository task.
If settings cannot be verified, report the exact blocker and stop before any
protected-branch write.

## Resume and recovery

Use `$ruseact-branch-resume` when changing machines or resuming a branch. Run
its `status` and `plan` before setup; never auto-stash, reset, clean, merge, or
force-push. Read the current branch's `AGENTS.md`, README, lockfiles,
`rust-toolchain.toml`, `.nvmrc`, `.ruseact/branch-env.json`, and
`docs/work-progress.md` before running branch commands.

For a failure, record the PR number and URL, source and target branches,
source squash SHA, resulting main SHA if any, failed operation, error details,
and whether a remote write completed. Resolve the cause before retrying. A
cherry-pick conflict, stale SHA, missing check, failed validation, API outage,
permission error, or branch-protection rejection is a stop condition.

## Machine setup

Use the pinned Rust toolchain and WASM target, `.nvmrc` Node `24.22.3`, and
the package manager version declared in `package.json`. Use frozen installs in
CI (`pnpm install --frozen-lockfile`) and run `pnpm typecheck` when package
sources are affected. Record environment details for benchmark results.

## Example repo integration

When public behavior changes, prepare the matching consumer change in the
separate `ruseact-examples` repository and include its PR link in the library
PR. Before packages are published, test through tarballs built from known
library commits; never commit sibling-path or absolute dependencies.
