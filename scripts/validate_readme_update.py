#!/usr/bin/env python3
"""Require a meaningful root README change between two Git revisions."""
from __future__ import annotations

import argparse
import subprocess
import sys

from workflow_policy import meaningful_readme_update


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-sha", required=True)
    parser.add_argument("--head-sha", required=True)
    args = parser.parse_args()

    if args.base_sha == args.head_sha:
        print("README gate failed: base and head revisions are identical", file=sys.stderr)
        return 1

    try:
        patch = subprocess.run(
            ["git", "diff", "--no-ext-diff", "--unified=3", args.base_sha, args.head_sha, "--", "README.md"],
            check=True,
            text=True,
            capture_output=True,
        ).stdout
        changed = subprocess.run(
            ["git", "diff", "--name-only", args.base_sha, args.head_sha],
            check=True,
            text=True,
            capture_output=True,
        ).stdout.splitlines()
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"README gate failed: unable to inspect Git diff: {error}", file=sys.stderr)
        return 1

    if not meaningful_readme_update(patch, changed):
        print(
            "README gate failed: README.md must contain meaningful added content "
            "connected to the task's changed paths",
            file=sys.stderr,
        )
        return 1

    print("README gate passed: README.md contains meaningful added content")
    return 0


if __name__ == "__main__":
    sys.exit(main())
