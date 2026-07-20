from __future__ import annotations

import json

import pytest

from backend_mirror.semantic_errors import classify_exception
from backend_mirror.source_adapters.hiring_qualification import vacancy_role_matches_technology


def test_classify_research_budget_exceeded() -> None:
    try:
        from cost_governor import ResearchBudgetExceeded
    except ImportError:
        from backend_mirror.cost_governor import ResearchBudgetExceeded
    code, _ = classify_exception(ResearchBudgetExceeded("hard budget"), failing_function="interpret")
    assert code == "SEMANTIC_BUDGET_EXCEEDED"


def test_classify_cost_governor_message() -> None:
    code, _ = classify_exception(
        RuntimeError("semantic interpretation requires an atomic cost governor"),
        failing_function="interpret",
    )
    assert code == "SEMANTIC_BUDGET_EXCEEDED"


def test_classify_semantic_timeout() -> None:
    code, detail = classify_exception(TimeoutError("timed out"), failing_function="interpret")
    assert code == "SEMANTIC_TIMEOUT"
    assert detail.failing_function == "interpret"


def test_classify_semantic_schema_invalid() -> None:
    code, _ = classify_exception(json.JSONDecodeError("bad", "{}", 0), failing_function="interpret")
    assert code == "SEMANTIC_SCHEMA_INVALID"


def test_technology_role_accepts_software_engineer() -> None:
    ok, code = vacancy_role_matches_technology(title="Software Engineer", description="Python backend services")
    assert ok, code


def test_technology_role_rejects_business_developer() -> None:
    ok, code = vacancy_role_matches_technology(title="Business Developer", description="new clients")
    assert not ok
    assert code == "HIRING_ROLE_MISMATCH"
