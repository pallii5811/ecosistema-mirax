#!/usr/bin/env python3
"""Test hiring enrichment — ruoli, parsing careers, cap intent-aware."""
from __future__ import annotations

import sys

from business_events_enrich import (
    _careers_html_qualifies,
    _expand_hiring_roles,
    _extract_job_titles_from_careers_html,
    _hiring_jobs_from_signal,
    _intent_hiring_roles,
    _make_signal,
    apply_signals_to_lead,
    intent_requires_external_enrichment,
    resolve_enrichment_cap,
)


def test_intent_hiring_roles_commercial_intent():
    intent = {
        "signals": [{"type": "hiring", "params": {"role": "commerciale"}}],
        "target_profile": {"roles": ["marketing"]},
        "hiring_roles": ["programmatore"],
    }
    roles = _intent_hiring_roles(intent)
    assert "commerciale" in roles
    assert "marketing" in roles
    assert "programmatore" in roles


def test_intent_requires_external():
    assert intent_requires_external_enrichment({"signals": [{"type": "hiring"}]})
    assert intent_requires_external_enrichment({"required_signals": ["tender_won"]})
    assert not intent_requires_external_enrichment({"signals": [{"type": "site_stale"}]})


def test_resolve_cap_hiring():
    cap_plain = resolve_enrichment_cap(None, 200)
    assert 1 <= cap_plain <= 120
    cap_hiring = resolve_enrichment_cap({"signals": [{"type": "hiring"}]}, 118)
    assert cap_hiring == 118


def test_expand_commerciale_synonyms():
    variants = _expand_hiring_roles(["commerciale"])
    assert "sales" in variants
    assert "venditori" in variants


def test_extract_job_titles_commerciale():
    html = """
    <html><body><h2>Lavora con noi</h2>
    <ul><li>Commerciale B2B Milano</li><li>Stage marketing</li></ul>
    <p>Assumiamo personale qualificato. Candidati ora.</p></body></html>
    """
    titles = _extract_job_titles_from_careers_html(html, _expand_hiring_roles(["commerciale"]))
    assert any("commerciale" in t.lower() for t in titles)


def test_careers_strict_without_role():
    html = "<html><body><h1>Lavora con noi</h1><p>Posizioni aperte. Candidati.</p></body></html>"
    assert not _careers_html_qualifies(html.lower(), _expand_hiring_roles(["commerciale"]))
    assert _careers_html_qualifies(html.lower(), [])


def test_apply_signals_hiring_jobs_from_evidence():
    sig = _make_signal(
        "hiring",
        "Sta assumendo — Commerciale B2B",
        evidence=[
            {"label": "Fonte", "value": "Sito aziendale", "source": "website_careers"},
            {"label": "Offerta", "value": "Commerciale B2B Milano", "source": "website_careers"},
        ],
    )
    lead: dict = {}
    apply_signals_to_lead(lead, [sig])
    jobs = lead.get("business_hiring_jobs") or []
    assert len(jobs) == 1
    assert "commerciale" in jobs[0]["title"].lower()


def test_hiring_jobs_from_signal_skips_generic():
    sig = {"type": "hiring", "title": "Sta assumendo — pagina careers rilevata sul sito", "evidence": []}
    assert _hiring_jobs_from_signal(sig) == []


def main() -> int:
    test_intent_hiring_roles_commercial_intent()
    test_intent_requires_external()
    test_resolve_cap_hiring()
    test_expand_commerciale_synonyms()
    test_extract_job_titles_commerciale()
    test_careers_strict_without_role()
    test_apply_signals_hiring_jobs_from_evidence()
    test_hiring_jobs_from_signal_skips_generic()
    print("test_hiring_enrichment: 8/8 OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
