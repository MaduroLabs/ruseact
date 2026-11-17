---
name: ruseact-main-promote
description: After the user explicitly confirms a specific Ruseact PR was merged into develop and its task is complete, verify the exact approved squash commit, update develop and main safely, cherry-pick that one commit to main, rerun Rust checks, push main, and return to develop. Never use for PR creation or before explicit post-merge approval.
---
# Promote an approved Ruseact PR from develop to main

## Critical authorization gate

This is a **high-impact remote write**. Run only when the user explicitly invokes `$ruseact-main-promote`, identifies the PR number or exact PR URL, **and** confirms both that they merged it into `develop` and that its task is finished. A GitHub `MERGED` status, a generic "sync branches" request, or the skill invocation alone is not approval. If any part is missing, stop and ask for the missing confirmation. Do not merge PRs yourself.

Operate exclusively in `MaduroLabs/ruseact`. Read `AGENTS.md` and preserve its mandatory Git workflow. This skill promotes **exactly one approved PR** per invocation, never whatever happens to be the latest commit.

## Pre-flight verification (read-only first)

1. Identify the exact approved PR and record its number, title, URL and merge commit SHA:

```bash
gh pr view <PR_NUMBER> --repo MaduroLabs/ruseact --json number,url,title,state,mergedAt,baseRefName,mergeCommit,headRefName
```

2. Require `state == MERGED`, a non-null `mergedAt`, `baseRefName == develop`, and a non-null `mergeCommit.oid`. Check these values against the user's explicit approval. Never derive the target SHA from an arbitrary `HEAD`.
3. Confirm the repo identity with `gh repo view --json nameWithOwner`, expected origin remote, clean worktree and no ongoing Git merge/cherry-pick/rebase. Do not stash, clean, reset, delete, or overwrite local changes.
4. `git fetch origin --prune`; ensure both `origin/develop` and `origin/main` exist. Require the approved SHA to be **identical to** `git rev-parse origin/develop`. If a newer commit has reached `develop`, stop and report; do not cherry-pick the new tip.
5. Inspect `git show --format=fuller --stat <SHA>` and the commit parents (`git rev-list --parents -n 1 <SHA>`). Require exactly one parent, with clear evidence it is the approved PR's single squash commit. Cross-check PR changed paths (`gh pr diff <PR_NUMBER> --name-only`) against the commit and inspect its diff. If merge method or commit identity is uncertain, or the PR was merged with a merge commit/rebase/multiple commits, stop and request a decision.
6. Detect an already promoted commit (e.g., `git log origin/main --format=%B` contains `cherry picked from commit <SHA>` from `git cherry-pick -x`). If already promoted, do not create a duplicate; report idempotent completion and return to a clean `develop` if safe.

## Synchronize and promote

Only after all gates pass:

1. `git switch develop` (or create local `develop` from `origin/develop` if absent and safe); `git pull --ff-only origin develop`. Check that local `HEAD` matches the verified `origin/develop` SHA.
2. `git switch main` (or create local `main` from `origin/main` if absent and safe); `git pull --ff-only origin main`. No force-push or implicit merge/rebase.
3. Before cherry-picking, inspect whether the exact patch is already present on `main`; if uncertain, stop. Cherry-pick **only** the verified commit using `git cherry-pick -x <VERIFIED_SHA>` for traceability.
4. If the cherry-pick conflicts or becomes empty, do not resolve automatically. If this skill initiated the cherry-pick and the pre-operation worktree was clean, use `git cherry-pick --abort` to restore the pre-cherry-pick state, then stop and report the conflict. Never reset away unrelated user work.
5. On the resulting local `main`, run and record:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```

6. Self-review `git show --stat HEAD`, commit message and original SHA provenance. Push `main` with normal `git push origin main` only if all checks pass and remote has not diverged. If checks or push fail, do not force-push, bypass protection or silently remove the new local commit; stop and report the recoverable state.
7. After successful push, `git switch develop`, `git pull --ff-only origin develop`, verify clean worktree and final branch `develop`. Do not begin another task automatically.

## Final report

Include approved PR #/URL, original `develop` squash SHA, new `main` cherry-pick SHA, validation evidence, remote push outcome, final local branch and any blockers. An unsuccessful or partially completed promotion must **never** be reported as success.

## Absolute prohibitions

Do not accept an unspecified PR; automatically approve a merge; promote a PR merged into `main` or another branch; cherry-pick `origin/develop` HEAD without matching the PR; rewrite history; force-push; bypass branch protection; push code if validation fails; or start a subsequent milestone. Stop on any unexpected condition.
