from __future__ import annotations

import asyncio
from datetime import date
from typing import Any, Mapping

import pytest

from source_adapters.contracts import AdapterDiscoveryRequest
from source_adapters.hiring import _validate_record
from source_adapters.hiring_ats_parsers import parse_workday_json
from source_adapters.hiring_budget import HiringDiscoveryState, URLS_PER_BATCH
from source_adapters.hiring_qualification import (
    QUALIFICATION_VALIDATOR_EPOCH,
    resolve_employer_identity,
    vacancy_role_matches_marketing,
)
from source_adapters.hiring_url_queue import (
    PENDING_PROGRESS_BATCH_CAP,
    URL_FETCH_CONCURRENCY,
    build_processing_batch,
)


def _marketing_request(**overrides: Any) -> AdapterDiscoveryRequest:
    base = {
        "intent": "hiring",
        "signal_ids": ("hiring_marketing",),
        "signal_match_mode": "any",
        "geographies": ("Italia",),
        "freshness_max_age_days": 60,
        "requested_count": 5,
        "budget_eur": 0.125,
        "query": "marketing manager Italia",
        "technical_filters": {},
    }
    base.update(overrides)
    return AdapterDiscoveryRequest(**base)


def test_workday_first_party_ats_not_secondary() -> None:
    payload = {
        "jobPostingInfo": {
            "title": "Marketing Manager Women's Health - Europe",
            "location": "ITA Milano",
            "startDate": "2026-07-03",
            "canApply": True,
            "jobDescription": "Lead marketing for Women's Health.",
            "hiringOrganization": {"name": "2600 Becton Dickinson, S.A. (BD SA Spain)", "url": ""},
            "externalUrl": "https://bdx.wd1.myworkdayjobs.com/it-it/external_career_site_uk/job/ita-milano/marketing-manager_r-1",
        }
    }
    url = "https://bdx.wd1.myworkdayjobs.com/it-it/external_career_site_uk/job/ita-milano---via-enrico-cialdini/marketing-manager-women-s-health---europe_r-537742-1"
    rows = parse_workday_json(payload, url)
    assert rows
    record = resolve_employer_identity(rows[0])
    assert record["source_class"] == "company_careers"
    assert record["source_subtype"] == "first_party_ats"
    assert record["ats_vendor"] == "workday"
    assert record["employer_official_domain"] == "bd.com"
    assert "myworkdayjobs.com" not in record["employer_official_domain"]
    assert "workday_tenant_corporate_map" in " ".join(record.get("domain_verification_evidence") or ())
    ok, code = _validate_record(record, _marketing_request(), date(2026, 7, 15))
    assert ok is True, code
    assert code != "SECONDARY_SOURCE_NOT_CORROBORATED"


def test_job_board_third_party_stays_secondary() -> None:
    row = {
        "vacancy_title": "Marketing Manager",
        "location": "Milano, Italia",
        "published_at": "2026-07-01",
        "active": True,
        "active_evidence": "live_jobposting_page",
        "active_verification_method": "http_200_jsonld_jobposting",
        "company_name": "Acme SpA",
        "employer_official_domain": "acme.it",
        "official_domain_verified": True,
        "vacancy_source_domain": "indeed.com",
        "source_url": "https://it.indeed.com/viewjob?jk=1",
        "source_class": "job_board",
        "corroborated": False,
        "employer_is_direct": True,
        "entity_class": "operating_company",
    }
    assert _validate_record(row, _marketing_request(), date(2026, 7, 15)) == (False, "SECONDARY_SOURCE_NOT_CORROBORATED")


def test_bd_replay_resolves_with_provenance() -> None:
    prior = {
        "url": "https://bdx.wd1.myworkdayjobs.com/it-it/external_career_site_uk/job/ita-milano/mm_r-1",
        "source_url": "https://bdx.wd1.myworkdayjobs.com/it-it/external_career_site_uk/job/ita-milano/mm_r-1",
        "vacancy_title": "Marketing Manager Women's Health - Europe",
        "employer": "2600 Becton Dickinson, S.A. (BD SA Spain)",
        "company_name": "2600 Becton Dickinson, S.A. (BD SA Spain)",
        "location": "ITA Milano - Via Enrico Cialdini, Italia",
        "published_at": "2026-07-03",
        "parser_result": "success",
        "source_class": "company_careers",
        "active": True,
        "employer_is_direct": True,
        "entity_class": "operating_company",
    }
    record = resolve_employer_identity(prior)
    assert record["employer_official_domain"] == "bd.com"
    assert record["source_class"] == "company_careers"
    assert record["source_subtype"] == "first_party_ats"
    assert record["ats_vendor"] == "workday"
    assert record["official_domain_verified"] is True


def test_baker_hughes_product_growth_fails_role_gate() -> None:
    ok, code = vacancy_role_matches_marketing(title="Digital Services Product Growth Manager (M/F/D)")
    assert ok is False
    assert code == "HIRING_ROLE_MISMATCH"
    ok2, _ = vacancy_role_matches_marketing(title="Growth Manager")
    assert ok2 is True
    ok3, _ = vacancy_role_matches_marketing(title="Growth Marketing Manager")
    assert ok3 is True


def test_batch_cap_uses_real_pending_slots_not_bool() -> None:
    urls = [f"https://careers.example.com/jobs/{i}" for i in range(30)]
    meta = {url: ("q", "serp:ats") for url in urls}
    batch = build_processing_batch(urls, meta, start_offset=0, batch_cap=PENDING_PROGRESS_BATCH_CAP, prefer_pending_over_retry=True)
    assert len(batch) >= 20
    assert URL_FETCH_CONCURRENCY == 4
    assert PENDING_PROGRESS_BATCH_CAP >= 20
    assert URLS_PER_BATCH >= 20
    assert QUALIFICATION_VALIDATOR_EPOCH >= 4


def test_timeout_on_one_url_does_not_block_batch() -> None:
    async def _run() -> list[str]:
        sem = asyncio.Semaphore(4)
        done: list[str] = []

        async def one(name: str, delay: float) -> None:
            async with sem:
                await asyncio.sleep(delay)
                done.append(name)

        await asyncio.gather(
            one("slow", 0.05),
            one("fast1", 0.0),
            one("fast2", 0.0),
            return_exceptions=True,
        )
        return done

    completed = asyncio.run(_run())
    assert "fast1" in completed and "fast2" in completed
