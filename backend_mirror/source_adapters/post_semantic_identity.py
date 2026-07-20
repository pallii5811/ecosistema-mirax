"""Paid identity resolution only after semantic match."""
from __future__ import annotations

from dataclasses import replace
from typing import Any, Mapping

from .contracts import AdapterDiscoveryRequest, OpportunityCandidate
from .generic_web_budget import IDENTITY_RESERVE_EUR


def resolve_post_semantic_identity(
    candidate: OpportunityCandidate,
    request: AdapterDiscoveryRequest,
    *,
    semantic_matched: bool,
) -> tuple[OpportunityCandidate, str | None]:
    if candidate.official_domain_verified:
        return candidate, None
    if not semantic_matched:
        return candidate, "IDENTITY_DEFERRED_PRE_SEMANTIC"
    from backend_mirror.agents.entity_identity_resolver import (
        COMMERCIAL_ENTITY_CLASSES,
        EntityIdentityRequest,
        resolve_entity_identity,
    )

    provenance = candidate.provenance if isinstance(candidate.provenance, Mapping) else {}
    source_url = ""
    if candidate.evidence:
        source_url = str(candidate.evidence[0].source_url or "")
    identity = resolve_entity_identity(
        EntityIdentityRequest(
            company_name=candidate.canonical_company_name,
            evidence_url=source_url,
            presented_domain=candidate.official_domain or "",
            geography=next((g for g in candidate.geographies if g), ""),
            budget_eur=IDENTITY_RESERVE_EUR,
            allow_serp=True,
            allowed_entity_classes=tuple(COMMERCIAL_ENTITY_CLASSES),
            source_payload=dict(provenance),
        )
    )
    if not identity.official_domain or str(identity.identity_status or "").lower() != "verified":
        return candidate, str(identity.rejection_code or "IDENTITY_RESOLUTION_FAILED")
    domain_verification: dict[str, Any] = {
        "status": "verified",
        "confidence": float(identity.identity_confidence or 0.85),
        "score": int(round(float(identity.identity_confidence or 0.85) * 100)),
        "evidence": tuple(identity.identity_evidence or ("post_semantic_identity",)),
        "resolution_source": identity.resolution_source or "post_semantic_identity",
        "resolution_method": identity.resolution_method or "post_semantic_serp",
        "adapter_id": candidate.adapter_id,
        "url": f"https://{identity.official_domain}/",
    }
    return replace(
        candidate,
        official_domain=identity.official_domain,
        official_domain_verified=True,
        official_domain_confidence=float(identity.identity_confidence or 0.85),
        provenance={**dict(provenance), "domain_verification": domain_verification},
    ), None
