from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import date

from backend_mirror.source_adapters.contracts import ContactRecord, EvidenceRecord, OpportunityCandidate
from backend_mirror.source_adapters.opportunity_scoring import WEIGHTS, rank_opportunities, score_opportunity
from backend_mirror.source_adapters.orchestrator import default_candidate_qualifier


TODAY = date(2026, 7, 15)


def evidence(
    *,
    source_class: str = "official_company_website",
    published_at: str = "2026-07-14",
    confidence: float = 0.96,
    proof_level: str = "direct",
) -> EvidenceRecord:
    return EvidenceRecord(
        signal_id="hiring",
        source_url="https://acme.example/careers/sales-manager",
        source_publisher="Acme S.r.l.",
        source_class=source_class,
        excerpt="Acme ricerca un Sales Manager a Milano con inserimento immediato.",
        observed_at="2026-07-15",
        published_at=published_at,
        extraction_method="structured_json_ld",
        confidence=confidence,
        provenance={"proof_level": proof_level},
    )


def candidate(**changes: object) -> OpportunityCandidate:
    base = OpportunityCandidate(
        canonical_company_name="Acme S.r.l.",
        company_identifiers={"vat": "IT00000000000"},
        official_domain="acme.example",
        entity_class="operating_company",
        geographies=("Milano",),
        buyer_fit=0.96,
        signal_id="hiring",
        signal_date="2026-07-14",
        evidence=(evidence(),),
        why_now="La selezione commerciale indica capacità e urgenza di crescita.",
        contacts=(ContactRecord("email", "sales@acme.example", "https://acme.example/contatti", True),),
        confidence=0.96,
        contradiction_flags=(),
        provenance={
            "urgency_score": 0.95, "causality_score": 0.94, "commercial_value_score": 0.86,
            "domain_verification": {
                "status": "verified", "confidence": 0.96, "score": 96,
                "evidence": ("schema_org_identity_match", "official_page_host_match"),
                "resolution_source": "source_adapter", "resolution_method": "verified_source_adapter",
                "adapter_id": "structured_hiring_v1", "url": "https://acme.example/",
            },
        },
        adapter_id="structured_hiring_v1",
        adapter_version="1.0.0",
        official_domain_verified=True,
        official_domain_confidence=0.96,
    )
    return replace(base, **changes)


def test_weights_are_complete_and_normalized() -> None:
    assert set(WEIGHTS) == {
        "buyer_fit", "signal_strength", "freshness", "source_reliability",
        "evidence_completeness", "urgency", "problem_offer_causality",
        "commercial_value", "contactability", "confidence",
    }
    assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-12


def test_direct_recent_first_party_opportunity_is_top_tier() -> None:
    result = score_opportunity(candidate(), today=TODAY)
    assert result.total >= 0.85
    assert result.top_tier is True
    assert result.critical_missing == ()
    assert any(reason.startswith("signal_strength=") for reason in result.explanation())


def test_critical_missing_fields_cannot_be_compensated() -> None:
    incomplete = candidate(
        official_domain=None,
        official_domain_verified=False,
        official_domain_confidence=0.0,
        buyer_fit=None,
        signal_date=None,
        evidence=(),
        confidence=1.0,
        provenance={"urgency_score": 1.0, "causality_score": 1.0, "commercial_value_score": 1.0},
    )
    result = score_opportunity(incomplete, today=TODAY)
    assert set(result.critical_missing) == {"official_domain", "buyer_fit", "evidence", "freshness"}
    assert result.total <= 0.49
    assert result.top_tier is False


def test_stale_evidence_scores_below_fresh_evidence() -> None:
    stale = candidate(signal_date="2025-01-01", evidence=(evidence(published_at="2025-01-01"),))
    assert score_opportunity(stale, today=TODAY).total < score_opportunity(candidate(), today=TODAY).total


def test_query_freshness_horizon_is_preserved_for_recent_observed_events() -> None:
    observed = candidate(
        signal_id="production_expansion",
        signal_date="2026-03-17",
        evidence=(evidence(published_at="2026-03-17", proof_level="direct"),),
        provenance={
            **candidate().provenance,
            "freshness_horizon_days": 180,
            "urgency_score": 0.80,
            "causality_score": 0.82,
        },
    )
    inherited = score_opportunity(observed, today=TODAY)
    hard_ninety = score_opportunity(observed, today=TODAY, freshness_horizon_days=90)
    inherited_freshness = next(item.value for item in inherited.components if item.name == "freshness")
    assert inherited_freshness > 0.30
    assert inherited.total > hard_ninety.total


def test_contradictions_and_weak_sources_are_visible_penalties() -> None:
    weak = candidate(
        contradiction_flags=("company_name_mismatch", "geography_mismatch"),
        evidence=(evidence(source_class="directory", proof_level=""),),
    )
    strong = score_opportunity(candidate(), today=TODAY)
    result = score_opportunity(weak, today=TODAY)
    assert result.total < strong.total
    assert result.penalties["contradictions"] == 0.16
    source = next(item for item in result.components if item.name == "source_reliability")
    assert source.value == 0.20


def test_missing_noncritical_commercial_fields_are_explained() -> None:
    result = score_opportunity(candidate(contacts=(), provenance={}), today=TODAY)
    assert {"contactability", "commercial_value", "explicit_problem_offer_causality"}.issubset(result.missing_fields)
    assert any(reason.startswith("missing=") for reason in result.explanation())


def test_ranking_is_deterministic_and_score_descending() -> None:
    high = candidate(canonical_company_name="Zulu S.r.l.")
    low = candidate(
        canonical_company_name="Alpha S.r.l.",
        evidence=(evidence(source_class="directory", proof_level=""),),
        contradiction_flags=("weak_identity",),
        contacts=(),
    )
    ranked = rank_opportunities((low, high))
    assert [item[0].canonical_company_name for item in ranked] == ["Zulu S.r.l.", "Alpha S.r.l."]
    assert ranked[0][1].total > ranked[1][1].total


def test_default_qualifier_exposes_score_and_rejects_low_value() -> None:
    accepted = asyncio.run(default_candidate_qualifier(candidate()))
    assert accepted.qualified is True
    assert accepted.opportunity_value_score >= 0.85
    assert "canonical_gate_passed" in accepted.reasons

    low = candidate(
        signal_date="2025-01-01",
        evidence=(evidence(source_class="directory", published_at="2025-01-01", confidence=0.70, proof_level=""),),
        contacts=(),
        contradiction_flags=("weak_identity", "weak_signal"),
        provenance={
            "domain_verification": {
                "status": "verified", "confidence": 0.96, "score": 96,
                "evidence": ("schema_org_identity_match",),
                "resolution_source": "source_adapter", "resolution_method": "verified_source_adapter",
                "adapter_id": "structured_hiring_v1", "url": "https://acme.example/",
            },
        },
        buyer_fit=0.50,
        confidence=0.70,
    )
    rejected = asyncio.run(default_candidate_qualifier(low))
    assert rejected.qualified is False
    assert rejected.rejection_code == "OPPORTUNITY_VALUE_TOO_LOW"
    assert rejected.opportunity_value_score < 0.55
    assert rejected.reasons

    unverified = asyncio.run(default_candidate_qualifier(candidate(
        official_domain_verified=False,
        official_domain_confidence=0.69,
    )))
    assert unverified.qualified is False
    assert unverified.rejection_code == "OFFICIAL_DOMAIN_UNVERIFIED"
