# Two machines, two repositories

## Source of truth
GitHub is the source of truth for tracked code, skills, architecture notes, and committed lockfiles. Work on feature branches, push intentionally when authorized, and pull/fetch on the other machine before starting. Check `git status` before switching devices; local uncommitted files do not sync.

## Mandatory task workflow

New implementation tasks start only from `develop`. Before beginning a task,
fetch `origin` and synchronize local `develop` with `git pull --ff-only
origin develop`. Create every milestone or sub-milestone branch from the latest
`origin/develop`, using the name `feature/<milestone>-<description>`; never
branch from `main` or another feature branch. If a prerequisite is not merged
into `develop`, stop and report the dependency.

For each task, keep the scope assigned, add or update tests, run Rust format,
Clippy, and workspace tests, self-review the complete diff, fix issues, rerun
validation, commit, push the feature branch, and open a PR targeting `develop`.
The agent must not merge its own PR and must stop for user review after opening
it.

Main synchronization requires both an actually merged PR and explicit user
confirmation that the task is complete. A merged PR or GitHub status alone is
not approval. After confirmation, fetch and fast-forward `develop`, verify the
approved PR produced one squash commit and that it is the latest commit on
`origin/develop`, fast-forward `main`, cherry-pick that verified commit, run
validation on `main`, push without force, and return to a clean synchronized
`develop`. Stop and report if the PR was merged with a merge commit, rebase
merge, or multiple commits; if another commit is newer; or if conflict,
validation, or branch protection blocks promotion.

## Machine setup
1. Install git, rustup, a Node version manager (`.nvmrc` selects 24.22.3 LTS), and pnpm (follow the actual `packageManager` value after package.json is created).
2. `rust-toolchain.toml` pins Rust and the WASM target for both machines; verify `rustup show`.
3. Keep both **independent clones as siblings** named `ruseact/` and `ruseact-examples/`.
4. Run `python3 scripts/validate_skills.py` to verify agent skill structure.
5. The workspace pins pnpm to `12.16.1` in the root `package.json`; use Corepack or an equivalent version manager to activate it.
6. Use frozen installs in CI (`pnpm install --frozen-lockfile`) and check in `pnpm-lock.yaml`. Run `pnpm typecheck` for TypeScript and `cargo test --workspace --locked` for Rust.

## Example repo integration
- When `ruseact` changes public behavior, prepare a matching change in the separate `ruseact-examples` repository; include the example PR link in the library PR.
- Never add `examples/` apps to the library repo.
- Preferred reproducible consumer source: **published prerelease package versions** recorded in `package.json`/`pnpm-lock.yaml`.
- Before packages are published, test through tarballs built from a known library commit; in CI, checkout both repos at pinned refs and test those tarballs. Do not commit absolute or sibling-path dependencies.
- Ad hoc `pnpm link` is allowed only for local experimentation. It can write `package.json`/workspace settings; inspect `git diff` and revert link-only modifications before committing.

## Git safety
Use `.gitignore` for generated files, inspect `git diff --check`, run relevant tests, and avoid cross-OS filesystem-case assumptions. Record performance measurements with OS, CPU, browser, Node, Rust, and WASM build config. No GitHub mutation without explicit authorization.

## Resume branch workflow
Invoke `$ruseact-branch-resume`: `status`, `switch <branch>`, `plan`, then `setup`/`verify`/`run` after reviewing commands. Each branch may commit its own `.ruseact/branch-env.json` profile and `docs/work-progress.md`. Avoid branch switching if local files are dirty, and never commit machine-specific environment files or secrets. Use `--worktree` if parallel development is needed.
