"""Contactability extraction gate."""
from __future__ import annotations

import re
from typing import Any, Mapping, Optional, Tuple

from .models import ContactabilityStatus, GateResult

_ROLE_HINTS = {
    "crm": ("crm", "sales", "marketing", "commercial", "it", "cio", "cto"),
    "hiring": ("hr", "talent", "recruiting", "people", "engineering", "cto"),
    "funding": ("ceo", "founder", "cfo", "finance"),
    "marketing": ("marketing", "commercial", "growth", "cmo"),
}


def _recommended_role(intent: Mapping[str, Any]) -> Optional[str]:
    query = str(intent.get("raw_query") or intent.get("original_query") or "").lower()
    seller = intent.get("seller_profile") or intent.get("seller")
    offer = ""
    if isinstance(seller, dict):
        offer = str(seller.get("offer_description") or seller.get("offer_category") or "").lower()
    blob = f"{query} {offer}"
    if "crm" in blob:
        return "Sales/Marketing leadership (inferred)"
    if any(k in blob for k in ("assum", "hiring", "recruit")):
        return "HR/Talent leadership (inferred)"
    if any(k in blob for k in ("fotovolta", "solar", "energy")):
        return "Facility/Operations leadership (inferred)"
    if any(k in blob for k in ("marketing", "social media", "comunicazione")):
        return "Marketing leadership (inferred)"
    if any(k in blob for k in ("assicur", "insurance")):
        return "Risk/Finance leadership (inferred)"
    return "Commercial decision maker (inferred)"


def evaluate_contactability(
    candidate: Mapping[str, Any],
    intent: Mapping[str, Any],
    *,
    require_contact: bool,
) -> Tuple[GateResult, ContactabilityStatus, Optional[str]]:
    contacts = candidate.get("contatti") if isinstance(candidate.get("contatti"), dict) else {}
    phones = contacts.get("telefoni") or contacts.get("phones") or []
    emails = contacts.get("email") or contacts.get("emails") or []
    if isinstance(emails, str):
        emails = [emails]
    linkedin = str(candidate.get("linkedin") or contacts.get("linkedin") or "").strip()

    person_name = str(
        candidate.get("decision_maker")
        or candidate.get("contact_name")
        or contacts.get("nome")
        or ""
    ).strip()
    role = str(candidate.get("decision_maker_role") or contacts.get("ruolo") or "").strip()

    status = ContactabilityStatus.NO_PUBLIC_CONTACT
    if person_name and (phones or emails):
        status = ContactabilityStatus.DIRECT_PERSON_CONTACT
    elif role:
        status = ContactabilityStatus.ROLE_CONTACT
    elif emails or phones or linkedin or re.search(r"mailto:|tel:", str(candidate.get("sito") or ""), re.I):
        status = ContactabilityStatus.COMPANY_CONTACT

    recommended = _recommended_role(intent) if not role else None
    decision_role = role or recommended

    reasons: list[str] = []
    if require_contact and status == ContactabilityStatus.NO_PUBLIC_CONTACT:
        reasons.append("NO_PUBLIC_CONTACT")

    passed = not reasons or not require_contact
    confidence = {
        ContactabilityStatus.DIRECT_PERSON_CONTACT: 0.95,
        ContactabilityStatus.ROLE_CONTACT: 0.8,
        ContactabilityStatus.COMPANY_CONTACT: 0.65,
        ContactabilityStatus.NO_PUBLIC_CONTACT: 0.1,
    }[status]

    return (
        GateResult(passed=passed, confidence=confidence, reasons=reasons),
        status,
        decision_role,
    )
