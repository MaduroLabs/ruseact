---
name: ruseact-branch-resume
description: Resume work safely on another Ubuntu/macOS machine or switch Git branches in Ruseact or ruseact-examples; fetch remote changes, checkout without losing local work, detect branch-specific toolchains and dev profiles, restore documented progress, and run the right setup, checks, or dev environment.
---
# Resume a Ruseact branch across machines

Use when the user says they want to "continue", "sync", "fetch", "checkout", "switch machines", "restore current work", or "run this branch's environment". This skill is **not** a GitHub background sync service; the user must have pushed commits from the first machine.

## Contract
1. Work **inside the repository requested by the user**. The library and examples repos are separate; never change both implicitly.
2. First report the repository, current branch, `git status --short`, and configured remote. Never silently lose uncommitted, untracked, ignored, or unpublished work. A safe first inspection is `python3 .agents/skills/ruseact-branch-resume/scripts/resume.py status`.
3. If the target branch is unclear, list available remote/local branches and use the branch the user actually selected; do not guess that `main` is current work.
4. Fetch from the configured remote and switch **without force**. Only fast-forward a clean branch. If behind/diverged/uncommitted/checked out in another worktree, stop and report exact state. Never automatically `reset --hard`, `clean -fd`, `stash`, force-push, or delete any branch/worktree. Use `git switch` or a new worktree; preserve local commits.
5. After checkout, **read the configuration of that checked-out branch**, not a stale configuration from the previous branch. Run `.../resume.py plan [--profile NAME]` and inspect `.ruseact/branch-env.json`, lockfiles, `.nvmrc`, `rust-toolchain.toml`, `package.json`, `Cargo.toml`, `compose.yaml` and `.env.example` where present. Every branch may differ. Validate the selected OS and installed dependencies.
6. Read `docs/work-progress.md` on that branch if present, `AGENTS.md`, README, open TODOs, recent commits, and relevant issue/PR references. Summarize completed work, outstanding tasks, current commit, tests and the concrete next step. Do not fabricate a progress log when absent.
7. Review any commands or scripts newly introduced by the branch **before executing**. A Git branch can contain executable scripts. Never expose environment secrets or run unknown remote code blindly.
8. Only after review, run `.../resume.py setup --approve-commands` and optionally `.../resume.py verify --approve-commands`, `.../resume.py run --approve-commands` with the appropriate `--profile`. If `.nvmrc` differs from the current `node --version`, activate that version in the shell first (`nvm use`/`fnm use`). Rustup selects the Rust toolchain using `rust-toolchain.toml` automatically when invoked from the repo. The `run` operation starts a foreground dev process; explain when no run profile exists. Inform the user which command actually ran, its process status, and any failures.
9. When completing a coding task, help update `docs/work-progress.md` **in the current branch** with done/next/commands/blockers and the companion repo package version or pinned commit, if applicable. Commit/push only with authorization. Never treat progress file as a substitute for Git commits.

## Commands
```bash
# From the repo root; works on Ubuntu and macOS with Python 3.9+ and Git:
python3 .agents/skills/ruseact-branch-resume/scripts/resume.py status
python3 .agents/skills/ruseact-branch-resume/scripts/resume.py switch feature/reactive-graph
python3 .agents/skills/ruseact-branch-resume/scripts/resume.py plan
python3 .agents/skills/ruseact-branch-resume/scripts/resume.py setup --approve-commands
python3 .agents/skills/ruseact-branch-resume/scripts/resume.py verify --approve-commands
python3 .agents/skills/ruseact-branch-resume/scripts/resume.py run --approve-commands
```

For multiple active branches, consider `switch feature/branch --worktree ../ruseact-feature-branch`. This creates a new working tree and leaves the original checkout untouched (unless Git reports the branch already in another worktree).

## Optional branch-specific environment manifest

Each Git branch may commit its own `.ruseact/branch-env.json`. Use the schema and sample in `references/branch-env-example.json`. A profile names `setup`, `verify`, and `run` argv commands, optional relative `cwd` and `platform` (`linux`, `darwin`, or `all`). This avoids hardcoded machine paths and stores build/run configuration **with the branch**. All commands are **displayed** by `plan`; execution requires the explicit `--approve-commands` flag. Never use shell strings or OS-specific absolute paths.

If the target branch predates this skill and lacks the helper, run a stable copy of `resume.py` from `~/.agents/skills/ruseact-branch-resume/scripts/resume.py` or a separate tooling worktree **while your current directory is the target repo root**. The helper resolves the repo from the shell current directory, not its own file location. If the manifest is absent, the helper provides conservative conventional commands inferred from files. Prefer adding a reviewed manifest when a branch needs Docker, a special WASM toolchain, a particular frontend example, or multiple services. Do not put credentials into the manifest; provide `.env.example` and load local secrets out-of-band.

## Failure behavior
- Dirty worktree: stop; describe what is modified and ask user to commit or explicitly choose a separate worktree. Do not auto-stash.
- Divergent history: show ahead/behind counts; no rebase/merge without instruction.
- Branch absent on remote: do not create it silently; report available refs.
- Missing toolchain: report exact missing executable/version and how to install it.
- Setup/build failure: preserve logs/exit code, stop before launching server; report what's blocking.
- Branch script introduces suspicious commands: stop and request explicit review/approval.
