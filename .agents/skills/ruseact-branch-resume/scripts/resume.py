#!/usr/bin/env python3
"""Safe Git branch resume + explicit, branch-local environment plan/execution.

Python 3.9+, standard library only. Intended for trusted, reviewed repositories.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

SCRIPT = Path(__file__).resolve()
ROOT = Path.cwd().resolve()  # always operate on the repository opened in this shell
# This also supports running a stable global skill when another branch lacks the script.
MANIFEST = Path('.ruseact/branch-env.json')
PROGRESS = Path('docs/work-progress.md')


class ResumeError(Exception):
    pass


def call(argv, cwd=ROOT, check=True, capture=True):
    try:
        return subprocess.run(argv, cwd=str(cwd), text=True, capture_output=capture,
                              check=check)
    except FileNotFoundError as e:
        raise ResumeError(f'Missing executable: {argv[0]}') from e
    except subprocess.CalledProcessError as e:
        extra = ((e.stderr or '') + '\n' + (e.stdout or '')).strip()
        raise ResumeError(f'Command failed ({e.returncode}): {" ".join(argv)}\n{extra}') from e


def git(*args, cwd=ROOT, check=True):
    return call(['git', *args], cwd=cwd, check=check).stdout.strip()


def ensure_repo():
    if git('rev-parse', '--show-toplevel') != str(ROOT):
        raise ResumeError(f'Expected repo root at {ROOT}; open Codex in this repository.')


def dirty():
    return git('status', '--porcelain=v1', '--untracked-files=all')


def ref_exists(ref):
    return call(['git', 'show-ref', '--verify', '--quiet', ref], check=False).returncode == 0


def remote_exists(remote):
    return remote in git('remote').splitlines()


def current_branch(cwd=ROOT):
    return git('branch', '--show-current', cwd=cwd) or '(detached HEAD)'


def print_status(cwd=ROOT):
    print('REPO:', cwd)
    print('PLATFORM:', platform.system(), platform.machine())
    print('BRANCH:', current_branch(cwd))
    print('COMMIT:', git('rev-parse', '--short', 'HEAD', cwd=cwd))
    print('REMOTE(S):', git('remote', '-v', cwd=cwd) or '(none)')
    print('STATUS:\n' + (git('status', '--short', cwd=cwd) or '(clean)'))
    up = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}', cwd=cwd, check=False)
    if up:
        print('UPSTREAM:', up)
        ahead_behind = git('rev-list', '--left-right', '--count', f'HEAD...{up}', cwd=cwd, check=False)
        print('AHEAD/BEHIND:', ahead_behind or '(unavailable)')
    progress = cwd / PROGRESS
    print('PROGRESS:', progress if progress.is_file() else '(not recorded)')
    if progress.is_file():
        print('PROGRESS PREVIEW:\n' + '\n'.join(progress.read_text(encoding='utf-8').splitlines()[:55]))


def valid_branch_name(name):
    if not name or name.startswith('-') or name.startswith('/') or name.endswith('/'):
        raise ResumeError('Branch must be a non-empty explicit branch name.')
    if call(['git', 'check-ref-format', '--branch', name], check=False).returncode:
        raise ResumeError(f'Invalid branch name: {name}')


def update_checkout(cwd, branch, remote):
    remote_ref = f'refs/remotes/{remote}/{branch}'
    if not ref_exists(remote_ref):
        raise ResumeError(f'Remote branch {remote}/{branch} not found. Use `git branch -r` to inspect.')
    if git('status', '--porcelain=v1', '--untracked-files=all', cwd=cwd):
        raise ResumeError(f'Worktree {cwd} is dirty. Stop: commit changes or choose a new worktree.')
    if current_branch(cwd) != branch:
        if ref_exists(f'refs/heads/{branch}'):
            call(['git', 'switch', '--no-overwrite-ignore', branch], cwd=cwd)
        else:
            call(['git', 'switch', '--no-overwrite-ignore', '--track', '-c', branch, f'{remote}/{branch}'], cwd=cwd)
    localsha = git('rev-parse', 'HEAD', cwd=cwd)
    remote_sha = git('rev-parse', remote_ref, cwd=cwd)
    if localsha != remote_sha:
        local_is_ancestor = call(['git', 'merge-base', '--is-ancestor', 'HEAD', f'{remote}/{branch}'], cwd=cwd, check=False).returncode == 0
        remote_is_ancestor = call(['git', 'merge-base', '--is-ancestor', f'{remote}/{branch}', 'HEAD'], cwd=cwd, check=False).returncode == 0
        if local_is_ancestor:
            call(['git', 'merge', '--ff-only', f'{remote}/{branch}'], cwd=cwd)
        elif remote_is_ancestor:
            print(f'WARNING: Local {branch} is ahead of {remote}/{branch}; preserving unpublished commits. Push intentionally when ready.')
        else:
            ahead_behind = git('rev-list', '--left-right', '--count', f'HEAD...{remote}/{branch}', cwd=cwd)
            raise ResumeError(f'Local branch diverged from {remote}/{branch} ({ahead_behind}). No merge/rebase/reset performed.')
    print('READY:', branch, 'at', git('rev-parse', '--short', 'HEAD', cwd=cwd))


def switch_branch(args):
    valid_branch_name(args.branch)
    if not remote_exists(args.remote):
        raise ResumeError(f'Remote {args.remote!r} does not exist.')
    if not args.worktree and dirty():
        raise ResumeError('Working tree has local changes. Commit them first or use --worktree to create a separate checkout.\n' + dirty())
    print('FETCH:', args.remote)
    call(['git', 'fetch', '--prune', args.remote], capture=False)
    if args.worktree:
        worktree = Path(args.worktree).expanduser().resolve()
        if worktree.exists():
            raise ResumeError(f'Worktree path already exists: {worktree}. Refusing to overwrite.')
        if not ref_exists(f'refs/remotes/{args.remote}/{args.branch}'):
            raise ResumeError(f'{args.remote}/{args.branch} not found.')
        if ref_exists(f'refs/heads/{args.branch}'):
            call(['git', 'worktree', 'add', str(worktree), args.branch], capture=False)
        else:
            call(['git', 'worktree', 'add', '--track', '-b', args.branch, str(worktree),
                  f'{args.remote}/{args.branch}'], capture=False)
        update_checkout(worktree, args.branch, args.remote)
        print('NEXT: cd', worktree)
        print('NEXT: from worktree, run this script via a stable path if the target branch lacks it.')
    else:
        update_checkout(ROOT, args.branch, args.remote)
        print_status()
        print('ENV PLAN:')
        perform(argparse.Namespace(profile=None, action='plan', approve_commands=False))


def validate_command(item, key):
    if not isinstance(item, dict):
        raise ResumeError(f'{key}: command must be an object with argv list.')
    argv = item.get('argv')
    if not isinstance(argv, list) or not argv or not all(isinstance(t, str) and t for t in argv):
        raise ResumeError(f'{key}: argv must be non-empty list of strings.')
    cwd = item.get('cwd', '.')
    if not isinstance(cwd, str) or not cwd or Path(cwd).is_absolute():
        raise ResumeError(f'{key}: cwd must be relative to repo.')
    resolved = (ROOT / cwd).resolve()
    if resolved != ROOT and ROOT not in resolved.parents:
        raise ResumeError(f'{key}: cwd escapes repository.')
    if not resolved.exists():
        raise ResumeError(f'{key}: cwd does not exist: {cwd}')
    plat = item.get('platform', 'all')
    if plat not in ('all', 'linux', 'darwin'):
        raise ResumeError(f'{key}: invalid platform: {plat}')
    return argv, resolved, plat


def load_profiles():
    manifest_path = ROOT / MANIFEST
    if manifest_path.exists():
        try:
            data = json.loads(manifest_path.read_text(encoding='utf-8'))
        except (ValueError, OSError) as e:
            raise ResumeError(f'Invalid {MANIFEST}: {e}') from e
        if data.get('schemaVersion') != 1 or not isinstance(data.get('profiles'), dict):
            raise ResumeError(f'{MANIFEST}: requires schemaVersion=1 and object profiles')
        profiles = data['profiles']
        default = data.get('defaultProfile')
        if not default or default not in profiles:
            raise ResumeError(f'{MANIFEST}: defaultProfile must name a profile')
        for pname, profile in profiles.items():
            if not isinstance(profile, dict):
                raise ResumeError(f'profile {pname}: expected object')
            for action in ('setup', 'verify', 'run'):
                commands = profile.get(action, [])
                if not isinstance(commands, list):
                    raise ResumeError(f'{pname}/{action}: commands must be list')
                for i, cmd in enumerate(commands):
                    validate_command(cmd, f'{pname}/{action}[{i}]')
        return profiles, default, f'branch manifest: {MANIFEST}'
    return infer_profiles()


def infer_profiles():
    setup, verify, run = [], [], []
    if (ROOT / 'Cargo.toml').exists():
        setup.append({'argv':['cargo', 'fetch']})
        verify.append({'argv':['cargo', 'test', '--workspace']})
    pkg = ROOT / 'package.json'
    if pkg.exists():
        package = json.loads(pkg.read_text(encoding='utf-8'))
        if (ROOT / 'pnpm-lock.yaml').exists():
            setup.append({'argv':['corepack', 'pnpm', 'install', '--frozen-lockfile']})
        elif (ROOT / 'package-lock.json').exists():
            setup.append({'argv':['npm', 'ci']})
        elif (ROOT / 'yarn.lock').exists():
            setup.append({'argv':['corepack', 'yarn', 'install', '--immutable']})
        else:
            print('NOTICE: no JS lockfile yet; refusing to infer a reproducible dependency install.')
        scripts = package.get('scripts', {})
        if 'test' in scripts:
            verify.append({'argv':['npm', 'run', 'test']})
        elif 'build' in scripts:
            verify.append({'argv':['npm', 'run', 'build']})
        if 'dev' in scripts:
            run.append({'argv':['npm', 'run', 'dev']})
    return {'auto': {'description':'Inferred from checked-out manifest/lockfiles; review before executing',
                     'setup':setup, 'verify':verify, 'run':run}}, 'auto', 'conservative auto-detection'


def print_context():
    print('BRANCH:', current_branch())
    print('COMMIT:', git('rev-parse','--short','HEAD'))
    print('OS:', sys.platform)
    for path in ['.nvmrc', 'rust-toolchain.toml', 'Cargo.toml', 'package.json',
                 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'mise.toml',
                 'compose.yaml', 'docker-compose.yml', '.env.example', str(PROGRESS)]:
        if (ROOT / path).exists():
            print('FILE:', path)
    if (ROOT / '.nvmrc').is_file():
        print('NODE PIN:', (ROOT / '.nvmrc').read_text(encoding='utf-8').strip())
        installed = call(['node', '--version'], check=False).stdout.strip() if shutil.which('node') else '(missing)'
        print('NODE ACTIVE:', installed)
    if (ROOT / '.env.example').exists():
        print('NOTE: .env.example exists; do not copy or print secrets automatically.')


def perform(args):
    profiles, default, source = load_profiles()
    profile_name = args.profile or default
    if profile_name not in profiles:
        raise ResumeError(f'Unknown profile {profile_name!r}; available: {", ".join(profiles)}')
    actions = profiles[profile_name]
    print_context()
    print('ENV SOURCE:', source)
    print('PROFILE:', profile_name)
    print('DESCRIPTION:', actions.get('description', '(none)'))
    print('AVAILABLE PROFILES:', ', '.join(profiles))
    selected = ('setup', 'verify', 'run') if args.action == 'plan' else (args.action,)
    runnable = []
    for action in selected:
        commands = actions.get(action, [])
        print(f'{action.upper()} ({len(commands)}):')
        for i, item in enumerate(commands):
            argv, cwd, plat = validate_command(item, f'{profile_name}/{action}[{i}]')
            matches = plat == 'all' or plat == sys.platform
            print(' ', '(skip platform)' if not matches else '(eligible)', 'cwd='+str(cwd.relative_to(ROOT)),
                  'argv='+repr(argv))
            if matches:
                runnable.append((action, argv, cwd))
    if args.action == 'plan':
        print('PLAN ONLY: no commands executed. Review branch scripts before using --approve-commands.')
        return
    if not args.approve_commands:
        raise ResumeError('Execution requires --approve-commands after reviewing plan and scripts.')
    if not runnable:
        print('NO COMMANDS: this profile does not define', args.action)
        return
    pin_file = ROOT / '.nvmrc'
    is_node_step = any(argv[0] in ('node','npm','npx','pnpm','yarn','corepack','vite') for _, argv, _ in runnable)
    if pin_file.is_file() and is_node_step:
        pin = pin_file.read_text(encoding='utf-8').strip().lstrip('v')
        installed = call(['node', '--version'], check=False).stdout.strip().lstrip('v') if shutil.which('node') else '(missing)'
        if pin and installed != pin:
            raise ResumeError(f'Node mismatch: .nvmrc pins {pin}, active version is {installed}. Activate via `nvm use`, `fnm use`, or your version manager, then rerun.')
    for _, argv, cwd in runnable:
        print('EXEC:', ' '.join(argv), '(cwd:', cwd, ')', flush=True)
        if not shutil.which(argv[0]):
            raise ResumeError(f'Missing executable {argv[0]!r}. Install/pin the right toolchain for this branch.')
        proc = subprocess.run(argv, cwd=str(cwd))
        if proc.returncode:
            raise ResumeError(f'Command exited {proc.returncode}: {argv!r}. Not proceeding.')
    print('DONE:', args.action)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='action', required=True)
    sub.add_parser('status', help='Read branch, local status, upstream, progress (no mutations).')
    sw = sub.add_parser('switch', help='Fetch and switch to remote branch safely, fast-forward only.')
    sw.add_argument('branch')
    sw.add_argument('--remote', default='origin')
    sw.add_argument('--worktree', help='Optional NEW worktree path (must not exist).')
    for action in ('plan','setup','verify','run'):
        ap = sub.add_parser(action)
        ap.add_argument('--profile')
        if action != 'plan':
            ap.add_argument('--approve-commands', action='store_true')
    args = p.parse_args()
    try:
        ensure_repo()
        if args.action == 'status':
            print_status()
        elif args.action == 'switch':
            switch_branch(args)
        else:
            perform(args)
    except ResumeError as e:
        print('ERROR:', e, file=sys.stderr)
        return 2
    return 0

if __name__ == '__main__':
    sys.exit(main())
