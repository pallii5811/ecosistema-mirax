#!/usr/bin/env python3
"""Offline requalification of paid Q7 grounding rejections without new SERP."""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import sys
import types
from dataclasses import replace
from pathlib import Path

import httpx
from bs4 import BeautifulSoup
from dotenv import dotenv_values

ROOT = Path("/home/worker/app/backend-staging")
sys.path.insert(0, str(ROOT))
_pkg = types.ModuleType("backend_mirror")
_pkg.__path__ = [str(ROOT)]
sys.modules["backend_mirror"] = _pkg

SEARCH_ID = sys.argv[1] if len(sys.argv) > 1 else "212508b6-2c46-4338-826f-1a9e2b58526d"


async def replay_url(
    *,
    url: str,
    title: str,
    snippet: str,
    contract_raw: dict,
    intent: dict,
    sb,
) -> dict:
    from cost_context import reset_current_cost_governor, set_current_cost_governor
    from cost_governor import ResearchCostGovernor
    from source_adapters.contracts import AdapterDiscoveryRequest, EvidenceRecord, OpportunityCandidate
    from source_adapters.generic_web import _company_identity_hint
    from source_adapters.generic_web_provenance import attach_generic_provenance, page_fetch_id
    from source_adapters.orchestrator import default_candidate_qualifier, semantic_authority_qualifier
    from source_adapters.post_semantic_identity import resolve_post_semantic_identity

    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"}) as client:
            response = await client.get(url)
        html = response.text[:2_000_000]
        final_url = str(response.url)
    except Exception as exc:
        return {"url": url[:100], "error": type(exc).__name__, "message": str(exc)[:200]}

    visible = " ".join(BeautifulSoup(html, "html.parser").get_text(" ", strip=True).split())
    hint = _company_identity_hint(title=title, snippet=snippet, html=html) or (title.split(",")[0].strip() if title else "")
    row = {
        "company_name": hint,
        "source_url": final_url,
        "source_publisher": title or "news",
        "source_class": "recognized_news",
        "evidence_excerpt": snippet[:400],
        "published_at": "2026-06-15",
        "source_text": visible,
        "page_title": title,
        "search_snippet": snippet,
    }
    attach_generic_provenance(
        row,
        adapter_id="generic_web_research_v1",
        search_scope="offline",
        execution_round=1,
        provider_call_id="offline:1",
        page_fetch_id_value=page_fetch_id(search_scope="offline", url=final_url, wave_index=1),
        source_text=visible,
        cursor_version="generic-web:v2",
    )
    token = set_current_cost_governor(ResearchCostGovernor(40000, 50000))
    try:
        request = AdapterDiscoveryRequest(
            intent="funding",
            signal_ids=("funding",),
            signal_match_mode="all",
            geographies=("Italia",),
            freshness_max_age_days=180,
            requested_count=2,
            budget_eur=0.05,
            query=str(intent.get("query") or intent.get("original_query") or ""),
            sectors=(),
            technical_filters={
                "semantic_authority_required": True,
                "semantic_query_contract": contract_raw,
                "universal_engine": True,
            },
            cursor=None,
        )
        candidate = OpportunityCandidate(
            canonical_company_name=hint or "Unknown",
            company_identifiers={},
            official_domain="example.it",
            entity_class="operating_company",
            geographies=("Italia",),
            buyer_fit=None,
            signal_id="funding",
            signal_date="2026-06-15",
            evidence=(
                EvidenceRecord(
                    signal_id="funding",
                    source_url=final_url,
                    source_publisher=row["source_publisher"],
                    source_class="recognized_news",
                    excerpt=snippet[:1200],
                    observed_at="2026-07-20T00:00:00Z",
                    published_at="2026-06-15",
                    extraction_method="offline_replay",
                    confidence=0.7,
                    provenance=row,
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
        merged = candidate
        identity_code = None
        final_qualified = decision.qualified
        if decision.semantic_grounding and decision.semantic_grounding.get("accepted"):
            merged, identity_code = resolve_post_semantic_identity(merged, request, semantic_matched=True)
            if identity_code:
                final_qualified = False
            elif not decision.qualified:
                requalified = await default_candidate_qualifier(merged)
                final_qualified = requalified.qualified
        grounding = decision.semantic_grounding or {}
        grounded = (grounding.get("grounded_evidence") or [{}])[0] if grounding.get("grounded_evidence") else {}
        interp = grounded.get("interpretation") or {}
        verdict = grounded.get("verdict") or {}
        return {
            "url": url[:100],
            "hint": hint,
            "source_len": len(visible),
            "semantic_qualified": decision.qualified,
            "final_qualified": final_qualified,
            "rejection_code": decision.rejection_code,
            "identity_code": identity_code,
            "domain": merged.official_domain,
            "domain_verified": merged.official_domain_verified,
            "grounding_accepted": grounding.get("accepted"),
            "target_entity": interp.get("target_company"),
            "target_role": interp.get("target_entity_role"),
            "recipient": interp.get("recipient"),
            "predicate": interp.get("predicate"),
            "satisfied_relationships": list(interp.get("satisfied_relationships") or ()),
            "excerpt": (interp.get("evidence_excerpt") or "")[:200],
            "excerpt_in_source": bool(interp.get("evidence_excerpt")) and str(interp.get("evidence_excerpt")) in visible,
            "verdict_code": verdict.get("rejection_code"),
            "verdict_reasons": list(verdict.get("reasons") or ()),
            "case": (
                "A_false_negative"
                if grounding.get("accepted") and final_qualified
                else "A_grounding_ok_identity_block"
                if grounding.get("accepted") and not final_qualified
                else "B_correct_rejection"
            ),
        }
    finally:
        reset_current_cost_governor(token)


async def main() -> None:
    env = dotenv_values(ROOT / ".env")
    os.environ.update({k: v for k, v in env.items() if v})
    from supabase import create_client

    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    job = sb.table("searches").select("intent,progress").eq("id", SEARCH_ID).single().execute().data
    intent = job.get("intent") or {}
    progress = job.get("progress") or {}
    contract_raw = (intent.get("uqe_plan") or {}).get("semantic_query_contract") or intent.get("semantic_query_contract")
    shadow = progress.get("shadow_resume") or {}
    cursor = (shadow.get("resume_cursors") or {}).get("generic_web_research_v1") or ""
    match = re.search(r"generic-web:v\d+:(.+)$", cursor)
    urls: list[dict] = []
    if match:
        state = json.loads(base64.urlsafe_b64decode(match.group(1) + "=="))
        urls = [item for item in (state.get("url_meta") or []) if isinstance(item, dict)]
    out = {"search_id": SEARCH_ID, "url_count": len(urls), "replays": []}
    for item in urls[:20]:
        url = str(item.get("url") or "")
        if not url:
            continue
        replay = await replay_url(
            url=url,
            title=str(item.get("title") or ""),
            snippet=str(item.get("snippet") or ""),
            contract_raw=contract_raw,
            intent=intent,
            sb=sb,
        )
        out["replays"].append(replay)
    summary = {
        "A_false_negative": sum(1 for r in out["replays"] if r.get("case") == "A_false_negative"),
        "A_grounding_ok_identity_block": sum(1 for r in out["replays"] if r.get("case") == "A_grounding_ok_identity_block"),
        "B_correct_rejection": sum(1 for r in out["replays"] if r.get("case") == "B_correct_rejection"),
        "errors": sum(1 for r in out["replays"] if r.get("error")),
    }
    out["summary"] = summary
    print(json.dumps(out, ensure_ascii=False, default=str))


if __name__ == "__main__":
    asyncio.run(main())
