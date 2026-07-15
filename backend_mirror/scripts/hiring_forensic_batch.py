#!/usr/bin/env python3
"""Forensic replay of materialized hiring URLs (read-only, no discovery)."""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from typing import Any, Dict, List
from urllib.parse import urlparse

import httpx

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from backend_mirror.source_adapters.hiring_url_queue import classify_url_prefetch
from backend_mirror.source_adapters.hiring_ats_parsers import detect_ats_vendor, parse_vacancy_html
from backend_mirror.source_adapters.hiring import _validate_record, parse_hiring_page
from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest
from backend_mirror.agents.structured_lanes import extract_jobposting_leads

_JS_SHELL_RE = re.compile(
    r"(?:__NEXT_DATA__|window\.__INITIAL_STATE__|data-automation-id=\"jobPostingPage\"|"
    r"wd-ApplicationShell|enableJsOnly|react-root|__NUXT__)",
    re.I,
)


def _decode_cursor(raw: str) -> dict:
    if not raw.startswith("hiring:v2:"):
        return {}
    payload = raw[len("hiring:v2:"):]
    return json.loads(base64.urlsafe_b64decode(payload + "==").decode("utf-8"))


def _sales_request() -> AdapterDiscoveryRequest:
    return AdapterDiscoveryRequest(
        intent="hiring",
        signal_ids=("hiring_sales",),
        signal_match_mode="all",
        geographies=("Lombardia",),
        freshness_max_age_days=60,
        requested_count=5,
        budget_eur=0.125,
        query="commerciali Lombardia",
        sectors=(),
        technical_filters={},
        cursor=None,
    )


def _jsonld_count(html: str) -> tuple[int, bool]:
    try:
        leads = extract_jobposting_leads(html, "https://example.test/job")
        return len(leads), bool(leads)
    except Exception:
        return 0, False


async def _forensic_one(client: httpx.AsyncClient, url: str, query_source: str) -> dict[str, Any]:
    prefetch = classify_url_prefetch(url, query_source=query_source)
    row: dict[str, Any] = {
        "canonical_url": prefetch["canonical_url"],
        "source_domain": prefetch["source_domain"],
        "source_class": prefetch["source_class"],
        "priority": prefetch["priority"],
        "ats_vendor": detect_ats_vendor(url),
        "prefetch_accept": prefetch["prefetch_accept"],
        "prefetch_rejection": prefetch.get("rejection_code"),
    }
    if not prefetch["prefetch_accept"]:
        row.update({
            "fetch_success": False,
            "rejection_code": prefetch["rejection_code"],
            "url_state": "rejected_final",
        })
        return row
    try:
        response = await asyncio.wait_for(client.get(url), timeout=15.0)
        row["http_status"] = response.status_code
        row["content_type"] = str(response.headers.get("content-type") or "")
        row["response_bytes"] = len(response.content or b"")
        row["final_url"] = str(response.url)
        row["redirect_chain"] = [str(h.url) for h in response.history]
        if response.status_code != 200:
            row.update({"fetch_success": False, "rejection_code": "FETCH_HTTP_ERROR", "url_state": "retryable_parser_failure"})
            return row
        html = response.text[:2_000_000]
        row["javascript_shell"] = bool(_JS_SHELL_RE.search(html[:50000]))
        jobposting_count, has_org = _jsonld_count(html)
        row["jsonld_jobposting_count"] = jobposting_count
        row["hiring_organization_present"] = has_org
        parsed = parse_hiring_page(html, str(response.url))
        row["parser_selected"] = parsed[0].get("extraction_method") if parsed else "none"
        row["parser_result"] = "success" if parsed else "empty"
        if parsed:
            record = parsed[0]
            row["vacancy_title"] = record.get("vacancy_title") or record.get("hiring_title")
            row["employer"] = record.get("company_name") or record.get("name")
            row["location"] = record.get("location")
            row["publication_date"] = record.get("published_at") or record.get("evidence_date")
            valid, rejection = _validate_record(record, _sales_request(), date.today())
            row["validation_result"] = "accepted" if valid else rejection
            row["rejection_code"] = "ACCEPTED" if valid else rejection
            row["url_state"] = "accepted" if valid else "rejected_final"
            row["fetch_success"] = True
        else:
            if row["javascript_shell"] and jobposting_count == 0:
                row["rejection_code"] = "JAVASCRIPT_SHELL"
                row["url_state"] = "retryable_parser_failure"
            elif jobposting_count == 0:
                row["rejection_code"] = "JSONLD_JOBPOSTING_MISSING"
                row["url_state"] = "retryable_parser_failure"
            else:
                row["rejection_code"] = "PARSE_FAILED"
                row["url_state"] = "retryable_parser_failure"
            row["fetch_success"] = True
    except asyncio.TimeoutError:
        row.update({"fetch_success": False, "rejection_code": "FETCH_TIMEOUT", "url_state": "retryable_parser_failure"})
    except Exception as exc:
        row.update({"fetch_success": False, "rejection_code": "FETCH_BLOCKED", "url_state": "retryable_parser_failure", "error": exc.__class__.__name__})
    return row


async def run(urls: list[str], meta: dict[str, str], limit: int) -> list[dict]:
    headers = {"User-Agent": "Mozilla/5.0 (compatible; MIRAX-Hiring-Forensic/1.0)", "Accept-Language": "it-IT,it;q=0.9"}
    sem = asyncio.Semaphore(4)
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers=headers, verify=False) as client:
        async def one(url: str) -> dict:
            async with sem:
                return await _forensic_one(client, url, meta.get(url, "unknown"))
        return await asyncio.gather(*[one(u) for u in urls[:limit]])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cursor-json", required=True, help="path to decoded hiring cursor json")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--out", default="-")
    args = parser.parse_args()
    state = json.loads(open(args.cursor_json, encoding="utf-8").read())
    urls = list(state.get("seen_urls") or [])[: args.limit]
    meta = {str(m.get("url") or ""): str(m.get("query_source") or "unknown") for m in state.get("url_meta") or []}
    rows = asyncio.run(run(urls, meta, args.limit))
    by_domain = Counter(r["source_domain"] for r in rows)
    by_ats = Counter(r["ats_vendor"] or "other" for r in rows)
    by_reject = Counter(r.get("rejection_code") or "UNKNOWN" for r in rows)
    summary = {
        "url_total": len(rows),
        "by_domain": dict(by_domain.most_common(30)),
        "by_ats": dict(by_ats.most_common()),
        "rejection_counts": dict(by_reject),
        "fetch_success": sum(1 for r in rows if r.get("fetch_success")),
        "parse_success": sum(1 for r in rows if r.get("parser_result") == "success"),
        "accepted": sum(1 for r in rows if r.get("rejection_code") == "ACCEPTED"),
        "javascript_shell": sum(1 for r in rows if r.get("javascript_shell")),
        "rows": rows,
    }
    out = json.dumps(summary, ensure_ascii=False, indent=2)
    if args.out == "-":
        print(out)
    else:
        open(args.out, "w", encoding="utf-8").write(out)


if __name__ == "__main__":
    main()
