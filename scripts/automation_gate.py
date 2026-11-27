#!/usr/bin/env python3
"""Fail-closed verifier for an explicitly reviewed main-targeted PR.

This module is a read-only policy helper. It never merges, pushes, changes
rulesets, or promotes commits. Automatic merge and promotion remain disabled.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from workflow_policy import (
    classify_paths,
    meaningful_readme_update,
    required_checks_passed,
    summarize_rulesets,
)


class GateError(RuntimeError):
    """A fail-closed API or repository-policy error."""


class GitHubApi:
    def __init__(self, token: str, repository: str) -> None:
        self.token = token
        self.repository = repository
        self.base_url = "https://api.github.com"

    def get(self, path: str, params: Optional[dict[str, str]] = None) -> Any:
        query = f"?{urlencode(params)}" if params else ""
        request = Request(
            f"{self.base_url}{path}{query}",
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {self.token}",
                "User-Agent": "ruseact-trusted-workflow",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        for attempt in range(3):
            try:
                with urlopen(request, timeout=30) as response:
                    return json.load(response)
            except HTTPError as error:
                if error.code < 500 and error.code != 429:
                    raise GateError(f"GitHub API request failed for {path}: {error}") from error
                if attempt == 2:
                    raise GateError(f"GitHub API request failed after retries for {path}: {error}") from error
            except (URLError, TimeoutError, json.JSONDecodeError) as error:
                if attempt == 2:
                    raise GateError(f"GitHub API request failed after retries for {path}: {error}") from error
            time.sleep(2**attempt)

    def paginated(self, path: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for page in range(1, 11):
            payload = self.get(path, {"per_page": "100", "page": str(page)})
            if not isinstance(payload, list):
                raise GateError(f"Expected a list from {path}")
            items.extend(payload)
            if len(payload) < 100:
                break
        return items


def applicable_rulesets(api: GitHubApi, branch: str, default_branch: str) -> list[dict[str, Any]]:
    del branch
    summaries = api.paginated(f"/repos/{api.repository}/rulesets")
    details = []
    for summary in summaries:
        ruleset_id = summary.get("id")
        if ruleset_id:
            details.append(api.get(f"/repos/{api.repository}/rulesets/{ruleset_id}"))
    return details


def readme_patch(files: list[dict[str, Any]]) -> Optional[str]:
    for file in files:
        if file.get("filename") == "README.md":
            patch = file.get("patch")
            return str(patch) if patch is not None else None
    return None


def changed_paths(files: list[dict[str, Any]]) -> list[str]:
    return sorted({str(file["filename"]) for file in files if file.get("filename")})


def check_runs_for(api: GitHubApi, sha: str) -> list[dict[str, Any]]:
    payload = api.get(f"/repos/{api.repository}/commits/{sha}/check-runs", {"per_page": "100"})
    if not isinstance(payload, dict) or not isinstance(payload.get("check_runs"), list):
        raise GateError(f"Unexpected check-runs response for {sha}")
    return payload["check_runs"]


def base_decision(risk: str, reasons: list[str], head_sha: str) -> dict[str, object]:
    return {
        "eligible": "false",
        "risk": risk,
        "reason": " | ".join(reasons),
        "head_sha": head_sha,
        "manual_approval_required": "true",
    }


def add(decision: dict[str, object], reasons: list[str], message: str) -> None:
    reasons.append(message)
    decision["reason"] = " | ".join(reasons)


def automatic_merge_blocked(decision: dict[str, object], reasons: list[str]) -> None:
    decision.update(base_decision("UNKNOWN", [], ""))
    add(decision, reasons, "automatic PR merging is disabled by manual-approval policy")
    decision["reason"] = " | ".join(reasons)


def evaluate_main_pr(
    api: GitHubApi,
    pr_number: int,
    decision: dict[str, object],
    reasons: list[str],
) -> None:
    """Evaluate a current implementation PR without authorizing its merge."""

    pr = api.get(f"/repos/{api.repository}/pulls/{pr_number}")
    files = api.paginated(f"/repos/{api.repository}/pulls/{pr_number}/files")
    repository = api.get(f"/repos/{api.repository}")
    default_branch = str(repository.get("default_branch") or "")
    paths = changed_paths(files)
    risk, risk_reasons = classify_paths(paths)
    head_sha = str(pr.get("head", {}).get("sha") or "")
    decision.update(base_decision(risk, risk_reasons, head_sha))

    if api.repository != "MaduroLabs/ruseact":
        add(decision, reasons, "repository identity is not MaduroLabs/ruseact")
    if default_branch != "main":
        add(decision, reasons, "repository default branch is not main")
    if pr.get("state") != "open" or pr.get("merged_at"):
        add(decision, reasons, "implementation PR is not open and unmerged")
    if pr.get("base", {}).get("ref") != "main":
        add(decision, reasons, "implementation PR target is not main")
    if pr.get("draft"):
        add(decision, reasons, "draft PRs are not eligible for publication")
    if not head_sha:
        add(decision, reasons, "PR head SHA is missing")
        return

    rulesets = applicable_rulesets(api, "main", default_branch)
    summary = summarize_rulesets(rulesets, "main", default_branch)
    decision["required_contexts"] = ",".join(summary["required_contexts"])
    decision["required_approvals"] = summary["required_approvals"]
    if not summary["has_required_status_checks"]:
        add(decision, reasons, "main has no enforced required status checks")
    if not summary["has_pull_request_rule"]:
        add(decision, reasons, "main has no enforced pull-request rule")
    if "squash" not in summary["allowed_merge_methods"]:
        add(decision, reasons, "main ruleset does not allow squash merge")
    if not meaningful_readme_update(readme_patch(files), paths):
        add(decision, reasons, "README.md is missing or has no meaningful added content")

    checks_ok, check_reasons = required_checks_passed(
        summary["required_contexts"],
        check_runs_for(api, head_sha),
    )
    if not checks_ok:
        for reason in check_reasons:
            add(decision, reasons, reason)

    decision["reason"] = " | ".join(reasons) if reasons else (
        "main-targeted PR passed trusted checks; manual approval is still required"
    )
    if not reasons:
        decision["eligible"] = "true"


def write_outputs(path: Optional[str], values: dict[str, object]) -> None:
    if not path:
        return
    output = Path(path)
    with output.open("a", encoding="utf-8") as handle:
        for key, value in values.items():
            text = str(value).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
            handle.write(f"{key}={text}\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("main-pr",), required=True)
    parser.add_argument("--pr-number", type=int, required=True)
    parser.add_argument("--output")
    args = parser.parse_args()

    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    repository = os.environ.get("GITHUB_REPOSITORY")
    if not token or not repository:
        print("main PR gate failed: GH_TOKEN and GITHUB_REPOSITORY are required", file=sys.stderr)
        return 1
    if repository != "MaduroLabs/ruseact":
        print("main PR gate failed: repository must be MaduroLabs/ruseact", file=sys.stderr)
        return 1

    api = GitHubApi(token, repository)
    decision: dict[str, object] = {"eligible": "false", "reason": "", "risk": "UNKNOWN"}
    reasons: list[str] = []
    try:
        evaluate_main_pr(api, args.pr_number, decision, reasons)
    except GateError as error:
        print(f"main PR gate failed closed: {error}", file=sys.stderr)
        return 1

    decision["pr_number"] = args.pr_number
    write_outputs(args.output, decision)
    print(json.dumps(decision, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
