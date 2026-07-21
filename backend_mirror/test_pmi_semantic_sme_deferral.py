"""Regression: PMI open-world queries must not kill discovery before market-scope."""
from __future__ import annotations

from datetime import date

from source_adapters.contracts import AdapterDiscoveryRequest
from source_adapters.generic_web import _valid_record
from source_adapters.generic_web_budget import GenericWebDiscoveryState
from source_adapters.generic_web_provenance import attach_generic_provenance, source_text_hash
from source_adapters.universal_evidence import extract_evidence_from_text


def _request(*, semantic: bool = True) -> AdapterDiscoveryRequest:
    return AdapterDiscoveryRequest(
        intent="commercial_search",
        signal_ids=("production_expansion",),
        signal_match_mode="any",
        geographies=("Nord Italia", "Lombardia"),
        freshness_max_age_days=365,
        requested_count=3,
        budget_eur=0.10,
        query=(
            "Installiamo sistemi antincendio industriali. "
            "Trovami 3 PMI del Nord Italia con segnali recenti di nuovi stabilimenti."
        ),
        sectors=("manifatturiero",),
        technical_filters={
            "universal_engine": True,
            "semantic_authority_required": semantic,
        },
    )


def _with_provenance(record: dict, text: str) -> dict:
    attach_generic_provenance(
        record,
        adapter_id="generic_web_research_v1",
        search_scope="test",
        execution_round=1,
        provider_call_id="serp:test:1",
        page_fetch_id_value="pf-test-1",
        source_text=text,
    )
    assert source_text_hash(text)
    return record


def test_pmi_semantic_path_defers_unknown_sme_size() -> None:
    text = (
        "Meccanica Nord Srl inaugura un nuovo stabilimento a Bergamo nel marzo 2025, "
        "aumentando la capacità produttiva dello stabilimento lombardo con un investimento "
        "documentato dalla direzione aziendale."
    )
    record = _with_provenance(
        {
            "company_name": "Meccanica Nord Srl",
            "official_domain": "",
            "official_domain_verified": False,
            "entity_class": "operating_company",
            "matched_signal_ids": ["production_expansion"],
            "published_at": "",
            "geography": "Lombardia",
            "source_url": "https://news.example/meccanica-nord-nuovo-stabilimento",
            "source_publisher": "News Example",
            "source_class": "recognized_news",
            "evidence_excerpt": "Meccanica Nord Srl inaugura un nuovo stabilimento a Bergamo.",
            "extraction_method": "semantic_deferred_news_candidate",
            "company_size": "",
            "employee_count": None,
        },
        text,
    )
    ok, code = _valid_record(record, _request(semantic=True), date.today())
    assert ok, code


def test_pmi_non_semantic_still_requires_sme_when_unknown() -> None:
    text = (
        "Meccanica Nord comunica un ampliamento produttivo documentato presso lo stabilimento "
        "di Bergamo con investimento e nuovi macchinari per la linea produttiva."
    )
    record = _with_provenance(
        {
            "company_name": "Meccanica Nord Srl",
            "official_domain": "meccanicanord.example",
            "official_domain_verified": True,
            "entity_class": "operating_company",
            "matched_signal_ids": ["production_expansion"],
            "published_at": "2026-03-01",
            "geography": "Lombardia",
            "source_url": "https://meccanicanord.example/news/ampliamento",
            "source_publisher": "Meccanica Nord",
            "source_class": "official_company_website",
            "evidence_excerpt": "ampliamento produttivo documentato",
            "extraction_method": "deterministic_primary_page",
            "why_now": "ampliamento produttivo documentato",
            "buyer_fit": 0.8,
            "company_size": "",
            "employee_count": None,
        },
        text,
    )
    ok, code = _valid_record(record, _request(semantic=False), date.today())
    assert not ok
    assert code == "SME_STATUS_UNVERIFIED"


def test_production_expansion_evidence_extracts() -> None:
    events = extract_evidence_from_text(
        text=(
            "Il 12 marzo 2025 Meccanica Nord Srl ha inaugurato un nuovo stabilimento "
            "a Bergamo, aumentando la capacità produttiva."
        ),
        source_url="https://news.example/articolo",
        company_name_hint="Meccanica Nord Srl",
        requested_signals=("production_expansion",),
    )
    assert events
    assert events[0].event_type == "production_expansion"


def test_discovery_soft_cap_scales_with_hard_cap() -> None:
    state = GenericWebDiscoveryState()
    assert state.discovery_cap_eur(0.05) <= 0.015 + 1e-9
    assert state.discovery_cap_eur(0.10) >= 0.03 - 1e-9
