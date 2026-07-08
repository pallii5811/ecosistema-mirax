"""Offline entity-resolution tests: official domain must be evidenced, not merely alive."""
from __future__ import annotations

from unittest.mock import patch

from agents.domain_resolver import resolve_official_identity, score_domain_identity


def test_official_site_scores_as_verified() -> None:
    html = """
    <html><head><title>Acque Pulite Srl | Depurazione Bari</title>
    <script type="application/ld+json">
    {"@type":"Organization","name":"Acque Pulite Srl"}
    </script></head>
    <body>Acque Pulite Srl - sede a Bari. Contatti. Partita IVA 01234567890.</body></html>
    """
    result = score_domain_identity("Acque Pulite Srl", "https://acquepulite.it", html, "Bari")
    assert result["score"] >= 70
    assert "company_tokens_in_host" in result["evidence"]
    assert "schema_org_identity_match" in result["evidence"]


def test_news_article_is_not_official_domain() -> None:
    html = """
    <html><head><title>Acque Pulite Srl vince una gara</title></head>
    <body>Acque Pulite Srl ha vinto una gara. Leggi tutte le notizie.</body></html>
    """
    result = score_domain_identity("Acque Pulite Srl", "https://giornale.example/notizia", html, "")
    assert result["score"] <= 45
    assert "missing_domain_ownership_proof" in result["evidence"]


def test_schema_identity_supports_brand_domain() -> None:
    html = """
    <html><head><title>Il brand ufficiale</title>
    <script type="application/ld+json">
    {"@type":"Corporation","legalName":"Officine Meccaniche Lombarde Srl"}
    </script></head><body>Officine Meccaniche Lombarde Srl. Privacy policy e contatti.</body></html>
    """
    result = score_domain_identity(
        "Officine Meccaniche Lombarde Srl",
        "https://oml-brand.it",
        html,
        "Lombardia",
    )
    assert result["score"] >= 55


def test_resolver_selects_best_candidate_not_first_http_200() -> None:
    candidates = ["https://weak-example.it/article", "https://acquepulite.it/"]

    def fake_verify(_name: str, url: str, _location: str):
        if "weak" in url:
            return {"url": url, "score": 58, "confidence": 0.58, "status": "probable"}
        return {"url": url, "score": 96, "confidence": 0.96, "status": "verified"}

    with patch("agents.search_serp.search_urls_http", return_value=candidates), patch(
        "agents.domain_resolver.verify_company_domain",
        side_effect=fake_verify,
    ):
        result = resolve_official_identity("Acque Pulite Srl", "Bari")
    assert result is not None
    assert result["url"] == "https://acquepulite.it/"
    assert result["score"] == 96


if __name__ == "__main__":
    test_official_site_scores_as_verified()
    test_news_article_is_not_official_domain()
    test_schema_identity_supports_brand_domain()
    test_resolver_selects_best_candidate_not_first_http_200()
    print("test_domain_resolver_v2: 4/4 OK")
