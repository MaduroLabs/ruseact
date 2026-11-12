#!/usr/bin/env python3
"""Validate local Codex SKILL.md structure using only the Python standard library."""
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1]
folder = root / '.agents' / 'skills'
files = sorted(folder.glob('*/SKILL.md'))
if not files:
    print('ERROR: no SKILL.md files found', file=sys.stderr)
    raise SystemExit(1)
errors = []
for f in files:
    content = f.read_text(encoding='utf-8')
    match = re.match(r'\A---\n(.*?)\n---\n', content, re.S)
    if not match:
        errors.append(f'{f}: missing YAML frontmatter')
        continue
    front = match.group(1)
    name = re.search(r'^name:\s*(\S+)\s*$', front, re.M)
    desc = re.search(r'^description:\s*(.+)$', front, re.M)
    if not name or not re.fullmatch(r'[a-z0-9-]{1,64}', name.group(1)):
        errors.append(f'{f}: invalid name')
    elif name.group(1) != f.parent.name:
        errors.append(f'{f}: name must match directory')
    if not desc or not desc.group(1).strip():
        errors.append(f'{f}: missing description')
    if not content[match.end():].strip():
        errors.append(f'{f}: empty skill body')
if errors:
    print('\n'.join(errors), file=sys.stderr)
    raise SystemExit(1)
print(f'OK: {len(files)} Codex skills validated')
