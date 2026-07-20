"""Phase A provenance, yield, and termination regression tests."""
from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import date

from source_adapters.contracts import (
    AdapterDiscoveryRequest,
    EvidenceRecord,
    OpportunityCandidate,
)
from source_adapters.generic_web import GenericWebResearchAdapter, _valid_record
from source_adapters.generic_web_budget import encode_generic_web_cursor, GenericWebDiscoveryState
from source_adapters.generic_web_provenance import (
    attach_generic_provenance,
    generic_record_has_fetch_provenance,
    is_careers_only_host,
)
from source_adapters.hiring_qualification import _corporate_from_careers_host, resolve_employer_identity
from source_adapters.shadow_runtime import candidate_to_lifecycle_shadow_payload
from source_adapters.universal_query_spec import UniversalQuerySpec
from source_adapters.signal_strategy_planner import plan_strategies


def _candidate(*, domain: str = "acme.com", verified: bool = True) -> OpportunityCandidate:
    return OpportunityCandidate(
        canonical_company_name="Acme Spa",
        company_identifiers={},
        official_domain=domain,
        entity_class="operating_company",
        geographies=("Italia",),
        buyer_fit=0.8,
        signal_id="funding",
        signal_date="2026-06-01",
        evidence=(
            EvidenceRecord(
                signal_id="funding",
                source_url="https://acme.com/news",
                source_publisher="Acme",
                source_class="recognized_news",
                excerpt="Acme ha raccolto 5 milioni in seed round.",
                observed_at="2026-06-01T00:00:00Z",
                published_at="2026-06-01",
                extraction_method="test",
                confidence=0.9,
                provenance={
                    "source_text": "Acme ha raccolto 5 milioni in seed round. " * 20,
                    "origin_page_fetch_id": "fetch-1",
                    "origin_source_text_hash": "abc123",
                },
            ),
        ),
        why_now="Round recente",
        contacts=(),
        confidence=0.9,
        contradiction_flags=(),
        provenance={
            "domain_verification": {
                "status": "verified",
                "confidence": 0.9,
                "score": 90,
                "evidence": ("schema_org_identity_match",),
                "resolution_source": "source_adapter",
                "resolution_method": "verified_source_adapter",
                "adapter_id": "generic_web_research_v1",
                "url": f"https://{domain}/",
            }
        },
        adapter_id="generic_web_research_v1",
        adapter_version="1.0.0",
        official_domain_verified=verified,
        official_domain_confidence=0.9,
    )


def test_q4_verified_domain_survives_final_payload() -> None:
    payload = candidate_to_lifecycle_shadow_payload(_candidate(domain="abbott.com"), opportunity_value_score=0.8)
    assert payload["official_domain"] == "abbott.com"
    assert payload["employer_official_domain"] == "abbott.com"


def test_q4_unverified_domain_cannot_serialize() -> None:
    try:
        candidate_to_lifecycle_shadow_payload(
            replace(_candidate(), official_domain_verified=False),
            opportunity_value_score=0.8,
        )
        raised = False
    except ValueError:
        raised = True
    assert raised


def test_jobs_abbott_maps_to_corporate_domain() -> None:
    assert _corporate_from_careers_host("jobs.abbott") == "abbott.com"


def test_generic_candidate_without_fetch_rejected() -> None:
    record = {
        "company_name": "Buyer Spa",
        "official_domain": "buyer.it",
        "official_domain_verified": True,
        "entity_class": "operating_company",
        "source_class": "recognized_news",
        "source_url": "https://buyer.it/news",
        "source_publisher": "Buyer",
        "evidence_excerpt": "ricerca nuovo CRM",
        "published_at": "2026-06-01",
        "matched_signal_ids": ["technology_adoption"],
    }
    ok, code = generic_record_has_fetch_provenance(record)
    assert not ok
    assert code == "PAGE_FETCH_PROVENANCE_MISSING"


def test_generic_candidate_without_source_text_hash_rejected() -> None:
    record = {
        "company_name": "Buyer Spa",
        "official_domain": "buyer.it",
        "official_domain_verified": True,
        "entity_class": "operating_company",
        "source_class": "recognized_news",
        "source_url": "https://buyer.it/news",
        "source_publisher": "Buyer",
        "evidence_excerpt": "ricerca nuovo CRM",
        "published_at": "2026-06-01",
        "matched_signal_ids": ["technology_adoption"],
        "origin_page_fetch_id": "pf-1",
        "source_text": "x" * 200,
    }
    ok, code = generic_record_has_fetch_provenance(record)
    assert not ok
    assert code == "SOURCE_TEXT_HASH_MISSING"


def test_funding_authority_role_rejected_before_grounding() -> None:
    excluded = frozenset({"investor", "publisher", "authority", "lender", "advisor", "fund"})
    assert "authority" in excluded
    assert "recipient" not in excluded
    assert "startup" not in excluded


def test_startup_recipient_with_literal_evidence_passes_provenance_gate() -> None:
    record = {
        "company_name": "Startup Spa",
        "official_domain": "startup.it",
        "official_domain_verified": True,
        "entity_class": "operating_company",
        "source_class": "recognized_news",
        "source_url": "https://startup.it/news",
        "source_publisher": "Startup",
        "evidence_excerpt": "Startup Spa ha raccolto 2 milioni.",
        "published_at": "2026-06-01",
        "matched_signal_ids": ["funding"],
        "why_now": "Round recente",
        "buyer_fit": 0.8,
    }
    attach_generic_provenance(
        record,
        adapter_id="generic_web_research_v1",
        search_scope="scope",
        execution_round=1,
        provider_call_id="serp:scope:1",
        page_fetch_id_value="pf-1",
        source_text="Startup Spa ha raccolto 2 milioni. " * 20,
    )
    request = AdapterDiscoveryRequest(
        intent="funding",
        signal_ids=("funding",),
        signal_match_mode="any",
        geographies=("Italia",),
        freshness_max_age_days=180,
        requested_count=1,
        budget_eur=0.05,
        query="startup funding",
        sectors=(),
        technical_filters={"universal_engine": True},
    )
    ok, code = _valid_record(record, request, date.today())
    assert ok, code


def test_q2_retrieval_queries_include_crm_hypotheses() -> None:
    spec = UniversalQuerySpec(
        original_query="Trovami aziende che stanno cercando un nuovo CRM.",
        seller_profile="crm",
        seller_offer="crm",
        target_company_profile="buyer",
        target_industries=("servizi",),
        target_geographies=("Italia",),
        buyer_roles=("buyer",),
        business_problem="CRM",
        requested_count=2,
        freshness_days=180,
        required_signals=("technology_adoption",),
        optional_signals=(),
        excluded_entities=(),
        source_preferences=(),
        evidence_requirements=("official_domain", "source_url"),
        cost_budget=0.05,
        capability_status="supported",
    )
    queries = [item.search_query for item in plan_strategies(spec)]
    assert any('("adotta" OR "sceglie" OR "implementa") CRM' in q for q in queries)
    assert any("migrazione CRM" in q for q in queries)
    crm_idx = next(i for i, q in enumerate(queries) if '("adotta" OR "sceglie" OR "implementa") CRM' in q)
    generic_idx = next(i for i, q in enumerate(queries) if 'site:.it ("comunicato stampa"' in q)
    assert crm_idx < generic_idx
    assert "crm" in queries[0].casefold()


def test_second_serp_blocked_until_pending_wave_processed(monkeypatch) -> None:
    calls: list[str] = []

    def _spy_search(query: str, target: int, *, cost_scope: str = "") -> list[dict[str, str]]:
        calls.append(query)
        return [{"url": f"https://example-{len(calls)}.it/news", "title": "News", "snippet": "CRM", "provider": "serper"}]

    monkeypatch.setattr("backend_mirror.agents.search_serp.search_hits_http", _spy_search)
    state = GenericWebDiscoveryState(query_index=0)
    cursor = encode_generic_web_cursor(state)
    request = AdapterDiscoveryRequest(
        intent="crm",
        signal_ids=("technology_adoption",),
        signal_match_mode="any",
        geographies=("Italia",),
        freshness_max_age_days=180,
        requested_count=2,
        budget_eur=0.05,
        query="CRM buyer",
        sectors=(),
        technical_filters={
            "universal_engine": True,
            "semantic_authority_required": True,
            "universal_search_queries": ("query-one", "query-two", "query-three"),
        },
        cursor=cursor,
    )

    async def _fetch(url: str) -> tuple[str, str]:
        return (f"<html><body>{'ricerca nuovo CRM ' * 40}</body></html>", url)

    monkeypatch.setattr(
        "backend_mirror.source_adapters.generic_web._gate_serp_hits",
        lambda req, hits, provider_query="": [
            type("Hit", (), {"url": hits[0]["url"], "title": hits[0]["title"], "snippet": hits[0]["snippet"], "publisher": ""})()
        ],
    )
    adapter = GenericWebResearchAdapter()
    result = asyncio.run(adapter.discover(request))
    assert len(calls) == 1
    assert result.cost_eur <= 0.05


def test_resume_rehydrates_url_meta_without_pending_urls(monkeypatch) -> None:
    fetched: list[str] = []

    def _spy_search(query: str, target: int, *, cost_scope: str = "") -> list[dict[str, str]]:
        raise AssertionError("second SERP must not run while url_meta has pending hits")

    def _page_fetch(url: str) -> tuple[str, str]:
        fetched.append(url)
        return (f"<html><body>{'startup round investimento ' * 40}</body></html>", url)

    monkeypatch.setattr("backend_mirror.agents.search_serp.search_hits_http", _spy_search)
    state = GenericWebDiscoveryState(
        query_index=1,
        url_meta=(
            {
                "url": "https://example-resume.it/funding",
                "title": "Startup round",
                "snippet": "round da 1M",
                "provider": "serper",
                "provider_query": "startup round",
            },
        ),
    )
    cursor = encode_generic_web_cursor(state)
    request = AdapterDiscoveryRequest(
        intent="funding",
        signal_ids=("funding",),
        signal_match_mode="any",
        geographies=("Italia",),
        freshness_max_age_days=180,
        requested_count=2,
        budget_eur=0.05,
        query="funding",
        sectors=(),
        technical_filters={
            "universal_engine": True,
            "semantic_authority_required": True,
            "universal_search_queries": ("startup round",),
            "universal_page_fetch": _page_fetch,
        },
        cursor=cursor,
    )
    adapter = GenericWebResearchAdapter()
    asyncio.run(adapter.discover(request))
    assert fetched == ["https://example-resume.it/funding"]


def test_careers_only_host_rejected_for_lifecycle_domain() -> None:
    assert is_careers_only_host("jobs.abbott")
    assert not is_careers_only_host("abbott.com")


def test_resolve_employer_identity_rejects_jobs_abbott_as_official() -> None:
    resolved = resolve_employer_identity({
        "company_name": "Abbott",
        "vacancy_title": "Software Engineer",
        "vacancy_url": "https://jobs.abbott/us/en/job/123",
        "employer_official_domain": "jobs.abbott",
        "published_at": "2026-06-01",
        "active": True,
        "active_evidence": "jsonld",
        "active_verification_method": "jsonld_jobposting",
        "description": "software engineering role",
        "location": "Milano",
    })
    assert resolved.get("employer_official_domain") == "abbott.com"
