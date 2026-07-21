"""Query-fit gate."""
from __future__ import annotations

from typing import Any, Mapping

from commercial_lifecycle import _evaluate_publication_gate_core

from .models import GateResult


def evaluate_query_fit(
    candidate: Mapping[str, Any],
    intent: Mapping[str, Any],
    *,
    cost_within_budget: bool,
) -> tuple[GateResult, dict]:
    gate = _evaluate_publication_gate_core(dict(candidate), dict(intent), cost_within_budget=cost_within_budget)
    reasons = list(gate.get("rejection_codes") or [])
    passed = bool(
        gate.get("buyer_fit_verified")
        and gate.get("relevant_buying_signal_present")
        and gate.get("semantic_authority_passed", True)
        and gate.get("signal_semantically_linked_to_seller_offer", True)
    )
    if not passed:
        reasons = list(dict.fromkeys(reasons + [c for c in (
            "NO_BUYER_FIT", "NO_RELEVANT_SIGNAL", "SEMANTIC_QUERY_MISMATCH", "NO_PROBLEM_FIT",
        ) if c in (gate.get("rejection_codes") or [])]))
    confidence = float(gate.get("buyer_fit_score") or 0) / 100.0 if float(gate.get("buyer_fit_score") or 0) > 1 else float(gate.get("buyer_fit_score") or 0.7)
    return GateResult(passed=passed, confidence=min(1.0, confidence), reasons=reasons, evidence=gate.get("evidence") or []), gate
