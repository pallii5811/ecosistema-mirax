"""Offline regressions for seller-driven inferred open-world recall-first path.

Uses the real case A raw query + SERP failure mode from search
26272264-186a-45cd-84a2-cc930a7a0e83. Zero external calls.
"""
from __future__ import annotations

from types import SimpleNamespace

from backend_mirror.source_adapters.cheap_discovery_prefilter import (
    DiscoveryHit,
    looks_plausible_industrial_fetch,
    prefilter_discovery_hit,
)
from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest
from backend_mirror.source_adapters.generic_web import _gate_serp_hits
from backend_mirror.source_adapters.hypothesis_retrieval_validator import HypothesisRetrievalValidator
from backend_mirror.source_adapters.signal_strategy_planner import (
    plan_strategies,
    strip_seller_offer_from_query,
)
from backend_mirror.source_adapters.universal_query_spec import compile_universal_query_spec


CASE_A_RAW_QUERY = (
    "Vendiamo manutenzione predittiva alle PMI industriali. "
    "Trovami aziende italiane non enormi che hanno ampliato fabbriche, "
    "automatizzato linee o installato nuovi macchinari recentemente, "
    "con un contatto pubblico."
)

# Reconstructed from the live failure mode: 2 industrial SERP hits rejected as no_event_hint.
CASE_A_SERP_HITS = [
    {
        "title": "Rossi Meccanica Srl — Chi siamo",
        "url": "https://www.rossimeccanica.it/chi-siamo",
        "snippet": "Azienda manifatturiera italiana specializzata in componenti industriali e officina di precisione.",
    },
    {
        "title": "Investimenti e sviluppo — Bianchi Impianti Spa",
        "url": "https://www.bianchi-impianti.it/news/piano-2025",
        "snippet": "Il gruppo industriale conferma il piano di sviluppo della sede produttiva per il 2025.",
    },
]


def _case_a_plan() -> dict:
    return {
        "original_query": CASE_A_RAW_QUERY,
        "raw_query": CASE_A_RAW_QUERY,
        "requested_count": 3,
        "search_strategy": "organic_web_search",
        "seller": {
            "offer_category": "Predictive Maintenance",
            "offer_description": "Predictive maintenance solutions for industrial equipment and production lines",
            "products_or_services": ["Predictive maintenance solutions", "Maintenance analytics"],
        },
        "target": {
            "industries": ["Manufacturing", "Industrial production"],
            "geographies": ["Italy", "Italia"],
            "excluded_entities": ["large_enterprises", "multinational_corporations"],
        },
        "signal_policy": {"required_signals": [], "optional_signals": [], "negative_signals": []},
        "source_policy": {
            "preferred_source_classes": [
                "official_company_website",
                "recognized_local_news",
                "industry_publication",
            ]
        },
        "budget_policy": {"hard_cost_eur": 0.075, "target_cost_eur": 0.063},
        "commercial_hypotheses": [
            {
                "id": "semantic-open-world",
                "buyer_problem": "Recent factory expansion, production line automation, or new machinery installation",
                "triggering_events": [
                    "Recent factory expansion, production line automation, or new machinery installation"
                ],
                "signals": [],
                "implied_need": "Public contact information available",
                "evidence_claim_type": "OBSERVED_EVENT",
            }
        ],
        "semantic_query_contract": {
            "original_query": CASE_A_RAW_QUERY,
            "event_or_state_description": (
                "Recent factory expansion, production line automation, or new machinery installation"
            ),
            "target_role_in_event": "equipment_operator",
            "required_relationships": [
                "factory_expansion_by_target_company",
                "production_line_automation_by_target_company",
                "new_machinery_installation_by_target_company",
            ],
            "seller": {
                "offer_category": "Predictive Maintenance",
                "products_or_services": ["Predictive maintenance solutions"],
            },
            "offer": {"description": "Predictive maintenance solutions for industrial equipment"},
        },
    }


def test_case_a_is_seller_driven_inferred_not_explicit_demand() -> None:
    plan = _case_a_plan()
    spec = compile_universal_query_spec(plan, requested_count=3, hard_cap_eur=0.075)
    assert plan["search_strategy"] != "explicit_demand"
    assert "manutenzione predittiva" in CASE_A_RAW_QUERY.casefold()
    # Evidence claim remains observed-event / inferred buyer trigger, not direct demand.
    assert all(
        str(item.get("evidence_claim_type") or "").upper() != "DIRECT_DEMAND"
        for item in spec.hypothesis_contracts
    )
    assert set(spec.required_signals) == {
        "factory_expansion_by_target_company",
        "production_line_automation_by_target_company",
        "new_machinery_installation_by_target_company",
    }


def test_provider_queries_exclude_seller_offer_as_target_requirement() -> None:
    spec = compile_universal_query_spec(_case_a_plan(), requested_count=3, hard_cap_eur=0.075)
    strategies = plan_strategies(spec)
    assert strategies
    for item in strategies:
        low = item.search_query.casefold()
        assert "manutenzione predittiva" not in low
        assert "predictive maintenance" not in low
        assert "new machinery installation by target company" not in low
        assert "production line automation by target company" not in low
        assert "factory expansion by target company" not in low
    # Buyer-trigger families must appear as Italian evidence terms.
    joined = " | ".join(item.search_query.casefold() for item in strategies)
    assert "ampliamento" in joined or "stabilimento" in joined
    assert "automazione" in joined or "linea di produzione" in joined or "industria 4.0" in joined
    assert "macchinari" in joined or "impianto" in joined or "revamping" in joined


def test_plausible_serp_hits_reach_fetch_gate() -> None:
    for raw in CASE_A_SERP_HITS:
        hit = DiscoveryHit(title=raw["title"], url=raw["url"], snippet=raw["snippet"])
        assert looks_plausible_industrial_fetch(hit)
        decision = prefilter_discovery_hit(hit, require_event_hint=True)
        assert decision.accepted, decision.reason
        assert decision.reason in {"accepted", "accepted_deferred_event_proof"}

    request = AdapterDiscoveryRequest(
        intent="commercial_search",
        signal_ids=(
            "factory_expansion_by_target_company",
            "new_machinery_installation_by_target_company",
        ),
        signal_match_mode="any",
        geographies=("Italia",),
        freshness_max_age_days=365,
        requested_count=3,
        budget_eur=0.05,
        query=CASE_A_RAW_QUERY,
        technical_filters={"universal_engine": True, "universal_prefilter_telemetry": {}},
    )
    accepted = _gate_serp_hits(request, CASE_A_SERP_HITS, provider_query="ampliamento produttivo Italia")
    assert len(accepted) == 2
    assert all(item.url for item in accepted)


def test_event_proof_still_required_semantics_after_fetch_helper() -> None:
    # Pages without a real event remain rejectable by the strict event checkers.
    from backend_mirror.source_adapters.cheap_discovery_prefilter import has_concrete_expansion_event

    no_event_body = "Chi siamo. Storia dell'azienda e valori del gruppo manifatturiero."
    assert has_concrete_expansion_event("Rossi Meccanica", no_event_body) is False
    with_event = "Rossi Meccanica inaugura un nuovo stabilimento a Vicenza nel 2026"
    assert has_concrete_expansion_event(with_event) is True


def test_directory_and_vendor_noise_still_excluded() -> None:
    directory = prefilter_discovery_hit(
        DiscoveryHit("Elenco aziende", "https://www.paginegialle.it/milano/x", "officine")
    )
    assert directory.accepted is False
    assert directory.reason == "directory"
    famous = prefilter_discovery_hit(
        DiscoveryHit("Ferrero amplia stabilimento", "https://news.test/ferrero", "Ferrero inaugura ampliamento 2026")
    )
    assert famous.accepted is False
    assert famous.reason == "famous_or_global_brand"


def test_insufficient_pool_produces_signal_family_query_variants() -> None:
    spec = compile_universal_query_spec(_case_a_plan(), requested_count=3, hard_cap_eur=0.075)
    strategies = plan_strategies(spec)
    families = {item.signal_type for item in strategies}
    assert "factory_expansion_by_target_company" in families
    assert "production_line_automation_by_target_company" in families
    assert "new_machinery_installation_by_target_company" in families
    # Multiple deterministic variants per family (not a single contaminated query).
    assert len(strategies) >= 12


def test_processed_urls_are_not_duplicated_in_gate() -> None:
    request = AdapterDiscoveryRequest(
        intent="commercial_search",
        signal_ids=("factory_expansion_by_target_company",),
        signal_match_mode="any",
        geographies=("Italia",),
        freshness_max_age_days=365,
        requested_count=3,
        budget_eur=0.05,
        query="ampliamento",
        technical_filters={"universal_engine": True, "universal_prefilter_telemetry": {}},
    )
    duped = CASE_A_SERP_HITS + CASE_A_SERP_HITS
    accepted = _gate_serp_hits(request, duped, provider_query="ampliamento produttivo")
    urls = [item.url for item in accepted]
    assert len(urls) == len(set(urls))


def test_intent_leakage_strips_seller_terms_without_auto_rejecting_strategy() -> None:
    spec = compile_universal_query_spec(_case_a_plan(), requested_count=3, hard_cap_eur=0.075)
    dirty = (
        'site:.it ("comunicato stampa") ("manutenzione predittiva") '
        '("nuovo stabilimento") Italia Manufacturing'
    )
    clean = strip_seller_offer_from_query(dirty, spec)
    assert "manutenzione predittiva" not in clean.casefold()
    assert "nuovo stabilimento" in clean.casefold()
    strategies = plan_strategies(spec)
    validator = HypothesisRetrievalValidator()
    accepted = 0
    for item in strategies:
        verdict = validator.validate(item, spec.hypothesis_contracts)
        if verdict.accepted:
            accepted += 1
    assert accepted >= 6, "enough signal-family strategies must pass validation to avoid false exhaustion"


def test_source_exhaustion_requires_all_signal_strategies_not_two_hits() -> None:
    # A single contaminated query yielding 2 dead SERP hits is not honest exhaustion
    # when other signal-family strategies remain unattempted.
    spec = compile_universal_query_spec(_case_a_plan(), requested_count=3, hard_cap_eur=0.075)
    strategies = plan_strategies(spec)
    executed = {"new_machinery_installation_by_target_company:company_owned"}
    remaining = [item.strategy_id for item in strategies if item.strategy_id not in executed]
    assert remaining, "cursor reopen must still have signal-family variants"
    assert any("factory_expansion" in item for item in remaining)
    assert any("automation" in item or "macchin" in item or "machinery" in item for item in remaining)


def test_generic_homepage_without_industrial_cue_still_hard_rejects() -> None:
    hit = DiscoveryHit("Acme homepage", "https://www.acme.test/", "chi siamo storia")
    decision = prefilter_discovery_hit(hit, require_event_hint=True)
    assert decision.accepted is False
    assert decision.reason == "no_event_hint"
