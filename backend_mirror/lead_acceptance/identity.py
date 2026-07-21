"""Company identity gate."""
from __future__ import annotations

from typing import Any, Mapping, Optional

from commercial_lifecycle import canonical_domain, positive_entity_classification

from .models import GateResult


def evaluate_identity(
    candidate: Mapping[str, Any],
    intent: Mapping[str, Any],
    publication_gate: Mapping[str, Any],
) -> tuple[GateResult, Optional[str], Optional[str], Optional[str]]:
    domain = publication_gate.get("canonical_domain") or canonical_domain(
        candidate.get("official_domain")
        or candidate.get("employer_official_domain")
        or candidate.get("sito")
        or candidate.get("website")
    )
    reasons: list[str] = []
    if not publication_gate.get("official_domain_verified"):
        reasons.append("OFFICIAL_DOMAIN_UNRESOLVED")
    if not publication_gate.get("entity_operating_verified"):
        reasons.append("ENTITY_NOT_OPERATING")

    entity = publication_gate.get("entity_classification") or positive_entity_classification(
        dict(candidate), dict(intent), bool(publication_gate.get("official_domain_verified"))
    )
    if entity.get("is_recruiter") or entity.get("is_source_publisher"):
        reasons.append("ACTOR_DIRECTION_INVERSION")

    ownership = str(candidate.get("ownership_status") or candidate.get("forma_giuridica") or "").strip() or None
    parent = str(candidate.get("parent_group") or candidate.get("controlling_group") or "").strip() or None

    reasons = list(dict.fromkeys(reasons))
    passed = not reasons and bool(domain)
    confidence = float(entity.get("official_domain_confidence") or publication_gate.get("entity_resolution", {}).get("confidence") or 0)
    return (
        GateResult(passed=passed, confidence=min(1.0, confidence), reasons=reasons),
        domain,
        ownership,
        parent or None,
    )
