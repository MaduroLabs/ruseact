---
name: ruseact-pr-publish
description: Validate and publish a Ruseact task with mandatory README maintenance, trusted risk classification, and CI-gated squash auto-merge eligibility. Use only when the user explicitly asks to publish a task or create its PR; never merge high-risk work or promote main.
---
# Publish a reviewed Ruseact feature branch to develop

## Scope and authorization

Run only for `MaduroLabs/ruseact` after the user explicitly asks to publish
the current task or milestone. This skill authorizes a scoped commit, feature
branch push, and PR creation. It does not authorize merging this task,
changing repository rulesets, changing Actions permissions, pushing `main`, or
working in `ruseact-examples`.

The trusted `.github/workflows/auto-merge-develop.yml` may request native
squash auto-merge for an eligible low-risk PR after GitHub verifies enforced
checks and reviews. This skill never enables auto-merge for high-risk work and
never uses labels or PR text as a security decision. The current workflow
configuration task is high risk and must remain pending explicit human review.

Read `AGENTS.md`, `README.md`, `docs/development-workflow.md`, and relevant
project documentation before acting. Follow stricter repository rules if they
exist.

## Phase A — Pre-publication verification

1. Confirm `git rev-parse --show-toplevel`, the expected `origin` remote,
   `gh repo view --json nameWithOwner`, and `gh auth status`.
2. Inspect `git status --short --branch`, the current branch, recent commits,
   unstaged and staged diffs, and any merge/cherry-pick/rebase state. Never
   auto-stash, clean, reset, or discard work.
3. Require `feature/<milestone>-<description>` based on the latest synchronized
   `origin/develop`, not `main` or another feature branch. If `develop`
   advanced after the branch was created, stop and request a safe integration
   decision rather than silently rebasing or merging.
4. Inspect the assigned task and acceptance criteria. Confirm only task-scoped
   files are changed and no secrets, generated WASM, `target`, `node_modules`,
   machine-local paths, or unrelated work are present.
5. Verify that the root `README.md` changed in the same branch. Check that the
   change is meaningful, relevant to the implementation, factually consistent
   with source and tests, and not a whitespace-only or unrelated touch. Check
   module-specific documentation when applicable.
6. Run `git fetch origin --prune` and check for an existing open PR for the
   exact head branch. Reuse a valid PR only when its base is exactly `develop`.

## Phase B — Local validation and self-review

Run the actual required checks and record their results:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
python3 scripts/validate_skills.py
python3 scripts/test_workflow_policy.py
```

Run additional package, compiler, DOM, WASM, or TypeScript checks using the
repository's actual tooling when those files are changed. For README
validation, use the trusted base and head SHAs:

```bash
python3 scripts/validate_readme_update.py --base-sha <BASE_SHA> --head-sha <HEAD_SHA>
python3 scripts/classify_changed_files.py --base-sha <BASE_SHA> --head-sha <HEAD_SHA>
```

Review `git diff origin/develop...HEAD`, all uncommitted diffs, tests,
dependencies, architecture boundaries, risk, documentation accuracy, and
potential secret leakage. High-risk paths include `AGENTS.md`,
`.agents/skills/**`, `.github/**`, Actions permissions, credentials, release
infrastructure, public API/ABI, and significant RustReactiveCore changes.

## Phase C — Publication

After validation and self-review:

1. Stage explicit task paths only with `git add -- <paths>`.
2. Inspect `git diff --cached --check`, `--stat`, and the complete staged diff.
3. Create a conventional task-scoped commit containing implementation and
   README changes together. Do not create an empty commit.
4. Verify no unexpected remote divergence, then push only the feature branch
   with `git push -u origin <branch>`.
5. Create a PR targeting `develop` with a structured body containing:
   objective, implementation changes, README updates, acceptance criteria,
   commands and results, risk classification, known limitations, head SHA, and
   base SHA.
6. Record the PR number, URL, head SHA, base SHA, and expected lifecycle state
   `PR_OPEN`/`CI_PENDING`.

The PR must not target `main`. Never push directly to `main`, merge the PR
yourself, bypass branch protection, or change repository settings from this
skill.

## Phase D — CI-gated squash merge eligibility

For a low-risk PR, the trusted workflow may enter `AUTO_MERGE_PENDING` only
when all of the following are true:

- the PR still targets `develop`, is not a draft, and has no conflict;
- the current PR head SHA is the SHA that was validated;
- the root README gate passed with meaningful content and self-review confirms
  semantic relevance;
- active `develop` rulesets enforce stable required checks and required
  reviews, all checks passed on the current SHA, and squash is allowed;
- native repository auto-merge is enabled; and
- trusted changed-file classification says `LOW`.

The workflow uses GitHub-native `--auto --squash`. If required checks are
missing, stale, failed, or unenforced, or if native auto-merge is disabled, it
must leave the PR pending and report the exact blocker. High-risk PRs always
remain `MANUAL_APPROVAL_REQUIRED`, including this workflow-configuration task.

## Failure and recovery

On any failure, report the PR number/URL, source and target branches, head and
base SHA, risk, failed operation, exact error, and whether a remote write
completed. Retry only transient API operations with bounded attempts. Do not
force-push, reset, discard work, weaken CI, bypass rulesets, or select an
arbitrary `HEAD`. A newer `develop` tip, missing README update, ambiguous
scope, stale checks, insufficient permission, or branch-protection rejection
is a stop condition.

## Final report

Include changed files, commit SHA, branch, PR URL/number, README evidence,
risk classification, every command actually run and its result, CI/auto-merge
eligibility state, blockers, and example-repository impact. Stop after opening
the PR and wait for human review when this skill is used for high-risk work.
