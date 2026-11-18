#!/usr/bin/env python3
"""Fail-closed verifier for explicitly authorized manual promotion.

Automatic merge and promotion workflows were intentionally removed. This
module remains useful to a manually invoked recovery command and tests the
same GitHub metadata, README, review, check, SHA, and ruleset invariants. It
never checks out or executes pull-request head code and never mutates GitHub.
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
    required_approvals_satisfied,
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
    summaries = api.paginated(f"/repos/{api.repository}/rulesets")
    details = []
    for summary in summaries:
        ruleset_id = summary.get("id")
        if not ruleset_id:
            continue
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


def reviews_for(api: GitHubApi, pr_number: int) -> list[dict[str, Any]]:
    return api.paginated(f"/repos/{api.repository}/pulls/{pr_number}/reviews")


def write_outputs(path: Optional[str], values: dict[str, object]) -> None:
    if not path:
        return
    output = Path(path)
    with output.open("a", encoding="utf-8") as handle:
        for key, value in values.items():
            text = str(value).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
            handle.write(f"{key}={text}\n")


def base_decision(risk: str, reasons: list[str], head_sha: str) -> dict[str, object]:
    return {
        "eligible": "false",
        "risk": risk,
        "reason": " | ".join(reasons),
        "head_sha": head_sha,
        "source_sha": "",
        "main_sha": "",
    }


def add(decision: dict[str, object], reasons: list[str], message: str) -> None:
    reasons.append(message)
    decision["reason"] = " | ".join(reasons)


def verify_status_and_reviews(
    api: GitHubApi,
    pr: dict[str, Any],
    files: list[dict[str, Any]],
    rulesets: list[dict[str, Any]],
    default_branch: str,
    decision: dict[str, object],
    reasons: list[str],
) -> None:
    branch = str(pr.get("base", {}).get("ref") or "")
    summary = summarize_rulesets(rulesets, branch, default_branch)
    decision["required_contexts"] = ",".join(summary["required_contexts"])
    if not summary["has_required_status_checks"]:
        add(decision, reasons, f"{branch} has no enforced required status checks")
    if not summary["has_pull_request_rule"]:
        add(decision, reasons, f"{branch} has no enforced pull-request rule")
    if "squash" not in summary["allowed_merge_methods"]:
        add(decision, reasons, f"{branch} rulesets do not allow squash merge")
    if summary["requires_code_owner_review"]:
        add(decision, reasons, "code-owner review policy requires explicit repository review")
    if summary["requires_thread_resolution"]:
        add(decision, reasons, "review-thread resolution cannot be verified by this gate")
    if summary["requires_last_push_approval"]:
        add(decision, reasons, "last-push approval policy cannot be verified by this gate")

    readme = readme_patch(files)
    paths = changed_paths(files)
    if not meaningful_readme_update(readme, paths):
        add(decision, reasons, "README.md is missing or has no meaningful added content")

    head_sha = str(pr.get("head", {}).get("sha") or "")
    if not head_sha:
        add(decision, reasons, "PR head SHA is missing")
        return
    checks = check_runs_for(api, head_sha)
    checks_ok, check_reasons = required_checks_passed(summary["required_contexts"], checks)
    if not checks_ok:
        for reason in check_reasons:
            add(decision, reasons, reason)

    reviews = reviews_for(api, int(pr["number"]))
    if not required_approvals_satisfied(int(summary["required_approvals"]), reviews):
        add(decision, reasons, "required pull-request approvals are not satisfied")


def automatic_merge_blocked(decision: dict[str, object], reasons: list[str]) -> None:
    decision.update(base_decision("UNKNOWN", [], ""))
    add(decision, reasons, "automatic PR merging is disabled by manual-approval policy")
    decision["reason"] = " | ".join(reasons)


def evaluate_promotion(
    api: GitHubApi,
    pr_number: int,
    expected_merge_sha: Optional[str],
    decision: dict[str, object],
    reasons: list[str],
    *,
    confirmed: bool = False,
) -> None:
    if not confirmed:
        decision.update(base_decision("UNKNOWN", [], ""))
        add(decision, reasons, "explicit completion confirmation is required")
        decision["reason"] = " | ".join(reasons)
        return

    pr = api.get(f"/repos/{api.repository}/pulls/{pr_number}")
    files = api.paginated(f"/repos/{api.repository}/pulls/{pr_number}/files")
    repository = api.get(f"/repos/{api.repository}")
    default_branch = str(repository.get("default_branch") or "main")
    rulesets = applicable_rulesets(api, "develop", default_branch)
    paths = changed_paths(files)
    risk, risk_reasons = classify_paths(paths)
    head_sha = str(pr.get("head", {}).get("sha") or "")
    decision.update(base_decision(risk, risk_reasons, head_sha))
    decision["risk"] = risk
    decision["reason"] = " | ".join(risk_reasons)

    merge_sha = str(expected_merge_sha or pr.get("merge_commit_sha") or "")
    decision["source_sha"] = merge_sha
    if pr.get("state") != "closed" or not pr.get("merged_at"):
        add(decision, reasons, "PR is not verified as merged")
    if pr.get("base", {}).get("ref") != "develop":
        add(decision, reasons, "merged PR target is not develop")
    if not merge_sha:
        add(decision, reasons, "merged PR has no merge commit SHA")
        return
    if expected_merge_sha and str(pr.get("merge_commit_sha") or "") != expected_merge_sha:
        add(decision, reasons, "trusted event SHA does not match GitHub merge_commit_sha")

    develop = api.get(f"/repos/{api.repository}/branches/develop")
    develop_tip = str(develop.get("commit", {}).get("sha") or "")
    if develop_tip != merge_sha:
        add(decision, reasons, "develop advanced beyond the verified squash commit")

    commit = api.get(f"/repos/{api.repository}/commits/{merge_sha}")
    parents = commit.get("parents") or []
    if len(parents) != 1:
        add(decision, reasons, "merge result is not a single-parent squash commit")
    commit_paths = sorted({str(item.get("filename")) for item in commit.get("files") or []})
    if commit_paths and commit_paths != paths:
        add(decision, reasons, "squash commit paths do not match the merged PR paths")
    if risk != "LOW":
        add(decision, reasons, "high-risk changes require explicit human approval")

    verify_status_and_reviews(
        api,
        pr,
        files,
        rulesets,
        default_branch,
        decision,
        reasons,
    )

    main_rulesets = applicable_rulesets(api, "main", default_branch)
    main_summary = summarize_rulesets(main_rulesets, "main", default_branch)
    if not repository.get("allow_squash_merge"):
        add(decision, reasons, "repository squash merge is disabled for the promotion PR")
    if not main_summary["has_pull_request_rule"]:
        add(decision, reasons, "main has no enforced pull-request promotion rule")
    if not main_summary["has_required_status_checks"]:
        add(decision, reasons, "main has no enforced required status checks")
    if "squash" not in main_summary["allowed_merge_methods"]:
        add(decision, reasons, "main rulesets do not allow squash promotion")
    main_ref = api.get(f"/repos/{api.repository}/git/ref/heads/main")
    decision["main_sha"] = str(main_ref.get("object", {}).get("sha") or "")
    decision["reason"] = " | ".join(reasons) if reasons else "all trusted promotion gates passed"
    if not reasons:
        decision["eligible"] = "true"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("promote",), required=True)
    parser.add_argument("--pr-number", type=int, required=True)
    parser.add_argument("--expected-merge-sha")
    parser.add_argument(
        "--confirm-completion",
        choices=("CONFIRM",),
        help="required explicit user confirmation that the merged task is complete",
    )
    parser.add_argument("--output")
    args = parser.parse_args()

    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    repository = os.environ.get("GITHUB_REPOSITORY")
    if not token or not repository:
        print("automation gate failed: GH_TOKEN and GITHUB_REPOSITORY are required", file=sys.stderr)
        return 1

    api = GitHubApi(token, repository)
    decision: dict[str, object] = {"eligible": "false", "reason": "", "risk": "UNKNOWN"}
    reasons: list[str] = []
    try:
        evaluate_promotion(
            api,
            args.pr_number,
            args.expected_merge_sha,
            decision,
            reasons,
            confirmed=args.confirm_completion == "CONFIRM",
        )
    except GateError as error:
        print(f"automation gate failed closed: {error}", file=sys.stderr)
        return 1

    decision["pr_number"] = args.pr_number
    write_outputs(args.output, decision)
    print(json.dumps(decision, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
