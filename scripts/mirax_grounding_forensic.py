#!/usr/bin/env python3
"""Grounding forensic: compare semantic interpretation vs verifier for a search candidate."""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any, Mapping

from dotenv import dotenv_values
from supabase import create_client

ROOT = Path("/home/worker/app/backend-staging")
sys.path.insert(0, str(ROOT))

SEARCH_ID = sys.argv[1] if len(sys.argv) > 1 else "f8cd7b7f-fe88-4843-9f75-41d3bd5ad6c4"


def _triple(interp: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "subject": interp.get("actor") or interp.get("investor") or interp.get("provider"),
        "predicate": interp.get("predicate") or interp.get("open_predicate"),
        "object": interp.get("recipient") or interp.get("beneficiary") or interp.get("target_company"),
        "direction": interp.get("direction"),
    }


def _forensic_payload(
    *,
    contract: Mapping[str, Any],
    interpretation: Mapping[str, Any],
    verdict: Mapping[str, Any],
    candidate_company: str,
    source_publisher: str,
    official_domain: str,
    source_url: str,
) -> dict[str, Any]:
    checks = verdict.get("checks") or {}
    return {
        "semantic_target_entity": interpretation.get("target_company"),
        "semantic_target_role": interpretation.get("target_entity_role"),
        "semantic_subject_predicate_object": _triple(interpretation),
        "satisfied_relationships": list(interpretation.get("satisfied_relationships") or ()),
        "required_relationships": list(contract.get("required_relationships") or ()),
        "exact_excerpt": interpretation.get("evidence_excerpt"),
        "excerpt_offsets": {
            "start": interpretation.get("evidence_start"),
            "end": interpretation.get("evidence_end"),
        },
        "grounding_rejection_sub_code": verdict.get("rejection_code"),
        "grounding_failed_checks": list(verdict.get("reasons") or ()),
        "negation_hypothetical_status": {
            "negated": interpretation.get("negated"),
            "hypothetical": interpretation.get("hypothetical"),
            "conditional": interpretation.get("conditional"),
            "rumor": interpretation.get("rumor"),
        },
        "publisher": source_publisher,
        "official_target_company": candidate_company,
        "official_domain": official_domain,
        "source_url": source_url,
        "relations": list(interpretation.get("relations") or ()),
        "verdict_checks": checks,
        "query_match": interpretation.get("query_match"),
        "query_match_reason": interpretation.get("query_match_reason"),
    }


async def replay_candidate(
    *,
    contract_raw: Mapping[str, Any],
    evidence_row: Mapping[str, Any],
    candidate_row: Mapping[str, Any],
) -> dict[str, Any]:
    from dataclasses import replace

    from source_adapters.contracts import EvidenceRecord, OpportunityCandidate
    from backend_mirror.semantic_intelligence import (
        AnthropicSemanticModel,
        SemanticCommercialEventInterpreter,
        SemanticEvidenceGroundingVerifier,
        SemanticQueryContract,
        SemanticResultCache,
        SemanticTelemetry,
        apply_hiring_relationship_proxy,
    )

    payload = candidate_row.get("payload") or {}
    provenance = evidence_row.get("provenance") or {}
    if not isinstance(provenance, Mapping):
        provenance = {}
    source_text = str(provenance.get("source_text") or evidence_row.get("source_text") or "")
    excerpt = str(evidence_row.get("excerpt") or provenance.get("excerpt") or "")
    candidate = OpportunityCandidate(
        canonical_company_name=str(
            payload.get("company_name")
            or payload.get("ragione_sociale")
            or candidate_row.get("canonical_name")
            or "Unknown"
        ),
        company_identifiers={},
        official_domain=str(payload.get("official_domain") or candidate_row.get("canonical_domain") or ""),
        entity_class=str(payload.get("entity_class") or "operating_company"),
        geographies=tuple(payload.get("geographies") or ("Italia",)),
        buyer_fit=None,
        signal_id=str(evidence_row.get("signal_id") or "funding"),
        signal_date=str(evidence_row.get("published_at") or "2026-06-01"),
        evidence=(
            EvidenceRecord(
                signal_id=str(evidence_row.get("signal_id") or "funding"),
                source_url=str(evidence_row.get("source_url") or ""),
                source_publisher=str(evidence_row.get("source_publisher") or ""),
                source_class=str(evidence_row.get("source_class") or "recognized_news"),
                excerpt=excerpt[:1200],
                observed_at=str(evidence_row.get("observed_at") or "2026-07-20T00:00:00Z"),
                published_at=str(evidence_row.get("published_at") or "2026-06-01"),
                extraction_method=str(evidence_row.get("extraction_method") or "fetch"),
                confidence=float(evidence_row.get("confidence") or 0.7),
                provenance={**provenance, "source_text": source_text},
            ),
        ),
        why_now=None,
        contacts=(),
        confidence=float(candidate_row.get("confidence") or 0.7),
        contradiction_flags=(),
        provenance={"adapter_id": "generic_web_research_v1"},
        adapter_id="generic_web_research_v1",
        adapter_version="1",
        official_domain_verified=bool(candidate_row.get("official_domain_verified")),
        official_domain_confidence=float(candidate_row.get("official_domain_confidence") or 0.0),
    )
    contract = SemanticQueryContract.from_model(
        contract_raw,
        original_query=str(contract_raw.get("original_query") or ""),
        requested_count=2,
    )
    telemetry = SemanticTelemetry()
    interpreter = SemanticCommercialEventInterpreter(
        AnthropicSemanticModel(),
        cache=SemanticResultCache(),
        telemetry=telemetry,
    )
    verifier = SemanticEvidenceGroundingVerifier()
    structured_metadata = (
        provenance.get("structured_metadata")
        if isinstance(provenance.get("structured_metadata"), Mapping)
        else {}
    )
    interpretation = await interpreter.interpret(
        contract,
        title=str(provenance.get("page_title") or ""),
        snippet=str(provenance.get("search_snippet") or excerpt),
        source_text=source_text,
        source_url=str(evidence_row.get("source_url") or ""),
        publisher=str(evidence_row.get("source_publisher") or ""),
        structured_metadata=structured_metadata,
        entity_hints=(candidate.canonical_company_name, candidate.official_domain or ""),
    )
    interpretation, hiring_early_reject = apply_hiring_relationship_proxy(
        contract,
        interpretation,
        source_text=source_text,
        structured_metadata=structured_metadata,
    )
    per_source_contract = replace(
        contract,
        required_relationships=tuple(
            item for item in contract.required_relationships
            if item in interpretation.satisfied_relationships
        ),
        acceptance_rubric=tuple(
            item for item in contract.acceptance_rubric
            if item in interpretation.acceptance_rubric_passed
        ),
    )
    verdict = verifier.verify(
        per_source_contract,
        interpretation,
        source_text=source_text,
        source_url=str(evidence_row.get("source_url") or ""),
        source_publisher=str(evidence_row.get("source_publisher") or ""),
        official_domain_verified=candidate.official_domain_verified,
        official_domain_confidence=candidate.official_domain_confidence,
        entity_class=candidate.entity_class,
        candidate_company=candidate.canonical_company_name,
        maximum_age_days=180,
        structured_metadata=structured_metadata,
    )
    interp_dict = interpretation.to_dict()
    verdict_dict = verdict.to_dict()
    forensic = _forensic_payload(
        contract=contract.to_dict(),
        interpretation=interp_dict,
        verdict=verdict_dict,
        candidate_company=candidate.canonical_company_name,
        source_publisher=str(evidence_row.get("source_publisher") or ""),
        official_domain=candidate.official_domain or "",
        source_url=str(evidence_row.get("source_url") or ""),
    )
    forensic["hiring_early_reject"] = hiring_early_reject
    forensic["verdict_accepted"] = verdict.accepted
    forensic["source_text_len"] = len(source_text)
    forensic["excerpt_in_source"] = bool(interp_dict.get("evidence_excerpt")) and (
        str(interp_dict.get("evidence_excerpt")) in source_text
    )
    return forensic


async def main() -> None:
    env = dotenv_values(ROOT / ".env")
    sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
    job = sb.table("searches").select("intent,progress,status").eq("id", SEARCH_ID).single().execute().data
    intent = job.get("intent") or {}
    progress = job.get("progress") or {}
    contract = (intent.get("uqe_plan") or {}).get("semantic_query_contract") or intent.get("semantic_query_contract")
    candidates = sb.table("search_candidates").select("*").eq("search_id", SEARCH_ID).execute().data or []
    evidence_rows = sb.table("search_evidence").select("*").eq("search_id", SEARCH_ID).execute().data or []
    rejected = (progress.get("shadow_resume") or {}).get("rejected_candidates") or []

    out: dict[str, Any] = {
        "search_id": SEARCH_ID,
        "status": job.get("status"),
        "rejected_candidates_progress": rejected[:5],
        "candidate_count": len(candidates),
        "evidence_count": len(evidence_rows),
        "forensics": [],
    }
    if not contract:
        out["error"] = "semantic_query_contract_missing"
        print(json.dumps(out, ensure_ascii=False, default=str))
        return
    if not candidates or not evidence_rows:
        out["error"] = "no_candidate_or_evidence_rows"
        print(json.dumps(out, ensure_ascii=False, default=str))
        return

    by_candidate: dict[str, list[Mapping[str, Any]]] = {}
    for row in evidence_rows:
        cid = str(row.get("candidate_id") or "")
        by_candidate.setdefault(cid, []).append(row)

    for cand in candidates[:3]:
        cid = str(cand.get("id") or "")
        evs = by_candidate.get(cid) or evidence_rows[:1]
        for ev in evs[:2]:
            try:
                forensic = await replay_candidate(
                    contract_raw=contract,
                    evidence_row=ev,
                    candidate_row=cand,
                )
            except Exception as exc:
                forensic = {"error": type(exc).__name__, "message": str(exc)[:500]}
            out["forensics"].append({
                "candidate_id": cid,
                "rejection_code": cand.get("rejection_code"),
                "company": (cand.get("payload") or {}).get("company_name"),
                **forensic,
            })
    print(json.dumps(out, ensure_ascii=False, default=str))


if __name__ == "__main__":
    asyncio.run(main())
