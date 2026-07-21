"""Deterministic evidence extraction for universal commercial signals."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from datetime import date, datetime
from typing import Any, Dict, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlparse


_DATE_PATTERNS = (
    (re.compile(r"\b(20\d{2})-(\d{2})-(\d{2})\b"), "%Y-%m-%d"),
    (re.compile(r"\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b"), "%d/%m/%Y"),
    (re.compile(r"\b(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(20\d{2})\b", re.I), "it_long"),
)

_IT_MONTHS = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}

_EVENT_PATTERNS: Tuple[Tuple[str, re.Pattern[str]], ...] = (
    ("hiring_sales", re.compile(r"\b(assum\w*|ricerca|cerca)\b.{0,40}\b(commercial\w*|sales|account manager|business developer)\b", re.I)),
    ("new_location", re.compile(r"\b(nuova sede|nuovo punto vendita|ha aperto|inaugur\w+)\b", re.I)),
    ("production_expansion", re.compile(
        r"\b(nuovo\s+stabilimento|nuova\s+unit[aà]\s+produttiva|ampliamento\s+(?:produttivo|dello\s+stabilimento|della\s+sede)|"
        r"capacit[aà]\s+produttiva|nuovo\s+impianto|nuova\s+linea\s+di\s+produzione|"
        r"investe\s+in\s+(?:un\s+)?(?:nuovo\s+)?(?:stabilimento|impianto))\b",
        re.I,
    )),
    ("geographic_expansion", re.compile(r"\b(espansione|entra nel mercato|nuova filiale|rete commerciale)\b", re.I)),
    ("tender_won", re.compile(r"\b(aggiudicat\w*|ha vinto la gara|affidamento|appalto)\b", re.I)),
    ("funding", re.compile(r"\b(ha raccolto|round|finanziament\w*|investiment\w* di)\b", re.I)),
    ("leadership_change", re.compile(r"\b(nuovo (?:CEO|AD|direttore commerciale)|nominat\w+|assume la guida)\b", re.I)),
    ("active_advertising", re.compile(r"\b(campagna pubblicitaria|Meta Ads|Google Ads|investimento media)\b", re.I)),
    ("technology_adoption", re.compile(r"\b(adotta|implementa|sceglie|migra a)\b.{0,40}\b(CRM|ERP|SaaS|piattaforma)\b", re.I)),
    ("regulatory_change", re.compile(r"\b(adeguamento normativo|nuova normativa|conformit\w+)\b", re.I)),
    ("certification", re.compile(r"\b(certificazion\w+|ISO\s?\d+)\b", re.I)),
)


@dataclass(frozen=True)
class ExtractedEvidence:
    company_name: Optional[str]
    event_type: Optional[str]
    event_date: Optional[str]
    event_location: Optional[str]
    evidence_excerpt: Optional[str]
    source_url: str
    source_class: str
    publisher: str
    official_domain_candidate: Optional[str]
    amount: Optional[str] = None
    job_count: Optional[int] = None
    technology: Optional[str] = None
    buyer_role: Optional[str] = None
    freshness_days: Optional[int] = None
    identity_hints: Tuple[str, ...] = ()
    confidence: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _host(url: str) -> Optional[str]:
    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = (parsed.hostname or "").lower().removeprefix("www.")
    return host or None


def _parse_event_date(text: str) -> Optional[str]:
    for pattern, kind in _DATE_PATTERNS:
        match = pattern.search(text or "")
        if not match:
            continue
        try:
            if kind == "%Y-%m-%d":
                return date(int(match.group(1)), int(match.group(2)), int(match.group(3))).isoformat()
            if kind == "%d/%m/%Y":
                return date(int(match.group(3)), int(match.group(2)), int(match.group(1))).isoformat()
            if kind == "it_long":
                month = _IT_MONTHS[match.group(2).casefold()]
                return date(int(match.group(3)), month, int(match.group(1))).isoformat()
        except (ValueError, KeyError):
            continue
    return None


def _excerpt_around(text: str, match: re.Match[str], radius: int = 140) -> str:
    start = max(0, match.start() - radius)
    end = min(len(text), match.end() + radius)
    return re.sub(r"\s+", " ", text[start:end]).strip()


def extract_evidence_from_text(
    *,
    text: str,
    source_url: str,
    source_class: str = "recognized_news",
    publisher: str = "",
    company_name_hint: str = "",
    page_date: Optional[str] = None,
    requested_signals: Sequence[str] = (),
) -> Tuple[ExtractedEvidence, ...]:
    """Deterministic extraction. Never invents missing facts."""
    blob = re.sub(r"\s+", " ", text or "").strip()
    if not blob or not source_url:
        return ()
    host = _host(source_url)
    event_date = _parse_event_date(blob) or None
    # Event date near evidence prevails over page date when both exist.
    effective_date = event_date or (str(page_date)[:10] if page_date else None)
    wanted = {str(item).strip() for item in requested_signals if str(item).strip()}
    found: list[ExtractedEvidence] = []
    seen: set[tuple[str, str, str]] = set()

    for event_type, pattern in _EVENT_PATTERNS:
        if wanted and event_type not in wanted and not any(event_type.startswith(w) or w.startswith(event_type) for w in wanted):
            # Still allow if alias family overlaps loosely via substring.
            if not any(token in event_type for token in wanted):
                continue
        match = pattern.search(blob)
        if not match:
            continue
        excerpt = _excerpt_around(blob, match)
        if not excerpt:
            continue
        local_date = _parse_event_date(excerpt) or effective_date
        key = (event_type, source_url, excerpt[:80])
        if key in seen:
            continue
        seen.add(key)
        amount_match = re.search(r"€\s?\d+(?:[.,]\d+)?\s?(?:mln|milioni|k)?", excerpt, re.I)
        tech_match = re.search(r"\b(CRM|ERP|SAP|Salesforce|HubSpot|Microsoft 365)\b", excerpt, re.I)
        role_match = re.search(r"\b(CEO|CFO|CTO|direttore commerciale|CMO|HR)\b", excerpt, re.I)
        confidence = 0.55
        if local_date:
            confidence += 0.15
        if company_name_hint:
            confidence += 0.1
        if amount_match or tech_match:
            confidence += 0.05
        found.append(
            ExtractedEvidence(
                company_name=company_name_hint or None,
                event_type=event_type,
                event_date=local_date,
                event_location=None,
                evidence_excerpt=excerpt,
                source_url=source_url,
                source_class=source_class,
                publisher=publisher or host or "unknown",
                official_domain_candidate=host if source_class == "official_company_website" else None,
                amount=amount_match.group(0) if amount_match else None,
                technology=tech_match.group(0) if tech_match else None,
                buyer_role=role_match.group(0) if role_match else None,
                identity_hints=tuple(h for h in (company_name_hint, host) if h),
                confidence=min(0.9, confidence),
            )
        )
    return tuple(found)
