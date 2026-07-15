from __future__ import annotations

import asyncio
from typing import Any, Mapping

import pytest

from source_adapters.contracts import AdapterDiscoveryRequest, AdapterExecutionResult, SourceExhaustion
from source_adapters.hiring import HiringAdapter, _register_unique_employer_record
from source_adapters.hiring_qualification import (
    collect_processed_employer_keys,
    employer_key_from_payload,
    employer_key_from_record,
    resolve_employer_identity,
)
from source_adapters.orchestrator import UniversalSourceOrchestrator
from source_adapters.shadow_runtime import build_shadow_resume_state, merge_shadow_qualified_payloads


def _hiring_request(**overrides: Any) -> AdapterDiscoveryRequest:
    base = {
        "intent": "hiring",
        "signal_ids": ("hiring_sales",),
        "signal_match_mode": "any",
        "geographies": ("Lombardia",),
        "freshness_max_age_days": 30,
        "requested_count": 1,
        "budget_eur": 0.125,
        "query": "commerciale lombardia",
        "technical_filters": {},
    }
    base.update(overrides)
    return AdapterDiscoveryRequest(**base)


def _verisure_milano_payload() -> dict[str, Any]:
    return {
        "sito": "https://verisure.com",
        "employer_official_domain": "verisure.com",
        "azienda": "Verisure",
        "citta": "Milano",
        "vacancy_url": "https://careers.verisure.com/milano",
    }


def _verisure_brescia_payload() -> dict[str, Any]:
    return {
        "sito": "https://verisure.com",
        "employer_official_domain": "verisure.com",
        "azienda": "Verisure",
        "citta": "Brescia",
        "vacancy_url": "https://careers.verisure.com/brescia",
        "business_signals": [{"source_url": "https://careers.verisure.com/brescia", "evidence": "Sales Brescia"}],
    }


def test_verisure_brescia_does_not_replace_milano_primary() -> None:
    merged = merge_shadow_qualified_payloads([_verisure_milano_payload()], [_verisure_brescia_payload()])
    assert len(merged) == 1
    assert merged[0]["citta"] == "Milano"
    assert len(merged[0].get("related_opportunities") or []) == 1
    keys = collect_processed_employer_keys((), merged)
    assert keys == ("domain:verisure.com",)


def test_duplicate_employer_does_not_increment_new_unique_count() -> None:
    processed = {"domain:verisure.com"}
    new_unique: set[str] = set()
    record = resolve_employer_identity({
        "company_name": "Verisure",
        "employer_official_domain": "verisure.com",
        "vacancy_title": "Sales Brescia",
        "location": "Brescia",
        "source_url": "https://careers.verisure.com/brescia",
    })
    ok, reason = _register_unique_employer_record(
        record,
        processed_employer_keys=processed,
        new_unique_employer_keys=new_unique,
    )
    assert ok is False
    assert reason == "DUPLICATE_EMPLOYER_OPPORTUNITY"
    assert not new_unique


def test_four_prior_employers_plus_duplicate_keeps_search_open() -> None:
    prior_payloads = [
        {"sito": "https://vitalaire.com", "employer_official_domain": "vitalaire.com", "azienda": "VitalAire"},
        {"sito": "https://verisure.com", "employer_official_domain": "verisure.com", "azienda": "Verisure"},
        {"sito": "https://lyreco.it", "employer_official_domain": "lyreco.it", "azienda": "Lyreco Italia"},
        {"sito": "https://teamsystem.com", "employer_official_domain": "teamsystem.com", "azienda": "TeamSystem"},
    ]
    processed = collect_processed_employer_keys((), prior_payloads)
    assert len(processed) == 4
    resume = build_shadow_resume_state(
        type("R", (), {
            "status": "completed_requested_count",
            "adapter_progress": (),
            "cost_eur": 0.0,
        })(),
        qualified_lead_payloads=prior_payloads,
        requested_count=5,
    )
    assert resume["unique_lifecycle_accepted_count"] == 4
    assert resume["resumable"] is True


def test_fifth_distinct_domain_completes_unique_target() -> None:
    prior_payloads = [
        {"sito": "https://vitalaire.com", "employer_official_domain": "vitalaire.com", "azienda": "VitalAire"},
        {"sito": "https://verisure.com", "employer_official_domain": "verisure.com", "azienda": "Verisure"},
        {"sito": "https://lyreco.it", "employer_official_domain": "lyreco.it", "azienda": "Lyreco Italia"},
        {"sito": "https://teamsystem.com", "employer_official_domain": "teamsystem.com", "azienda": "TeamSystem"},
    ]
    fifth = {"sito": "https://dedalus.com", "employer_official_domain": "dedalus.com", "azienda": "Dedalus"}
    merged = merge_shadow_qualified_payloads(prior_payloads, [fifth])
    keys = collect_processed_employer_keys((), merged)
    assert len(keys) == 5
    resume = build_shadow_resume_state(
        type("R", (), {
            "status": "completed_requested_count",
            "adapter_progress": (),
            "cost_eur": 0.0,
        })(),
        qualified_lead_payloads=merged,
        requested_count=5,
    )
    assert resume["resumable"] is False


def test_alias_resolves_to_same_employer_key() -> None:
    record = resolve_employer_identity({
        "company_name": "Verisure Alarm",
        "displayed_employer_name": "Verisure",
        "vacancy_title": "Sales",
        "location": "Milano",
        "source_url": "https://careers.verisure.com/job/1",
    })
    assert employer_key_from_record(record) == "domain:verisure.com"


def test_orchestrator_skips_processed_employer_for_requested_count() -> None:
    from source_adapters.catalog import SourceCapabilityRegistry
    from source_adapters.contracts import EvidenceRecord, OpportunityCandidate, SourceCapability

    class _StubAdapter:
        CAPABILITY = SourceCapability(
            adapter_id="stub_hiring",
            adapter_version="1.0.0",
            supported_intents=("hiring",),
            supported_signals=("hiring_sales",),
            source_classes=("company_careers",),
            geographic_coverage=("global",),
            freshness_max_age_days=30,
            discovery_mode="discovery_first",
            supports_pagination=False,
            supports_cursor_resume=False,
            max_results_per_page=10,
            max_results_per_run=10,
            estimated_cost_eur_per_operation=0.0,
            authentication_requirements=(),
            rate_limit_per_minute=100,
            provenance_guarantees=(),
            evidence_guarantees=(),
            exhaustion_semantics="best_effort",
            coverage_status="supported",
        )

        @property
        def capability(self):
            return self.CAPABILITY

        async def discover(self, request: AdapterDiscoveryRequest) -> AdapterExecutionResult:
            evidence = EvidenceRecord(
                signal_id="hiring_sales",
                source_url="https://careers.verisure.com/brescia",
                source_publisher="verisure.com",
                source_class="company_careers",
                excerpt="Sales Brescia",
                observed_at="2026-07-15T00:00:00+00:00",
                published_at="2026-07-01",
                extraction_method="test",
                confidence=0.95,
                provenance={},
            )
            candidate = OpportunityCandidate(
                canonical_company_name="Verisure",
                company_identifiers={},
                official_domain="verisure.com",
                entity_class="operating_company",
                geographies=("Brescia",),
                buyer_fit=1.0,
                signal_id="hiring_sales",
                signal_date="2026-07-01",
                evidence=(evidence,),
                why_now="test",
                contacts=(),
                confidence=0.95,
                contradiction_flags=(),
                provenance={
                    "domain_verification": {
                        "status": "verified",
                        "confidence": 0.95,
                        "evidence": ("host_match",),
                        "resolution_source": "test",
                        "resolution_method": "test",
                        "url": "https://verisure.com/",
                    }
                },
                adapter_id="stub_hiring",
                adapter_version="1.0.0",
                official_domain_verified=True,
                official_domain_confidence=0.95,
            )
            return AdapterExecutionResult(
                adapter_id="stub_hiring",
                adapter_version="1.0.0",
                candidates=(candidate,),
                operations=1,
                cost_eur=0.0,
                started_at="2026-07-15T00:00:00+00:00",
                completed_at="2026-07-15T00:00:00+00:00",
                warnings=(),
                exhaustion=SourceExhaustion(exhausted=True, scope="source", reason="done", authoritative=True),
                telemetry={},
            )

    registry = SourceCapabilityRegistry((_StubAdapter(),))
    orchestrator = UniversalSourceOrchestrator(registry, max_seconds=5.0, max_rounds=1)

    async def _always_qualify(candidate: OpportunityCandidate):
        from source_adapters.orchestrator import QualificationDecision
        return QualificationDecision(qualified=True, audited=True, evidence_verified=True, opportunity_value_score=0.9)

    orchestrator.qualifier = _always_qualify
    request = _hiring_request(
        requested_count=1,
        technical_filters={
            "processed_employer_keys": ("domain:verisure.com",),
            "total_unique_employer_target": 5,
        },
    )
    result = asyncio.run(orchestrator.run(request))
    assert result.status != "completed_requested_count"
    assert not result.qualified_leads
    assert result.rejection_codes.get("DUPLICATE_EMPLOYER_OPPORTUNITY") == 1


def test_resume_state_preserves_processed_keys_and_cost() -> None:
    prior = {
        "prior_cost_eur": 0.05,
        "processed_employer_keys": ["domain:vitalaire.com", "domain:verisure.com"],
        "resume_cursors": {"structured_hiring_v1": "hire:106"},
    }
    payloads = [
        {"sito": "https://lyreco.it", "employer_official_domain": "lyreco.it", "azienda": "Lyreco Italia"},
    ]
    resume = build_shadow_resume_state(
        type("R", (), {
            "status": "partial_time_limit",
            "adapter_progress": (),
            "cost_eur": 0.0,
        })(),
        qualified_lead_payloads=payloads,
        prior_state=prior,
        requested_count=5,
    )
    assert resume["prior_cost_eur"] == 0.05
    assert "domain:lyreco.it" in resume["processed_employer_keys"]
    assert resume["resume_cursors"]["structured_hiring_v1"] == "hire:106"


def test_hiring_adapter_stops_only_on_new_unique_employers(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"count": 0}

    async def _provider(request: AdapterDiscoveryRequest, state, limit: int):
        from source_adapters.hiring import HiringProviderResult
        calls["count"] += 1
        record_a = resolve_employer_identity({
            "company_name": "Verisure",
            "employer_official_domain": "verisure.com",
            "vacancy_title": "Sales Milano",
            "location": "Milano",
            "source_url": "https://careers.verisure.com/a",
            "source_class": "company_careers",
            "published_at": "2026-07-01",
            "official_domain_verified": True,
        })
        record_b = resolve_employer_identity({
            "company_name": "Dedalus",
            "employer_official_domain": "dedalus.com",
            "vacancy_title": "Sales",
            "location": "Milano",
            "source_url": "https://careers.dedalus.com/a",
            "source_class": "company_careers",
            "published_at": "2026-07-01",
            "official_domain_verified": True,
        })
        records = (record_a, record_b) if calls["count"] == 1 else (record_a,)
        return HiringProviderResult(records, True, 0.0, (), (), state, 1, 1)

    adapter = HiringAdapter(providers=(_provider,))
    request = _hiring_request(
        requested_count=1,
        technical_filters={"processed_employer_keys": ("domain:verisure.com",)},
    )
    result = asyncio.run(adapter.discover(request))
    assert len(result.candidates) == 1
    assert result.candidates[0].official_domain == "dedalus.com"
