---
name: ruseact-pr-publish
description: Publish a completed Ruseact task or milestone by inspecting the feature branch, running required Rust validation and self-review, committing only task changes, pushing the feature branch, and opening or updating a pull request targeting develop. Use only when the user explicitly invokes this skill to publish code or create a PR; never merge a PR or promote main.
---
# Publish a reviewed Ruseact feature branch to develop

## Scope and authorization

Run only for `MaduroLabs/ruseact` after the user explicitly asks to publish the current task or milestone. Invocation authorizes a scoped commit, feature-branch push, and PR creation, **not** a PR merge, a push to `develop`/`main`, or work in `ruseact-examples`.

Read the current `AGENTS.md`, `docs/development-workflow.md` if present, and relevant project documentation. Follow stricter repository rules if they exist. The user owns final PR review and merge.

## Pre-flight gate (before any mutation)

1. Confirm repository identity: `git rev-parse --show-toplevel`, `git remote -v`, `gh repo view --json nameWithOwner`; it must be `MaduroLabs/ruseact`.
2. Inspect `git status --short --branch`, current branch, `git log -5 --oneline`, `git diff`, `git diff --cached`, and `gh auth status`. Never auto-stash, clean, reset, or discard work.
3. Require a feature branch `feature/<milestone>-<description>`. It must originate from `develop`, not `main` or another feature branch. If currently on `develop`, do not publish changes directly from it: create a new task branch from a clean and synchronized `origin/develop` **only when the user has identified the task and the worktree is clean**. If work already exists on the wrong branch, stop for explicit instructions; do not migrate work silently.
4. `git fetch origin --prune`; verify `origin/develop` exists and that the branch contains its originally approved baseline. If `develop` advanced after the task branched, report this and require a safe integration decision rather than silently rebasing or merging.
5. Confirm which files and commits belong to this one task. If there are unrelated modifications, untracked files, secrets, generated files, or ambiguous ownership, stop and request cleanup/selection. Check `AGENTS.md` exclusions (`target`, `node_modules`, generated WASM, machine-local paths, credentials).
6. Check whether an open PR already exists for this head branch: `gh pr list --head <branch> --state open --json number,url,baseRefName`. Reuse a valid existing PR; never create a duplicate.

## Validate and self-review

Run from the repository root and record actual results:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```

- Inspect the complete diff against `origin/develop` (`git diff origin/develop...HEAD`) **and** uncommitted diffs before committing.
- Review scope, architecture, tests, potential regressions, dependencies and accidental secret leakage. Never claim a check passed without running it.
- Fix only task-scoped issues, rerun relevant checks, and stop if validation fails or an architectural decision is unapproved.
- For documentation-only updates, still run the repository-required checks or report the exact unavailable command/blocker; do not silently skip them.

## Commit, push, and PR

1. Stage **explicit task-related paths only** with `git add -- <paths>`; never blindly stage everything with `git add -A`.
2. Inspect `git diff --cached --check`, `git diff --cached --stat` and `git diff --cached`; confirm there are no unintended changes.
3. Create a conventional, task-scoped commit if needed. If all intended changes were already committed, do not create an empty commit.
4. Verify the local feature branch is safe to publish and no unexpected remote divergence exists. Push **only** the feature branch (`git push -u origin <branch>`), never force-push.
5. Create a PR with `gh pr create --base develop --head <branch> --title '<title>' --body '<summary and checks>'` unless a valid PR already exists. Ensure the PR base is **exactly `develop`**.
6. Report branch, commit SHA(s), PR number/URL, changed files, validation results, review findings, and blockers. **Stop and wait for the user to review and merge the PR.**

## Absolute stop conditions

Wrong repository; dirty unrelated work; branch not based on `develop`; missing or diverged remote; unavailable authentication; validation or review failure; secrets detected; ambiguous task scope; unsafe push; conflicting PR base; or missing user authorization to publish. Never merge the PR, cherry-pick onto `main`, delete branches, force-push, or start the next task.
