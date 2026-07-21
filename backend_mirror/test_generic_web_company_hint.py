from __future__ import annotations

from backend_mirror.source_adapters.generic_web import (
    _company_identity_hint,
    _literal_excerpt_for_hint,
    _looks_like_company_name,
    _snippet_company_hint,
    _title_company_leading,
    company_hint_present_in_source,
)


def test_title_company_rejects_market_summary_headlines() -> None:
    assert _title_company_leading("Le startup Italiane sfiorano i 700 milioni di investimenti nel ...") == ""
    assert _title_company_leading("Invertix chiude un round pre-seed da 1,7 milioni di euro") == "Invertix"


def test_crm_adoption_title_extracts_buyer_not_vendor() -> None:
    title = "Valsir sceglie CDM Tecnoconsulting per implementare il CRM analitico"
    assert _title_company_leading(title) == "Valsir"
    assert _snippet_company_hint(title) == "Valsir"
    html = f"<html><body><article>{title}. Valsir rafforza la gestione clienti.</article></body></html>"
    assert _company_identity_hint(title=title, snippet=title, html=html) == "Valsir"


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
    from backend_mirror.source_adapters.generic_web import _enqueue_content_shell_followup
    from backend_mirror.source_adapters.generic_web_budget import GenericWebDiscoveryState

    state = GenericWebDiscoveryState()
    _enqueue_content_shell_followup(
        state,
        identity_hint="Sirius Game",
        failed_url="https://www.borsaitaliana.it/borsa/notizie/archivi/teleborsa.html",
    )
    assert state.followup_queries
    assert "Sirius Game" in state.followup_queries[0]
    assert "borsaitaliana.it" in state.followup_queries[0]
    # Same company must not consume the second recovery slot.
    _enqueue_content_shell_followup(
        state,
        identity_hint="Sirius Game",
        failed_url="https://www.borsaitaliana.it/other.html",
    )
    assert len(state.followup_queries) == 1
    _enqueue_content_shell_followup(
        state,
        identity_hint="Invertix",
        failed_url="https://startupitalia.eu/invertix",
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


def test_can_reserve_serp_after_first_semantic_for_second_lead() -> None:
    from backend_mirror.source_adapters.generic_web_budget import GenericWebDiscoveryState

    state = GenericWebDiscoveryState(provider_calls=1, discovery_spent_eur=0.005, pages_fetched=12)
    # Mirror live Q7: €0.02 spent, €0.03 remaining, soft discovery still open.
    assert state.can_reserve_serp(hard_cap_eur=0.05, spent_eur=0.02, governor_remaining=0.03)
    # Live 1/2 strand: €0.0276 spent → €0.0224 remaining must still unlock a SERP.
    assert state.can_reserve_serp(hard_cap_eur=0.05, spent_eur=0.0276, governor_remaining=0.0224)
    assert not state.can_reserve_serp(hard_cap_eur=0.05, spent_eur=0.035, governor_remaining=0.015)


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
    from backend_mirror.source_adapters.generic_web import _enqueue_content_shell_followup, _serp_company_hint
    from backend_mirror.source_adapters.generic_web_budget import GenericWebDiscoveryState

    title = "Matchplat chiude un round da 3,5 milioni di euro"
    snippet = "Matchplat, società che offre analisi ..."
    hint = _serp_company_hint(title=title, snippet=snippet)
    assert hint == "Matchplat"
    state = GenericWebDiscoveryState()
    _enqueue_content_shell_followup(
        state,
        identity_hint=hint,
        failed_url="https://startupitalia.eu/startup/investimenti/matchplat/",
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

