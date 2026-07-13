#!/usr/bin/env python3
"""Test hiring multi-source parsing (deterministic, no network)."""
from __future__ import annotations

import sys

from hiring_sources import _hiring_signals_from_jobs, _parse_job_titles_from_html, _role_in_text


def test_role_in_text_commerciale_not_communication():
    assert _role_in_text("commerciale b2b milano", ["commerciale"])
    assert not _role_in_text("communication agency milano", ["commerciale"])


def test_parse_job_titles_from_html():
    html = """
    <html><body>
    <h3>Commerciale esterno - Milano</h3>
    <li>Stage marketing digital</li>
    <span>Communication manager</span>
    </body></html>
    """
    titles = _parse_job_titles_from_html(html, ["commerciale", "sales"])
    assert any("commerciale" in t.lower() for t in titles)
    assert not any("communication manager" in t.lower() for t in titles)


def test_hiring_signals_from_jobs_evidence():
    sigs = _hiring_signals_from_jobs(
        ["Commerciale B2B"],
        source="google_jobs",
        source_label="Google Jobs",
        url="https://google.com/search?q=test",
        company="Acme Srl",
    )
    assert sigs[0]["type"] == "hiring"
    offers = [e for e in sigs[0]["evidence"] if e.get("label") == "Offerta"]
    assert offers[0]["value"] == "Commerciale B2B"


def main() -> int:
    test_role_in_text_commerciale_not_communication()
    test_parse_job_titles_from_html()
    test_hiring_signals_from_jobs_evidence()
    print("test_hiring_sources: 3/3 OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
