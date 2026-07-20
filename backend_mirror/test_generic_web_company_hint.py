from __future__ import annotations

from backend_mirror.source_adapters.generic_web import (
    _company_identity_hint,
    _literal_excerpt_for_hint,
    _snippet_company_hint,
    _title_company_leading,
    company_hint_present_in_source,
)


def test_title_company_rejects_market_summary_headlines() -> None:
    assert _title_company_leading("Le startup Italiane sfiorano i 700 milioni di investimenti nel ...") == ""
    assert _title_company_leading("Invertix chiude un round pre-seed da 1,7 milioni di euro") == "Invertix"


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


def test_snippet_company_hint_extracts_matchplat() -> None:
    snippet = "Matchplat chiude un round da 35 milioni di euro per espansione internazionale"
    assert _snippet_company_hint(snippet) == "Matchplat"
