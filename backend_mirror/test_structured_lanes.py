"""Offline tests for zero-LLM source lanes."""
from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import time
from contextlib import closing
from datetime import datetime

import anac_indexer
from anac_client import _to_signal
from agents.structured_lanes import extract_jobposting_leads, infer_hiring_roles


def _build_anac_fixture(path: str) -> None:
    with closing(sqlite3.connect(path)) as conn:
        anac_indexer._init_db(conn)
        today = datetime.now().date().isoformat()
        conn.execute(
            "INSERT INTO tenders(cig,date,amount,object,authority,province,region,status,resource_date) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            ("CIG001", today, 250000, "Impianto di depurazione acque", "Comune", "Bari", "Puglia", "aggiudicata", "fixture"),
        )
        conn.execute(
            "INSERT INTO winners(cig,company_name,cf,role,resource_date) VALUES (?,?,?,?,?)",
            ("CIG001", "Acque Pulite Srl", "01234567890", "aggiudicatario", "fixture"),
        )
        conn.commit()


def test_anac_discovers_winners_by_need() -> None:
    handle, path = tempfile.mkstemp(suffix=".db")
    os.close(handle)
    try:
        _build_anac_fixture(path)
        records = anac_indexer.discover_companies(
            ["aziende depurazione acque"],
            location="Puglia",
            max_records=10,
            db_path=path,
        )
        assert len(records) == 1
        assert records[0]["company_name"] == "Acque Pulite Srl"
        assert records[0]["cf"] == "01234567890"
    finally:
        for attempt in range(5):
            try:
                os.unlink(path)
                break
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.05)


def test_anac_date_first_discovery_without_sector_tokens() -> None:
    handle, path = tempfile.mkstemp(suffix=".db")
    os.close(handle)
    try:
        _build_anac_fixture(path)
        records = anac_indexer.discover_companies(
            ["Trova aziende che hanno recentemente vinto gare pubbliche in Italia"],
            location="Italia",
            max_records=10,
            db_path=path,
        )
        assert len(records) == 1
        assert records[0]["company_name"] == "Acque Pulite Srl"
    finally:
        for attempt in range(5):
            try:
                os.unlink(path)
                break
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.05)


def test_anac_signal_keeps_verification_status() -> None:
    signal = _to_signal(
        {
            "cig": "CIG001",
            "object": "Depurazione acque",
            "status": "aggiudicata",
            "company_name": "Acque Pulite Srl",
        },
        "Acque Pulite Srl",
    )
    assert signal["status"] == "confirmed"
    assert signal["tender_status"] == "aggiudicata"


def test_jobposting_jsonld_is_extracted_without_llm() -> None:
    payload = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": "Commerciale B2B",
        "datePosted": "2026-07-01",
        "hiringOrganization": {
            "@type": "Organization",
            "name": "Vendite Futuro Srl",
            "sameAs": "https://venditefuturo.it",
        },
    }
    html = f'<script type="application/ld+json">{json.dumps(payload)}</script>'
    leads = extract_jobposting_leads(html, "https://jobs.example/offerta")
    assert len(leads) == 1
    assert leads[0]["website"] == "https://venditefuturo.it"
    assert leads[0]["matched_signals"] == ["hiring"]
    assert leads[0]["hiring_title"] == "Commerciale B2B"


def test_job_board_cannot_become_company_website() -> None:
    payload = {
        "@type": "JobPosting",
        "title": "Developer",
        "hiringOrganization": {"name": "Acme Srl", "sameAs": "https://indeed.it/company/acme"},
    }
    html = f'<script type="application/ld+json">{json.dumps(payload)}</script>'
    leads = extract_jobposting_leads(html, "https://indeed.it/viewjob/1")
    assert leads[0]["website"] == ""


def test_hiring_role_inference() -> None:
    assert infer_hiring_roles({"hiring_roles": ["sales manager"]}) == ["sales manager"]
    inferred = infer_hiring_roles({"original_query": "aziende che stanno assumendo commerciali a Roma"})
    assert inferred and inferred[0].startswith("commerciali")


if __name__ == "__main__":
    test_anac_discovers_winners_by_need()
    test_anac_signal_keeps_verification_status()
    test_jobposting_jsonld_is_extracted_without_llm()
    test_job_board_cannot_become_company_website()
    test_hiring_role_inference()
    print("test_structured_lanes: 5/5 OK")
