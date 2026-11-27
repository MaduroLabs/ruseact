---
name: ruseact-post-merge
description: Verify one explicitly supplied, squash-merged Ruseact PR targeting main and synchronize local main without creating another PR or changing remote state.
policy:
  allow_implicit_invocation: false
---

# Ruseact post-merge verification

Use only for `MaduroLabs/ruseact` after the user explicitly supplies the
merged PR number. This skill verifies the completed main-only workflow; it is
not a promotion tool and never starts another task.

## Required safety gates

Before changing the local checkout:

1. Confirm the repository root and expected `origin` remote. Verify the
   GitHub repository is exactly `MaduroLabs/ruseact` and that GitHub
   authentication is available.
2. Inspect `git status --short --branch`, active merge/cherry-pick/rebase
   state, worktrees, and the current local branches. If the worktree is dirty,
   preserve it and stop; never stash, reset, clean, or discard local work.
3. Query exactly the supplied PR with `gh pr view <number> --repo
   MaduroLabs/ruseact`. Require:
   - the repository identity to match;
   - `state == MERGED` and a non-null `mergedAt`;
   - `baseRefName == main`;
   - a non-null `mergeCommit.oid`; and
   - a squash result with exactly one Git parent.
4. Record the PR URL, source branch, source head SHA, merge timestamp, exact
   squash commit, and status-check results. Verify required checks completed
   successfully for the PR head SHA and that the merge method is consistent
   with the protected squash-only policy. Missing, stale, or failed checks are
   a stop condition.
5. Run `git fetch origin --prune`. Require `origin/main` to exist and verify
   the exact merge commit is an ancestor of `origin/main`. Do not require it to
   remain the tip if a later approved main commit exists.

An API outage, ambiguous PR identity, non-main target, non-squash result,
unknown merge commit, failed required check, or diverged local state is
`BLOCKED`. Report the exact evidence and stop.

## Local synchronization

After all gates pass:

1. Ensure local `main` exists. If it does not, create it from `origin/main`.
2. Switch to `main` without force. If another worktree owns the branch or the
   local branch has unique commits, stop and report the conflict.
3. Synchronize with `git pull --ff-only origin main` and verify
   `git rev-parse HEAD == git rev-parse origin/main`.
4. Verify `git status --short --branch` is clean and report the final main
   SHA, the verified PR merge SHA, and the required-check results.

This skill never cherry-picks, creates a promotion PR, merges a PR, pushes to
`main`, changes branch protection or rulesets, deletes branches, or launches
the next implementation task. It does not treat `archive/legacy-main` as an
active base.

## Completion report

Report the repository, PR number and URL, target branch, source head SHA,
exact squash merge SHA, merge provenance, required CI status, remote main SHA,
local synchronization result, and any blocker. Stop after the report and wait
for the next user instruction.
