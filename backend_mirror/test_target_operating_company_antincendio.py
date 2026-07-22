from __future__ import annotations

from datetime import date

from backend_mirror.agents.entity_identity_resolver import classify_entity
from backend_mirror.semantic_intelligence import (
    SemanticEventInterpretation,
    SemanticEvidenceGroundingVerifier,
    SemanticQueryContract,
)
from backend_mirror.source_adapters.contracts import OpportunityCandidate
from backend_mirror.source_adapters.generic_web import _serp_company_hint
from backend_mirror.source_adapters.orchestrator import _semantic_qualification_priority
from backend_mirror.test_semantic_intelligence import event_payload, query_payload


def test_company_group_passes_operating_entity_gate() -> None:
    excerpt = "DalterFood Group inaugura a Parma il nuovo stabilimento per il formaggio."
    text = excerpt + " Lo stabilimento produttivo apre nel 2026."
    contract = SemanticQueryContract.from_model(
        query_payload(
            target_role_in_event="expanding_company",
            event_or_state_description="nuovo stabilimento or production expansion",
            required_relationships=["company_opening_or_expanding_facility"],
            excluded_roles=["publisher", "association", "advisor", "investor"],
        ),
        original_query="PMI Nord Italia nuovo stabilimento",
        requested_count=3,
    )
    raw = event_payload(
        excerpt,
        target_company="DalterFood Group",
        target_entity_role="expanding_company",
        event_date="2026-02-10",
        event_type="production_expansion",
    )
    interpretation = SemanticEventInterpretation.from_model(raw)
    result = SemanticEvidenceGroundingVerifier().verify(
        contract,
        interpretation,
        source_text=text,
        source_url="https://www.dalterfood.com/news",
        source_publisher="DalterFood",
        official_domain_verified=True,
        official_domain_confidence=0.95,
        entity_class="company_group",
        candidate_company="DalterFood Group",
        maximum_age_days=365,
        now=date(2026, 7, 22),
    )
    assert result.checks.get("operating_entity") is True


def test_cdo_classified_as_association_not_operating_company() -> None:
    assert classify_entity("CDO Bergamo", host="cdobg.it") == "association"
    assert classify_entity("Compagnia delle Opere Bergamo", host="cdobg.it") == "association"


def test_serp_hint_recovers_company_after_di_preposition() -> None:
    hint = _serp_company_hint(
        title="A Brembate nuovo stabilimento farmaceutico di Fine Foods",
        snippet="Taglio del nastro al nuovo stabilimento Fine Foods a Brembate.",
        url="https://www.bergamonews.it/2026/06/08/fine-foods",
    )
    assert "Fine Foods" in hint


def test_semantic_priority_prefers_verified_operating_company() -> None:
    weak = OpportunityCandidate(
        canonical_company_name="Noise Portal",
        company_identifiers={},
        official_domain="",
        entity_class="directory",
        geographies=(),
        buyer_fit=None,
        signal_id="production_expansion",
        signal_date=None,
        evidence=(),
        why_now="",
        contacts=(),
        confidence=0.9,
        contradiction_flags=(),
        provenance={},
        adapter_id="generic_web_research_v1",
        adapter_version="1",
        official_domain_verified=False,
        official_domain_confidence=0.0,
    )
    strong = OpportunityCandidate(
        canonical_company_name="Tironi",
        company_identifiers={},
        official_domain="tironi.com",
        entity_class="operating_company",
        geographies=("Emilia-Romagna",),
        buyer_fit=None,
        signal_id="production_expansion",
        signal_date="2025-05-01",
        evidence=(),
        why_now="nuovo stabilimento",
        contacts=(),
        confidence=0.55,
        contradiction_flags=(),
        provenance={},
        adapter_id="generic_web_research_v1",
        adapter_version="1",
        official_domain_verified=True,
        official_domain_confidence=0.9,
    )
    assert _semantic_qualification_priority(strong) > _semantic_qualification_priority(weak)
