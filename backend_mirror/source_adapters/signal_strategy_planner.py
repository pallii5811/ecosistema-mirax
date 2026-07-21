"""Signal Strategy Planner — multi-strategy discovery plans per buying signal."""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from typing import Any, Dict, List, Mapping, Sequence, Tuple

from .universal_query_spec import SOURCE_CLASSES, UniversalQuerySpec


@dataclass(frozen=True)
class DiscoveryStrategy:
    strategy_id: str
    signal_type: str
    source_class: str
    search_query: str
    preferred_domains: Tuple[str, ...]
    excluded_domains: Tuple[str, ...]
    freshness_days: int
    expected_evidence: Tuple[str, ...]
    estimated_cost: float
    priority: int
    fallback_level: int
    adapter_affinity: Tuple[str, ...] = ()
    hypothesis_id: str = ""
    event_type: str = ""
    evidence_claim_type: str = "OBSERVED_EVENT"
    semantic_justification: str = ""
    required_target_role: str = "target_operating_company"
    prohibited_roles: Tuple[str, ...] = ()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


_DEFAULT_EXCLUDED = (
    "pagesjaunes.fr",
    "paginegialle.it",
    "yelp.com",
    "tripadvisor.com",
    "facebook.com",
    "linkedin.com",
    "indeed.com",  # allow job_board strategies to override
    "wikipedia.org",
    "amazon.it",
)

_SIGNAL_LEXICON: Dict[str, Dict[str, Any]] = {
    "hiring_sales": {
        "events": ("assume commerciale", "figura commerciale", "sales account", "business developer", "key account"),
        "synonyms": ("commerciale", "vendite", "sales", "account manager"),
        "adapters": ("structured_hiring_v1",),
        "sources": ("job_board", "official_company_website", "recognized_news"),
    },
    "hiring_marketing": {
        "events": ("assume marketing", "digital marketing manager", "media buyer", "performance marketer"),
        "synonyms": ("marketing", "comunicazione", "advertising"),
        "adapters": ("structured_hiring_v1",),
        "sources": ("job_board", "official_company_website"),
    },
    "hiring": {
        "events": ("stiamo assumendo", "posizioni aperte", "lavora con noi"),
        "synonyms": ("assunzioni", "hiring", "open roles"),
        "adapters": ("structured_hiring_v1",),
        "sources": ("job_board", "official_company_website"),
    },
    "tender_won": {
        "events": ("aggiudicata", "ha vinto la gara", "contratto pubblico", "affidamento"),
        "synonyms": ("gara", "appalto", "ANAC", "bando"),
        "adapters": ("public_procurement_v1",),
        "sources": ("procurement_registry", "institutional_source", "recognized_news"),
    },
    "contract_awarded": {
        "events": ("contratto aggiudicato", "affidamento diretto"),
        "synonyms": ("aggiudicazione", "commessa pubblica"),
        "adapters": ("public_procurement_v1",),
        "sources": ("procurement_registry",),
    },
    "new_location": {
        "events": ("nuova sede", "nuovo punto vendita", "ha aperto", "inaugura", "nuovo stabilimento"),
        "synonyms": ("apertura", "filiale", "store opening", "stabilimento"),
        "adapters": ("generic_web_research_v1", "official_growth_signals_v1"),
        "sources": ("corporate_newsroom", "official_company_website", "recognized_news"),
    },
    "geographic_expansion": {
        "events": ("espansione", "entra nel mercato", "nuova area", "rete commerciale"),
        "synonyms": ("espansione geografica", "espansione commerciale", "nuove filiali"),
        "adapters": ("generic_web_research_v1", "official_growth_signals_v1"),
        "sources": ("corporate_newsroom", "industry_publication", "recognized_news"),
    },
    "production_expansion": {
        "events": ("nuovo stabilimento", "ampliamento produttivo", "capacità produttiva", "nuova unità produttiva"),
        "synonyms": ("stabilimento", "impianto", "produzione", "ampliamento dello stabilimento"),
        "adapters": ("generic_web_research_v1", "official_growth_signals_v1"),
        "sources": ("corporate_newsroom", "industry_publication", "recognized_news"),
    },
    "funding": {
        "events": ("ha raccolto", "round di investimento", "finanziamento", "venture capital"),
        "synonyms": ("funding", "investimento", "capital raise"),
        "adapters": ("generic_web_research_v1",),
        "sources": ("recognized_news", "industry_publication", "institutional_source"),
    },
    "capital_investment": {
        "events": ("investimento di", "iniezione di capitale", "private equity"),
        "synonyms": ("investimento", "equity"),
        "adapters": ("generic_web_research_v1",),
        "sources": ("recognized_news", "industry_publication"),
    },
    "financing": {
        "events": ("finanziamento agevolato", "credito d'imposta", "fondo perduto"),
        "synonyms": ("finanziamento", "incentivo"),
        "adapters": ("generic_web_research_v1",),
        "sources": ("institutional_source", "recognized_news"),
    },
    "leadership_change": {
        "events": ("nuovo CEO", "nuovo direttore commerciale", "nomina", "assume la guida"),
        "synonyms": ("direttore commerciale", "amministratore delegato", "CEO"),
        "adapters": ("generic_web_research_v1", "official_growth_signals_v1"),
        "sources": ("corporate_newsroom", "recognized_news", "industry_publication"),
    },
    "active_advertising": {
        "events": ("campagna pubblicitaria", "Meta Ads", "Google Ads", "investimento media"),
        "synonyms": ("advertising", "media buying", "ads"),
        "adapters": ("official_growth_signals_v1",),
        "sources": ("technology_evidence", "recognized_news", "industry_publication"),
    },
    "rebranding": {
        "events": ("rebranding", "nuovo brand", "nuova identità visiva"),
        "synonyms": ("rebrand", "restyling"),
        "adapters": ("official_growth_signals_v1",),
        "sources": ("corporate_newsroom", "industry_publication"),
    },
    "technology_adoption": {
        "events": ("adotta", "implementa", "migra a", "sceglie la piattaforma"),
        "synonyms": ("CRM", "ERP", "SaaS", "digitalizzazione"),
        "adapters": ("generic_web_research_v1",),
        "sources": ("technology_evidence", "industry_publication", "recognized_news"),
    },
    "technology_migration": {
        "events": ("migrazione", "sostituzione sistema", "passaggio a"),
        "synonyms": ("migrazione IT", "modernizzazione"),
        "adapters": ("generic_web_research_v1",),
        "sources": ("technology_evidence", "industry_publication"),
    },
    "outdated_technology": {
        "events": ("tecnologia obsoleta", "legacy system"),
        "synonyms": ("obsoleto", "legacy"),
        "adapters": ("legacy_digital_audit_v1", "generic_web_research_v1"),
        "sources": ("technology_evidence",),
    },
    "regulatory_change": {
        "events": ("adeguamento normativo", "nuova normativa", "obbligo di conformità"),
        "synonyms": ("compliance", "normativa", "regolamento"),
        "adapters": ("generic_web_research_v1",),
        "sources": ("institutional_source", "recognized_news"),
    },
    "compliance_gap": {
        "events": ("non conforme", "sanzione", "obbligo non rispettato"),
        "synonyms": ("compliance gap", "non conformità"),
        "adapters": ("generic_web_research_v1",),
        "sources": ("institutional_source", "recognized_news"),
    },
    "certification": {
        "events": ("ottiene la certificazione", "certificata ISO", "accreditamento"),
        "synonyms": ("certificazione", "ISO"),
        "adapters": ("generic_web_research_v1",),
        "sources": ("official_company_website", "industry_publication"),
    },
    "website_weakness": {
        "events": ("sito lento", "SEO", "errori tecnici sito"),
        "synonyms": ("SEO", "sito web", "digital presence"),
        "adapters": ("legacy_digital_audit_v1",),
        "sources": ("technology_evidence", "official_company_website"),
    },
}


def _geo_phrase(spec: UniversalQuerySpec) -> str:
    geos = [g for g in spec.target_geographies if g.casefold() not in {"italy", "italia", "it"}]
    if geos:
        return " ".join(geos[:2])
    return "Italia"


def _wants_crm_hypotheses(spec: UniversalQuerySpec) -> bool:
    """Prefer CRM-grounded SERPs when the commercial brief is about CRM."""
    blob = " ".join(
        (
            spec.original_query or "",
            spec.seller_offer or "",
            spec.seller_profile or "",
            spec.business_problem or "",
            " ".join(spec.commercial_hypotheses or ()),
        )
    ).casefold()
    return "crm" in blob


def _industry_phrase(spec: UniversalQuerySpec) -> str:
    return " ".join(spec.target_industries[:2]).strip()


def _lexicon(signal: str) -> Dict[str, Any]:
    return _SIGNAL_LEXICON.get(signal) or {
        "events": (signal.replace("_", " "),),
        "synonyms": (signal.replace("_", " "),),
        "adapters": ("generic_web_research_v1",),
        "sources": ("generic_web_research", "recognized_news"),
    }


def _claim_type_for_signal(signal: str) -> str:
    if signal in {"procurement", "active_tender", "rfp", "request_for_proposal"}:
        return "SELECTION_PROCESS"
    if signal in {"website_weakness", "seo_errors", "missing_analytics", "missing_advertising_pixel", "site_stale"}:
        return "COMPANY_ATTRIBUTE"
    return "OBSERVED_EVENT"


def hypothesis_contracts_for_spec(spec: UniversalQuerySpec) -> Tuple[Mapping[str, Any], ...]:
    """Return complete contracts, synthesizing only from canonical signals.

    The synthetic path is deterministic and exists for legacy plans; it never
    invents a new signal family or cross-links an unrelated commercial play.
    """
    if spec.hypothesis_contracts:
        return tuple(spec.hypothesis_contracts)
    contracts: List[Mapping[str, Any]] = []
    for signal in tuple(dict.fromkeys((*spec.required_signals, *spec.optional_signals))):
        lex = _lexicon(signal)
        contracts.append({
            "hypothesis_id": f"canonical-signal:{signal}",
            "buyer_archetype": spec.target_company_profile or "target operating company",
            "buyer_problem": spec.business_problem,
            "expected_outcome": spec.seller_offer,
            "observable_event_types": (signal,),
            "required_relationships": (f"company_has_{signal}",),
            "allowed_signal_families": (signal,),
            "excluded_signal_families": (),
            "source_classes": tuple(lex.get("sources") or spec.source_preferences),
            "evidence_claim_type": _claim_type_for_signal(signal),
            "query_templates": (),
            "expected_yield": "medium",
            "expected_cost": "low",
            "false_positive_risks": tuple(spec.prohibited_roles),
        })
    return tuple(contracts)


def _bind_strategy(
    strategy: DiscoveryStrategy,
    *,
    spec: UniversalQuerySpec,
    hypotheses: Sequence[Mapping[str, Any]],
) -> DiscoveryStrategy:
    signal = strategy.signal_type
    hypothesis = next(
        (
            item for item in hypotheses
            if signal in {
                str(value).strip()
                for value in (item.get("allowed_signal_families") or item.get("signals") or ())
            }
        ),
        None,
    )
    if hypothesis is None:
        return strategy
    events = tuple(
        str(value).strip()
        for value in (hypothesis.get("observable_event_types") or hypothesis.get("triggering_events") or (signal,))
        if str(value).strip()
    )
    event_type = signal if signal in events else (events[0] if events else signal)
    hypothesis_id = str(hypothesis.get("hypothesis_id") or hypothesis.get("id") or "").strip()
    problem = str(hypothesis.get("buyer_problem") or spec.business_problem or "").strip()
    outcome = str(hypothesis.get("expected_outcome") or hypothesis.get("implied_need") or spec.seller_offer or "").strip()
    justification = f"{event_type} supports {problem}"
    if outcome:
        justification += f"; expected outcome: {outcome}"
    return replace(
        strategy,
        hypothesis_id=hypothesis_id,
        event_type=event_type,
        evidence_claim_type=str(hypothesis.get("evidence_claim_type") or _claim_type_for_signal(signal)).upper(),
        semantic_justification=justification,
        required_target_role=spec.required_target_role or "target_operating_company",
        prohibited_roles=tuple(spec.prohibited_roles),
    )


def plan_strategies(spec: UniversalQuerySpec) -> Tuple[DiscoveryStrategy, ...]:
    """Generate multi-strategy discovery plans for required + optional signals."""
    geo = _geo_phrase(spec)
    industry = _industry_phrase(spec)
    year_hint = "(2025 OR 2026)"
    strategies: List[DiscoveryStrategy] = []
    signals = tuple(dict.fromkeys((*spec.required_signals, *spec.optional_signals)))
    priority = 10

    for signal in signals:
        lex = _lexicon(signal)
        events: Sequence[str] = lex["events"]
        synonyms: Sequence[str] = lex["synonyms"]
        adapters: Tuple[str, ...] = tuple(lex["adapters"])
        sources: Sequence[str] = lex["sources"]
        event_or = " OR ".join(f'"{item}"' for item in events[:4])
        synonym_or = " OR ".join(f'"{item}"' for item in synonyms[:4])

        # 1) company-owned / newsroom
        strategies.append(
            DiscoveryStrategy(
                strategy_id=f"{signal}:company_owned",
                signal_type=signal,
                source_class="official_company_website",
                search_query=f'site:.it ("comunicato stampa" OR newsroom OR "ufficio stampa") ({event_or}) {geo} {industry}'.strip(),
                preferred_domains=(".it",),
                excluded_domains=_DEFAULT_EXCLUDED,
                freshness_days=spec.freshness_days,
                expected_evidence=("company_name", "event_type", "event_date", "evidence_excerpt", "source_url"),
                estimated_cost=0.005,
                priority=priority,
                fallback_level=0,
                adapter_affinity=adapters,
            )
        )
        # 2) source-specific
        primary_source = sources[0] if sources else "generic_web_research"
        strategies.append(
            DiscoveryStrategy(
                strategy_id=f"{signal}:source_specific",
                signal_type=signal,
                source_class=primary_source if primary_source in SOURCE_CLASSES else "generic_web_research",
                search_query=f'({event_or}) {geo} {industry} {year_hint}'.strip(),
                preferred_domains=(),
                excluded_domains=_DEFAULT_EXCLUDED,
                freshness_days=spec.freshness_days,
                expected_evidence=("company_name", "event_type", "evidence_excerpt", "source_url"),
                estimated_cost=0.005,
                priority=priority + 1,
                fallback_level=0,
                adapter_affinity=adapters,
            )
        )
        # 3) event-specific
        strategies.append(
            DiscoveryStrategy(
                strategy_id=f"{signal}:event_specific",
                signal_type=signal,
                source_class="recognized_news",
                search_query=f'aziende {geo} ({event_or}) (annuncia OR comunica OR conferma) {industry}'.strip(),
                preferred_domains=(),
                excluded_domains=_DEFAULT_EXCLUDED,
                freshness_days=spec.freshness_days,
                expected_evidence=("company_name", "event_type", "event_date", "evidence_excerpt"),
                estimated_cost=0.005,
                priority=priority + 2,
                fallback_level=1,
                adapter_affinity=adapters,
            )
        )
        # 4) geography-specific
        strategies.append(
            DiscoveryStrategy(
                strategy_id=f"{signal}:geography_specific",
                signal_type=signal,
                source_class="industry_publication",
                search_query=f'"{geo}" ({synonym_or}) ({event_or}) impresa OR azienda OR spa OR srl'.strip(),
                preferred_domains=(),
                excluded_domains=_DEFAULT_EXCLUDED,
                freshness_days=spec.freshness_days,
                expected_evidence=("company_name", "event_location", "evidence_excerpt"),
                estimated_cost=0.005,
                priority=priority + 3,
                fallback_level=1,
                adapter_affinity=adapters,
            )
        )
        # 5) Italian synonyms
        strategies.append(
            DiscoveryStrategy(
                strategy_id=f"{signal}:italian_synonyms",
                signal_type=signal,
                source_class="generic_web_research",
                search_query=f'({synonym_or}) {geo} {year_hint} (azienda OR impresa) {industry}'.strip(),
                preferred_domains=(),
                excluded_domains=_DEFAULT_EXCLUDED,
                freshness_days=spec.freshness_days,
                expected_evidence=("company_name", "evidence_excerpt", "source_url"),
                estimated_cost=0.005,
                priority=priority + 4,
                fallback_level=2,
                adapter_affinity=adapters,
            )
        )
        # 6) fallback
        strategies.append(
            DiscoveryStrategy(
                strategy_id=f"{signal}:fallback",
                signal_type=signal,
                source_class="generic_web_research",
                search_query=f'{signal.replace("_", " ")} {geo} {industry} azienda'.strip(),
                preferred_domains=(),
                excluded_domains=_DEFAULT_EXCLUDED,
                freshness_days=spec.freshness_days,
                expected_evidence=("company_name", "source_url"),
                estimated_cost=0.005,
                priority=priority + 8,
                fallback_level=3,
                adapter_affinity=adapters,
            )
        )
        priority += 20

    if "technology_adoption" in signals and _wants_crm_hypotheses(spec):
        # CRM hypotheses must outrank generic technology_adoption SERPs
        # (comunicato stampa + adotta/implementa without "CRM") — otherwise the
        # first €0.05/time-boxed wave never reaches buyer-relevant queries.
        crm_vendor_exclude = _DEFAULT_EXCLUDED + (
            "salesforce.com", "hubspot.com", "microsoft.com", "zoho.com", "pipedrive.com",
            # Job-board noise dominates naive "selezione CRM" SERPs and burns the €0.05 envelope.
            "linkedin.com", "jobsora.com", "jooble.org", "careerjet.it", "pagepersonnel.it",
            "experis.it", "intervieweb.it", "recruit.net", "indeed.com", "infojobs.it",
            # Vendor/directory SEO and roundups — not operating-company buyers.
            "osservatoriocrm.it", "capterra.it", "teamleader.eu", "crmpartners.it",
            "rfp.wiki", "starbridge.ai", "taxdome.com",
        )
        crm_guide_exclude = '-guida -tutorial -"come scegliere" -"come si sceglie" -"miglior CRM" -"caso di successo" -osservatorio'
        # Prefer named-company adoption headlines on trade press; keep the Phase-A
        # ("adotta" OR "sceglie" OR "implementa") CRM substring for regression.
        crm_queries = (
            # Trade-press headlines name both buyer and CRM event — highest yield.
            'site:engage.it OR site:key4biz.it OR site:corrierecomunicazioni.it OR site:logisticaefficiente.it OR site:bitmat.it ("sceglie" OR "adotta") CRM -guida',
            f'"ha scelto" OR "ha adottato" OR "sceglie la piattaforma" CRM Italia (Spa OR Srl) {crm_guide_exclude}',
            # Broader open-web: keep ("adotta" OR "sceglie" OR "implementa") CRM for Phase-A.
            f'Italia ("adotta" OR "sceglie" OR "implementa") CRM (Spa OR Srl OR Group OR "comunicato stampa") {crm_guide_exclude}',
            # Rollout / go-live announcements (often explicitly "avvio del CRM").
            f'("avvio del CRM" OR "go-live CRM" OR "go live CRM" OR rollout CRM) Italia (Spa OR Srl) {crm_guide_exclude}',
            f'"migrazione CRM" OR "sostituzione CRM" OR "progetto CRM" (avvio OR "in corso" OR kickoff OR annuncia) Italia azienda {crm_guide_exclude}',
        )
        for idx, query in enumerate(crm_queries):
            strategies.insert(
                idx,
                DiscoveryStrategy(
                    strategy_id=f"technology_adoption:crm_hypothesis_{idx}",
                    signal_type="technology_adoption",
                    source_class="recognized_news",
                    search_query=query,
                    preferred_domains=(),
                    excluded_domains=crm_vendor_exclude,
                    freshness_days=spec.freshness_days,
                    expected_evidence=("company_name", "evidence_excerpt", "source_url"),
                    estimated_cost=0.005,
                    priority=1 + idx,
                    fallback_level=0,
                    adapter_affinity=("generic_web_research_v1",),
                ),
            )

    if "funding" in signals:
        strategies.insert(
            0,
            DiscoveryStrategy(
                strategy_id="funding:startup_recipient",
                signal_type="funding",
                source_class="recognized_news",
                search_query=(
                    f'startup {geo} ("ha raccolto" OR "round di investimento" OR "chiude un round" '
                    f'OR "annuncia un investimento") -investitori -"venture capital" -fondo -banca'
                ).strip(),
                preferred_domains=(),
                excluded_domains=_DEFAULT_EXCLUDED,
                freshness_days=spec.freshness_days,
                expected_evidence=("company_name", "event_date", "evidence_excerpt", "source_url"),
                estimated_cost=0.005,
                priority=1,
                fallback_level=0,
                adapter_affinity=("generic_web_research_v1",),
            ),
        )

    if set(signals).intersection({"production_expansion", "new_location", "geographic_expansion", "expansion"}):
        # Buyer expansion headlines — keep seller-offer terms out of the SERP so
        # fire-protection vendors are not mistaken for expanding industrial buyers.
        expansion_exclude = (
            '-antincendio -sprinkler -"impianti antincendio" -extinguisher -vigilanza '
            '-site:bebeez.it -site:italianostra.org -site:paginegialle.it '
            '-site:instagram.com -site:linkedin.com -site:bandi.regione.lombardia.it '
            '-site:finlombarda.it -site:reteagevolazioni.it -site:bandosubito.it '
            '-"richiedi informazioni" -associazione -onlus -fondazione -bando -agevolazione'
        )
        expansion_queries = (
            f'("inaugura" OR "ha inaugurato" OR "inaugurato") ("nuovo stabilimento" OR "nuovo impianto") '
            f'(Lombardia OR Veneto OR Emilia OR Bergamo OR Brescia OR Vicenza OR Modena OR Padova) '
            f'(2025 OR 2026) (Spa OR Srl) {expansion_exclude}',
            f'("nuovo stabilimento" OR "nuova unità produttiva") (Bergamo OR Brescia OR Vicenza OR Padova OR Modena OR Parma OR Thiene) '
            f'(2025 OR 2026) (Spa OR Srl) (inaugura OR inaugurato OR apre) {expansion_exclude}',
            f'"comunicato stampa" ("nuovo stabilimento" OR "ampliamento dello stabilimento") '
            f'(Lombardia OR Veneto OR Emilia-Romagna) (2025 OR 2026) (Spa OR Srl) {expansion_exclude}',
        )
        signal_set = set(signals)
        primary_signal = next(
            (item for item in ("production_expansion", "new_location", "geographic_expansion", "expansion") if item in signal_set),
            "production_expansion",
        )
        for idx, query in enumerate(expansion_queries):
            strategies.insert(
                idx,
                DiscoveryStrategy(
                    strategy_id=f"{primary_signal}:industrial_expansion_{idx}",
                    signal_type=primary_signal,
                    source_class="recognized_news",
                    search_query=query.strip(),
                    preferred_domains=(),
                    excluded_domains=_DEFAULT_EXCLUDED,
                    freshness_days=spec.freshness_days,
                    expected_evidence=("company_name", "event_date", "evidence_excerpt", "source_url"),
                    estimated_cost=0.005,
                    priority=1 + idx,
                    fallback_level=0,
                    adapter_affinity=("generic_web_research_v1",),
                ),
            )

    hypotheses = hypothesis_contracts_for_spec(spec)
    strategies = [_bind_strategy(item, spec=spec, hypotheses=hypotheses) for item in strategies]

    # Stable sort: lower priority number first, then fallback_level.
    strategies.sort(key=lambda item: (item.priority, item.fallback_level, item.strategy_id))
    return tuple(strategies)


def strategies_for_adapter(strategies: Sequence[DiscoveryStrategy], adapter_id: str) -> Tuple[DiscoveryStrategy, ...]:
    return tuple(item for item in strategies if not item.adapter_affinity or adapter_id in item.adapter_affinity)


def strategy_search_queries(
    strategies: Sequence[DiscoveryStrategy],
    *,
    signal_ids: Sequence[str] = (),
    max_queries: int = 12,
) -> Tuple[str, ...]:
    wanted = {str(item).strip() for item in signal_ids if str(item).strip()}
    queries: List[str] = []
    for item in strategies:
        if wanted and item.signal_type not in wanted:
            continue
        if item.search_query and item.search_query not in queries:
            queries.append(item.search_query)
        if len(queries) >= max_queries:
            break
    return tuple(queries)
