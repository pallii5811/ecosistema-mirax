"""Unit checks for generic_web size/contact/why_now enrichment."""

from __future__ import annotations

from backend_mirror.source_adapters.generic_web import (
    _enrich_record_from_page,
    _parse_employee_count,
    _public_contacts_from_html,
    _size_class_from_employees,
)


def test_parse_employee_count_italian() -> None:
    assert _parse_employee_count("L'azienda conta 85 dipendenti in Lombardia") == 85
    assert _parse_employee_count("oltre 1.200 lavoratori") == 1200
    assert _size_class_from_employees(85) == "medium"
    assert _size_class_from_employees(300) == "enterprise"


def test_public_contacts_from_mailto() -> None:
    html = '<a href="mailto:info@acme-pmi.it">scrivi</a> <a href="tel:+390212345678">chiama</a>'
    contacts = _public_contacts_from_html(html, source_url="https://news.example/x", prefer_domain="acme-pmi.it")
    kinds = {item.kind: item.value for item in contacts}
    assert kinds["email"] == "info@acme-pmi.it"
    assert "390212345678" in kinds["phone"] or kinds["phone"].endswith("0212345678")


def test_publisher_mailto_dropped_when_company_domain_known() -> None:
    html = '<a href="mailto:redazione@news.test">x</a><a href="mailto:info@tbksrl.it">y</a>'
    contacts = _public_contacts_from_html(html, prefer_domain="tbksrl.it")
    assert [item.value for item in contacts] == ["info@tbksrl.it"]
    assert _public_contacts_from_html(html, prefer_domain="tbksrl.it")  # company only
    assert _public_contacts_from_html('<a href="mailto:redazione@news.test">x</a>', prefer_domain="tbksrl.it") == ()


def test_enrich_sets_size_and_listed() -> None:
    row = _enrich_record_from_page(
        {"company_name": "Acme"},
        text="Acme Spa, quotata in Borsa Italiana, con 40 dipendenti",
    )
    assert row["employee_count"] == 40
    assert row["company_size"] == "small"
    assert row["is_listed"] is True
