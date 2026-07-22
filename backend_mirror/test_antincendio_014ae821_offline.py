from __future__ import annotations

import json
from pathlib import Path

from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest
from backend_mirror.source_adapters.generic_web import (
    _enqueue_content_shell_followup,
    _looks_like_company_name,
    _serp_company_hint,
)
from backend_mirror.source_adapters.generic_web_budget import GenericWebDiscoveryState


FIXTURE = Path(__file__).parent / "fixtures" / "antincendio_failed_canary_014ae821.json"


def test_014ae821_rejects_institutional_identities_that_burned_budget() -> None:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for item in payload["toxic_followups"]:
        assert not _looks_like_company_name(item["seed_identity"])
        hint = _serp_company_hint(
            title=item["seed_title"],
            snippet=item["seed_snippet"],
            url=item["seed_url"],
        )
        assert hint == item["expected_identity"]


def test_014ae821_does_not_enqueue_institutional_shell_followups() -> None:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    request = AdapterDiscoveryRequest(
        intent="production_expansion",
        signal_ids=("production_expansion",),
        signal_match_mode="any",
        geographies=("Nord Italia",),
        freshness_max_age_days=180,
        requested_count=3,
        budget_eur=0.10,
        query="Installiamo sistemi antincendio industriali",
        technical_filters={
            "universal_active_strategies": [
                {
                    "hypothesis_id": "hyp-event-production-expansion-1",
                    "signal_type": "production_expansion",
                    "event_type": "production_expansion",
                    "strategy_id": "production_expansion:event_specific",
                    "search_query": "aziende Nord Italia nuovo stabilimento",
                }
            ]
        },
    )
    state = GenericWebDiscoveryState()
    for item in payload["toxic_followups"]:
        _enqueue_content_shell_followup(
            state,
            identity_hint=item["seed_identity"],
            failed_url=item["seed_url"],
            request=request,
        )
    assert state.followup_queries == ()


def test_014ae821_recovers_operating_company_from_parsed_pages() -> None:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for item in payload["parsed_pages_without_candidates"]:
        hint = _serp_company_hint(
            title=item["title"],
            snippet=item["snippet"],
            url=item["url"],
        )
        assert hint == item["expected_identity"], item["url"]
