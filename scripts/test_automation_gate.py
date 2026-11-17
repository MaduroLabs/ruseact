#!/usr/bin/env python3
"""Mocked GitHub-event tests for the trusted automation gate."""
from __future__ import annotations

from copy import deepcopy
import unittest

from automation_gate import evaluate_auto_merge, evaluate_promotion


REPOSITORY = "MaduroLabs/ruseact"
REPO_PATH = f"/repos/{REPOSITORY}"
HEAD_SHA = "1111111111111111111111111111111111111111"
SOURCE_SHA = "2222222222222222222222222222222222222222"
MAIN_SHA = "3333333333333333333333333333333333333333"


class FakeApi:
    def __init__(self, data: dict[str, object], lists: dict[str, list[dict[str, object]]]) -> None:
        self.repository = REPOSITORY
        self.data = data
        self.lists = lists

    def get(self, path: str, params: object = None) -> object:
        return deepcopy(self.data[path])

    def paginated(self, path: str) -> list[dict[str, object]]:
        return deepcopy(self.lists[path])


def make_api(
    *,
    readme: bool = True,
    high_risk: bool = False,
    required_checks: bool = True,
    check_conclusion: str = "success",
    develop_sha: str = SOURCE_SHA,
    parent_count: int = 1,
    main_rules: bool = True,
    merged: bool = False,
) -> FakeApi:
    files = []
    if readme:
        files.append({"filename": "README.md", "patch": "@@ -1 +1 @@\n- old\n+ documented feature capability\n"})
    if high_risk:
        files.append({"filename": ".github/workflows/example.yml", "patch": "@@ -0,0 +1 @@\n+name: example\n"})
    else:
        files.append({"filename": "docs/feature.md", "patch": "@@ -0,0 +1 @@\n+feature\n"})

    develop_rules = [
        {
            "type": "pull_request",
            "parameters": {"required_approving_review_count": 1, "allowed_merge_methods": ["squash"]},
        }
    ]
    if required_checks:
        develop_rules.append(
            {
                "type": "required_status_checks",
                "parameters": {
                    "required_status_checks": [
                        {"context": "README documentation"},
                        {"context": "Rust (ubuntu-latest)"},
                    ]
                },
            }
        )
    main_rules = deepcopy(develop_rules) if main_rules else []
    ruleset_summaries = [{"id": 1}, {"id": 2}]
    ruleset_details = [
        {
            "enforcement": "active",
            "conditions": {"ref_name": {"include": ["refs/heads/develop"]}},
            "rules": develop_rules,
        },
        {
            "enforcement": "active",
            "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"]}},
            "rules": main_rules,
        },
    ]
    pr = {
        "number": 8,
        "state": "closed" if merged else "open",
        "merged_at": "2026-01-01T00:00:00Z" if merged else None,
        "merge_commit_sha": SOURCE_SHA if merged else None,
        "base": {"ref": "develop"},
        "head": {"sha": HEAD_SHA},
        "draft": False,
        "mergeable": True,
        "mergeable_state": "clean",
    }
    commit_files = [{"filename": file["filename"]} for file in files]
    commit = {"parents": [{} for _ in range(parent_count)], "files": commit_files}
    checks = [
        {"name": "README documentation", "status": "completed", "conclusion": check_conclusion},
        {"name": "Rust (ubuntu-latest)", "status": "completed", "conclusion": "success"},
    ]
    data = {
        f"{REPO_PATH}/pulls/8": pr,
        f"{REPO_PATH}": {"default_branch": "main", "allow_auto_merge": True, "allow_squash_merge": True},
        f"{REPO_PATH}/rulesets/1": ruleset_details[0],
        f"{REPO_PATH}/rulesets/2": ruleset_details[1],
        f"{REPO_PATH}/commits/{HEAD_SHA}/check-runs": {"check_runs": checks},
        f"{REPO_PATH}/commits/{SOURCE_SHA}": commit,
        f"{REPO_PATH}/branches/develop": {"commit": {"sha": develop_sha}},
        f"{REPO_PATH}/git/ref/heads/main": {"object": {"sha": MAIN_SHA}},
    }
    lists = {
        f"{REPO_PATH}/pulls/8/files": files,
        f"{REPO_PATH}/pulls/8/reviews": [
            {"user": {"login": "reviewer"}, "state": "APPROVED", "submitted_at": "2026-01-01"}
        ],
        f"{REPO_PATH}/rulesets": ruleset_summaries,
    }
    return FakeApi(data, lists)


class AutomationGateTests(unittest.TestCase):
    def evaluate_auto(self, api: FakeApi) -> dict[str, object]:
        decision: dict[str, object] = {}
        evaluate_auto_merge(api, 8, decision, [])
        return decision

    def test_low_risk_pr_with_current_gates_is_eligible(self) -> None:
        self.assertEqual(self.evaluate_auto(make_api())["eligible"], "true")

    def test_failed_ci_is_not_eligible(self) -> None:
        self.assertEqual(self.evaluate_auto(make_api(check_conclusion="failure"))["eligible"], "false")

    def test_missing_required_checks_is_not_eligible(self) -> None:
        self.assertEqual(self.evaluate_auto(make_api(required_checks=False))["eligible"], "false")

    def test_missing_readme_is_not_eligible(self) -> None:
        self.assertEqual(self.evaluate_auto(make_api(readme=False))["eligible"], "false")

    def test_high_risk_pr_is_not_eligible(self) -> None:
        decision = self.evaluate_auto(make_api(high_risk=True))
        self.assertEqual(decision["risk"], "HIGH")
        self.assertEqual(decision["eligible"], "false")

    def test_verified_squash_promotion_is_eligible_when_main_is_configured(self) -> None:
        api = make_api(merged=True)
        decision: dict[str, object] = {}
        evaluate_promotion(api, 8, SOURCE_SHA, decision, [])
        self.assertEqual(decision["eligible"], "true")

    def test_newer_develop_commit_blocks_promotion(self) -> None:
        api = make_api(merged=True, develop_sha="4444444444444444444444444444444444444444")
        decision: dict[str, object] = {}
        evaluate_promotion(api, 8, SOURCE_SHA, decision, [])
        self.assertEqual(decision["eligible"], "false")

    def test_non_squash_merge_blocks_promotion(self) -> None:
        api = make_api(merged=True, parent_count=2)
        decision: dict[str, object] = {}
        evaluate_promotion(api, 8, SOURCE_SHA, decision, [])
        self.assertEqual(decision["eligible"], "false")

    def test_unconfigured_main_blocks_promotion(self) -> None:
        api = make_api(merged=True, main_rules=False)
        decision: dict[str, object] = {}
        evaluate_promotion(api, 8, SOURCE_SHA, decision, [])
        self.assertEqual(decision["eligible"], "false")


if __name__ == "__main__":
    unittest.main()
