# Two machines, two repositories

## Source of truth
GitHub is the source of truth for tracked code, skills, architecture notes, and committed lockfiles. Work on feature branches, push intentionally when authorized, and pull/fetch on the other machine before starting. Check `git status` before switching devices; local uncommitted files do not sync.

## Machine setup
1. Install git, rustup, a Node version manager (`.nvmrc` selects 24.22.3 LTS), and pnpm (follow the actual `packageManager` value after package.json is created).
2. `rust-toolchain.toml` pins Rust and the WASM target for both machines; verify `rustup show`.
3. Keep both **independent clones as siblings** named `ruseact/` and `ruseact-examples/`.
4. Run `python3 scripts/validate_skills.py` to verify agent skill structure.
5. Once package manifests exist, use frozen installs in CI (`pnpm install --frozen-lockfile`) and check in a lockfile. Use `cargo test --workspace` for Rust and add browser/WASM tests when supported.

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
