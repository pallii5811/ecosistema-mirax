#!/usr/bin/env python3
"""Offline semantic replay for persisted Q7 shadow evidence without new SERP."""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from dotenv import dotenv_values
from supabase import create_client

ROOT = Path("/home/worker/app/backend-staging")
sys.path.insert(0, str(ROOT))

SEARCH_ID = sys.argv[1] if len(sys.argv) > 1 else "ca7b0d50-37b3-44e5-b553-11583851384e"


async def main() -> None:
    env = dotenv_values(ROOT / ".env")
    sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
    job = sb.table("searches").select("intent,progress").eq("id", SEARCH_ID).single().execute().data
    intent = job.get("intent") or {}
    progress = job.get("progress") or {}
    contract = (intent.get("uqe_plan") or {}).get("semantic_query_contract") or intent.get("semantic_query_contract")
    rejected = (progress.get("shadow_resume") or {}).get("rejected_candidates") or []
    from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest, EvidenceRecord, OpportunityCandidate
    from backend_mirror.source_adapters.orchestrator import semantic_authority_qualifier

    request = AdapterDiscoveryRequest(
        intent="funding",
        signal_ids=tuple(intent.get("required_signals") or ("funding",)),
        signal_match_mode="all",
        geographies=("Italia",),
        freshness_max_age_days=180,
        requested_count=2,
        budget_eur=0.10,
        query=str(intent.get("query") or intent.get("original_query") or ""),
        sectors=(),
        technical_filters={
            "semantic_authority_required": True,
            "semantic_query_contract": contract,
            "universal_engine": True,
        },
        cursor=None,
    )
    if not rejected:
        print(json.dumps({"ok": False, "reason": "no_rejected_candidates"}, ensure_ascii=False))
        return
    item = rejected[0]
    excerpt = str(item.get("evidence_excerpt") or item.get("source_text") or "x" * 200)
    source_text = str(item.get("source_text") or excerpt)
    candidate = OpportunityCandidate(
        canonical_company_name=str(item.get("entity_hint") or "Replay Co"),
        company_identifiers={},
        official_domain=str(item.get("official_domain") or "example.it"),
        entity_class="operating_company",
        geographies=("Italia",),
        buyer_fit=None,
        signal_id="funding",
        signal_date="2026-06-01",
        evidence=(
            EvidenceRecord(
                signal_id="funding",
                source_url=str(item.get("source_url") or "https://example.it/news"),
                source_publisher="replay",
                source_class="recognized_news",
                excerpt=excerpt[:1200],
                observed_at="2026-07-20T00:00:00Z",
                published_at="2026-06-01",
                extraction_method="replay",
                confidence=0.7,
                provenance={
                    "source_text": source_text,
                    "origin_page_fetch_id": item.get("origin_page_fetch_id") or "replay-fetch",
                    "origin_source_text_hash": item.get("origin_source_text_hash") or "hash",
                    "page_title": item.get("page_title") or "",
                    "search_snippet": item.get("search_snippet") or "",
                },
            ),
        ),
        why_now=None,
        contacts=(),
        confidence=0.7,
        contradiction_flags=(),
        provenance={"adapter_id": "generic_web_research_v1"},
        adapter_id="generic_web_research_v1",
        adapter_version="1",
        official_domain_verified=False,
        official_domain_confidence=0.0,
    )
    decision = await semantic_authority_qualifier(candidate, request)
    print(json.dumps({
        "ok": True,
        "search_id": SEARCH_ID,
        "qualified": decision.qualified,
        "rejection_code": decision.rejection_code,
        "reasons": list(decision.reasons),
        "semantic_grounding": decision.semantic_grounding,
    }, ensure_ascii=False, default=str))


if __name__ == "__main__":
    asyncio.run(main())
