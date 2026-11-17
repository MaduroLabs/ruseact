---
name: ruseact-pr-publish
description: Validate and publish a Ruseact task with mandatory README maintenance, trusted risk classification, and manual-approval PR publication. Use only when the user explicitly asks to publish a task or create its PR; never merge or promote it.
---
# Publish a reviewed Ruseact feature branch to develop

## Scope and authorization

Run only for `MaduroLabs/ruseact` after the user explicitly asks to publish
the current task or milestone. This skill authorizes a scoped commit, feature
branch push, and PR creation. It does not authorize merging this task,
changing repository rulesets, changing Actions permissions, pushing `main`, or
working in `ruseact-examples`.

Ruseact uses a strictly manual merge policy. The former
`.github/workflows/auto-merge-develop.yml` is disabled and removed. This skill
never invokes `gh pr merge`, never enables native auto-merge, and never treats
CI success as merge authorization. Every task stops after opening its PR for
human review and protected squash merge.

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

## Phase D — Manual approval and stop condition

Every PR enters `MANUAL_APPROVAL_REQUIRED` after publication, regardless of
risk classification. Before stopping, verify that:

- the PR targets `develop`, is not a draft, and has no unresolved conflict;
- the current PR head SHA is the SHA that was validated;
- the meaningful README gate passed and self-review confirms semantic
  relevance;
- active `develop` rulesets enforce required checks, required reviews, and
  squash merging; and
- all required checks passed for the current PR head SHA.

Then stop. A human must review and squash-merge the PR in GitHub. Do not call
`gh pr merge`, pass `--auto`, or alter repository settings. The agent may
continue only in a later user-authorized task after the merge is independently
verified.

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
risk classification, every command actually run and its result, manual review
state, blockers, and example-repository impact. Always stop after opening the
PR and wait for human review; this is required for both low- and high-risk
work.
