from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest
from backend_mirror.source_adapters.hiring import _validate_record
from backend_mirror.source_adapters.hiring_qualification import (
    QUALIFICATION_VALIDATOR_EPOCH,
    bootstrap_parsed_and_revalidation_queues,
    dedupe_key,
    replay_parsed_candidates,
    resolve_employer_identity,
    vacancy_geography_matches,
    vacancy_role_matches_sales,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _sales_request() -> AdapterDiscoveryRequest:
    return AdapterDiscoveryRequest(
        intent="hiring",
        signal_ids=("hiring_sales",),
        signal_match_mode="all",
        geographies=("Lombardia",),
        freshness_max_age_days=60,
        requested_count=5,
        budget_eur=0.125,
        query="commerciali Lombardia",
        sectors=(),
        technical_filters={},
        cursor=None,
    )


def test_geography_lombardia_nord_from_title_passes():
    assert vacancy_geography_matches(
        location="Trezzano - Sales - Vitalaire, Italy",
        title="Commerciale - Lombardia Nord",
        geographies=("Lombardia",),
    )


def test_geography_dpi_sales_lombardia_from_title_passes():
    assert vacancy_geography_matches(
        location="Field Based - Italy, Italien",
        title="DPI SALES SPECIALIST - DIVISIONE ANTINFORTUNISTICA LOMBARDIA",
        geographies=("Lombardia",),
    )


def test_geography_milano_passes():
    assert vacancy_geography_matches(
        location="Milano, Italy",
        title="CONSULENTE COMMERCIALE - MILANO",
        geographies=("Lombardia",),
    )


def test_geography_lazio_with_lombardia_only_in_unscoped_body_fails():
    assert not vacancy_geography_matches(
        location="Roma, Lazio, Italia",
        title="Project Manager Healthcare",
        geographies=("Lombardia",),
    )


def test_role_sales_titles_pass():
    for title in (
        "Commerciale - Lombardia Nord",
        "DPI SALES SPECIALIST Lombardia",
        "CONSULENTE COMMERCIALE - MILANO",
        "Junior Sales Consultant - Enterprise Solutions - Lombardia",
        "Agente di Commercio B2B - ENI PLENITUDE",
    ):
        ok, _ = vacancy_role_matches_sales(title=title)
        assert ok, title


def test_role_non_sales_titles_fail():
    for title in (
        "Application Engineer Lombardia e Piemonte",
        "Help Desk Specialist",
        "Project Manager - Software for Healthcare",
        "STAGE VISUAL MERCHANDISER (FT - Arese SC)",
    ):
        ok, code = vacancy_role_matches_sales(title=title)
        assert not ok, title
        assert code == "HIRING_ROLE_MISMATCH"


def test_verisure_domain_resolved_from_careers_host():
    record = resolve_employer_identity({
        "company_name": "Verisure",
        "vacancy_title": "CONSULENTE COMMERCIALE - MILANO",
        "location": "Milano, Italy",
        "source_url": "https://careers.verisure.com/it/it/job/r2022100220/consulente-commerciale-milano",
        "vacancy_source_domain": "careers.verisure.com",
        "published_at": "2026-07-02",
        "active": True,
        "source_class": "company_careers",
    })
    assert record["employer_official_domain"] == "verisure.com"
    ok, rejection = _validate_record(record, _sales_request(), date(2026, 7, 15))
    assert ok, rejection


def test_vitalaire_dedupe_key_collapses_variants():
    base = {
        "company_name": "VitalAire",
        "employer_official_domain": "vitalaire.com",
        "vacancy_title": "Commerciale - Lombardia Nord",
        "location": "Trezzano, Italy",
        "source_url": "https://airliquidehr.wd3.myworkdayjobs.com/en-us/airliquideexternalcareer/job/commerciale---lombardia-nord_r10094218",
    }
    variant = dict(base)
    variant["source_url"] = "https://airliquidehr.wd3.myworkdayjobs.com/en-ca/airliquideexternalcareer/job/italy-moncalieri/commerciale---lombardia-nord_r10094218/apply/applymanually"
    assert dedupe_key(base) == dedupe_key(variant)


def test_bootstrap_revalidation_queue_from_parsed_outcomes():
    outcomes = (
        {"canonical_url": "https://a.example/j/1", "parser_result": "success", "rejection_code": "GEOGRAPHY_MISMATCH"},
        {"canonical_url": "https://b.example/j/2", "parser_result": "empty", "rejection_code": "PARSE_FAILED"},
    )
    parsed, reval = bootstrap_parsed_and_revalidation_queues(outcomes, qualification_validator_epoch=1)
    assert parsed == ("https://a.example/j/1",)
    assert reval == ("https://a.example/j/1",)
    parsed2, reval2 = bootstrap_parsed_and_revalidation_queues(outcomes, qualification_validator_epoch=QUALIFICATION_VALIDATOR_EPOCH)
    assert parsed2 == ("https://a.example/j/1",)
    assert reval2 == ()


def test_offline_replay_first100_parsed_candidates():
    payload = json.loads((FIXTURES / "hiring_forensic_first100_pre_fix.json").read_text(encoding="utf-8"))
    rows = [row for row in payload["rows"] if row.get("parser_result") == "success"]
    assert len(rows) == 15
    replay = replay_parsed_candidates(rows, today=date(2026, 7, 15))
    assert replay.geography_pass >= 10
    assert replay.role_pass >= 4
    assert replay.domain_resolved >= 4
    assert replay.duplicates_removed >= 3
    assert replay.orchestrator_qualified >= 3
