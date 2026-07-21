from __future__ import annotations

import json
from pathlib import Path

from backend_mirror.source_adapters.hypothesis_retrieval_validator import HypothesisRetrievalValidator
from backend_mirror.source_adapters.signal_strategy_planner import DiscoveryStrategy
from backend_mirror.source_adapters.universal_evidence import extract_evidence_from_text


FIXTURE = Path(__file__).parent / "fixtures" / "antincendio_failed_canary_919147ed.json"


def _hypothesis() -> dict:
    return {
        "hypothesis_id": "antincendio-expansion",
        "buyer_archetype": "PMI industriale del Nord Italia",
        "buyer_problem": "nuovi spazi produttivi richiedono una valutazione della sicurezza",
        "expected_outcome": "valutazione di sistemi antincendio industriali",
        "observable_event_types": ("production_expansion",),
        "required_relationships": ("company_opening_or_expanding_facility",),
        "allowed_signal_families": ("production_expansion",),
        "excluded_signal_families": ("funding",),
        "source_classes": ("recognized_news", "official_company_website"),
        "evidence_claim_type": "OBSERVED_EVENT",
        "query_templates": (),
        "expected_yield": "medium",
        "expected_cost": "low",
        "false_positive_risks": ("publisher as target", "association as target"),
    }


def _strategy(query: str) -> DiscoveryStrategy:
    return DiscoveryStrategy(
        strategy_id="production_expansion:fixture",
        signal_type="production_expansion",
        source_class="recognized_news",
        search_query=query,
        preferred_domains=(),
        excluded_domains=(),
        freshness_days=180,
        expected_evidence=("company_name", "event_date", "evidence_excerpt"),
        estimated_cost=0.005,
        priority=1,
        fallback_level=0,
        hypothesis_id="antincendio-expansion",
        event_type="production_expansion",
        evidence_claim_type="OBSERVED_EVENT",
        semantic_justification="production expansion supports the safety-system evaluation hypothesis",
        required_target_role="expanding_company",
        prohibited_roles=("publisher", "association", "investor", "vendor"),
    )


def test_failed_canary_query_trace_is_reconciled_and_leakage_is_zero_cost() -> None:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert len(payload["candidates"]) == 7
    validator = HypothesisRetrievalValidator()
    verdicts = [
        validator.validate(_strategy(item["query"]), (_hypothesis(),))
        for item in payload["provider_queries"]
    ]
    assert verdicts[0].accepted is True
    assert verdicts[1].accepted is False
    assert verdicts[1].code == "STRATEGY_INTENT_LEAKAGE"


def test_only_real_expansion_candidate_reaches_enrichment_boundary() -> None:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    expansion = payload["candidates"][0]
    evidence = extract_evidence_from_text(
        text=f"{expansion['evidence_excerpt']} 20 giugno 2026",
        source_url=expansion["source_url"],
        source_class="recognized_news",
        publisher=expansion["source_publisher"],
        company_name_hint=expansion["company"],
        requested_signals=("production_expansion",),
    )
    expansion_event = next(item for item in evidence if item.event_type == "production_expansion")
    assert expansion_event.company_name == "ECOSYSTEM SpA"
    assert expansion_event.event_date == "2026-06-20"
    assert all(item["event"] == "funding" for item in payload["candidates"][1:])
    assert all(item["expected"] != "QUALIFY" for item in payload["candidates"][1:])
