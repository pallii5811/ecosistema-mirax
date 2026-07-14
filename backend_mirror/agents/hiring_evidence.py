"""Deterministic evidence gates for hiring signal-led discovery.

These helpers deliberately inspect captured page text only. A careers URL,
navigation label or job-category counter is discovery context, not evidence of
an active vacancy.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse


_CONCRETE_HIRING_ACTION_RE = re.compile(
    r"\b(assum(?:e|iamo|ono)|assunzion[ei]|selezion[ei]\s+apert[ae]|"
    r"posizion[ei]\s+apert[ae]|offert[ae]\s+di\s+lavoro|avviso\s+permanente|"
    r"invia\s+(?:la\s+)?candidatura|we(?:'re|\s+are)\s+hiring|"
    r"open\s+positions?|job\s+openings?|apply\s+now|submit\s+(?:an\s+)?application)\b",
    re.I,
)
_OPERATIONAL_HIRING_ROLE_RE = re.compile(
    r"\b(operai[oa]?|operator[ei]|addett[oa]|autist[ai]|magazzinier[ei]|installator[ei]|"
    r"manutentor[ei]|tecnic[oaie]|produzion[ei]|agricol[oaie]|cantiere|"
    r"logistic[oa]|saldator[ei]|elettricist[ai]|meccanic[oaie]|"
    r"warehouse\s+(?:worker|operator)|drivers?|operators?|installers?|"
    r"maintenance\s+(?:worker|engineer|technician)|technicians?|production|"
    r"construction\s+(?:worker|operator)|logistics?|welders?|electricians?|mechanics?)\b",
    re.I,
)
_DIRECTED_OPERATIONAL_ROLE_RE = re.compile(
    rf"\b(?:cerc(?:a|ano|hiamo)|ricerc(?:a|ano|hiamo)|selezion(?:a|ano|iamo)|"
    rf"seek(?:s|ing)?|look(?:s|ing)?\s+for|recruit(?:s|ing)?)\b"
    rf"[^.;:|]{{0,60}}{_OPERATIONAL_HIRING_ROLE_RE.pattern}",
    re.I,
)


def has_concrete_operational_hiring_evidence(value: str) -> bool:
    """Return true only for an explicit active action tied to an operational role."""
    blob = re.sub(r"\s+", " ", str(value or "")).strip()
    if not blob or not _OPERATIONAL_HIRING_ROLE_RE.search(blob):
        return False
    if _CONCRETE_HIRING_ACTION_RE.search(blob):
        return True
    # Ambiguous verbs are valid only when they govern a nearby role. This
    # rejects product copy such as "ricerca perdite ... installatore" while
    # retaining "ricerchiamo operai/manutentori".
    return bool(_DIRECTED_OPERATIONAL_ROLE_RE.search(blob))


def operational_hiring_evidence_priority(value: str, source_url: str = "") -> int:
    """Rank already-acquired pages; never treat URL features as signal proof."""
    blob = re.sub(r"\s+", " ", str(value or "")).strip()
    if not has_concrete_operational_hiring_evidence(blob):
        return 0
    score = 100
    if re.search(
        r"\b(?:data\s+di\s+scadenza|pubblicat[oa]\s+il|scade\s+il|"
        r"\d{1,2}[/-]\d{1,2}[/-]20\d{2}|20\d{2}-\d{2}-\d{2})\b",
        blob,
        re.I,
    ):
        score += 25
    path = urlparse(str(source_url or "")).path.lower().rstrip("/")
    # Specific vacancy paths are useful ordering hints only after the content
    # has independently passed the concrete-evidence gate.
    if re.search(r"/(?:jobs?|careers?|posizioni?|vacanc(?:y|ies))/[^/]+$", path):
        score += 10
    return score
