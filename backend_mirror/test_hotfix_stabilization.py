#!/usr/bin/env python3
"""HOTFIX 0 — test ANAC JSON guard + poor lead fallback + lead name resolution."""
from __future__ import annotations

import asyncio
import sys

from business_events_enrich import (
    _lead_has_valid_website,
    _lead_name,
    detect_tender_signals,
    enrich_poor_lead_fallback,
)


def test_lead_name():
    assert _lead_name({"nome": "Acme Srl"}) == "Acme Srl"
    assert _lead_name({"azienda": "Beta"}) == "Beta"
    assert _lead_name({}) == ""


def test_no_website():
    lead = {"sito": "NO WEBSITE", "tech_stack": ["NO WEBSITE"]}
    assert not _lead_has_valid_website(lead)
    lead2 = {"sito": "https://acme.it"}
    assert _lead_has_valid_website(lead2)


async def test_anac_no_crash():
    # Must not raise or print errors — empty list OK
    out = await detect_tender_signals("Impresa Edile Test XYZ Non Esiste")
    assert isinstance(out, list)


async def test_poor_fallback_no_piva():
    out = await enrich_poor_lead_fallback({"sito": "NO WEBSITE"}, "Modena")
    assert out == []


def main() -> int:
    test_lead_name()
    test_no_website()
    asyncio.run(test_anac_no_crash())
    asyncio.run(test_poor_fallback_no_piva())
    print("test_hotfix_stabilization: 4/4 OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
