"""Deterministic CRM seeking/adoption observables for semantic grounding.

Lexical detection is fail-closed: it only marks seeking when the page
literally mentions CRM together with selection, tender, migration, project,
or adoption language. It never invents a buyer from vendor SEO or how-to guides.
"""

from __future__ import annotations

import re
from typing import Optional, Tuple

CRM_SEEKING_RELATIONSHIP = "target_company_seeking_crm_solution"

_GUIDE_RE = re.compile(
    r"(?:"
    r"come\s+(?:si\s+)?scegli\w*\s+(?:un\s+|il\s+)?crm"
    r"|miglior(?:i)?\s+crm"
    r"|guida\s+(?:al|alla|completa)\s+crm"
    r"|tutorial\s+crm"
    r")",
    re.I,
)

_VENDOR_ONLY_RE = re.compile(
    r"(?:"
    r"\b(?:salesforce|hubspot|pipedrive|zoho)\s+(?:crm)?\b"
    r"|scopri\s+(?:il\s+)?(?:nostro|la\s+nostra)\s+crm"
    r"|richiedi\s+(?:una\s+)?demo\s+crm"
    r")",
    re.I,
)

# Company is in-market for CRM: selection, tender, migration, project, or adoption.
_CRM_SEEKING_RE = re.compile(
    r"(?:"
    r"(?:selezione|gara|bando|rfp|appalto|migrazione|sostituzione|implementazione|"
    r"progetto|introduzione|adozione|avvio)\s+(?:di\s+(?:un\s+|del\s+)?|del\s+|di\s+)?"
    r"(?:nuovo\s+|nuova\s+)?crm\b"
    r"|\bcrm\b.{0,40}(?:selezione|gara|bando|rfp|migrazione|sostituzione|implementazione|"
    r"progetto|introduzione|adozione|kickoff)"
    r"|(?:scegli\w*|adott\w*|scelt\w*|implement\w*)\s+(?:la\s+)?(?:piattaforma\s+)?"
    r"(?:crm|salesforce|dynamics|hubspot|veeva|vtecrm|sugarcrm|\w*crm)\b"
    r"|(?:scegli\w*|adott\w*)\s+.{0,50}\bcrm\b"
    r"|(?:scegli\w*|adott\w*)\s+.{0,50}\b(?:sistema|soluzione|piattaforma)\s+crm\b"
    r"|\bcrm\b.{0,20}(?:project\s+manager|specialist|owner|responsabile)"
    r")",
    re.I | re.S,
)


def _text(value: object) -> str:
    return " ".join(str(value or "").split()).strip()


def looks_crm_guide(text: str) -> bool:
    return bool(_GUIDE_RE.search(text or ""))


def looks_crm_vendor_pitch(text: str) -> bool:
    """True when the page is mostly a CRM vendor selling itself."""
    blob = text or ""
    if not _VENDOR_ONLY_RE.search(blob):
        return False
    # Vendor pitch without third-party adoption/project language.
    return not bool(_CRM_SEEKING_RE.search(blob))


def find_crm_seeking_evidence(source_text: str) -> Tuple[Optional[str], int, int]:
    """Return (excerpt, start, end) for a literal CRM seeking/adoption span."""
    text = source_text or ""
    if looks_crm_guide(text):
        return None, -1, -1
    match = _CRM_SEEKING_RE.search(text)
    if not match:
        return None, -1, -1
    excerpt = _text(match.group(0))
    if len(excerpt) < 8:
        return None, -1, -1
    return excerpt, match.start(), match.end()
