# Ruseact development workflow

GitHub is the source of truth for tracked code, skills, architecture notes,
workflow definitions, and committed lockfiles. The library and
`ruseact-examples` repositories remain independent; this repository never adds
example applications.

## Lifecycle

Tasks move through `TASK_READY`, `IMPLEMENTING`, `DOCUMENTING`, `VALIDATING`,
`SELF_REVIEW`, `PR_OPEN`, `CI_PENDING`, `CI_FAILED` or `CI_PASSED`,
`AUTO_MERGE_PENDING`, `MERGED_DEVELOP`, `PROMOTING_MAIN`, and
`PROMOTED_MAIN`. `BLOCKED` and `MANUAL_APPROVAL_REQUIRED` stop the current run
until the cause is resolved or a human authorizes recovery. The complete state
transition contract and risk policy live in `AGENTS.md`.

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

Low-risk PRs may request GitHub-native squash auto-merge only when required
checks are enforced and current, required reviews are satisfied, the PR is
conflict-free, and repository auto-merge is enabled. High-risk PRs—including
workflow, skill, ruleset, permissions, security, ABI, public API, and
RustReactiveCore architecture changes—require explicit human approval. Labels
and PR text cannot override the trusted risk policy.

## Trusted automation

`.github/workflows/auto-merge-develop.yml` runs from the trusted base revision
with `pull_request_target`; it inspects GitHub API metadata and never executes
PR head code with a write token. It fails closed when repository settings or
required checks are missing.

`.github/workflows/promote-main.yml` consumes one trusted merged-PR event (or
an explicitly confirmed recovery dispatch), verifies the exact single-parent
squash SHA is the current `origin/develop` tip, checks for duplicate and
out-of-order events, and prepares a traceable promotion PR to `main`. It uses
bounded workflow dispatch for validation because pushes made with
`GITHUB_TOKEN` do not reliably create downstream workflow runs. It never
force-pushes, bypasses branch protection, or directly updates a protected
branch. Native auto-merge and required checks must be configured by repository
maintainers before automatic promotion can complete.

The workflows use concurrency groups to serialize auto-merge and promotion.
When a newer commit reaches `develop`, the older promotion is stopped rather
than guessing. Duplicate promotions are recognized by the source SHA and
cherry-pick trace. Manual recovery uses `$ruseact-main-promote`, which requires
an exact PR identity and explicit approval; it must not select arbitrary
`HEAD`.

## Repository configuration required

The repository currently contains active `develop` and `main` rulesets, but
activation must be verified by a maintainer. Configure, without weakening
existing rules:

- native auto-merge enabled and squash merge allowed;
- stable required status checks for the `Ruseact CI` jobs, including
  `README documentation` and `Risk classification` where policy requires;
- at least one required review for implementation PRs and a squash-only
  `develop` merge policy;
- a protected `main` promotion path with required checks and no workflow
  bypass actor; and
- minimal Actions permissions, with privileged workflows limited to trusted
  base-branch code.

Do not modify rulesets or permissions automatically from this repository task.
If settings cannot be verified, report the exact blocker and leave automation
in its fail-closed state.

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
