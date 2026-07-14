"""Provider-free forensic replay for hiring canary 72578395.

The fixture is a frozen database snapshot.  Tests may not browse, resolve DNS
or call an LLM/search provider.
"""
from __future__ import annotations

import json
import os
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
os.environ.setdefault("MIRAX_WORKER_DISABLED", "1")

from agents.agentic_gap_fill import prepare_agentic_extracted_item, rank_pages_for_extraction
from agents.data_extractor import page_has_required_signal
from agents.hiring_evidence import has_concrete_operational_hiring_evidence
from commercial_lifecycle import evaluate_publication_gate


FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "evaluation"
    / "fixtures"
    / "hiring-canary-72578395-forensic-v5.json"
)


def _load():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _plan(trace):
    return {
        "schema_version": "1.0.0",
        "raw_query": trace["query"],
        "seller": {
            "offer_category": "consulente sicurezza sul lavoro",
            "offer_description": "consulenza sicurezza per personale operativo",
            "products_or_services": ["consulenza sicurezza sul lavoro"],
            "problems_solved": ["operational_risk", "safety"],
            "preferred_buyer_roles": ["responsabile HR", "responsabile operations"],
        },
        "target": {
            "entity_types": ["company"],
            "company_sizes": ["micro", "small", "medium"],
            "geographies": ["Italia"],
            "local_business_preference": True,
        },
        "signal_policy": {
            "required_signals": [trace["required_signal"]],
            "maximum_age_days_by_signal": {trace["required_signal"]: trace["maximum_age_days"]},
        },
        "source_policy": {
            "allowed_source_classes": ["company_careers", "job_board"],
            "minimum_independent_sources": 1,
            "primary_source_required_for": [],
        },
        "evidence_policy": {"minimum_evidence_confidence": 0.75},
        "commercial_hypotheses": [{
            "signals": [trace["required_signal"]],
            "buyer_problem": "L'inserimento di personale operativo aumenta il rischio operativo.",
            "implied_need": "Serve aggiornare formazione e procedure di sicurezza.",
            "relevance_to_offer": "La vacancy operativa rende attuale la consulenza sicurezza.",
            "triggering_events": ["operational_job_posting"],
        }],
    }


def _extracted(candidate):
    payload = candidate["payload"]
    return {
        "name": candidate["entity_name"],
        "website": payload["website"],
        "source_url": candidate["source_url"],
        "evidence": candidate["vacancy_excerpt"],
        "evidence_date": payload["evidence_date"],
        "matched_signals": payload["matched_signals"],
        "hiring_title": candidate["page_title"],
        "_required_signals": ["hiring_operational"],
        "_signal_match_mode": "all",
        "_ranking_policy": {"max_signal_age_days": 60},
    }


def _identity(candidate):
    return deepcopy(candidate["payload"]["domain_verification"])


def test_forensic_fixture_has_complete_boundary_snapshot():
    trace = _load()
    assert trace["source_search_id"] == "72578395-853d-4675-beae-ffeae0f6ba9c"
    assert len(trace["candidates"]) == 4
    assert {row["expected_human_verdict"] for row in trace["candidates"]} == {
        "SHOULD_REJECT", "INSUFFICIENT_DATA"
    }
    for row in trace["candidates"]:
        assert row["canonical_domain"]
        assert row["source_url"].startswith("https://")
        assert row["source_publisher"]
        assert row["source_class"] == "company_careers"
        assert row["candidate_row"]["official_domain_verified"] is True
        assert row["payload"]["domain_verification"]["status"] == "verified"
        assert row["payload"]["technical_report"]["domain_verification"]["status"] == "verified"
        assert row["payload"]["audit"] == {"missing_instagram": False}
        assert row["persisted_evidence"]["verification_status"] == "primary_source_verified"


def test_operational_source_gate_positive_and_three_real_negatives():
    trace = _load()
    actual = {
        row["entity_name"]: has_concrete_operational_hiring_evidence(row["vacancy_excerpt"])
        for row in trace["candidates"]
    }
    assert actual == {"Brt": False, "Fmach": True, "Hoval": False, "Woehler": False}
    assert all(actual[row["entity_name"]] is row["expected_source_gate"] for row in trace["candidates"])


def test_jobs_or_careers_url_cannot_self_validate_generic_page():
    generic = "Chi siamo Contatti Lavora con noi Prodotti e servizi"
    assert has_concrete_operational_hiring_evidence(generic) is False
    explicit = "Selezioni aperte: ricerchiamo operai agricoli stagionali. Invia la candidatura."
    assert has_concrete_operational_hiring_evidence(explicit) is True
    assert has_concrete_operational_hiring_evidence(
        "We are hiring warehouse operators. Apply now."
    ) is True


def test_zero_cost_page_prefilter_rejects_noise_before_extraction():
    trace = _load()
    plan = {"required_signals": ["hiring_operational"]}
    outcomes = {
        row["entity_name"]: page_has_required_signal(row["vacancy_excerpt"], plan)
        for row in trace["candidates"]
    }
    assert outcomes == {
        "Brt": False,
        "Fmach": True,
        "Hoval": False,
        "Woehler": False,
    }


def test_acquired_page_ranking_puts_concrete_fresh_evidence_first():
    trace = _load()
    pages = [
        {"url": row["source_url"], "raw_text": row["vacancy_excerpt"]}
        for row in trace["candidates"]
    ]
    ranked = rank_pages_for_extraction(pages, {"required_signals": ["hiring_operational"]})
    assert ranked[0]["url"] == "https://fmach.it/Lavora-con-noi"
    assert all(
        not page_has_required_signal(page["raw_text"], {"required_signals": ["hiring_operational"]})
        for page in ranked[1:]
    )


def test_forensic_boundary_mismatches_are_explicit_and_fail_closed():
    trace = _load()
    assert len(trace["boundary_findings"]) == 5
    for row in trace["candidates"]:
        payload = row["payload"]
        candidate = row["candidate_row"]
        persisted = row["persisted_evidence"]

        # Resolver/audit identity propagation is no longer the failing boundary.
        assert payload["domain_verification"] == payload["technical_report"]["domain_verification"]
        assert candidate["official_domain_verified"] is True
        assert candidate["official_domain_confidence"] == payload["domain_verification"]["confidence"]

        # Source identity is present and verifiable, but evidence remains tied
        # to generic hiring and has no explicit publication timestamp.
        assert payload["source_url"] == persisted["source_url"]
        assert payload["source_publisher"] == persisted["source_publisher"]
        assert persisted["verification_status"] == "primary_source_verified"
        assert persisted["signal_type"] == "hiring"
        assert persisted["published_at"] is None
        assert candidate["evidence_policy_passed"] is False

        # The operating company test itself passed. The current first reason
        # code is caused by unknown SME size, and must not be used as evidence
        # that the company is non-operating.
        assert candidate["is_operating_buyer"] is True
        assert candidate["operating_company_probability"] == 0.9
        assert payload["company_size_class"] is None
        assert "ENTITY_NOT_OPERATING" in candidate["rejection_codes"]


def test_prepare_boundary_filters_noise_without_provider_calls():
    trace = _load()
    selected = []
    for candidate in trace["candidates"]:
        with patch(
            "agents.domain_resolver.resolve_company_identity",
            return_value=_identity(candidate),
        ):
            prepared = prepare_agentic_extracted_item(_extracted(candidate), location="Italia")
        if prepared is not None:
            selected.append(candidate["entity_name"])
    assert selected == ["Fmach"]


def test_offline_funnel_before_and_after_source_gate_promotes_no_invalid_candidate():
    trace = _load()
    plan = _plan(trace)
    before = trace["before_funnel"]
    assert before == {"raw": 4, "resolved": 4, "audited": 4, "evidence_verified": 0, "qualified": 0}

    selected = [row for row in trace["candidates"] if row["expected_source_gate"]]
    gates = []
    for row in selected:
        lead = deepcopy(row["payload"])
        lead["lead_quality_contract"] = {"score": 95}
        gates.append(evaluate_publication_gate(lead, plan, cost_within_budget=True))

    after = {
        "raw": len(selected),
        "resolved": sum(bool(gate["official_domain_verified"]) for gate in gates),
        "audited": sum(bool(gate["audit_completed"]) for gate in gates),
        "evidence_verified": sum(bool(gate["evidence_supports_signal"]) for gate in gates),
        "qualified": sum(bool(gate["publishable"]) for gate in gates),
    }
    assert after == trace["expected_after_source_gate"]
    assert all(not gate["publishable"] for gate in gates)
    assert all("ENTITY_NOT_OPERATING" in gate["rejection_codes"] for gate in gates)
