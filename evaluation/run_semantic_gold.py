"""Metered semantic gold evaluator. No provider call without --allow-paid and hard cap."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any, Dict

from backend_mirror.cost_context import reset_current_cost_governor, set_current_cost_governor
from backend_mirror.cost_governor import ResearchCostGovernor
from backend_mirror.semantic_intelligence import (
    AnthropicSemanticModel,
    SemanticCommercialEventInterpreter,
    SemanticCommercialQueryInterpreter,
    SemanticEvidenceGroundingVerifier,
    SemanticResultCache,
)
from evaluation.semantic_gold_v1 import SEMANTIC_GOLD_CASES, composition


def _governor(cap: float) -> ResearchCostGovernor:
    micro = int(round(cap * 1_000_000))
    return ResearchCostGovernor(target_micro_eur=micro, hard_micro_eur=micro)


async def evaluate(split: str, cap: float, cache_path: Path) -> Dict[str, Any]:
    cases = [case for case in SEMANTIC_GOLD_CASES if split == "all" or case["split"] == split]
    model = AnthropicSemanticModel()
    cache = SemanticResultCache(str(cache_path))
    query_interpreter = SemanticCommercialQueryInterpreter(model, cache=cache)
    event_interpreter = SemanticCommercialEventInterpreter(model, cache=cache)
    verifier = SemanticEvidenceGroundingVerifier()
    rows = []
    for case in cases:
        interpretation = None
        verdict = None
        evaluation_error = None
        try:
            contract = await query_interpreter.interpret(case["query"], 5)
            interpretation = await event_interpreter.interpret(
                contract,
                title=case["source_text"], snippet=case["source_text"],
                source_text=case["source_text"], source_url=case["source_url"],
                publisher=case["publisher"],
                structured_metadata={"target_organization": {"name": case["target_company"]}},
                entity_hints=(case["target_company"],),
            )
            verdict = verifier.verify(
                contract, interpretation, source_text=case["source_text"],
                source_url=case["source_url"], source_publisher=case["publisher"],
                official_domain_verified=case["official_domain_verified"],
                official_domain_confidence=case["official_domain_confidence"],
                entity_class=case["target_entity_type"], candidate_company=case["target_company"],
                maximum_age_days=case["maximum_age_days"],
            )
        except Exception as exc:
            # A malformed/ambiguous model result is a fail-closed prediction,
            # not a reason to discard the remainder of the measured cohort.
            evaluation_error = f"{type(exc).__name__}:{exc}"
        predicted = bool(verdict and verdict.accepted)
        expected = bool(case["expected_accept"])
        rows.append({
            "id": case["id"], "split": case["split"], "expected": expected,
            "predicted": predicted,
            "rejection_code": verdict.rejection_code if verdict else "SEMANTIC_EVALUATION_FAILED",
            "evaluation_error": evaluation_error,
            "expected_role": case["target_role"],
            "predicted_role": interpretation.target_entity_role if interpretation else None,
            "role_correct": bool(interpretation and interpretation.target_entity_role == case["target_role"]),
            "literal_grounding": bool(verdict and verdict.checks.get("excerpt_literal") is True),
            "publisher_as_company": bool(
                interpretation and interpretation.target_company.casefold() == case["publisher"].casefold()
            ),
            "unsafe_modality_rejected": (
                not predicted if any(case.get(flag) for flag in ("negated", "hypothetical", "conditional", "rumor")) else None
            ),
        })
    tp = sum(row["expected"] and row["predicted"] for row in rows)
    fp = sum(not row["expected"] and row["predicted"] for row in rows)
    positives = sum(row["expected"] for row in rows)
    modalities = [row for row in rows if row["unsafe_modality_rejected"] is not None]
    return {
        "dataset": composition(), "split": split, "cases": len(rows),
        "metrics": {
            "semantic_precision": tp / (tp + fp) if tp + fp else 0.0,
            "semantic_recall": tp / positives if positives else 0.0,
            "target_role_precision": sum(row["role_correct"] for row in rows) / len(rows) if rows else 0.0,
            "negation_hypothesis_rejection": (
                sum(row["unsafe_modality_rejected"] is True for row in modalities) / len(modalities)
                if modalities else 1.0
            ),
            "grounding_rate": sum(row["literal_grounding"] for row in rows) / len(rows) if rows else 0.0,
            "invented_facts": sum(not row["literal_grounding"] for row in rows),
            "publisher_as_company": sum(row["publisher_as_company"] for row in rows),
        },
        "rows": rows,
        "query_telemetry": query_interpreter.telemetry.to_dict(),
        "event_telemetry": event_interpreter.telemetry.to_dict(),
        "cost": None,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", choices=("development", "validation", "holdout", "all"), default="development")
    parser.add_argument("--hard-cap-eur", type=float, required=True)
    parser.add_argument("--allow-paid", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not args.allow_paid:
        raise SystemExit("paid semantic evaluation disabled; pass --allow-paid with an explicit hard cap")
    if not 0 < args.hard_cap_eur <= 2.0:
        raise SystemExit("hard cap must be > 0 and <= 2.0 EUR")
    governor = _governor(args.hard_cap_eur)
    token = set_current_cost_governor(governor)
    try:
        report = asyncio.run(evaluate(
            args.split, args.hard_cap_eur,
            args.output.with_suffix(".cache.sqlite"),
        ))
        report["cost"] = governor.snapshot()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"output": str(args.output), "metrics": report["metrics"], "cost": report["cost"]}))
    finally:
        reset_current_cost_governor(token)


if __name__ == "__main__":
    main()
