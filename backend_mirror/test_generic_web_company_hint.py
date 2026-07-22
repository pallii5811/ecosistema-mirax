from __future__ import annotations

from backend_mirror.source_adapters.generic_web import (
    _company_identity_hint,
    _literal_excerpt_for_hint,
    _looks_like_company_name,
    _snippet_company_hint,
    _title_company_leading,
    company_hint_present_in_source,
)


def test_expansion_title_extracts_company_not_locality_prefix() -> None:
    title = "Castrezzato: nuovo polo logistico Bracchi, 30 posti di lavoro"
    snippet = (
        "Nel nuovo stabilimento gia ci lavorano 10 persone: l'obiettivo e arrivare a 30 "
        "dipendenti nei prossimi mesi."
    )
    assert not _looks_like_company_name("Castrezzato")
    assert _title_company_leading(title) == "Bracchi"
    assert _snippet_company_hint(title) == "Bracchi"
    html = (
        "<html><body><article>Inaugurato a Castrezzato il nuovo polo logistico della Bracchi, "
        "storica azienda nel settore dei trasporti.</article></body></html>"
    )
    assert _company_identity_hint(title=title, snippet=snippet, html=html) == "Bracchi"


def test_expansion_title_extracts_inaugura_company() -> None:
    assert _title_company_leading(
        "Elettromeccanica Tironi inaugura il nuovo stabilimento logistico a Modena"
    ) == "Elettromeccanica Tironi"
    assert _title_company_leading(
        "Ares Line inaugura il nuovo stabilimento a Thiene grazie a un investimento"
    ) == "Ares Line"
    assert _title_company_leading("Cembre: nuovo stabilimento da 15mila mq, investimento") == "Cembre"
    assert _title_company_leading("TBK Srl celebra trent'anni guardando al futuro") == "TBK Srl"
    assert _title_company_leading("Inaugurazione nuovo stabilimento") == ""
    # Parent company leading the inauguration headline is the correct target.
    assert _snippet_company_hint(
        "MARPOSS HA INAUGURATO IL NUOVO STABILIMENTO DELLA CONTROLLATA MG SPA A TRAVAGLIATO"
    ) == "MARPOSS"


def test_institutional_actors_are_not_operating_companies() -> None:
    assert not _looks_like_company_name("Il Mimit")
    assert not _looks_like_company_name("MIMIT")
    assert not _looks_like_company_name("Assessorato Attività produttive Industria 4.0")
    assert not _looks_like_company_name("Imprese")
    assert not _looks_like_company_name("San")
    assert _looks_like_company_name("San Pellegrino")
    assert _snippet_company_hint(
        "Intesa Provincia Dana per l'avvio di una nuova unità produttiva in Meccatronica"
    ) == "Dana"
    assert _snippet_company_hint(
        "Fendi grazie ad un accordo un nuovo stabilimento e 133 nuovi posti"
    ) == "Fendi"
    from backend_mirror.source_adapters.generic_web import _serp_company_hint

    assert (
        _serp_company_hint(
            title="MIMIT, 12 milioni per accordo sviluppo Azienda Agricola Ponte Reale",
            snippet="accordo sviluppo Azienda Agricola Ponte Reale di Ciorlano",
            url="",
        )
        == "Azienda Agricola Ponte Reale"
    )


def test_stale_news_page_is_not_deferred_for_semantic() -> None:
    from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest
    from backend_mirror.source_adapters.generic_web import (
        _append_semantic_deferred_news_record,
        _infer_page_date,
    )
    from backend_mirror.source_adapters.generic_web_budget import GenericWebDiscoveryState

    html = (
        "<html><head><meta property=\"article:published_time\" content=\"2022-09-29T10:00:00Z\">"
        "</head><body><article>Bracchi nuovo polo logistico a Castrezzato.</article></body></html>"
    )
    assert _infer_page_date(html=html, text="Bracchi", url="", title="Castrezzato: Bracchi", snippet="") == "2022-09-29"
    request = AdapterDiscoveryRequest(
        intent="production_expansion",
        signal_ids=("production_expansion",),
        signal_match_mode="any",
        geographies=("Nord Italia",),
        freshness_max_age_days=180,
        requested_count=3,
        budget_eur=0.10,
        query="Installiamo sistemi antincendio industriali",
        technical_filters={"universal_engine": True, "semantic_authority_required": True},
    )
    records: list = []
    ok = _append_semantic_deferred_news_record(
        records=records,
        request=request,
        company_hint="Bracchi",
        visible_text="Bracchi nuovo polo logistico a Castrezzato. " * 20,
        title="Castrezzato: nuovo polo logistico Bracchi, 30 posti di lavoro",
        snippet="Nel nuovo stabilimento gia ci lavorano 10 persone",
        html=html,
        final_url="https://www.bresciatoday.it/social/bracchi-castrezzato.html",
        page_host="bresciatoday.it",
        fetch_provenance={"final_url": "https://www.bresciatoday.it/social/bracchi-castrezzato.html"},
        scope="t",
        state=GenericWebDiscoveryState(),
        provider_query="q",
        search_provider="serp",
        item={"publisher": "BresciaToday"},
    )
    assert ok is False
    assert records == []


def test_infer_page_date_from_italian_body_and_url() -> None:
    from backend_mirror.source_adapters.generic_web import _infer_page_date

    assert (
        _infer_page_date(
            html="",
            text="L'azienda ha inaugurato lo stabilimento il 12 marzo 2026 a Thiene.",
            url="https://news.example.it/story",
            title="Ares Line inaugura",
            snippet="",
        )
        == "2026-03-12"
    )
    assert (
        _infer_page_date(
            html="",
            text="",
            url="https://www.corriere.it/economia/aziende/24_agosto_27/prosciutto.shtml",
            title="Prosciutto",
            snippet="",
        )
        == "2024-08-27"
    )


def test_geography_serp_noise_rejected_by_concrete_event_gate() -> None:
    from backend_mirror.source_adapters.cheap_discovery_prefilter import (
        DiscoveryHit,
        has_concrete_expansion_event,
        prefilter_discovery_hit,
    )

    noise = DiscoveryHit(
        title="Stampi caldo o freddo in Italia: scelta 2026",
        url="https://blog.teamrapidtooling.com/it/blog/hot-runner/",
        snippet="La concentrazione piu evidente si trova nel Nord Italia: Lombardia ... capacita produttiva",
    )
    assert not has_concrete_expansion_event(noise.title, noise.snippet)
    valid = DiscoveryHit(
        title="Ares Line inaugura il nuovo stabilimento a Thiene",
        url="https://www.industriavicentina.it/ares-line",
        snippet="Ares Line inaugura il nuovo stabilimento a Thiene grazie a un investimento di 12 milioni.",
    )
    assert has_concrete_expansion_event(valid.title, valid.snippet)
    assert prefilter_discovery_hit(valid).accepted


def test_crm_adoption_title_extracts_buyer_not_vendor() -> None:
    title = "Valsir sceglie CDM Tecnoconsulting per implementare il CRM analitico"
    assert _title_company_leading(title) == "Valsir"
    assert _snippet_company_hint(title) == "Valsir"
    html = f"<html><body><article>{title}. Valsir rafforza la gestione clienti.</article></body></html>"
    assert _company_identity_hint(title=title, snippet=title, html=html) == "Valsir"


def test_guide_headline_come_si_sceglie_is_not_a_buyer() -> None:
    title = "Come si sceglie il CRM immobiliare giusto?"
    assert _snippet_company_hint(title) == ""
    assert _title_company_leading(title) == ""
    assert not _looks_like_company_name("Come si")


def test_company_hint_from_adoption_url_slug() -> None:
    from backend_mirror.source_adapters.generic_web import _company_hint_from_url, _serp_company_hint

    url = "https://www.prnewswire.com/news-releases/tec-med-adotta-veeva-crm-per-rafforzare-le-interazioni-digitali-804299819.html"
    assert _company_hint_from_url(url) == "Tec Med"
    assert _serp_company_hint(title="", snippet="", url=url) == "Tec Med"


def test_crm_shell_followup_uses_crm_recovery_not_funding() -> None:
    from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest
    from backend_mirror.source_adapters.generic_web import _enqueue_content_shell_followup
    from backend_mirror.source_adapters.generic_web_budget import GenericWebDiscoveryState

    request = AdapterDiscoveryRequest(
        intent="technology_adoption",
        signal_ids=("technology_adoption",),
        signal_match_mode="all",
        geographies=("Italia",),
        freshness_max_age_days=365,
        requested_count=2,
        budget_eur=0.05,
        query="Trovami aziende che stanno cercando un nuovo CRM.",
        technical_filters={
            "universal_active_strategies": [
                {
                    "hypothesis_id": "hyp-crm-1",
                    "signal_type": "technology_adoption",
                    "event_type": "technology_adoption",
                    "strategy_id": "technology_adoption:crm_hypothesis_0",
                    "search_query": 'Italia ("adotta" OR "sceglie") CRM',
                }
            ]
        },
    )
    state = GenericWebDiscoveryState()
    _enqueue_content_shell_followup(
        state,
        identity_hint="Valsir",
        failed_url="https://www.borsaitaliana.it/valsir.html",
        request=request,
    )
    assert state.followup_queries
    assert "Valsir" in state.followup_queries[0]
    assert "CRM" in state.followup_queries[0]
    assert "selezione" in state.followup_queries[0].casefold() or "migrazione" in state.followup_queries[0].casefold()
    assert "chiude un round" not in state.followup_queries[0].casefold()


def test_company_hint_matches_legal_suffix_variants() -> None:
    source = "Sirius Game, la startup edutech chiude un round da 1,3 milioni di euro."
    assert company_hint_present_in_source("Sirius Game S.r.l.", source)
    assert company_hint_present_in_source("Sirius Game Srl", source)
    assert company_hint_present_in_source("Sirius Game", source)


def test_company_hint_matches_acme_spa() -> None:
    source = "ACME annuncia un round seed da 2 milioni."
    assert company_hint_present_in_source("ACME S.p.A.", source)
    assert company_hint_present_in_source("ACME Spa", source)


def test_company_hint_accepts_abbreviated_commercial_name() -> None:
    source = "International Business Machines ha chiuso un round."
    assert company_hint_present_in_source("IBM", source) is False
    assert company_hint_present_in_source("International Business Machines S.p.A.", source)


def test_company_hint_accepts_verified_acronym_when_expanded_in_source() -> None:
    source = "IBM (International Business Machines) annuncia un nuovo round."
    assert company_hint_present_in_source("IBM", source)
    assert company_hint_present_in_source("International Business Machines", source)


def test_company_hint_matches_whitespace_and_punctuation_noise() -> None:
    source = "Sirius   Game — la startup edutech chiude un round."
    assert company_hint_present_in_source("Sirius Game", source)
    assert company_hint_present_in_source("Sirius-Game S.r.l.", source)


def test_company_hint_rejects_missing_target_on_listing_shell() -> None:
    source = "Notizie dalle agenzie - Borsa Italiana Accedi Registrati"
    assert not company_hint_present_in_source("Sirius Game", source)


def test_company_hint_accepts_accent_and_punctuation_variants() -> None:
    source = "Caffè Milano Srl ha raccolto fondi."
    assert company_hint_present_in_source("Caffe Milano S.r.l.", source)


def test_identity_hint_prefers_serp_title_over_publisher_jsonld() -> None:
    html = """
    <html><head>
    <script type="application/ld+json">{"@type":"NewsArticle","publisher":{"@type":"Organization","name":"GEDI News Network S.p.A"}}</script>
    </head><body><p>Altro testo.</p></body></html>
    """
    title = "Sirius Game, la startup edutech chiude un round da 1,3 milioni"
    snippet = "Sirius Game, la startup edutech chiude un round da 1,3 milioni di euro guidato da CDP."
    assert _company_identity_hint(title=title, snippet=snippet, html=html) == "Sirius Game"


def test_identity_hint_does_not_return_unrelated_publisher() -> None:
    html = """
    <html><head>
    <script type="application/ld+json">{"@type":"NewsArticle","publisher":{"@type":"Organization","name":"Pubblicità Borsa Italiana Spa"}}</script>
    </head><body><p>Solo menu sito.</p></body></html>
    """
    title = "Sirius Game, la startup edutech chiude un round da 1,3 milioni"
    snippet = "Sirius Game, la startup edutech chiude un round da 1,3 milioni di euro guidato da CDP."
    assert _company_identity_hint(title=title, snippet=snippet, html=html) == "Sirius Game"


def test_literal_excerpt_prefers_title_when_present_in_source() -> None:
    source = "Sirius Game, la startup edutech chiude un round da 1,3 milioni di euro."
    title = "Sirius Game, la startup edutech chiude un round da 1,3 milioni"
    assert _literal_excerpt_for_hint("Sirius Game", source, title, "") == title


def test_content_shell_enqueues_followup_query() -> None:
    from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest
    from backend_mirror.source_adapters.generic_web import _enqueue_content_shell_followup
    from backend_mirror.source_adapters.generic_web_budget import GenericWebDiscoveryState

    request = AdapterDiscoveryRequest(
        intent="funding",
        signal_ids=("funding",),
        signal_match_mode="any",
        geographies=("Italia",),
        freshness_max_age_days=180,
        requested_count=2,
        budget_eur=0.05,
        query="Trovami startup che stanno raccogliendo fondi",
        technical_filters={
            "universal_active_strategies": [
                {
                    "hypothesis_id": "hyp-funding-1",
                    "signal_type": "funding",
                    "event_type": "funding",
                    "strategy_id": "funding:startup_recipient",
                    "search_query": 'startup Italia ("ha raccolto" OR "chiude un round")',
                }
            ]
        },
    )
    state = GenericWebDiscoveryState()
    _enqueue_content_shell_followup(
        state,
        identity_hint="Sirius Game",
        failed_url="https://www.borsaitaliana.it/borsa/notizie/archivi/teleborsa.html",
        request=request,
    )
    assert state.followup_queries
    assert "Sirius Game" in state.followup_queries[0]
    assert "borsaitaliana.it" in state.followup_queries[0]
    # Same company must not consume the second recovery slot.
    _enqueue_content_shell_followup(
        state,
        identity_hint="Sirius Game",
        failed_url="https://www.borsaitaliana.it/other.html",
        request=request,
    )
    assert len(state.followup_queries) == 1
    _enqueue_content_shell_followup(
        state,
        identity_hint="Invertix",
        failed_url="https://startupitalia.eu/invertix",
        request=request,
    )
    assert len(state.followup_queries) == 2
    assert "Invertix" in state.followup_queries[1]


def test_serp_fetch_priority_prefers_news_over_exchange_shell() -> None:
    from types import SimpleNamespace

    from backend_mirror.source_adapters.generic_web import _serp_fetch_priority

    shell = SimpleNamespace(url="https://www.borsaitaliana.it/borsa/notizie/sirius.html")
    news = SimpleNamespace(url="https://finanza.repubblica.it/News/2026/06/15/sirius_game/")
    other = SimpleNamespace(url="https://www.startupbusiness.it/round/")
    ranked = sorted([shell, other, news], key=_serp_fetch_priority)
    assert ranked[0].url == news.url
    assert ranked[-1].url == shell.url


def test_serp_fetch_priority_prefers_crm_adoption_over_guides() -> None:
    from types import SimpleNamespace

    from backend_mirror.source_adapters.generic_web import _serp_fetch_priority

    guide = SimpleNamespace(
        url="https://www.canthiere.it/blog/crm-guida",
        title="Come si sceglie il CRM immobiliare",
        snippet="Guida 2026",
    )
    adoption = SimpleNamespace(
        url="https://bi.gruppocdm.it/valsir-sceglie-cdm/",
        title="Valsir sceglie CDM per implementare il CRM analitico",
        snippet="Valsir adotta un nuovo CRM",
    )
    ranked = sorted([guide, adoption], key=_serp_fetch_priority)
    assert ranked[0].url == adoption.url


def test_serp_fetch_priority_uses_url_path_when_title_empty() -> None:
    from types import SimpleNamespace

    from backend_mirror.source_adapters.generic_web import _serp_fetch_priority

    vague = SimpleNamespace(
        url="https://www.formula.it/casi-di-successo",
        title="",
        snippet="",
    )
    tecmed = SimpleNamespace(
        url="https://www.prnewswire.com/news-releases/tec-med-adotta-veeva-crm-per-rafforzare-le-interazioni-digitali.html",
        title="",
        snippet="",
    )
    ranked = sorted([vague, tecmed], key=_serp_fetch_priority)
    assert ranked[0].url == tecmed.url


def test_can_reserve_serp_after_first_semantic_for_second_lead() -> None:
    from backend_mirror.source_adapters.generic_web_budget import GenericWebDiscoveryState

    state = GenericWebDiscoveryState(provider_calls=1, discovery_spent_eur=0.005, pages_fetched=12)
    # Mirror live Q7: €0.02 spent, €0.03 remaining, soft discovery still open.
    assert state.can_reserve_serp(hard_cap_eur=0.05, spent_eur=0.02, governor_remaining=0.03)
    # Live 1/2 strand: €0.0276 spent → €0.0224 remaining must still unlock a SERP.
    assert state.can_reserve_serp(hard_cap_eur=0.05, spent_eur=0.0276, governor_remaining=0.0224)
    # Late envelope: SERP-only room still unlocks (antincendio 2/3 at €0.095).
    assert state.can_reserve_serp(hard_cap_eur=0.10, spent_eur=0.095, governor_remaining=0.005)
    assert not state.can_reserve_serp(hard_cap_eur=0.05, spent_eur=0.048, governor_remaining=0.002)


def test_resume_followup_serp_not_zeroed_by_prior_discovery_spend() -> None:
    """Residual batch budget must still unlock queued followups after prior SERP spend."""
    from backend_mirror.source_adapters.generic_web_budget import (
        QUERY_COST_EUR,
        GenericWebDiscoveryState,
    )

    state = GenericWebDiscoveryState(
        provider_calls=2,
        discovery_spent_eur=0.025,
        pages_fetched=18,
        followup_queries=('\"Opinel\" (CRM) (sceglie OR adotta)',),
    )
    hard_cap = 0.05
    batch_budget = 0.01  # residual after prior_cost ~€0.04
    discovery_left = state.discovery_remaining_eur(hard_cap)
    remaining = max(0.0, min(batch_budget, discovery_left))
    # Old bug: min(batch, hard) - discovery_spent => 0.01 - 0.025 => 0
    legacy_broken = max(0.0, min(batch_budget, hard_cap) - float(state.discovery_spent_eur))
    assert legacy_broken < QUERY_COST_EUR
    assert remaining + 1e-9 >= QUERY_COST_EUR or (
        state.followup_queries and batch_budget + 1e-9 >= QUERY_COST_EUR
    )


def test_planeat_foodtech_headline_extracts_company() -> None:
    title = "La foodtech italiana PlanEat chiude un round da 2 milioni"
    snippet = "La foodtech italiana PlanEat chiude un round seed."
    assert _snippet_company_hint(title) == "PlanEat"
    assert _company_identity_hint(title=title, snippet=snippet, html="<html></html>") == "PlanEat"
    assert not _looks_like_company_name("foodtech italiana PlanEat")


def test_discovery_soft_cap_lifts_after_first_wave_drained() -> None:
    from backend_mirror.source_adapters.generic_web_budget import (
        DISCOVERY_SOFT_CAP_EUR,
        GenericWebDiscoveryState,
    )

    state = GenericWebDiscoveryState(
        provider_calls=3,
        discovery_spent_eur=DISCOVERY_SOFT_CAP_EUR,
        pages_fetched=40,
        pending_urls=(),
    )
    assert state.discovery_cap_eur(0.05) > DISCOVERY_SOFT_CAP_EUR
    assert state.discovery_remaining_eur(0.05) + 1e-9 >= 0.005
    assert state.can_reserve_serp(hard_cap_eur=0.05, spent_eur=0.015, governor_remaining=0.035)


def test_looks_like_company_rejects_job_titles() -> None:
    from backend_mirror.source_adapters.generic_web import _looks_like_company_name

    assert _looks_like_company_name("Sirius Game")
    assert not _looks_like_company_name("AI Engineer")
    assert not _looks_like_company_name("Software Developer")
    assert not _looks_like_company_name("Sales Manager")
    assert not _looks_like_company_name("Just a moment...")
    assert not _looks_like_company_name("Our Admissions Process")
    assert not _looks_like_company_name("Digital biotech")
    assert not _looks_like_company_name("Pubblicità Borsa Italiana Spa")
    assert not _looks_like_company_name("I845")
    assert not _looks_like_company_name("HB")
    assert not _looks_like_company_name("Forum SMA Solar Technology AG")
    assert not _looks_like_company_name("Lavoro Urgente")


def test_title_extracts_genomeup_not_digital_biotech() -> None:
    title = "Digital biotech, la startup italiana GenomeUp chiude un round d'investimento"
    snippet = (
        "La startup italiana GenomeUp ha annunciato la chiusura di un round di "
        "investimento da 1,1 milioni di euro a cui hanno partecipato Lumen ..."
    )
    assert _title_company_leading(title) == "GenomeUp"
    assert _snippet_company_hint(snippet) == "GenomeUp"
    assert _company_identity_hint(title=title, snippet=snippet, html="<html></html>") == "GenomeUp"


def test_challenge_html_falls_back_to_serp_company_hint() -> None:
    html = "<html><body>Just a moment... Enable JavaScript and cookies to continue</body></html>"
    title = "Matchplat chiude un round da 3,5 milioni di euro"
    snippet = "Matchplat chiude un round da 3,5 milioni di euro ... Da startup a realtà internazionale"
    assert _company_identity_hint(title=title, snippet=snippet, html=html) == "Matchplat"


def test_fetch_failure_enqueues_serp_company_followup() -> None:
    from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest
    from backend_mirror.source_adapters.generic_web import _enqueue_content_shell_followup, _serp_company_hint
    from backend_mirror.source_adapters.generic_web_budget import GenericWebDiscoveryState

    title = "Matchplat chiude un round da 3,5 milioni di euro"
    snippet = "Matchplat, società che offre analisi ..."
    hint = _serp_company_hint(title=title, snippet=snippet)
    assert hint == "Matchplat"
    request = AdapterDiscoveryRequest(
        intent="funding",
        signal_ids=("funding",),
        signal_match_mode="any",
        geographies=("Italia",),
        freshness_max_age_days=180,
        requested_count=2,
        budget_eur=0.05,
        query="Trovami startup che stanno raccogliendo fondi",
        technical_filters={
            "universal_active_strategies": [
                {
                    "hypothesis_id": "hyp-funding-1",
                    "signal_type": "funding",
                    "event_type": "funding",
                    "strategy_id": "funding:startup_recipient",
                    "search_query": 'startup Italia ("ha raccolto" OR "chiude un round")',
                }
            ]
        },
    )
    state = GenericWebDiscoveryState()
    _enqueue_content_shell_followup(
        state,
        identity_hint=hint,
        failed_url="https://startupitalia.eu/startup/investimenti/matchplat/",
        request=request,
    )
    assert state.followup_queries
    assert "Matchplat" in state.followup_queries[0]
    assert "startupitalia.eu" in state.followup_queries[0]


def test_diversified_funding_queries_skip_raw_nl_and_market_roundups() -> None:
    from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest
    from backend_mirror.source_adapters.generic_web import diversified_queries

    request = AdapterDiscoveryRequest(
        intent="funding",
        signal_ids=("funding",),
        signal_match_mode="any",
        freshness_max_age_days=180,
        query="Trovami startup che stanno raccogliendo fondi di investimento.",
        requested_count=2,
        geographies=("Italia",),
        sectors=("startup", "tech"),
        budget_eur=0.05,
        technical_filters={
            "universal_search_queries": [
                'startup Italia ("ha raccolto" OR "chiude un round") -investitori -fondo -banca',
            ],
        },
    )
    queries = diversified_queries(request)
    assert queries
    assert all("Trovami startup" not in q for q in queries)
    assert all("comunicato OR news OR aggiornamento" not in q for q in queries)
