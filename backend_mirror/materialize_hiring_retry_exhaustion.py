"""Materialize the persisted Hiring Marketing retry cohort without network I/O."""
from __future__ import annotations

import argparse
from collections import Counter
import json
import re
import sys
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlparse

from backend_mirror.source_adapters.hiring_retry_policy import (
    apply_retry_policy,
    attempted_strategies,
    available_fallbacks,
)

SEARCH_ID = "2f68adb3-016e-4b1b-8b9f-754a703a1a7c"
_MARKETING = re.compile(r"(?:marketing|social.media|performance.marketer)", re.I)
_ITALIAN_GEO = re.compile(r"(?:milano|lombardia|lodi|bergamo|brescia|monza|pavia|varese|como|lecco|cremona|mantova|sondrio|italy|italia)", re.I)
_LISTING = re.compile(r"(?:[?&]page=|/jobs/(?:marketing-manager|digital|comunicazione|area-manager|brand-manager)(?:/|$)|/talent/|/lavoro/online-marketing$)", re.I)


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower().removeprefix("www.")


def _fetch_attempts(row: Mapping[str, Any]) -> int:
    if row.get("fetch_attempt_count") is not None:
        return int(row.get("fetch_attempt_count") or 0)
    return int(any(row.get(key) is not None for key in ("http_status", "fetch_success", "fetch_path")))


def _probability(row: Mapping[str, Any], url: str) -> float:
    title = str(row.get("vacancy_title") or "")
    location = str(row.get("location") or "")
    employer = str(row.get("employer") or "")
    domain = str(row.get("employer_official_domain") or "")
    individual = not _LISTING.search(url)
    score = 0.0
    if individual and _MARKETING.search(f"{title} {url}"):
        score += 0.35
    if individual and _ITALIAN_GEO.search(f"{location} {url}"):
        score += 0.35
    if employer:
        score += 0.15
    if domain:
        score += 0.10
    if row.get("active") is True or available_fallbacks(row):
        score += 0.05
    return round(min(score, 1.0), 2)


def materialize(rows: list[Mapping[str, Any]]) -> dict[str, Any]:
    materialized: list[dict[str, Any]] = []
    for source in rows:
        row = dict(source)
        url = str(row.get("canonical_url") or row.get("url") or "").strip()
        classified = apply_retry_policy(row)
        probability = _probability(row, url)
        materialized.append({
            "canonical_url": url.lower().rstrip("/"),
            "source_host": str(row.get("host") or row.get("source_domain") or _host(url)),
            "ats_vendor": row.get("ats_vendor"),
            "rejection_code": row.get("rejection_code") or row.get("validation_result"),
            "http_status": row.get("cxs_http_status") or row.get("http_status"),
            "parser_result": row.get("parser_selected") or row.get("parser_result"),
            "cxs_attempts": int(row.get("cxs_attempt_count") or len(row.get("cxs_attempts") or ())),
            "fetch_attempts": _fetch_attempts(row),
            "last_attempt_at": row.get("last_attempt_at"),
            "fallbacks_already_attempted": list(attempted_strategies(row)),
            "fallbacks_still_available": list(available_fallbacks(row)),
            "vacancy_title": row.get("vacancy_title"),
            "location": row.get("location"),
            "employer": row.get("employer"),
            "employer_official_domain": row.get("employer_official_domain"),
            "probability_italian_marketing_vacancy": probability,
            "retry_attempt_count": classified.get("retry_attempt_count"),
            "retry_strategy": classified.get("retry_strategy"),
            "next_retry_at": classified.get("next_retry_at"),
            "max_retry_attempts": classified.get("max_retry_attempts"),
            "terminal_after_reason": classified.get("terminal_after_reason"),
            "final_decision": classified.get("url_state"),
        })

    if len(materialized) != 52 or len({row["canonical_url"] for row in materialized}) != 52:
        raise SystemExit("forensic cohort reconciliation failed: expected exactly 52 unique URLs")
    terminal = [row for row in materialized if str(row["final_decision"]).startswith("rejected_final")]
    transient = [row for row in materialized if row["final_decision"] == "retryable_transient"]
    fallback = [row for row in materialized if row["final_decision"] == "retryable_alternate_strategy"]
    plausible = [row for row in materialized if row["probability_italian_marketing_vacancy"] >= 0.70]
    expected_max = len([row for row in plausible if row["fallbacks_still_available"]])
    decision = "A" if expected_max >= 4 else "B"
    return {
        "search_id": SEARCH_ID,
        "mode": "offline_persisted_outcomes_only",
        "data_quality": {
            "last_attempt_at": "not persisted by the historical runtime; reported as null, never fabricated",
            "fetch_attempts": "historical count inferred as one when an HTTP/fetch outcome is present",
            "probability": "conservative deterministic URL/title/location metadata score; not qualification",
        },
        "reconciliation": {"expected": 52, "materialized": len(materialized), "unique_urls": 52},
        "summary": {
            "retry_totali": 52,
            "terminali_subito": len(terminal),
            "transient_reali": len(transient),
            "fallback_diversi_disponibili": len(fallback),
            "plausible_italian_marketing": len(plausible),
            "expected_max_new_qualified": expected_max,
            "automatic_decision": decision,
            "coverage": "SUPPORTED_PARTIAL" if decision == "B" else "RETRY_ONCE_AUTHORIZABLE",
            "verified_leads": 1,
            "termination": "partial_sources_exhausted" if decision == "B" else None,
            "rejection_code_counts": dict(Counter(str(row["rejection_code"]) for row in materialized)),
            "final_decision_counts": dict(Counter(str(row["final_decision"]) for row in materialized)),
        },
        "rows": materialized,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    rows = json.load(sys.stdin)
    report = materialize(rows)
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
