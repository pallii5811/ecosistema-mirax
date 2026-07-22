from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace

from backend_mirror.source_adapters.generic_web import _shell_recovery_query
from backend_mirror.source_adapters.hypothesis_retrieval_validator import HypothesisRetrievalValidator
from backend_mirror.source_adapters.signal_strategy_planner import (
    DiscoveryStrategy,
    hypothesis_contracts_for_spec,
    plan_strategies,
)
from backend_mirror.source_adapters.universal_query_spec import UniversalQuerySpec


def _hypothesis(signal: str, *, prohibited_roles: tuple[str, ...] = ()) -> dict:
    return {
        "hypothesis_id": f"hyp-{signal}",
        "buyer_archetype": "target operating company",
        "buyer_problem": "verified commercial problem",
        "expected_outcome": "relevant solution evaluation",
        "observable_event_types": (signal,),
        "required_relationships": (f"company_has_{signal}",),
        "allowed_signal_families": (signal,),
        "excluded_signal_families": (),
        "source_classes": ("recognized_news", "official_company_website"),
        "evidence_claim_type": "OBSERVED_EVENT",
        "query_templates": (),
        "expected_yield": "medium",
        "expected_cost": "low",
        "false_positive_risks": prohibited_roles,
    }


def _strategy(signal: str, query: str, *, prohibited_roles: tuple[str, ...] = ()) -> DiscoveryStrategy:
    return DiscoveryStrategy(
        strategy_id=f"{signal}:test",
        signal_type=signal,
        source_class="recognized_news",
        search_query=query,
        preferred_domains=(),
        excluded_domains=(),
        freshness_days=180,
        expected_evidence=("source_url", "evidence_excerpt"),
        estimated_cost=0.005,
        priority=1,
        fallback_level=0,
        hypothesis_id=f"hyp-{signal}",
        event_type=signal,
        semantic_justification="observable event supports the buyer problem",
        required_target_role="target_operating_company",
        prohibited_roles=prohibited_roles,
    )


def test_expansion_contaminated_by_generic_funding_is_blocked_before_provider() -> None:
    verdict = HypothesisRetrievalValidator().validate(
        _strategy("production_expansion", 'startup Italia "chiude un round" funding'),
        (_hypothesis("production_expansion"),),
    )
    assert not verdict.accepted
    assert verdict.code == "STRATEGY_INTENT_LEAKAGE"
    assert any("cross_intent_query_terms:funding" in item for item in verdict.reasons)


def test_hiring_contaminated_by_procurement_is_blocked() -> None:
    verdict = HypothesisRetrievalValidator().validate(
        _strategy("hiring_sales", 'Italia bando gara appalto commerciale'),
        (_hypothesis("hiring_sales"),),
    )
    assert not verdict.accepted
    assert "cross_intent_query_terms:procurement" in verdict.reasons


def test_funding_recipient_cannot_be_inverted_with_investor() -> None:
    strategy = _strategy(
        "funding",
        'investitore venture capital Italia funding round',
        prohibited_roles=("investor",),
    )
    verdict = HypothesisRetrievalValidator().validate(
        strategy,
        (_hypothesis("funding", prohibited_roles=("investor",)),),
    )
    assert not verdict.accepted
    assert "prohibited_role_in_query:investor" in verdict.reasons


def test_crm_migration_cannot_degrade_to_generic_technology_news() -> None:
    verdict = HypothesisRetrievalValidator().validate(
        _strategy("technology_adoption", "notizie tecnologia aziende italiane"),
        (_hypothesis("technology_adoption"),),
    )
    assert not verdict.accepted
    assert "query_does_not_support_event" in verdict.reasons


def test_marketing_weakness_cannot_degrade_to_unrelated_growth_news() -> None:
    verdict = HypothesisRetrievalValidator().validate(
        _strategy("website_weakness", "aziende italiane crescita nuove sedi"),
        (_hypothesis("website_weakness"),),
    )
    assert not verdict.accepted
    assert "query_does_not_support_event" in verdict.reasons


def test_antincendio_expansion_strategies_are_bound_and_funding_free() -> None:
    spec = UniversalQuerySpec(
        original_query="Installiamo sistemi antincendio industriali. Trovami PMI con nuovi stabilimenti.",
        seller_profile="industrial fire protection seller",
        seller_offer="sistemi antincendio industriali",
        target_company_profile="PMI industriali del Nord Italia",
        target_industries=("manifatturiero",),
        target_geographies=("Nord Italia",),
        buyer_roles=("RSPP", "operations"),
        business_problem="nuovi spazi produttivi richiedono una valutazione della sicurezza",
        requested_count=3,
        freshness_days=180,
        required_signals=("production_expansion", "geographic_expansion"),
        optional_signals=("new_location",),
        excluded_entities=("publisher", "association"),
        source_preferences=("official_company_website", "recognized_news"),
        evidence_requirements=("official_domain", "source_url", "event_excerpt"),
        cost_budget=0.10,
        capability_status="SUPPORTED_PARTIAL",
        required_target_role="expanding_company",
        prohibited_roles=("publisher", "association", "vendor"),
    )
    hypotheses = hypothesis_contracts_for_spec(spec)
    strategies = plan_strategies(spec)
    validator = HypothesisRetrievalValidator()
    valid = [item for item in strategies if validator.validate(item, hypotheses).accepted]
    assert valid
    assert all(item.hypothesis_id for item in valid)
    assert all("funding round" not in item.search_query.casefold() for item in valid)
    assert all("chiude un round" not in item.search_query.casefold() for item in valid)
    industrial = [item for item in valid if "industrial_expansion" in item.strategy_id]
    assert industrial
    from datetime import date
    from backend_mirror.source_adapters.signal_strategy_planner import _expansion_year_clause

    assert _expansion_year_clause(365) == f"({date.today().year - 1} OR {date.today().year})"
    if date.today().month > 3:
        assert _expansion_year_clause(180) == f"({date.today().year})"
    # Spec freshness_days=180 → industrial queries follow that window.
    expected_years = _expansion_year_clause(spec.freshness_days)
    assert all(expected_years in item.search_query for item in industrial)


def test_content_shell_recovery_stays_on_active_expansion_hypothesis() -> None:
    strategy = _strategy(
        "production_expansion",
        'Italia "nuovo stabilimento" OR "ampliamento produttivo"',
    )
    request = SimpleNamespace(
        query="Installiamo sistemi antincendio industriali",
        signal_ids=("production_expansion",),
        technical_filters={"universal_active_strategies": [strategy.to_dict()]},
    )
    query = _shell_recovery_query("Acme Srl", failed_host="example.it", request=request)
    assert "nuovo stabilimento" in query.casefold()
    assert "funding" not in query.casefold()
    assert "round" not in query.casefold()


def test_content_shell_without_bound_hypothesis_does_not_spend_on_fallback() -> None:
    request = SimpleNamespace(
        query="generic search",
        signal_ids=("production_expansion",),
        technical_filters={},
    )
    assert _shell_recovery_query("Acme Srl", failed_host="example.it", request=request) == ""
