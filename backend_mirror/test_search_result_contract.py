from __future__ import annotations

import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")

from search_leads_sync import normalize_search_lead_rows
from worker_supabase import _cap_search_results, _extract_first_social_link


def test_requested_result_cap_is_hard() -> None:
    leads = [
        {"azienda": f"Company {index}", "sito": f"https://company-{index}.it"}
        for index in range(15)
    ]
    assert len(_cap_search_results(leads, 5)) == 5


def test_search_lead_batch_has_unique_conflict_keys() -> None:
    rows = normalize_search_lead_rows(
        "00000000-0000-0000-0000-000000000001",
        None,
        [
            {"azienda": "Acme", "sito": "https://www.acme.it", "telefono": "111"},
            {"azienda": "Acme enriched", "sito": "https://acme.it", "email": "info@acme.it"},
        ],
    )
    assert len(rows) == 1
    assert rows[0]["dedupe_key"] == "web:acme.it"
    assert rows[0]["email"] == "info@acme.it"


def test_hot_accounts_are_ranked_before_cap() -> None:
    leads = [
        {"azienda": "Warm", "sito": "https://warm.it", "hotness_score": 65},
        {"azienda": "Hot", "sito": "https://hot.it", "hotness_score": 92},
    ]
    ranked = _cap_search_results(leads, 1, prioritize_hot=True)
    assert ranked[0]["azienda"] == "Hot"


def test_official_site_social_links_are_extracted() -> None:
    html = '<a href="https://www.linkedin.com/company/acme-srl/">LinkedIn</a>'
    assert _extract_first_social_link(html, "linkedin") == "https://www.linkedin.com/company/acme-srl/"


if __name__ == "__main__":
    test_requested_result_cap_is_hard()
    test_search_lead_batch_has_unique_conflict_keys()
    test_hot_accounts_are_ranked_before_cap()
    test_official_site_social_links_are_extracted()
    print("test_search_result_contract: 4/4 OK")
