# Ruseact — Agent Instructions

## Product / architecture
Ruseact is a **React-inspired** TypeScript/JSX UI framework using a **RustReactiveCore** implemented in Rust, compiled to WASM for the browser. It does not use React Fiber or wrap React's reconciler. The compiler may generate static templates, binding metadata, and a dynamic fallback. JavaScript executes user component closures and DOM operations; Rust owns the reactive dependency graph, scheduling data, and structural mutation planning only where justified.

Do **not** claim React API compatibility or performance superiority unless tests and benchmarks prove it. `useState`-style syntax without component re-execution requires a compiler strategy for stale closures, effect ownership, and dynamic dependencies; do not silently implement a semantically incompatible approximation.

## Ownership boundaries
- `crates/ruseact-core`: platform-independent graph/signal/scheduler; **no DOM, wasm-bindgen, or browser imports**.
- `crates/ruseact-wasm`: thin, explicit Rust ↔ JS ABI bridge; avoid per-binding crossings.
- `packages/ruseact`: public TSX API and compiler integration, when implemented.
- `packages/ruseact-dom`: browser host adapter and event lifecycle, when implemented.
- `ruseact-examples`: a **separate GitHub repository**. Do not add example applications to this repository.

## Working rules
1. Inspect the relevant code and tests before changing behavior; preserve existing repo setup.
2. Keep changes scoped to the requested milestone; do not implement all modules speculatively.
3. Prefer deterministic Rust unit tests for core invariants; add integration tests where an API crosses layers.
4. Do not allocate DOM nodes or call JS from `ruseact-core`.
5. Distinguish architectural hypotheses from observed benchmark results.
6. Use GitHub branches/PRs for nontrivial changes; do not push, publish, release, or modify the sibling repo without user authorization.
7. Before completing, report code changed, commands actually run, test results, and the corresponding example consumer impact.

## Mandatory Git workflow

### Branch creation

- `develop` is the only permitted starting branch for new implementation tasks.
- Before starting any task, inspect the working tree, fetch `origin`, switch to local `develop`, and synchronize it with `origin/develop` using `git pull --ff-only origin develop`. If local `develop` does not exist, create it from `origin/develop` before pulling.
- Every milestone or sub-milestone must use a separate feature branch created from the latest `origin/develop`.
- Name feature branches `feature/<milestone>-<description>`.
- Never create a task branch directly from `main` or another feature branch.
- If the task depends on changes that are not merged into `develop`, stop and report the dependency.
- This workflow configuration task is documentation-only, but it also follows the same rule by using a dedicated branch from the latest `origin/develop`.

### Implementation and review

For every task:

1. Implement only the assigned scope.
2. Write or update appropriate tests.
3. Run Rust formatting, Clippy, and workspace tests.
4. Self-review the complete diff.
5. Fix discovered issues and rerun validation.
6. Commit the completed changes.
7. Push the feature branch to `origin`.
8. Create a Pull Request targeting `develop`.

Never merge the agent's own PR. After opening the PR, stop and wait for the user's review.

### Human approval gate

Proceed to main-branch synchronization only when both conditions are satisfied:

- The PR has actually been merged into `develop`.
- The user has explicitly confirmed that the corresponding task is completed.

A merged PR alone is not sufficient authorization. Never infer approval from GitHub status or proceed automatically after a PR merge.

### Promote an approved task to main

After receiving explicit user confirmation:

1. Fetch the latest remote state.
2. Switch to `develop`.
3. Pull `origin/develop` using `--ff-only`.
4. Identify the exact merge result associated with the approved PR.
5. Verify that the commit corresponds to the approved task.
6. Confirm that the PR was merged using a single squash commit.
7. Confirm that the expected commit is the latest commit on `origin/develop`. If another commit has appeared afterward, stop and report instead of cherry-picking an unrelated `HEAD`.
8. Switch to `main`.
9. Pull `origin/main` using `--ff-only`.
10. Cherry-pick the verified commit from `develop` into `main`.
11. Run the required validation checks on `main`.
12. Push `main` to `origin` without force-pushing.
13. Switch back to `develop`.
14. Synchronize `develop` again and verify that the working tree is clean.
15. Stop and wait for the next user-assigned task.

If the PR used a merge commit, rebase merge, or multiple commits instead of a single squash commit, stop and request an explicit promotion strategy. If cherry-picking causes conflicts, validation fails, or main-branch protection rejects the push, stop and report the blocker. Do not bypass protection rules or force-push.

### Restrictions

- Never push directly to `main` during implementation.
- Never merge a PR without user authorization.
- Never promote an unverified commit to `main`.
- Never force-push `main` or `develop`.
- Never silently skip review or validation.
- Never start another dependent milestone before its prerequisites have been merged into `develop`.
- Always leave the repository on `develop` after successful main synchronization.
- Await the next task after completing the workflow.

## Platform
Support Ubuntu Linux and Apple macOS (including Apple Silicon). Use relative paths, Rust toolchain metadata, Node/pnpm lockfiles, and GitHub CI; never commit `target`, `node_modules`, generated WASM, machine-local links, or secrets. Do not assume GNU-only flags or OS-specific shell paths. Read `docs/development-workflow.md` when modifying tooling or package integration.

## Codex skills
Use a focused skill in `.agents/skills/` when the task matches its description. Do not invoke every skill for an unrelated change.

## Branch resume across Ubuntu and macOS
Use `$ruseact-branch-resume` when fetching/checking out work from another machine or restoring a branch-specific environment. Read the checked-out branch's `.ruseact/branch-env.json` (if present) and `docs/work-progress.md`; never assume every branch runs the same setup. Inspect working-tree status before switching and do not force-reset or auto-stash. `docs/work-progress.md` is branch-local and must be committed/pushed to appear on the other machine.
