"""Evidence grounding gate."""
from __future__ import annotations

from typing import Any, Mapping

from .models import GateResult


def evaluate_evidence(candidate: Mapping[str, Any], publication_gate: Mapping[str, Any]) -> GateResult:
    reasons: list[str] = []
    records = publication_gate.get("evidence") or []
    if not publication_gate.get("evidence_supports_signal"):
        reasons.append("EVIDENCE_MISMATCH")
    if not publication_gate.get("source_url_verified"):
        reasons.append("SOURCE_NOT_VERIFIABLE")
    if not publication_gate.get("freshness_pass"):
        reasons.append("SIGNAL_NOT_FRESH")
    if not publication_gate.get("no_critical_contradictions", True):
        reasons.append("CRITICAL_CONTRADICTION")

    semantic = candidate.get("semantic_grounding")
    if isinstance(semantic, dict):
        if semantic.get("negated"):
            reasons.append("NEGATED_EVENT")
        if semantic.get("hypothetical") or semantic.get("conditional"):
            reasons.append("HYPOTHETICAL_EVENT")

    reasons = list(dict.fromkeys(reasons))
    passed = not reasons
    confidence = 0.9 if passed else 0.2
    return GateResult(passed=passed, confidence=confidence, reasons=reasons, evidence=records)
