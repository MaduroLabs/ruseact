---
name: ruseact-main-promote
description: Verify one exact squash-merged Ruseact PR and promote it through the trusted main-promotion path, using a protected promotion PR for automation or an explicitly authorized manual recovery. Never guess from HEAD, bypass branch protection, or promote high-risk work automatically.
---
# Promote one approved Ruseact PR from develop to main

## Modes and authorization

This skill supports two modes:

1. **Trusted automation:** `.github/workflows/promote-main.yml` receives one
   verified merged-PR event and performs API and SHA checks from trusted
   repository code. It creates a traceable promotion PR to `main` and requests
   native squash auto-merge only when `main` rulesets, checks, and repository
   settings support that path.
2. **Manual recovery:** run only after the user explicitly invokes
   `$ruseact-main-promote`, identifies the exact PR number or URL, and confirms
   that it was merged into `develop` and the task is complete. A generic
   “promote latest” request or a GitHub `MERGED` status alone is insufficient.

Operate only in `MaduroLabs/ruseact`. This skill never changes rulesets or
Actions permissions, never merges the implementation PR, never force-pushes,
and never bypasses branch protection. High-risk PRs—including `AGENTS.md`,
`.agents/skills/**`, `.github/**`, permissions, security, public API/ABI,
release infrastructure, and significant RustReactiveCore changes—require
explicit human approval and are not eligible for trusted automatic promotion.

## Phase A — Identify and verify exactly one PR

1. Obtain the PR number and URL from the trusted closed-PR event or the user's
   explicit manual request. Do not enumerate merged PRs and guess the latest.
2. Verify repository identity, expected `origin`, clean worktree, no active
   merge/cherry-pick/rebase, and GitHub authentication.
3. Fetch `origin --prune`; ensure `origin/develop` and `origin/main` exist.
4. Query GitHub for `number,url,title,state,mergedAt,baseRefName,mergeCommit,
   headRefName,headSha,commits,files`. Require `state == MERGED`, a non-null
   `mergedAt`, base branch `develop`, and a non-null exact merge SHA.
5. Require the merge result to have one parent and confirm its changed paths
   exactly match the merged PR. A merge commit, rebase result, ambiguous
   identity, or multiple unverified candidates is a stop condition.
6. Verify the exact squash SHA exists on `origin/develop` and is identical to
   the current tip. If a newer commit is present, stop rather than selecting
   arbitrary `HEAD`.
7. Verify trusted CI and README gates passed for the PR's validated head SHA,
   and classify changed paths using repository policy. High-risk work enters
   `MANUAL_APPROVAL_REQUIRED`.

## Phase B — Idempotency and concurrency

Before creating any promotion branch or PR:

- check for a prior cherry-pick trailer containing the exact source SHA on
  `main`;
- check whether the source patch or an open promotion PR already exists;
- record source PR number/URL, source branch, source squash SHA, current
  `origin/develop`, and current `origin/main`;
- serialize promotion attempts with the repository promotion concurrency
  group; and
- stop on a newer `develop` commit, a changed `main` tip, a duplicate branch
  without an open matching PR, or any conflicting event.

Duplicate and delayed events must produce an idempotent report, not a second
cherry-pick or a second main commit.

## Phase C — Protected promotion path

The trusted automation and authorized recovery use this sequence:

1. `git switch develop` and `git pull --ff-only origin develop`; verify the
   exact approved squash SHA is still the tip.
2. `git switch main` and `git pull --ff-only origin main`; verify the remote
   main tip has not changed.
3. Create a uniquely named `automation/promote-<PR>-<SHA>` branch from
   `origin/main` and run `git cherry-pick -x <VERIFIED_SHA>` exactly once.
4. Inspect the resulting diff and traceability trailer. Push only this
   promotion branch, never `main` directly.
5. Create or reuse a PR targeting `main`. Dispatch the trusted CI workflow
   explicitly when the push was made by `GITHUB_TOKEN`; poll only a bounded
   number of times and require success for the promotion branch head SHA.
6. Request GitHub-native `--auto --squash` only when native auto-merge is
   enabled, main has enforced required checks and a pull-request rule, squash
   is allowed, and the verified promotion PR remains unchanged.
7. Do not use a direct push when it would bypass a protected branch. If the
   repository lacks the protected promotion configuration, leave the PR or
   workflow blocked and report the exact settings required.

The resulting GitHub promotion PR may have a new merge SHA; its body and
cherry-pick trailer must preserve the original PR number and source squash
SHA. A direct manual push to `main` is never a fallback for a protection
failure.

## Phase D — Main validation

Before requesting promotion completion, run and record:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```

Run package, WASM, compiler, DOM, TypeScript, skill, and README checks required
by the changed paths. Verify the resulting commit contains only the intended
patch and that README and implementation remain consistent.

## Phase E — Recovery and final state

For failure, report PR number/URL, source and target branches, source squash
SHA, resulting main SHA if any, failed operation, exact error, and whether a
remote write completed. Retry only clearly transient API calls with bounded
attempts. Never reset or discard unrelated work.

After successful promotion, switch to `develop`, run
`git pull --ff-only origin develop`, verify a clean worktree and matching
remote tip, then stop. If the workflow was interrupted, use the recorded
source SHA and idempotency checks before retrying.

## Absolute prohibitions

Do not promote an unspecified PR, a PR merged into another branch, a merge or
rebase commit, a stale or ambiguous SHA, high-risk work without approval, or a
patch already on `main`. Do not execute untrusted PR code with privileged
credentials, force-push, rewrite shared history, bypass rulesets, modify
branch protection automatically, or start another milestone.
