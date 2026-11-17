#!/usr/bin/env python3
"""Deterministic tests for README, risk, and trusted-check policy helpers."""
from __future__ import annotations

import unittest

from workflow_policy import (
    classify_paths,
    meaningful_readme_patch,
    meaningful_readme_update,
    promotion_recorded,
    required_approvals_satisfied,
    required_checks_passed,
    summarize_rulesets,
)


class WorkflowPolicyTests(unittest.TestCase):
    def test_high_risk_workflow_and_core_changes_require_review(self) -> None:
        risk, _ = classify_paths([".github/workflows/ci.yml", "crates/ruseact-core/src/lib.rs"])
        self.assertEqual(risk, "HIGH")

    def test_documentation_only_change_is_low_risk(self) -> None:
        risk, _ = classify_paths(["docs/architecture.md", "README.md"])
        self.assertEqual(risk, "LOW")

    def test_readme_gate_rejects_missing_and_whitespace_only_patches(self) -> None:
        self.assertFalse(meaningful_readme_patch(None))
        self.assertFalse(meaningful_readme_patch("@@ -1 +1 @@\n- old\n+   \n"))
        self.assertTrue(meaningful_readme_patch("@@ -1 +1 @@\n- old\n+ new workflow status\n"))
        self.assertTrue(
            meaningful_readme_update(
                "@@ -1 +1 @@\n- old\n+ documented development workflow status\n",
                ["README.md", "docs/development-workflow.md"],
            )
        )
        self.assertFalse(
            meaningful_readme_update(
                "@@ -1 +1 @@\n- old\n+ unrelated restaurant notes\n",
                ["README.md", "crates/ruseact-core/src/signal.rs"],
            )
        )

    def test_required_checks_must_be_successful_on_current_revision(self) -> None:
        required = ["Ruseact CI / Rust (ubuntu-latest)", "README documentation"]
        checks = [
            {
                "name": "Rust (ubuntu-latest)",
                "status": "completed",
                "conclusion": "success",
            },
            {
                "name": "README documentation",
                "workflow_name": "Ruseact CI",
                "status": "completed",
                "conclusion": "failure",
            },
        ]
        passed, reasons = required_checks_passed(required, checks)
        self.assertFalse(passed)
        self.assertIn("required check not successful: README documentation", reasons)

    def test_missing_required_checks_fail_closed(self) -> None:
        passed, reasons = required_checks_passed(["Ruseact CI / Rust (ubuntu-latest)"], [])
        self.assertFalse(passed)
        self.assertEqual(len(reasons), 1)

    def test_ruleset_without_required_checks_is_not_eligible(self) -> None:
        summary = summarize_rulesets(
            [
                {
                    "enforcement": "active",
                    "conditions": {"ref_name": {"include": ["refs/heads/develop"]}},
                    "rules": [
                        {
                            "type": "pull_request",
                            "parameters": {
                                "required_approving_review_count": 1,
                                "allowed_merge_methods": ["squash"],
                            },
                        }
                    ],
                }
            ],
            "develop",
            "main",
        )
        self.assertTrue(summary["has_pull_request_rule"])
        self.assertFalse(summary["has_required_status_checks"])

    def test_review_approval_is_based_on_latest_state(self) -> None:
        reviews = [
            {"user": {"login": "reviewer"}, "state": "APPROVED", "submitted_at": "2026-01-01"},
            {"user": {"login": "reviewer"}, "state": "CHANGES_REQUESTED", "submitted_at": "2026-01-02"},
        ]
        self.assertFalse(required_approvals_satisfied(1, reviews))

    def test_promotion_trailer_is_exact_and_idempotent(self) -> None:
        source = "0123456789abcdef"
        self.assertTrue(promotion_recorded([f"cherry picked from commit {source}"], source))
        self.assertFalse(promotion_recorded(["cherry picked from commit another"], source))


if __name__ == "__main__":
    unittest.main()
