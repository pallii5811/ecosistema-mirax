"""Offline end-to-end replay of the failed Stage 1 hiring canary trace.

This test must remain provider-free. It joins the production discovery,
extraction, identity, evidence, lifecycle and publication gates so the known
cross-component regressions cannot be tested in isolation only.
"""
from __future__ import annotations

import asyncio
import json
import os
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role")
os.environ.setdefault("MIRAX_WORKER_DISABLED", "1")

from agents.agentic_gap_fill import (
    extracted_to_lead_stub,
    lead_dedupe_key,
    prepare_agentic_extracted_item,
)
from agents.data_extractor import DataExtractor
from agents.web_researcher import (
    WebResearcher,
    _queries_for_discovery_round,
    _query_source_metadata,
    _source_plan_queries,
)
from commercial_lifecycle import evaluate_publication_gate
from worker_supabase import (
    _agentic_candidate_pool_target,
    _lead_satisfies_confirmed_required_signals,
)


FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "evaluation"
    / "fixtures"
    / "stage1-hiring-trace-replay-v5.json"
)


def _load_fixture():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _canonical_plan(trace):
    now = datetime.now(timezone.utc).isoformat()
    return {
        "schema_version": "1.0.0",
        "raw_query": trace["query"],
        "seller": {
            "offer_category": "consulente sicurezza sul lavoro",
            "offer_description": "consulenza sicurezza e prevenzione per personale operativo",
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
            "required_signals": ["hiring_operational"],
            "maximum_age_days_by_signal": {"hiring_operational": 60},
        },
        "source_policy": {
            "allowed_source_classes": ["company_careers", "job_board"],
            "preferred_source_classes": ["company_careers"],
            "excluded_source_classes": ["search_snippet", "generic_blog", "directory"],
            "minimum_independent_sources": 1,
            "primary_source_required_for": ["hiring_operational"],
        },
        "evidence_policy": {
            "minimum_evidence_confidence": 0.75,
            "require_source_url": True,
            "require_observed_at": True,
            "require_official_domain": True,
        },
        "commercial_hypotheses": [{
            "id": "ontology-hiring_operational",
            "signals": ["hiring_operational"],
            "confidence": 0.9,
            "buyer_problem": "L'aumento di personale operativo aumenta il rischio operativo e gli obblighi di sicurezza.",
            "implied_need": "Serve aggiornare valutazione dei rischi, formazione e procedure di sicurezza.",
            "triggering_events": ["operational_job_posting"],
            "relevance_to_offer": "Una vacancy operativa rende attuale la consulenza sicurezza prima dell'inserimento.",
        }],
        "planner_metadata": {"generated_at": now, "planner": "validated_replay"},
    }


def _identity(name, website, _location):
    url = website or ""
    if not url:
        return None
    return {
        "url": url,
        "status": "verified",
        "score": 92,
        "confidence": 0.92,
        "evidence": ["company_tokens_in_host", "legal_name_in_page", "official_site_markers"],
        "resolution_method": "positive_page_identity",
        "resolution_source": "extracted_website",
        "resolved_at": datetime.now(timezone.utc).isoformat(),
    }


def _lifecycle_lead(prepared, page, now):
    lead = extracted_to_lead_stub(prepared, category="PMI", location="Italia")
    evidence = page["extracted"]["evidence"]
    source_url = page["url"]
    lead.update({
        "azienda": page["extracted"]["name"],
        "website": prepared["website"],
        "sito": prepared["website"],
        "domain_verification": prepared["domain_verification"],
        "source_url": source_url,
        "source_class": "company_careers",
        "evidence": evidence,
        "why_now": f"Vacancy operativa recente verificata sulla pagina ufficiale: {evidence}",
        "last_audited_at": now,
        "technical_report": {"audit_status": "complete"},
        "company_size_class": page["extracted"].get("company_size_class", "small"),
        "operating_company_probability": 0.95,
        "business_signals": [{
            "type": "hiring_operational",
            "status": "confirmed",
            "confidence": 0.9,
            "evidence": evidence,
            "source_url": source_url,
            "source_class": "company_careers",
            "observed_at": now,
            "retrieval_method": "trace_replay",
        }],
        "required_signals": ["hiring_operational"],
        "signal_match_mode": "any",
    })
    for flag in ("is_public_body", "is_global_brand", "is_source_publisher"):
        if page["extracted"].get(flag):
            lead[flag] = True
    if page["extracted"].get("enterprise_excluded"):
        lead["is_global_brand"] = True
        lead["enterprise_excluded"] = True
    return lead


def test_stage1_hiring_trace_replay_end_to_end(monkeypatch):
    trace = _load_fixture()
    plan = trace["plan"]
    canonical_plan = _canonical_plan(trace)
    now = datetime.now(timezone.utc).isoformat()

    # Plan -> query -> lane lineage must survive diversified rounds.
    base_queries = _source_plan_queries(plan)
    assert len(base_queries) == 1
    for round_idx in (1, 2, 3):
        query = _queries_for_discovery_round(
            base_queries,
            {**plan, "_discovery_round": round_idx},
            max_queries=1,
        )[0]
        metadata = _query_source_metadata(plan, query)
        assert metadata["source_lane"] == "job_market"
        assert metadata["expected_signals"] == ["hiring_operational"]
        assert metadata["source_types"] == ["company_careers"]

    # Discovery must deduplicate repeated URLs and keep searching beyond the
    # first requested_count raw rows; the controlled pool target is 3x.
    researcher = WebResearcher(plan, max_queries=1, max_urls_per_query=25, max_total_urls=25)

    async def fake_discover(_query):
        return list(trace["serp_results"])

    monkeypatch.setattr(researcher, "_discover_urls_for_query", fake_discover)
    jobs = asyncio.run(researcher._discover_url_jobs(base_queries))
    urls = [job[0] for job in jobs]
    assert len(urls) == len(set(urls))
    assert len(urls) > trace["requested_count"]
    assert _agentic_candidate_pool_target(trace["requested_count"], True) == 15
    assert all(job[2]["source_lane"] == "job_market" for job in jobs)

    # Page -> extraction -> identity/domain -> lifecycle. The first five raw
    # rows are deliberately all noise; valid candidates occur only afterward.
    prepared_rows = []
    lifecycle = []
    first_five_qualified = 0
    with patch("agents.domain_resolver.resolve_company_identity", side_effect=_identity):
        for index, page in enumerate(trace["pages"]):
            extracted = deepcopy(page["extracted"])
            assert extracted["evidence"] in page["content"]
            extracted["_required_signals"] = ["hiring_operational"]
            extracted["_signal_match_mode"] = "any"
            extracted["_ranking_policy"] = {"max_signal_age_days": 60}
            if page["expected"] != "reject_stale":
                extracted["evidence_date"] = now
            prepared = prepare_agentic_extracted_item(extracted, location="Italia")
            if prepared is None:
                lifecycle.append((page["expected"], False, []))
                continue
            prepared_rows.append(prepared)
            lead = _lifecycle_lead(prepared, page, now)
            gate = evaluate_publication_gate(lead, canonical_plan, cost_within_budget=True)
            lifecycle.append((page["expected"], gate["publishable"], gate["rejection_codes"]))
            if index < trace["requested_count"] and gate["publishable"]:
                first_five_qualified += 1

    assert first_five_qualified == 0
    qualified = [row for row in lifecycle if row[1]]
    assert len(qualified) == 2, lifecycle
    assert all(expected == "qualified_candidate" for expected, _, _ in qualified)
    assert not any(passed for expected, passed, _ in lifecycle if expected.startswith("reject_"))

    # Official careers subdomain is promoted when the extractor has no site.
    sibeg = next(row for row in prepared_rows if row["name"] == "Sibeg Srl")
    assert sibeg["website"] == "https://careers.sibeg.it/"
    assert sibeg["domain_verification"]["status"] == "verified"

    # Global dedup uses the verified official domain, not the display name.
    keys = [lead_dedupe_key(row["name"], row["website"]) for row in prepared_rows]
    assert len(keys) == len(set(keys))

    # Canonical alias and any/all semantics must agree at the final signal gate.
    alias_lead = {
        "required_signals": ["hiring_operational", "contract_awarded"],
        "business_signals": [{"type": "hiring", "status": "confirmed"}],
        "signal_match_mode": "any",
    }
    assert _lead_satisfies_confirmed_required_signals(alias_lead) is True
    assert _lead_satisfies_confirmed_required_signals({**alias_lead, "signal_match_mode": "all"}) is False

    # An unaudited candidate must never pass the publication gate.
    valid_page = next(page for page in trace["pages"] if page["expected"] == "qualified_candidate")
    with patch("agents.domain_resolver.resolve_company_identity", side_effect=_identity):
        extracted = deepcopy(valid_page["extracted"])
        extracted.update({
            "_required_signals": ["hiring_operational"],
            "_signal_match_mode": "any",
            "_ranking_policy": {"max_signal_age_days": 60},
            "evidence_date": now,
        })
        prepared = prepare_agentic_extracted_item(extracted, location="Italia")
    audited = _lifecycle_lead(prepared, valid_page, now)
    assert evaluate_publication_gate(audited, canonical_plan, cost_within_budget=True)["publishable"] is True
    unaudited = {**audited, "last_audited_at": None, "technical_report": {"audit_status": "pending"}}
    unaudited_gate = evaluate_publication_gate(unaudited, canonical_plan, cost_within_budget=True)
    assert unaudited_gate["publishable"] is False
    assert "audit_completed" in unaudited_gate["failures"]

    # The replayed paid-operation trace is deterministic and below the cap.
    simulated_cost = sum(float(row["actual_cost_eur"]) for row in trace["simulated_cost_ledger"])
    assert round(simulated_cost, 6) == 0.045846
    assert simulated_cost < trace["hard_budget_eur"]


def test_stage1_replay_prevents_duplicate_extraction_and_lane_starvation(monkeypatch):
    monkeypatch.setenv("MIRAX_LLM_MAX_CHUNKS_PER_PAGE", "1")
    monkeypatch.setenv("MIRAX_HEURISTIC_OFFICIAL_FIRST", "0")
    extractor = DataExtractor({"required_signals": ["hiring_operational"]}, [], chunk_size=140, chunk_overlap=0)
    extraction_calls = []

    async def fake_extract(source_url, _chunk, _index, _total, plan_override=None):
        extraction_calls.append((source_url, tuple((plan_override or {}).get("required_signals") or [])))
        return []

    monkeypatch.setattr(extractor, "_extract_chunk", fake_extract)
    asyncio.run(extractor.extract_page({
        "url": "https://candidate.example/jobs/tecnico",
        "raw_text": "Posizione aperta: azienda cerca tecnico manutentore operativo. " * 20,
        "expected_signals": ["hiring_operational"],
        "source_lane": "job_market",
        "source_types": ["company_careers"],
    }))
    assert extraction_calls == [("https://candidate.example/jobs/tecnico", ("hiring_operational",))]

    coverage_plan = {
        "original_query": "PMI con assunzioni, appalti o ampliamenti",
        "sector": "company",
        "location": "Italia",
        "required_signals": ["hiring_operational", "contract_awarded", "production_expansion"],
        "source_plan": [
            {"lane": "job_market", "source_types": ["company_careers"], "query_templates": ["careers operai {location}"], "expected_evidence": ["hiring_operational"]},
            {"lane": "public_procurement", "source_types": ["public_procurement_portal"], "query_templates": ["appalto aggiudicato {location}"], "expected_evidence": ["contract_awarded"]},
            {"lane": "web_evidence", "source_types": ["official_company_website"], "query_templates": ["nuovo stabilimento {location}"], "expected_evidence": ["production_expansion"]},
        ],
    }
    coverage_researcher = WebResearcher(coverage_plan, max_queries=3, max_urls_per_query=5, max_total_urls=3)
    coverage_queries = _source_plan_queries(coverage_plan)
    calls = []

    async def fake_lane_discover(query):
        calls.append(query)
        return [f"https://lane-{len(calls)}.example/evidence-{i}" for i in range(5)]

    monkeypatch.setattr(coverage_researcher, "_discover_urls_for_query", fake_lane_discover)
    jobs = asyncio.run(coverage_researcher._discover_url_jobs(coverage_queries))
    assert calls == coverage_queries
    assert len(jobs) == 3
    assert {job[2]["source_lane"] for job in jobs} == {"job_market", "public_procurement", "web_evidence"}
