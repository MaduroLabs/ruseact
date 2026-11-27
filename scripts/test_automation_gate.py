#!/usr/bin/env python3
"""Mocked GitHub API tests for the main-only manual PR verifier."""
from __future__ import annotations

from copy import deepcopy
import unittest

from automation_gate import automatic_merge_blocked, evaluate_main_pr


REPOSITORY = "MaduroLabs/ruseact"
REPO_PATH = f"/repos/{REPOSITORY}"
HEAD_SHA = "1111111111111111111111111111111111111111"


class FakeApi:
    def __init__(self, data: dict[str, object], lists: dict[str, list[dict[str, object]]]) -> None:
        self.repository = REPOSITORY
        self.data = data
        self.lists = lists

    def get(self, path: str, params: object = None) -> object:
        del params
        return deepcopy(self.data[path])

    def paginated(self, path: str) -> list[dict[str, object]]:
        return deepcopy(self.lists[path])


def make_api(
    *,
    readme: bool = True,
    required_checks: bool = True,
    check_conclusion: str = "success",
    base: str = "main",
    draft: bool = False,
    main_rules: bool = True,
) -> FakeApi:
    files: list[dict[str, object]] = []
    if readme:
        files.append({"filename": "README.md", "patch": "@@ -1 +1 @@\n- old\n+ documented feature capability\n"})
    files.append({"filename": "docs/feature.md", "patch": "@@ -0,0 +1 @@\n+feature\n"})

    main_rules_list: list[dict[str, object]] = [
        {
            "type": "pull_request",
            "parameters": {"required_approving_review_count": 1, "allowed_merge_methods": ["squash"]},
        }
    ]
    if required_checks:
        main_rules_list.append(
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

    pr = {
        "number": 8,
        "state": "open",
        "merged_at": None,
        "base": {"ref": base},
        "head": {"sha": HEAD_SHA},
        "draft": draft,
    }
    checks = [
        {"name": "README documentation", "status": "completed", "conclusion": check_conclusion},
        {"name": "Rust (ubuntu-latest)", "status": "completed", "conclusion": "success"},
    ]
    data = {
        f"{REPO_PATH}/pulls/8": pr,
        f"{REPO_PATH}": {"default_branch": "main"},
        f"{REPO_PATH}/commits/{HEAD_SHA}/check-runs": {"check_runs": checks},
        f"{REPO_PATH}/rulesets/1": {
            "enforcement": "active",
            "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"]}},
            "rules": main_rules_list if main_rules else [],
        },
    }
    lists = {
        f"{REPO_PATH}/pulls/8/files": files,
        f"{REPO_PATH}/rulesets": [{"id": 1}],
    }
    return FakeApi(data, lists)


class AutomationGateTests(unittest.TestCase):
    def test_automatic_merge_is_always_blocked(self) -> None:
        decision: dict[str, object] = {}
        automatic_merge_blocked(decision, [])
        self.assertEqual(decision["eligible"], "false")
        self.assertIn("automatic PR merging is disabled", decision["reason"])

    def test_main_targeted_pr_is_eligible_for_manual_review(self) -> None:
        decision: dict[str, object] = {}
        evaluate_main_pr(make_api(), 8, decision, [])
        self.assertEqual(decision["eligible"], "true")
        self.assertEqual(decision["manual_approval_required"], "true")

    def test_non_main_target_is_rejected(self) -> None:
        decision: dict[str, object] = {}
        evaluate_main_pr(make_api(base="develop"), 8, decision, [])
        self.assertEqual(decision["eligible"], "false")

    def test_missing_required_checks_rejects_pr(self) -> None:
        decision: dict[str, object] = {}
        evaluate_main_pr(make_api(required_checks=False), 8, decision, [])
        self.assertEqual(decision["eligible"], "false")

    def test_failed_current_check_rejects_pr(self) -> None:
        decision: dict[str, object] = {}
        evaluate_main_pr(make_api(check_conclusion="failure"), 8, decision, [])
        self.assertEqual(decision["eligible"], "false")

    def test_unconfigured_main_ruleset_rejects_pr(self) -> None:
        decision: dict[str, object] = {}
        evaluate_main_pr(make_api(main_rules=False), 8, decision, [])
        self.assertEqual(decision["eligible"], "false")

    def test_draft_pr_rejects_publication(self) -> None:
        decision: dict[str, object] = {}
        evaluate_main_pr(make_api(draft=True), 8, decision, [])
        self.assertEqual(decision["eligible"], "false")


if __name__ == "__main__":
    unittest.main()
