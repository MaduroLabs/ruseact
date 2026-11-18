#!/usr/bin/env python3
"""Pure policy helpers shared by the manual Ruseact workflow checks.

The CI checks import this module after checking out repository policy. It
intentionally contains no GitHub or filesystem I/O; that keeps risk
classification and gate decisions straightforward to test. It does not grant
merge or promotion authority.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
import re
from typing import Optional, Set


HIGH_RISK_EXACT = {
    "AGENTS.md",
    "Cargo.toml",
    "Cargo.lock",
    "package.json",
    "pnpm-lock.yaml",
    "rust-toolchain.toml",
    ".nvmrc",
}

HIGH_RISK_PREFIXES = (
    ".agents/skills/",
    ".github/",
    "crates/ruseact-core/",
    "crates/ruseact-wasm/",
    "packages/",
    "scripts/automation_",
    "scripts/workflow_",
    "scripts/validate_readme_update.py",
    "scripts/classify_changed_files.py",
    "scripts/test_workflow_policy.py",
    "scripts/test_automation_gate.py",
)

HIGH_RISK_SUFFIXES = (
    ".env",
    ".env.example",
    ".pem",
    ".key",
)

README_PATH_STOPWORDS = {
    "agents",
    "docs",
    "github",
    "json",
    "lib",
    "md",
    "py",
    "rs",
    "scripts",
    "skills",
    "src",
    "test",
    "tests",
    "toml",
    "workflows",
    "yml",
    "yaml",
}


def normalize_path(path: str) -> str:
    """Normalize a GitHub path without resolving it on the host filesystem."""

    normalized = path.replace("\\", "/")
    return normalized[2:] if normalized.startswith("./") else normalized


def classify_paths(paths: Iterable[str]) -> tuple[str, list[str]]:
    """Return ``(risk, reasons)`` using a conservative path policy.

    The policy deliberately classifies framework core, ABI, package, skill,
    workflow, and repository-policy changes as high risk.  A human review can
    still approve those changes; the trusted automation never overrides this
    result with a label or PR-body claim.
    """

    reasons: list[str] = []
    for raw_path in paths:
        path = normalize_path(raw_path)
        if path in HIGH_RISK_EXACT:
            reasons.append(f"{path} is repository/toolchain policy")
            continue
        if any(path.startswith(prefix) for prefix in HIGH_RISK_PREFIXES):
            reasons.append(f"{path} matches a high-risk implementation area")
            continue
        if path.startswith(".github/") or path.endswith(HIGH_RISK_SUFFIXES):
            reasons.append(f"{path} may affect privileged configuration or secrets")

    if reasons:
        return "HIGH", sorted(set(reasons))
    return "LOW", ["no high-risk paths detected by the repository policy"]


def meaningful_readme_patch(patch: Optional[str]) -> bool:
    """Reject missing, empty, and whitespace-only README patches.

    Whether the changed content is relevant to the task remains a required
    self-review decision.  This mechanical gate ensures that self-review is
    not replaced by an empty or whitespace-only README touch.
    """

    if not patch:
        return False
    added = []
    for line in patch.splitlines():
        if line.startswith("+++"):
            continue
        if line.startswith("+"):
            content = line[1:]
            if content.strip():
                added.append(content)
    return bool(added) and any(re.search(r"[A-Za-z0-9]", line) for line in added)


def meaningful_readme_update(patch: Optional[str], changed_paths: Iterable[str]) -> bool:
    """Require meaningful README content connected to the task's changed paths."""

    if not meaningful_readme_patch(patch):
        return False
    paths = [normalize_path(path) for path in changed_paths if normalize_path(path) != "README.md"]
    if not paths:
        return True
    added_text = "\n".join(
        line[1:]
        for line in (patch or "").splitlines()
        if line.startswith("+") and not line.startswith("+++")
    ).lower()
    tokens: set[str] = set()
    for path in paths:
        for token in re.findall(r"[A-Za-z]+", path.lower()):
            if token not in README_PATH_STOPWORDS and len(token) >= 4:
                tokens.add(token)
    return any(re.search(rf"\b{re.escape(token)}\b", added_text) for token in tokens)


def _check_run_matches(context: str, check_run: Mapping[str, object]) -> bool:
    name = str(check_run.get("name") or "")
    workflow_name = str(check_run.get("workflow_name") or "")
    full_name = f"{workflow_name} / {name}" if workflow_name else name
    short_context = context.rsplit(" / ", 1)[-1]
    return context in {name, full_name} or name == short_context or full_name.endswith(f" / {context}")


def required_checks_passed(
    required_contexts: Iterable[str], check_runs: Iterable[Mapping[str, object]]
) -> tuple[bool, list[str]]:
    """Verify every trusted required check completed successfully on the SHA."""

    runs = list(check_runs)
    missing_or_failed: list[str] = []
    for context in sorted(set(required_contexts)):
        matches = [run for run in runs if _check_run_matches(context, run)]
        if not matches:
            missing_or_failed.append(f"missing required check: {context}")
            continue
        successful = any(
            run.get("status") == "completed" and run.get("conclusion") == "success"
            for run in matches
        )
        if not successful:
            missing_or_failed.append(f"required check not successful: {context}")
    return not missing_or_failed, missing_or_failed


def latest_review_states(reviews: Iterable[Mapping[str, object]]) -> dict[str, str]:
    """Return the latest non-pending review state for each reviewer."""

    latest: dict[str, tuple[str, str]] = {}
    for review in reviews:
        user = review.get("user") or {}
        login = str(user.get("login") or review.get("user_login") or "")
        state = str(review.get("state") or "").upper()
        submitted = str(review.get("submitted_at") or "")
        if not login or state == "PENDING":
            continue
        previous = latest.get(login)
        if previous is None or submitted >= previous[0]:
            latest[login] = (submitted, state)
    return {login: state for login, (_, state) in latest.items()}


def required_approvals_satisfied(
    required_count: int, reviews: Iterable[Mapping[str, object]]
) -> bool:
    states = latest_review_states(reviews)
    return sum(state == "APPROVED" for state in states.values()) >= required_count


def promotion_recorded(commit_messages: Iterable[str], source_sha: str) -> bool:
    """Detect the exact ``git cherry-pick -x`` source trailer."""

    marker = f"cherry picked from commit {source_sha}"
    return any(marker in message for message in commit_messages)


def summarize_rulesets(
    rulesets: Iterable[Mapping[str, object]], branch: str, default_branch: str
) -> dict[str, object]:
    """Combine active rulesets applicable to one branch into a gate summary."""

    required_contexts: list[str] = []
    required_approvals = 0
    allowed_methods: Optional[Set[str]] = None
    has_pull_request_rule = False
    requires_code_owner_review = False
    requires_thread_resolution = False
    requires_last_push_approval = False
    applicable = 0
    target_ref = f"refs/heads/{branch}"

    for ruleset in rulesets:
        if ruleset.get("enforcement") != "active":
            continue
        conditions = ruleset.get("conditions") or {}
        ref_name = conditions.get("ref_name") or {}
        includes = set(ref_name.get("include") or [])
        if target_ref not in includes and not (
            branch == default_branch and "~DEFAULT_BRANCH" in includes
        ):
            continue
        applicable += 1
        for rule in ruleset.get("rules") or []:
            rule_type = rule.get("type")
            parameters = rule.get("parameters") or {}
            if rule_type == "required_status_checks":
                for item in parameters.get("required_status_checks") or []:
                    context = item.get("context") if isinstance(item, Mapping) else item
                    if context:
                        required_contexts.append(str(context))
            elif rule_type == "pull_request":
                has_pull_request_rule = True
                required_approvals = max(
                    required_approvals,
                    int(parameters.get("required_approving_review_count") or 0),
                )
                requires_code_owner_review = requires_code_owner_review or bool(
                    parameters.get("require_code_owner_review")
                )
                requires_thread_resolution = requires_thread_resolution or bool(
                    parameters.get("required_review_thread_resolution")
                )
                requires_last_push_approval = requires_last_push_approval or bool(
                    parameters.get("require_last_push_approval")
                )
                methods = {str(method).lower() for method in parameters.get("allowed_merge_methods") or []}
                allowed_methods = methods if allowed_methods is None else allowed_methods & methods

    return {
        "applicable_rulesets": applicable,
        "required_contexts": sorted(set(required_contexts)),
        "required_approvals": required_approvals,
        "has_pull_request_rule": has_pull_request_rule,
        "requires_code_owner_review": requires_code_owner_review,
        "requires_thread_resolution": requires_thread_resolution,
        "requires_last_push_approval": requires_last_push_approval,
        "allowed_merge_methods": sorted(allowed_methods or set()),
        "has_required_status_checks": bool(required_contexts),
    }
