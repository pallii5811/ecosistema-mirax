"""Unit checks for generic_web size/contact/why_now enrichment."""

from __future__ import annotations

from datetime import date
import json
from pathlib import Path

from backend_mirror.source_adapters import AdapterDiscoveryRequest
from backend_mirror.source_adapters.generic_web import (
    _enrich_record_from_page,
    _explicit_requested_geography,
    _parse_employee_count,
    _public_contacts_from_html,
    _size_class_from_employees,
    _valid_record,
)


def test_missing_published_date_is_never_replaced_with_today() -> None:
    from backend_mirror.source_adapters.generic_web import _iso_date

    assert _iso_date(None) is None
    assert _iso_date("") is None
    assert _iso_date("2026-03-19") == "2026-03-19"


def test_failed_canary_records_cannot_inherit_requested_geography_or_current_date() -> None:
    from backend_mirror.source_adapters.generic_web import _iso_date

    fixture = json.loads(
        (Path(__file__).parent / "fixtures" / "antincendio_failed_canary_b367f0f6.json").read_text(
            encoding="utf-8"
        )
    )
    request = _northern_expansion_request()
    assert fixture["expected_outcome"] == "zero_lifecycle_published"
    assert len(fixture["records"]) == 2
    for record in fixture["records"]:
        grounded = _explicit_requested_geography(request, record["evidence_excerpt"])
        assert grounded["geography_match"] is record["expected_geography_match"]
        assert grounded["geography"] == ""
        assert _iso_date(record.get("published_at")) == record.get("expected_signal_date", record.get("published_at"))


def _northern_expansion_request() -> AdapterDiscoveryRequest:
    return AdapterDiscoveryRequest(
        intent="commercial_search",
        signal_ids=("production_expansion",),
        signal_match_mode="all",
        geographies=("Nord Italia", "Lombardia", "Veneto", "Piemonte", "Emilia-Romagna"),
        freshness_max_age_days=180,
        requested_count=3,
        budget_eur=0.1,
        query="PMI del Nord Italia con nuovi stabilimenti",
        technical_filters={},
    )


def test_geography_is_grounded_in_source_not_copied_from_query() -> None:
    request = _northern_expansion_request()
    parma = _explicit_requested_geography(
        request,
        "DSM-Firmenich annuncia un nuovo investimento nello stabilimento di Parma.",
    )
    assert parma["geography_match"] is True
    assert parma["geography"] == "Emilia-Romagna"
    assert parma["geography_match_method"] == "source_locality_to_region"

    pomezia = _explicit_requested_geography(
        request,
        "ECOSYSTEM inaugura il nuovo impianto a Pomezia.",
    )
    assert pomezia["geography_match"] is False
    assert pomezia["geography"] == ""


def test_geography_mapping_is_generic_across_italian_macro_areas() -> None:
    southern_request = AdapterDiscoveryRequest(
        intent="commercial_search",
        signal_ids=("production_expansion",),
        signal_match_mode="all",
        geographies=("Sud Italia",),
        freshness_max_age_days=180,
        requested_count=3,
        budget_eur=0.1,
        query="PMI del Sud Italia con nuovi stabilimenti",
        technical_filters={},
    )
    result = _explicit_requested_geography(
        southern_request,
        "TBK celebra il nuovo stabilimento dell'azienda calabrese.",
    )
    assert result["geography_match"] is True
    assert result["geography"] == "Calabria"
    assert result["geography_match_evidence"] == "calabrese"


def test_specific_geography_missing_is_rejected_before_semantic_cost() -> None:
    request = _northern_expansion_request()
    valid, code = _valid_record(
        {
            "company_name": "Target PMI Srl",
            "official_domain": "target-pmi.test",
            "official_domain_verified": True,
            "entity_class": "operating_company",
            "source_url": "https://target-pmi.test/news/nuovo-stabilimento",
            "source_publisher": "Target PMI Srl",
            "source_class": "official_company_website",
            "evidence_excerpt": "Target PMI Srl inaugura un nuovo stabilimento.",
            "published_at": date.today().isoformat(),
            "matched_signal_ids": ["production_expansion"],
            "company_size": "small",
            "geography": "",
        },
        request,
        date.today(),
    )
    assert valid is False
    assert code == "GEOGRAPHY_EVIDENCE_MISSING"


def test_parse_employee_count_italian() -> None:
    assert _parse_employee_count("L'azienda conta 85 dipendenti in Lombardia") == 85
    assert _parse_employee_count("oltre 1.200 lavoratori") == 1200
    assert _size_class_from_employees(85) == "medium"
    assert _size_class_from_employees(300) == "enterprise"


def test_public_contacts_from_mailto() -> None:
    html = '<a href="mailto:info@acme-pmi.it">scrivi</a> <a href="tel:+390212345678">chiama</a>'
    contacts = _public_contacts_from_html(html, source_url="https://acme-pmi.it/contatti", prefer_domain="acme-pmi.it")
    kinds = {item.kind: item.value for item in contacts}
    assert kinds["email"] == "info@acme-pmi.it"
    assert "390212345678" in kinds["phone"] or kinds["phone"].endswith("0212345678")


def test_publisher_mailto_dropped_when_company_domain_known() -> None:
    html = '<a href="mailto:redazione@news.test">x</a><a href="mailto:info@tbksrl.it">y</a>'
    contacts = _public_contacts_from_html(
        html,
        source_url="https://news.test/article",
        prefer_domain="tbksrl.it",
    )
    assert [item.value for item in contacts] == ["info@tbksrl.it"]
    assert _public_contacts_from_html(html, prefer_domain="tbksrl.it")  # company only
    assert _public_contacts_from_html('<a href="mailto:redazione@news.test">x</a>', prefer_domain="tbksrl.it") == ()


def test_publisher_phone_and_organization_jsonld_are_not_company_facts() -> None:
    html = """
    <a href="tel:+390212345678">Redazione</a>
    <script type="application/ld+json">
      {"@type":"Organization","name":"Publisher Spa","numberOfEmployees":500}
    </script>
    """
    assert _public_contacts_from_html(
        html,
        source_url="https://news.test/article",
        prefer_domain="target-pmi.it",
    ) == ()
    row = _enrich_record_from_page(
        {
            "company_name": "Target PMI",
            "official_domain": "target-pmi.it",
            "source_url": "https://news.test/article",
            "source_class": "recognized_news",
        },
        html=html,
    )
    assert row.get("legal_name") is None
    assert row.get("employee_count") is None
    assert not row.get("contacts")


def test_enrich_sets_size_and_listed() -> None:
    row = _enrich_record_from_page(
        {"company_name": "Acme"},
        text="Acme Spa, quotata in Borsa Italiana, con 40 dipendenti",
    )
    assert row["employee_count"] == 40
    assert row["company_size"] == "small"
    assert row["is_listed"] is True


def test_enrich_uses_official_organization_jsonld_for_scope_and_contacts() -> None:
    html = """
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "legalName": "Officina Verificata S.r.l.",
      "numberOfEmployees": {"@type": "QuantitativeValue", "maxValue": 48},
      "email": "info@officinaverificata.it",
      "telephone": "+39 02 12345678"
    }
    </script>
    """
    row = _enrich_record_from_page(
        {
            "company_name": "Officina Verificata",
            "official_domain": "officinaverificata.it",
            "official_enrichment_url": "https://officinaverificata.it/chi-siamo",
        },
        html=html,
    )
    assert row["legal_name"] == "Officina Verificata S.r.l."
    assert row["employee_count"] == 48
    assert row["company_size"] == "small"
    assert {(item["kind"], item["value"]) for item in row["contacts"]} == {
        ("email", "info@officinaverificata.it"),
        ("phone", "+39 02 12345678"),
    }


def test_contact_form_counts_only_on_official_enrichment_page() -> None:
    html = '<form action="/send"><label>Contattaci</label></form>'
    official = _enrich_record_from_page(
        {
            "company_name": "Acme",
            "official_domain": "acme.it",
            "official_enrichment_url": "https://acme.it/contatti",
        },
        html=html,
    )
    publisher = _enrich_record_from_page(
        {"company_name": "Acme", "official_domain": "acme.it", "source_url": "https://news.test/acme"},
        html=html,
    )
    assert official["contacts"] == [{
        "kind": "other",
        "value": "https://acme.it/contatti",
        "source_url": "https://acme.it/contatti",
        "verified": True,
    }]
    assert not publisher.get("contacts")
