"""Bridge structured hiring vacancy records into semantic evidence bundles.

Lexical duty detection is fail-closed discovery for the semantic authority: it
selects literal excerpts and rejects title-only commercials. It never invents
team growth or customer acquisition when the page text lacks them.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any, Dict, Mapping, Optional, Tuple

_ACQUISITION_DUTY_RE = re.compile(
    r"(?:"
    r"acquisiz\w*\s+(?:e\s+sviluppo\s+)?client\w*"
    r"|svilupp\w*\s+(?:e\s+acquis\w*\s+)?(?:nuov\w+\s+)?client\w*"
    r"|nuov\w+\s+(?:potenziali\s+)?client\w*"
    r"|nuov\w+\s+opportunit\w+\s+commercial\w*"
    r"|new\s+business"
    r"|prospect(?:ing|are|ing)?"
    r"|apertur\w+\s+(?:di\s+)?nuov\w+\s+(?:client\w+|opportunit\w+|mercati)"
    r"|ampliare\s+il\s+portafoglio\s+client"
    r"|espans\w+\s+(?:del\s+)?portafoglio"
    r"|sviluppo\s+commerciale\s+del\s+territorio"
    r"|individua\w*\s+e\s+seleziona\w*\s+nuov\w+\s+(?:potenziali\s+)?client"
    r"|generate\s+new\s+(?:business|customers?|clients?)"
    r"|acquire\s+new\s+(?:customers?|clients?)"
    r"|customer\s+acquisition"
    r")",
    re.I,
)
_EXISTING_ONLY_DUTY_RE = re.compile(
    r"(?:"
    r"gestione\s+e\s+assistenza\s+dei\s+clienti\s+gi[aà]\s+acquisiti"
    r"|account\s+management\s+(?:di\s+)?clienti\s+esistenti"
    r"|customer\s+care"
    r"|assistenza\s+clienti\s+esistenti"
    r"|gestione\s+esclusiva\s+(?:del\s+)?portafoglio\s+esistente"
    r")",
    re.I,
)
_SALES_TITLE_RE = re.compile(
    r"\b(?:"
    r"commerciale|sales|business\s+developer|business\s+development|"
    r"account\s+(?:manager|executive)|key\s+account|sdr|bdr|"
    r"new\s+business|sviluppo\s+clienti|area\s+manager"
    r")\b",
    re.I,
)


def _text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _strip_html(value: str) -> str:
    return re.sub(r"<[^>]+>", " ", value or "")


@dataclass(frozen=True)
class HiringSemanticEvidenceBundle:
    subject: str
    subject_role: str
    event: str
    object: str
    role_duties: str
    location: str
    event_date: str
    source_url: str
    official_domain: str
    evidence_excerpt: str
    excerpt_start: int
    excerpt_end: int
    vacancy_title: str
    vacancy_active: bool
    employer_is_direct: bool
    customer_acquisition_duty_proven: bool
    duty_rejection_code: Optional[str] = None

    def to_structured_metadata(self) -> Dict[str, Any]:
        return {
            "hiring_semantic_evidence_bundle": asdict(self),
            "subject": self.subject,
            "subject_role": self.subject_role,
            "event": self.event,
            "object": self.object,
            "role_duties": self.role_duties,
            "location": self.location,
            "event_date": self.event_date,
            "source_url": self.source_url,
            "official_domain": self.official_domain,
            "evidence_excerpt": self.evidence_excerpt,
            "excerpt_start": self.excerpt_start,
            "excerpt_end": self.excerpt_end,
            "vacancy_title": self.vacancy_title,
            "vacancy_active": self.vacancy_active,
            "employer_is_direct": self.employer_is_direct,
            "customer_acquisition_duty_proven": self.customer_acquisition_duty_proven,
        }


def find_customer_acquisition_duty(source_text: str) -> Tuple[str, int, int]:
    """Return literal duty excerpt and Python offsets, or empty."""
    text = _strip_html(source_text)
    if not text:
        return "", -1, -1
    if _EXISTING_ONLY_DUTY_RE.search(text) and not _ACQUISITION_DUTY_RE.search(text):
        return "", -1, -1
    match = _ACQUISITION_DUTY_RE.search(text)
    if not match:
        return "", -1, -1
    start = max(0, match.start() - 40)
    end = min(len(text), match.end() + 120)
    # Expand to nearest sentence-ish bounds when cheap.
    while start > 0 and text[start] not in ".;:\n" and start > match.start() - 80:
        start -= 1
    if start > 0 and text[start] in ".;:\n":
        start += 1
    excerpt = text[start:end].strip()
    # Re-anchor exact offsets inside the cleaned source.
    exact = text.find(excerpt)
    if exact < 0:
        excerpt = match.group(0)
        exact = match.start()
        return excerpt, exact, exact + len(excerpt)
    return excerpt, exact, exact + len(excerpt)


def has_customer_acquisition_duty(source_text: str) -> bool:
    excerpt, start, _end = find_customer_acquisition_duty(source_text)
    return bool(excerpt) and start >= 0


def looks_sales_role(*, title: str, description: str = "") -> bool:
    blob = f"{title} {description}"
    return bool(_SALES_TITLE_RE.search(blob))


def build_hiring_semantic_evidence_bundle(record: Mapping[str, Any]) -> HiringSemanticEvidenceBundle:
    company = _text(record.get("company_name") or record.get("name") or record.get("employer"))
    title = _text(record.get("vacancy_title") or record.get("hiring_title"))
    description = _strip_html(_text(record.get("description") or record.get("role_duties")))
    location = _text(record.get("location"))
    event_date = _text(record.get("published_at") or record.get("evidence_date") or record.get("date_posted"))[:10]
    source_url = _text(record.get("source_url") or record.get("vacancy_url"))
    domain = _text(record.get("employer_official_domain") or record.get("official_domain"))
    duties = description or _text(record.get("evidence") or record.get("evidence_excerpt"))
    source_text = "\n".join(part for part in (company, title, location, duties) if part)
    duty_excerpt, start, end = find_customer_acquisition_duty(source_text)
    duty_proven = bool(duty_excerpt) and start >= 0
    rejection: Optional[str] = None
    if looks_sales_role(title=title, description=description) and not duty_proven:
        rejection = "CUSTOMER_ACQUISITION_DUTY_UNPROVEN"
    if not duty_proven:
        # Prefer the richest literal page text available; never invent duties.
        fallback = duties or title
        evidence_excerpt = fallback[:500]
        start = source_text.find(evidence_excerpt) if evidence_excerpt else -1
        end = start + len(evidence_excerpt) if start >= 0 else -1
    else:
        evidence_excerpt = duty_excerpt
    return HiringSemanticEvidenceBundle(
        subject=company,
        subject_role="employer",
        event="active_job_opening",
        object=title or "ruolo commerciale",
        role_duties=duties[:4000],
        location=location,
        event_date=event_date,
        source_url=source_url,
        official_domain=domain,
        evidence_excerpt=evidence_excerpt,
        excerpt_start=start,
        excerpt_end=end,
        vacancy_title=title,
        vacancy_active=record.get("active") is True,
        employer_is_direct=record.get("employer_is_direct") is True,
        customer_acquisition_duty_proven=duty_proven,
        duty_rejection_code=rejection,
    )
