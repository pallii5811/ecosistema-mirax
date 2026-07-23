"""Universal QuerySpec — commercial NL → structured buying-signal research plan."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple


SOURCE_CLASSES: Tuple[str, ...] = (
    "official_company_website",
    "corporate_newsroom",
    "public_registry",
    "procurement_registry",
    "job_board",
    "institutional_source",
    "recognized_news",
    "industry_publication",
    "technology_evidence",
    "generic_web_research",
)


@dataclass(frozen=True)
class UniversalQuerySpec:
    """Canonical commercial research brief for the universal signal engine."""

    original_query: str
    seller_profile: str
    seller_offer: str
    target_company_profile: str
    target_industries: Tuple[str, ...]
    target_geographies: Tuple[str, ...]
    buyer_roles: Tuple[str, ...]
    business_problem: str
    requested_count: int
    freshness_days: int
    required_signals: Tuple[str, ...]
    optional_signals: Tuple[str, ...]
    excluded_entities: Tuple[str, ...]
    source_preferences: Tuple[str, ...]
    evidence_requirements: Tuple[str, ...]
    cost_budget: float
    capability_status: str
    commercial_hypotheses: Tuple[str, ...] = ()
    hypothesis_contracts: Tuple[Mapping[str, Any], ...] = ()
    required_target_role: str = "target_operating_company"
    prohibited_roles: Tuple[str, ...] = ()
    observability_notes: Tuple[str, ...] = ()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _tuple_str(value: Any) -> Tuple[str, ...]:
    if isinstance(value, str):
        text = value.strip()
        return (text,) if text else ()
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        return tuple(dict.fromkeys(str(item).strip() for item in value if str(item).strip()))
    return ()


def _cost_budget(requested_count: int, hard_cap: float = 0.125) -> float:
    # Target €0.025 per accepted lead; hard canary cap €0.125 for count=5.
    scaled = max(1, int(requested_count)) * 0.025
    return round(min(hard_cap, scaled), 6)


def compile_universal_query_spec(
    plan: Mapping[str, Any],
    *,
    requested_count: Optional[int] = None,
    hard_cap_eur: float = 0.125,
) -> UniversalQuerySpec:
    """Compile UniversalQuerySpec from a validated CommercialSearchPlan mapping."""
    seller = plan.get("seller") if isinstance(plan.get("seller"), Mapping) else {}
    target = plan.get("target") if isinstance(plan.get("target"), Mapping) else {}
    signal_policy = plan.get("signal_policy") if isinstance(plan.get("signal_policy"), Mapping) else {}
    semantic_contract = plan.get("semantic_query_contract") if isinstance(plan.get("semantic_query_contract"), Mapping) else {}
    source_policy = plan.get("source_policy") if isinstance(plan.get("source_policy"), Mapping) else {}
    evidence_policy = plan.get("evidence_policy") if isinstance(plan.get("evidence_policy"), Mapping) else {}
    budget_policy = plan.get("budget_policy") if isinstance(plan.get("budget_policy"), Mapping) else {}
    ranking = plan.get("ranking_policy") if isinstance(plan.get("ranking_policy"), Mapping) else {}

    required = _tuple_str(signal_policy.get("required_signals") or plan.get("required_signals"))
    if not required and semantic_contract:
        required = _tuple_str(semantic_contract.get("required_relationships"))
    optional = _tuple_str(signal_policy.get("optional_signals"))
    if not required:
        raise ValueError("UniversalQuerySpec requires at least one required_signal")

    count = int(requested_count if requested_count is not None else plan.get("requested_count") or 1)
    if count < 1:
        raise ValueError("requested_count must be >= 1")

    ages = signal_policy.get("maximum_age_days_by_signal")
    freshness = 90
    if isinstance(ages, Mapping) and ages:
        freshness = min(int(ages[key]) for key in required if key in ages) if any(key in ages for key in required) else 90
    elif evidence_policy.get("max_age_days") is not None:
        freshness = int(evidence_policy["max_age_days"])
    elif ranking.get("max_signal_age_days") is not None:
        freshness = int(ranking["max_signal_age_days"])

    hard = float(budget_policy.get("hard_cost_eur") or hard_cap_eur)
    budget = min(_cost_budget(count, hard_cap=hard_cap_eur), hard)

    hypotheses = []
    hypothesis_contracts: List[Mapping[str, Any]] = []
    for item in plan.get("commercial_hypotheses") or ():
        if isinstance(item, Mapping):
            text = str(item.get("buyer_problem") or item.get("implied_need") or "").strip()
            if text:
                hypotheses.append(text)
            signals = _tuple_str(item.get("signals") or item.get("allowed_signal_families") or required)
            events = _tuple_str(item.get("triggering_events") or item.get("observable_event_types") or signals)
            # Prefer canonical relationship/signal IDs over free-text English prose.
            if events and all((" " in value and len(value) > 24) for value in events):
                events = signals or events
            preferred_sources = _tuple_str(
                item.get("source_classes") or source_policy.get("preferred_source_classes")
            )
            allowed_sources = _tuple_str(source_policy.get("allowed_source_classes"))
            # Open-world relationship strategies also use newsroom/publication classes.
            lexicon_sources: List[str] = []
            try:
                from source_adapters.signal_strategy_planner import _lexicon
            except Exception:  # pragma: no cover - import path differs in package installs
                from backend_mirror.source_adapters.signal_strategy_planner import _lexicon
            for signal in signals or required:
                lexicon_sources.extend(str(src) for src in (_lexicon(signal).get("sources") or ()))
            source_classes = tuple(
                dict.fromkeys(
                    (
                        *preferred_sources,
                        *allowed_sources,
                        *lexicon_sources,
                        "recognized_news",
                        "official_company_website",
                        "industry_publication",
                        "corporate_newsroom",
                        "generic_web_research",
                    )
                )
            )
            hypothesis_id = str(item.get("hypothesis_id") or item.get("id") or "").strip()
            if hypothesis_id:
                hypothesis_contracts.append({
                    "hypothesis_id": hypothesis_id,
                    "buyer_archetype": str(
                        item.get("buyer_archetype")
                        or semantic_contract.get("target_company_description")
                        or "target operating company"
                    ).strip(),
                    "buyer_problem": text or "commercial problem supported by observable evidence",
                    "expected_outcome": str(item.get("expected_outcome") or item.get("implied_need") or "").strip(),
                    "observable_event_types": events,
                    "required_relationships": _tuple_str(
                        item.get("required_relationships")
                        or semantic_contract.get("required_relationships")
                        or signals
                    ),
                    "allowed_signal_families": signals,
                    "excluded_signal_families": _tuple_str(
                        item.get("excluded_signal_families") or signal_policy.get("negative_signals")
                    ),
                    "source_classes": source_classes,
                    "evidence_claim_type": str(
                        item.get("evidence_claim_type")
                        or ("DIRECT_DEMAND" if plan.get("search_strategy") == "explicit_demand" else "OBSERVED_EVENT")
                    ).strip().upper(),
                    "query_templates": _tuple_str(item.get("query_templates")),
                    "expected_yield": str(item.get("expected_yield") or "medium"),
                    "expected_cost": str(item.get("expected_cost") or "low"),
                    "false_positive_risks": _tuple_str(item.get("false_positive_risks")),
                })

    evidence_reqs: List[str] = []
    if evidence_policy.get("require_official_domain", True):
        evidence_reqs.append("official_domain")
    if evidence_policy.get("require_source_url", True):
        evidence_reqs.append("source_url")
    if evidence_policy.get("require_observed_at", True):
        evidence_reqs.append("observed_at")
    evidence_reqs.append("event_excerpt")

    geographies = _tuple_str(target.get("geographies") or plan.get("location") or ("italy",))
    industries = _tuple_str(target.get("industries") or plan.get("sector"))
    buyer_roles = _tuple_str(seller.get("preferred_buyer_roles") or target.get("required_attributes"))

    observability = []
    for signal in required:
        observability.append(f"observable_signal:{signal}")

    return UniversalQuerySpec(
        original_query=str(plan.get("original_query") or plan.get("raw_query") or "").strip(),
        seller_profile=str(seller.get("offer_category") or seller.get("sales_motion") or "B2B seller").strip(),
        seller_offer=str(seller.get("offer_description") or " | ".join(_tuple_str(seller.get("products_or_services"))) or "commercial offer").strip(),
        target_company_profile=str(
            " ".join(
                part
                for part in (
                    ", ".join(industries) if industries else "aziende operative",
                    ", ".join(geographies),
                )
                if part
            )
        ).strip(),
        target_industries=industries,
        target_geographies=geographies,
        buyer_roles=buyer_roles,
        business_problem=str(
            semantic_contract.get("event_or_state_description")
            or semantic_contract.get("target_company_description")
            or
            (hypotheses[0] if hypotheses else None)
            or plan.get("intent_summary")
            or "Buying signal research"
        ).strip(),
        requested_count=count,
        freshness_days=max(1, freshness),
        required_signals=required,
        optional_signals=optional,
        excluded_entities=_tuple_str(target.get("excluded_entities")),
        source_preferences=_tuple_str(source_policy.get("preferred_source_classes") or SOURCE_CLASSES[:4]),
        evidence_requirements=tuple(evidence_reqs),
        cost_budget=budget,
        capability_status="SUPPORTED_PARTIAL",  # upgraded by engine after strategy coverage
        commercial_hypotheses=tuple(hypotheses) or _tuple_str(semantic_contract.get("positive_conditions")),
        hypothesis_contracts=tuple(hypothesis_contracts),
        required_target_role=str(semantic_contract.get("target_role_in_event") or "target_operating_company"),
        prohibited_roles=_tuple_str(
            semantic_contract.get("excluded_roles") or target.get("excluded_entities")
        ),
        observability_notes=tuple(observability),
    )


# Seed matrix for offline/canary QuerySpec examples (not fixture leads).
CANARY_QUERY_SPECS: Tuple[Dict[str, Any], ...] = (
    {
        "id": "seo_weakness",
        "query": "Trova PMI italiane con problemi SEO evidenti sul sito ufficiale",
        "required_signals": ("website_weakness",),
        "geographies": ("Italia",),
        "buyer_roles": ("marketing_manager", "founder"),
        "business_problem": "sito debole / SEO scarsa riduce acquisizione clienti",
        "seller_offer": "servizi SEO e digital audit",
    },
    {
        "id": "hiring_sales",
        "query": "Trova aziende italiane che stanno assumendo commerciali o sales",
        "required_signals": ("hiring_sales",),
        "geographies": ("Italia", "Lombardia"),
        "buyer_roles": ("sales_director", "HR"),
        "business_problem": "espansione forza vendita",
        "seller_offer": "CRM / sales enablement",
    },
    {
        "id": "tender_won",
        "query": "Trova aziende che hanno vinto gare pubbliche recenti",
        "required_signals": ("tender_won",),
        "geographies": ("Italia",),
        "buyer_roles": ("procurement", "CEO"),
        "business_problem": "capacità operativa post-aggiudicazione",
        "seller_offer": "fornitura B2B / servizi operativi",
    },
    {
        "id": "new_locations",
        "query": "Trova aziende che aprono nuove sedi o punti vendita",
        "required_signals": ("new_location", "geographic_expansion"),
        "geographies": ("Lombardia", "Italia"),
        "buyer_roles": ("operations", "sales_director"),
        "business_problem": "apertura rete e capacità commerciale",
        "seller_offer": "CRM / facility / staffing",
    },
    {
        "id": "funding",
        "query": "Trova aziende che hanno ricevuto finanziamenti o investimenti recenti",
        "required_signals": ("funding", "capital_investment"),
        "geographies": ("Italia",),
        "buyer_roles": ("CEO", "CFO"),
        "business_problem": "crescita post-funding",
        "seller_offer": "servizi growth / software",
    },
    {
        "id": "leadership",
        "query": "Trova aziende con nuovo direttore commerciale o CEO",
        "required_signals": ("leadership_change",),
        "geographies": ("Italia",),
        "buyer_roles": ("CEO", "sales_director"),
        "business_problem": "nuovo leadership riorganizza go-to-market",
        "seller_offer": "CRM / consulenza commerciale",
    },
    {
        "id": "marketing_investment",
        "query": "Trova aziende che stanno investendo in marketing e advertising",
        "required_signals": ("active_advertising", "rebranding"),
        "geographies": ("Italia",),
        "buyer_roles": ("CMO", "marketing_manager"),
        "business_problem": "scale campagne e misurazione",
        "seller_offer": "media / analytics / creative",
    },
    {
        "id": "technology_change",
        "query": "Trova aziende con cambiamenti tecnologici rilevanti (migrazione o adozione)",
        "required_signals": ("technology_adoption", "technology_migration"),
        "geographies": ("Italia",),
        "buyer_roles": ("CTO", "IT_manager"),
        "business_problem": "modernizzazione stack",
        "seller_offer": "software / integrazione",
    },
    {
        "id": "compliance",
        "query": "Trova aziende con obblighi o adeguamenti compliance verificabili",
        "required_signals": ("regulatory_change", "compliance_gap", "certification"),
        "geographies": ("Italia",),
        "buyer_roles": ("compliance_officer", "CEO"),
        "business_problem": "adeguamento normativo",
        "seller_offer": "compliance / consulting",
    },
    {
        "id": "multi_expansion_hiring",
        "query": "Trova aziende in espansione che stanno anche assumendo commerciali",
        "required_signals": ("geographic_expansion", "hiring_sales"),
        "geographies": ("Lombardia", "Italia"),
        "buyer_roles": ("sales_director", "CEO"),
        "business_problem": "espansione rete + hiring sales → bisogno CRM",
        "seller_offer": "CRM",
        "observability_notes": (
            "apertura sedi",
            "nuove filiali",
            "assunzioni sales",
            "nuovo direttore commerciale",
            "espansione geografica",
            "implementazione CRM",
            "crescita team commerciale",
            "funding o investimento",
        ),
    },
)


def canary_plan_from_seed(seed: Mapping[str, Any], *, requested_count: int = 5) -> Dict[str, Any]:
    """Build a minimal CommercialSearchPlan-shaped dict for offline/canary use."""
    signals = _tuple_str(seed.get("required_signals"))
    ages = {signal: 180 for signal in signals}
    return {
        "schema_version": "1.0.0",
        "original_query": str(seed["query"]),
        "raw_query": str(seed["query"]),
        "search_strategy": "commercial_search",
        "requested_count": requested_count,
        "seller": {
            "offer_description": str(seed.get("seller_offer") or "commercial offer"),
            "products_or_services": [str(seed.get("seller_offer") or "offer")],
            "problems_solved": [str(seed.get("business_problem") or "growth")],
            "preferred_buyer_roles": list(_tuple_str(seed.get("buyer_roles"))),
        },
        "target": {
            "entity_types": ["operating_company"],
            "industries": [],
            "company_sizes": ["sme"],
            "geographies": list(_tuple_str(seed.get("geographies") or ("Italia",))),
            "local_business_preference": False,
            "required_attributes": [],
            "excluded_attributes": [],
            "excluded_entities": ["directory", "publisher", "associazione"],
        },
        "commercial_hypotheses": [
            {
                "id": f"h-{seed.get('id')}",
                "buyer_problem": str(seed.get("business_problem") or ""),
                "triggering_events": list(signals),
                "signals": list(signals),
                "implied_need": str(seed.get("seller_offer") or ""),
                "relevance_to_offer": "direct",
                "confidence": 0.8,
            }
        ],
        "signal_policy": {
            "required_signals": list(signals),
            "optional_signals": [],
            "negative_signals": [],
            "maximum_age_days_by_signal": ages,
            "minimum_signal_confidence": 0.7,
        },
        "source_policy": {
            "preferred_source_classes": [
                "official_company_website",
                "corporate_newsroom",
                "job_board",
                "procurement_registry",
                "recognized_news",
            ],
            "allowed_source_classes": list(SOURCE_CLASSES),
            "excluded_source_classes": [],
            "minimum_independent_sources": 1,
            "primary_source_required_for": list(signals),
        },
        "evidence_policy": {
            "require_official_domain": True,
            "require_source_url": True,
            "require_observed_at": True,
            "minimum_evidence_confidence": 0.7,
            "corroboration_required_above_risk": 0.9,
        },
        "audit_policy": {
            "modules": [],
            "crawl_depth": 0,
            "maximum_pages": 1,
            "collect_contacts": False,
            "collect_social_profiles": False,
            "detect_technologies": "website_weakness" in signals,
            "detect_commercial_signals": True,
        },
        "ranking_policy": {
            "weight_buyer_fit": 0.25,
            "weight_signal_strength": 0.25,
            "weight_freshness": 0.15,
            "weight_evidence_confidence": 0.2,
            "weight_contactability": 0.05,
            "weight_need_gap": 0.1,
            "signal_match_mode": "all" if seed.get("id") == "multi_expansion_hiring" else "any",
        },
        "budget_policy": {
            "target_cost_eur": min(0.125, requested_count * 0.025),
            "hard_cost_eur": min(0.125, requested_count * 0.025),
            "maximum_search_calls": 40,
            "maximum_pages_opened": 80,
            "maximum_llm_evaluations": 20,
        },
    }
