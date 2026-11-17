#!/usr/bin/env python3
"""Classify changed paths using the trusted repository risk policy."""
from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys

from workflow_policy import classify_paths


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-sha", required=True)
    parser.add_argument("--head-sha", required=True)
    parser.add_argument("--files", nargs="*")
    args = parser.parse_args()

    if args.files:
        paths = args.files
    else:
        try:
            result = subprocess.run(
                ["git", "diff", "--name-only", args.base_sha, args.head_sha],
                check=True,
                text=True,
                capture_output=True,
            )
        except (OSError, subprocess.CalledProcessError) as error:
            print(f"risk classification failed: unable to inspect Git diff: {error}", file=sys.stderr)
            return 1
        paths = [line for line in result.stdout.splitlines() if line]

    risk, reasons = classify_paths(paths)
    print(f"risk={risk}")
    for reason in reasons:
        print(f"reason={reason}")
    print("changed_paths=")
    for path in paths:
        print(f"  {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
