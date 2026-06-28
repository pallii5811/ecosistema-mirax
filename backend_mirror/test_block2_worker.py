"""Blocco 2 — worker freshness + opportunity score unit tests."""
from datetime import datetime, timedelta, timezone

from worker_supabase import _calc_freshness_score, _calc_opportunity_score


def test_freshness_decay():
    now = datetime.now(timezone.utc).replace(microsecond=0)
    iso = now.strftime('%Y-%m-%dT%H:%M:%SZ')
    assert _calc_freshness_score(iso) >= 99
    old = (now - timedelta(days=15)).strftime('%Y-%m-%dT%H:%M:%SZ')
    assert 45 <= _calc_freshness_score(old) <= 55
    ancient = (now - timedelta(days=31)).strftime('%Y-%m-%dT%H:%M:%SZ')
    assert _calc_freshness_score(ancient) == 0
    assert _calc_freshness_score(None) == 0


def test_opportunity_score_rule_based():
    high = {
        "meta_pixel": False,
        "sito": None,
        "instagram": None,
        "tech_stack": ["MISSING FB PIXEL", "NO WEBSITE"],
        "technical_report": {"seo_disaster": True, "has_dmarc": False},
    }
    assert _calc_opportunity_score(high) >= 70

    low = {
        "meta_pixel": True,
        "sito": "https://x.it",
        "instagram": "@x",
        "tech_stack": ["SSL", "Meta Pixel"],
        "technical_report": {},
        "reviews_count": 50,
        "rating": 4.8,
    }
    assert _calc_opportunity_score(low) == 0


if __name__ == "__main__":
    test_freshness_decay()
    test_opportunity_score_rule_based()
    print("[test_block2_worker] OK")
