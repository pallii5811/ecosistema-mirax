"""Offline reproduction of canary 4fdaeaa3 discovery first-loss point."""
from __future__ import annotations

import json
from pathlib import Path

from backend_mirror.source_adapters.cheap_discovery_prefilter import (
    DiscoveryHit,
    has_concrete_expansion_event,
    prefilter_discovery_hit,
)
from backend_mirror.source_adapters.generic_web import _company_identity_hint, _title_company_leading

FIXTURE = Path(__file__).parent / "fixtures" / "antincendio_failed_canary_4fdaeaa3.json"


def test_geography_serp_noise_vs_one_stale_accepted_hit() -> None:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert payload["funnel"]["prefilter_accepted"] == 1
    assert payload["funnel"]["canonical_candidates"] == 0
    for item in payload["noise_examples"]:
        hit = DiscoveryHit(title=item["title"], url=item["url"], snippet=item.get("snippet") or "")
        assert not has_concrete_expansion_event(hit.title, hit.snippet)


def test_fetched_bracchi_page_company_is_bracchi_not_castrezzato() -> None:
    page = json.loads(FIXTURE.read_text(encoding="utf-8"))["fetched_page"]
    assert _title_company_leading(page["title"]) == page["expected_company_hint"]
    html = f"<html><body><article>{page['source_excerpt']}</article></body></html>"
    assert (
        _company_identity_hint(title=page["title"], snippet=page["snippet"], html=html)
        == page["expected_company_hint"]
    )
    assert _title_company_leading(page["title"]) != page["buggy_company_hint"]


def test_industrial_serp_titles_yield_operating_companies() -> None:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for item in payload["industrial_serp_positive_examples"]:
        assert _title_company_leading(item["title"]) == item["expected_company"]
        snippet = item.get("snippet") or f"{item['title']} nuovo stabilimento inaugurato"
        assert has_concrete_expansion_event(item["title"], snippet)
        assert prefilter_discovery_hit(
            DiscoveryHit(title=item["title"], url="https://example.test/x", snippet=snippet)
        ).accepted
