from __future__ import annotations

import asyncio
from dataclasses import replace
from pathlib import Path
from typing import Any, Mapping

import pytest

from backend_mirror.source_adapters import AdapterDiscoveryRequest, SourceCapabilityRegistry
from backend_mirror.source_adapters.orchestrator import UniversalSourceOrchestrator
from backend_mirror.test_source_orchestrator import PagedAdapter, candidate, capability


def semantic_contract() -> dict[str, Any]:
    return {
        "query_goal": "find financed operating companies", "seller": {}, "offer": {},
        "target_entity_types": ["operating_company"],
        "target_company_description": "Italian company receiving resources",
        "event_or_state_description": "capital received by target",
        "target_role_in_event": "recipient",
        "required_relationships": ["capital_received_by_target"], "optional_relationships": [],
        "excluded_roles": ["provider", "publisher", "investor"], "excluded_entities": [],
        "geography": ["Italia"], "industry": [], "size_constraints": {},
        "temporal_constraints": {"maximum_age_days": 30}, "positive_conditions": ["capital received"],
        "negative_conditions": ["credit merely offered"], "must_have_facts": ["recipient", "date"],
        "forbidden_inferences": ["publisher is target", "provider is recipient"],
        "data_requirements": ["official_domain", "source_url"],
        "ranking_objective": "recent grounded recipient",
        "acceptance_rubric": ["target_is_recipient", "event_is_observed"],
        "discovery_hypotheses": [{"source_classes": ["recognized_news"]}],
        "clarification_required": False, "confidence": 0.95, "canonical_signal_hints": ["funding"],
    }


class Model:
    model_version = "semantic-orchestrator-fixture-v1"

    def __init__(self, response: Mapping[str, Any]) -> None:
        self.response = response
        self.calls = 0

    async def complete_json(self, **_: Any) -> Mapping[str, Any]:
        self.calls += 1
        return self.response


def event(excerpt: str, *, company: str, role: str, query_match: bool) -> dict[str, Any]:
    accepted = query_match and role == "recipient"
    return {
        "entities": [{"name": company, "type": "operating_company", "role": role}],
        "events": [{"type": "financing", "status": "completed"}], "relations": [],
        "target_company": company, "target_entity_role": role, "event_type": "financing",
        "open_predicate": "capital received" if accepted else "credit offered",
        "actor": None, "recipient": company if role == "recipient" else None,
        "provider": company if role == "provider" else None, "beneficiary": company if role == "recipient" else None,
        "investor": None, "employer": None, "recruiter": None, "publisher": "Fixture Publisher",
        "authority": None, "predicate": "capital_received_by_target" if accepted else "credit_offered_by_target",
        "direction": "provider_to_recipient", "event_status": "completed", "event_date": "2026-07-18",
        "amount": None, "location": "Italia", "technology": None, "role": None,
        "negated": False, "hypothetical": False, "conditional": False, "rumor": False, "historical": False,
        "certainty": 0.95, "query_match": query_match,
        "query_match_reason": "correct recipient" if accepted else "inverse provider role",
        "satisfied_relationships": ["capital_received_by_target"] if accepted else [],
        "acceptance_rubric_passed": ["target_is_recipient", "event_is_observed"] if accepted else [],
        "buyer_need": "growth", "why_now": "fresh resources", "evidence_excerpt": excerpt,
        "evidence_start": 0, "evidence_end": len(excerpt), "confidence": 0.95,
        "rejection_reason": None if accepted else "provider is excluded",
    }


def event_without_date(excerpt: str, *, company: str, role: str, query_match: bool) -> dict[str, Any]:
    payload = event(excerpt, company=company, role=role, query_match=query_match)
    payload["event_date"] = None
    return payload


def request(model: Model, cache_path: Path) -> AdapterDiscoveryRequest:
    return AdapterDiscoveryRequest(
        intent="commercial_search", signal_ids=("funding",), signal_match_mode="all",
        geographies=("italy",), freshness_max_age_days=30, requested_count=1, budget_eur=0.125,
        query="aziende italiane che hanno ottenuto nuove risorse finanziarie",
        technical_filters={
            "semantic_query_contract": semantic_contract(), "semantic_authority_required": True,
            "semantic_model_client": model, "semantic_cache_path": str(cache_path),
            "semantic_telemetry": {},
        },
    )


def test_deferred_news_domain_applies_semantic_enrichment_before_requalify(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from backend_mirror.source_adapters import OpportunityCandidate
    from backend_mirror.source_adapters import orchestrator as orch_mod

    base = candidate("Sirius Game", "placeholder.test", "funding", "generic_web_research_v1")
    excerpt = "Sirius Game chiude un round da 1,3 milioni di euro"
    source_text = (excerpt + ". " + "contesto letterale sufficiente per il grounding semantico. ") * 8
    item = replace(
        base,
        buyer_fit=None,
        why_now=None,
        confidence=0.55,
        official_domain="",
        official_domain_verified=False,
        official_domain_confidence=0.0,
        evidence=(replace(
            base.evidence[0],
            excerpt=excerpt,
            source_class="recognized_news",
            source_url="https://finanza.repubblica.it/sirius",
            provenance={
                "source_text": source_text,
                "page_title": "Sirius Game chiude un round",
                "search_snippet": excerpt,
                "origin_page_fetch_id": "fetch123",
                "origin_source_text_hash": "abc123",
            },
        ),),
        provenance={"adapter_id": "generic_web_research_v1", "domain_verification": {"status": "deferred"}},
        adapter_id="generic_web_research_v1",
    )
    model = Model(event(excerpt, company="Sirius Game", role="recipient", query_match=True))

    def fake_identity(candidate: OpportunityCandidate, request, *, semantic_matched: bool):
        assert semantic_matched is True
        assert candidate.buyer_fit == 0.95
        assert "Sirius Game chiude un round" in (candidate.why_now or "")
        assert "Inferenza commerciale, non domanda esplicita" in (candidate.why_now or "")
        verified = replace(
            candidate,
            official_domain="siriusgame.it",
            official_domain_verified=True,
            official_domain_confidence=0.9,
            provenance={
                **dict(candidate.provenance),
                "domain_verification": {
                    "status": "verified", "confidence": 0.9, "score": 90,
                    "evidence": ("post_semantic_identity",),
                    "resolution_source": "post_semantic_identity",
                    "resolution_method": "test",
                    "adapter_id": candidate.adapter_id,
                    "url": "https://siriusgame.it/",
                },
            },
        )
        return verified, None

    monkeypatch.setattr(orch_mod, "resolve_post_semantic_identity", fake_identity)
    adapter = PagedAdapter(capability("generic_web_research_v1", ("funding",)), [[item]])
    result = asyncio.run(UniversalSourceOrchestrator(SourceCapabilityRegistry((adapter,))).run(
        request(model, tmp_path / "deferred.sqlite"),
    ))
    assert result.progress.qualified_count == 1, result.rejection_codes
    assert result.qualified_leads[0].candidate.official_domain == "siriusgame.it"
    assert result.qualified_leads[0].candidate.buyer_fit == 0.95


def test_common_semantic_gate_qualifies_grounded_recipient(tmp_path: Path) -> None:
    item = replace(
        candidate("Beta Srl", "beta.test", "funding", "generic"),
        buyer_fit=None, why_now=None, confidence=0.55,
    )
    excerpt = item.evidence[0].excerpt
    model = Model(event(excerpt, company="Beta Srl", role="recipient", query_match=True))
    adapter = PagedAdapter(capability("generic", ("funding",)), [[item]])
    result = asyncio.run(UniversalSourceOrchestrator(SourceCapabilityRegistry((adapter,))).run(
        request(model, tmp_path / "positive.sqlite"),
    ))
    assert result.progress.qualified_count == 1
    grounding = result.qualified_leads[0].candidate.provenance["semantic_grounding"]
    assert grounding["accepted"] is True
    assert grounding["target_role"] == "recipient"
    assert result.qualified_leads[0].candidate.buyer_fit == 0.95
    why_now = result.qualified_leads[0].candidate.why_now or ""
    assert "Beta Srl prova esplicita funding" in why_now
    assert "Inferenza commerciale, non domanda esplicita" in why_now
    assert result.qualified_leads[0].candidate.confidence == 0.95
    assert result.semantic_telemetry["semantic_calls"] == 1


def test_common_semantic_gate_uses_evidence_published_at_when_model_omits_event_date(tmp_path: Path) -> None:
    item = replace(
        candidate("Datafire Srl", "datafire.test", "funding", "generic"),
        buyer_fit=None,
        why_now=None,
        confidence=0.55,
    )
    excerpt = item.evidence[0].excerpt
    model = Model(event_without_date(excerpt, company="Datafire Srl", role="recipient", query_match=True))
    adapter = PagedAdapter(capability("generic", ("funding",)), [[item]])
    result = asyncio.run(UniversalSourceOrchestrator(SourceCapabilityRegistry((adapter,))).run(
        request(model, tmp_path / "missing-event-date.sqlite"),
    ))
    assert result.progress.qualified_count == 1, result.rejection_codes
    assert result.rejection_codes.get("EVENT_GROUNDING_FAILED", 0) == 0


def test_common_semantic_gate_rejects_inverse_provider_before_scoring(tmp_path: Path) -> None:
    item = candidate("Gamma Banca", "gamma.test", "funding", "generic")
    excerpt = item.evidence[0].excerpt
    model = Model(event(excerpt, company="Gamma Banca", role="provider", query_match=False))
    adapter = PagedAdapter(capability("generic", ("funding",)), [[item]])
    result = asyncio.run(UniversalSourceOrchestrator(SourceCapabilityRegistry((adapter,))).run(
        request(model, tmp_path / "negative.sqlite"),
    ))
    assert result.progress.qualified_count == 0
    assert result.rejection_codes == {"ACTOR_ROLE_EXCLUDED": 1}


def test_semantic_model_failure_is_fail_closed(tmp_path: Path) -> None:
    class Broken(Model):
        async def complete_json(self, **_: Any) -> Mapping[str, Any]:
            raise TimeoutError("offline fixture timeout")

    item = candidate("Delta Srl", "delta.test", "funding", "generic")
    adapter = PagedAdapter(capability("generic", ("funding",)), [[item]])
    result = asyncio.run(UniversalSourceOrchestrator(SourceCapabilityRegistry((adapter,))).run(
        request(Broken({}), tmp_path / "broken.sqlite"),
    ))
    assert result.progress.qualified_count == 0
    assert result.rejection_codes == {"SEMANTIC_TIMEOUT": 1}


@pytest.mark.parametrize("adapter_id", (
    "generic_web_research_v1", "structured_hiring_v1",
    "public_procurement_v1", "official_growth_signals_v1",
))
def test_semantic_authority_is_common_to_every_adapter_path(tmp_path: Path, adapter_id: str) -> None:
    item = candidate("Gamma Banca", "gamma.test", "funding", adapter_id)
    excerpt = item.evidence[0].excerpt
    model = Model(event(excerpt, company="Gamma Banca", role="provider", query_match=False))
    adapter = PagedAdapter(capability(adapter_id, ("funding",)), [[item]])
    result = asyncio.run(UniversalSourceOrchestrator(SourceCapabilityRegistry((adapter,))).run(
        request(model, tmp_path / f"{adapter_id}.sqlite"),
    ))
    assert result.progress.qualified_count == 0
    assert result.rejection_codes in (
        {"ACTOR_ROLE_EXCLUDED": 1},
        {"PAGE_FETCH_PROVENANCE_MISSING": 1},
        {"TARGET_ROLE_UNVERIFIED": 1},
    )
