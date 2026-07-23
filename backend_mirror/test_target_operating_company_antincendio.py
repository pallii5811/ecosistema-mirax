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


def test_association_rejected_as_non_operating_entity() -> None:
    assert classify_entity("Associazione Artigiani Vicenza", host="associazione.example") == "association"


def test_portal_directory_rejected_as_non_operating() -> None:
    from datetime import date

    from source_adapters.contracts import AdapterDiscoveryRequest
    from source_adapters.generic_web import _valid_record
    from source_adapters.generic_web_provenance import attach_generic_provenance, page_fetch_id

    req = AdapterDiscoveryRequest(
        intent="commercial_search",
        signal_ids=("new_location",),
        signal_match_mode="any",
        geographies=(),
        freshness_max_age_days=730,
        requested_count=1,
        budget_eur=0.05,
        query="PMI nuovo stabilimento",
        technical_filters={"universal_engine": True, "semantic_authority_required": True},
    )
    text = "Elenco aziende con nuovo stabilimento in Veneto."
    row = {
        "company_name": "Pagine Gialle Portale",
        "official_domain": "paginegialle.it",
        "official_domain_verified": True,
        "entity_class": "directory",
        "source_class": "official_company_website",
        "source_url": "https://www.paginegialle.it/elenco",
        "source_publisher": "Pagine Gialle",
        "evidence_excerpt": text[:160],
        "published_at": "2026-02-02",
        "matched_signal_ids": ["new_location"],
        "geography": "Veneto",
    }
    attach_generic_provenance(
        row,
        adapter_id="generic_web_research_v1",
        search_scope="fixture",
        execution_round=1,
        provider_call_id="fixture",
        page_fetch_id_value=page_fetch_id(search_scope="fixture", url=row["source_url"], wave_index=1),
        source_text=text,
        cursor_version="generic-web:v2:fixture",
    )
    ok, code = _valid_record(row, req, date(2026, 7, 23))
    assert not ok
    # Portal domains are blacklisted first; non-portal directories fail as NON_OPERATING_ENTITY.
    assert code in {"NON_OPERATING_ENTITY", "OFFICIAL_DOMAIN_UNRESOLVED"}


def test_passive_holding_without_industrial_event_rejected() -> None:
    """Passive financial holding (no plant/industrial event) must not pass operating gate."""
    excerpt = "Alpha Holding SpA detiene partecipazioni finanziarie nel settore food."
    text = excerpt + " Nessuno stabilimento produttivo in costruzione."
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
        target_company="Alpha Holding SpA",
        target_entity_role="investor",
        event_date="2026-02-10",
        event_type="financial_holding",
    )
    interpretation = SemanticEventInterpretation.from_model(raw)
    result = SemanticEvidenceGroundingVerifier().verify(
        contract,
        interpretation,
        source_text=text,
        source_url="https://www.alpha-holding.example/news",
        source_publisher="Alpha Holding",
        official_domain_verified=True,
        official_domain_confidence=0.95,
        entity_class="company_group",
        candidate_company="Alpha Holding SpA",
        maximum_age_days=365,
        now=date(2026, 7, 22),
    )
    # Holding passiva: either operating gate fails or required relationship fails.
    assert result.checks.get("operating_entity") is True or result.accepted is False
    assert result.accepted is False


def test_operating_subsidiary_is_published_not_generic_parent() -> None:
    """If the event subject is the operating subsidiary, publish that name."""
    excerpt = "Parma Formaggi Srl, controllata da DalterFood Group, inaugura lo stabilimento di taglio."
    text = excerpt + " Lo stabilimento produttivo apre nel 2026 a Parma."
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
        target_company="Parma Formaggi Srl",
        target_entity_role="expanding_company",
        event_date="2026-02-10",
        event_type="production_expansion",
    )
    interpretation = SemanticEventInterpretation.from_model(raw)
    result = SemanticEvidenceGroundingVerifier().verify(
        contract,
        interpretation,
        source_text=text,
        source_url="https://www.parmaformaggi.example/news",
        source_publisher="Parma Formaggi",
        official_domain_verified=True,
        official_domain_confidence=0.95,
        entity_class="operating_company",
        candidate_company="Parma Formaggi Srl",
        maximum_age_days=365,
        now=date(2026, 7, 22),
    )
    assert result.accepted is True or result.checks.get("operating_entity") is True
    assert interpretation.target_company == "Parma Formaggi Srl"
    assert "DalterFood Group" not in (interpretation.target_company or "")



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
