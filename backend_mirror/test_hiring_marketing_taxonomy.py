from __future__ import annotations

import os
from datetime import date
from typing import Any

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
os.environ.setdefault("MIRAX_WORKER_DISABLED", "1")

from source_adapters.contracts import AdapterDiscoveryRequest
from source_adapters.hiring import _register_unique_employer_record, _validate_record
from source_adapters.hiring_qualification import (
    collect_processed_employer_keys,
    resolve_employer_identity,
    vacancy_role_matches_marketing,
)
from source_adapters.shadow_runtime import build_shadow_resume_state, merge_shadow_qualified_payloads
from worker_supabase import (
    _canonicalize_marketing_investment_job,
    _looks_like_buyer_marketing_investment_query,
)

def _marketing_request(**overrides: Any) -> AdapterDiscoveryRequest:
    base = {
        "intent": "hiring",
        "signal_ids": ("hiring_marketing",),
        "signal_match_mode": "any",
        "geographies": ("Italia",),
        "freshness_max_age_days": 60,
        "requested_count": 5,
        "budget_eur": 0.125,
        "query": "marketing manager Italia",
        "technical_filters": {},
    }
    base.update(overrides)
    return AdapterDiscoveryRequest(**base)


def _base_record(**overrides: Any) -> dict[str, Any]:
    row = {
        "vacancy_title": "Marketing Manager",
        "location": "Milano, Italia",
        "address_locality": "Milano",
        "address_region": "Lombardia",
        "published_at": "2026-07-01",
        "active": True,
        "active_evidence": "greenhouse_job_api_current",
        "active_verification_method": "greenhouse_individual_job_api",
        "description": "Ruolo operativo nel team.",
        "company_name": "Acme SpA",
        "employer_official_domain": "acme.it",
        "official_domain_verified": True,
        "vacancy_source_domain": "boards.greenhouse.io",
        "source_url": "https://boards.greenhouse.io/acme/jobs/1",
        "source_class": "job_board",
        "corroborated": True,
        "employer_is_direct": True,
        "entity_class": "operating_company",
    }
    row.update(overrides)
    return row


def test_marketing_titles_pass() -> None:
    for title in (
        "Marketing Manager",
        "Growth Marketing Manager",
        "Performance Marketing Specialist",
        "Social Media Manager",
        "Head of Marketing",
        "Digital Marketing Specialist",
        "Brand Manager",
        "Product Marketing Manager",
    ):
        ok, code = vacancy_role_matches_marketing(title=title)
        assert ok is True, (title, code)


def test_sales_manager_fails_marketing_gate() -> None:
    ok, code = vacancy_role_matches_marketing(title="Sales Manager")
    assert ok is False
    assert code == "HIRING_ROLE_MISMATCH"


def test_description_marketing_word_without_marketing_title_fails() -> None:
    ok, code = vacancy_role_matches_marketing(
        title="Project Coordinator",
        description="Support the marketing team with campaigns and social media.",
    )
    assert ok is False
    assert code == "HIRING_ROLE_MISMATCH"


def test_validate_record_rejects_description_only_marketing() -> None:
    row = _base_record(
        vacancy_title="Operations Coordinator",
        description="Collaborate with marketing on growth campaigns.",
    )
    assert _validate_record(row, _marketing_request(), date(2026, 7, 15)) == (False, "HIRING_ROLE_MISMATCH")


def test_validate_record_accepts_marketing_manager() -> None:
    row = _base_record(vacancy_title="Marketing Manager - Italia")
    assert _validate_record(row, _marketing_request(), date(2026, 7, 15)) == (True, "")


def test_ats_domain_differs_from_employer_official_domain() -> None:
    row = _base_record()
    assert row["vacancy_source_domain"] != row["employer_official_domain"]
    assert _validate_record(row, _marketing_request(), date(2026, 7, 15)) == (True, "")


def test_anonymous_recruiter_fails_direct_employer() -> None:
    row = _base_record(employer_is_direct=False, company_name="Acme SpA")
    assert _validate_record(row, _marketing_request(), date(2026, 7, 15)) == (False, "DIRECT_EMPLOYER_UNVERIFIED")


def test_duplicate_employer_does_not_increment_count() -> None:
    processed = {"domain:acme.it"}
    new_unique: set[str] = set()
    record = resolve_employer_identity({
        "company_name": "Acme SpA",
        "employer_official_domain": "acme.it",
        "vacancy_title": "Social Media Manager",
        "location": "Roma",
        "source_url": "https://careers.acme.it/roma",
    })
    ok, reason = _register_unique_employer_record(
        record,
        processed_employer_keys=processed,
        new_unique_employer_keys=new_unique,
    )
    assert ok is False
    assert reason == "DUPLICATE_EMPLOYER_OPPORTUNITY"
    assert not new_unique


def test_requested_count_five_means_five_unique_employers() -> None:
    payloads = [
        {"sito": f"https://co{i}.it", "employer_official_domain": f"co{i}.it", "azienda": f"Co{i}"}
        for i in range(1, 6)
    ]
    merged = merge_shadow_qualified_payloads([], payloads)
    keys = collect_processed_employer_keys((), merged)
    assert len(keys) == 5
    resume = build_shadow_resume_state(
        type("R", (), {"status": "completed_requested_count", "adapter_progress": (), "cost_eur": 0.0})(),
        qualified_lead_payloads=merged,
        requested_count=5,
    )
    assert resume["unique_lifecycle_accepted_count"] == 5
    assert resume["resumable"] is False


def test_hiring_marketing_query_is_not_rewritten_to_investing_marketing() -> None:
    query = (
        "Trovami aziende in Italia che stanno assumendo marketing manager, "
        "digital marketing specialist, growth manager, performance marketing specialist "
        "o social media manager."
    )
    assert _looks_like_buyer_marketing_investment_query(query) is False
    _, _, intent, changed = _canonicalize_marketing_investment_job(
        "Live shadow Source Adapter v5: hiring-marketing",
        "Italia",
        {
            "query": query,
            "required_signals": ["hiring_marketing"],
            "signals": [{"type": "hiring_marketing", "params": {}}],
        },
        {},
    )
    assert changed is False
    assert intent["required_signals"] == ["hiring_marketing"]
