"""Single canonical runtime contract shared by all MIRAX source adapters.

Adapters must emit this representation at the acquisition boundary. Downstream
components may serialize it, but must not invent parallel aliases for the same
facts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Dict, Iterable, List, Literal, Mapping, Optional, Protocol, Sequence, Tuple, runtime_checkable
from urllib.parse import urlparse


CoverageStatus = Literal["supported", "unsupported", "generic_fallback_partial"]
SignalMatchMode = Literal["any", "all"]
DiscoveryMode = Literal["discovery_first", "candidate_first", "verification_only", "generic_fallback"]


def _clean(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def _string_tuple(value: Any) -> Tuple[str, ...]:
    if isinstance(value, str):
        values: Iterable[Any] = (value,)
    elif isinstance(value, Iterable) and not isinstance(value, (bytes, Mapping)):
        values = value
    else:
        values = ()
    return tuple(dict.fromkeys(text for item in values if (text := _clean(item))))


def _iso_date(value: Any) -> Optional[str]:
    if isinstance(value, (date, datetime)):
        return value.date().isoformat() if isinstance(value, datetime) else value.isoformat()
    text = _clean(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        try:
            return date.fromisoformat(text[:10]).isoformat()
        except ValueError:
            return None


def _official_domain(value: Any) -> Optional[str]:
    text = _clean(value)
    if not text:
        return None
    parsed = urlparse(text if "://" in text else f"https://{text}")
    host = (parsed.hostname or "").lower().strip(".")
    if host.startswith("www."):
        host = host[4:]
    return host or None


@dataclass(frozen=True)
class DiscoveryCursor:
    value: str
    partition: Optional[str] = None
    exhausted: bool = False


@dataclass(frozen=True)
class ContactRecord:
    kind: Literal["email", "phone", "social", "person", "other"]
    value: str
    source_url: Optional[str] = None
    verified: bool = False


@dataclass(frozen=True)
class EvidenceRecord:
    signal_id: str
    source_url: str
    source_publisher: str
    source_class: str
    excerpt: str
    observed_at: str
    published_at: Optional[str] = None
    extraction_method: str = "unknown"
    confidence: float = 0.0
    provenance: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SourceCapability:
    adapter_id: str
    adapter_version: str
    supported_intents: Tuple[str, ...]
    supported_signals: Tuple[str, ...]
    source_classes: Tuple[str, ...]
    geographic_coverage: Tuple[str, ...]
    freshness_max_age_days: Optional[int]
    discovery_mode: DiscoveryMode
    supports_pagination: bool
    supports_cursor_resume: bool
    max_results_per_page: int
    max_results_per_run: Optional[int]
    estimated_cost_eur_per_operation: float
    authentication_requirements: Tuple[str, ...]
    rate_limit_per_minute: int
    provenance_guarantees: Tuple[str, ...]
    evidence_guarantees: Tuple[str, ...]
    exhaustion_semantics: Literal["authoritative", "partition", "best_effort", "unknown"]
    coverage_status: CoverageStatus = "supported"

    def __post_init__(self) -> None:
        if not self.adapter_id or not self.adapter_version:
            raise ValueError("adapter id and version are required")
        if self.max_results_per_page <= 0 or self.rate_limit_per_minute <= 0:
            raise ValueError("adapter page size and rate limit must be positive")
        if self.estimated_cost_eur_per_operation < 0:
            raise ValueError("adapter cost cannot be negative")
        if self.coverage_status == "supported" and self.discovery_mode == "generic_fallback":
            raise ValueError("generic fallback cannot claim full support")


@dataclass(frozen=True)
class AdapterDiscoveryRequest:
    intent: str
    signal_ids: Tuple[str, ...]
    signal_match_mode: SignalMatchMode
    geographies: Tuple[str, ...]
    freshness_max_age_days: Optional[int]
    requested_count: int
    budget_eur: float
    query: str = ""
    sectors: Tuple[str, ...] = ()
    technical_filters: Mapping[str, Any] = field(default_factory=dict)
    cursor: Optional[DiscoveryCursor] = None

    def __post_init__(self) -> None:
        if self.requested_count <= 0:
            raise ValueError("requested_count must be positive")
        if self.budget_eur < 0:
            raise ValueError("budget_eur cannot be negative")
        if self.signal_match_mode not in ("any", "all"):
            raise ValueError("invalid signal_match_mode")


@dataclass(frozen=True)
class OpportunityCandidate:
    canonical_company_name: str
    company_identifiers: Mapping[str, str]
    official_domain: Optional[str]
    entity_class: Optional[str]
    geographies: Tuple[str, ...]
    buyer_fit: Optional[float]
    signal_id: str
    signal_date: Optional[str]
    evidence: Tuple[EvidenceRecord, ...]
    why_now: Optional[str]
    contacts: Tuple[ContactRecord, ...]
    confidence: float
    contradiction_flags: Tuple[str, ...]
    provenance: Mapping[str, Any]
    adapter_id: str
    adapter_version: str

    def __post_init__(self) -> None:
        if not self.canonical_company_name or not self.signal_id:
            raise ValueError("candidate company name and signal id are required")
        if not 0 <= self.confidence <= 1:
            raise ValueError("candidate confidence must be between 0 and 1")
        if self.buyer_fit is not None and not 0 <= self.buyer_fit <= 1:
            raise ValueError("buyer_fit must be between 0 and 1")


@dataclass(frozen=True)
class QualifiedLead:
    candidate: OpportunityCandidate
    qualification_reasons: Tuple[str, ...]
    opportunity_value_score: float
    qualified_at: str

    def __post_init__(self) -> None:
        if not 0 <= self.opportunity_value_score <= 1:
            raise ValueError("opportunity value score must be between 0 and 1")
        if not self.candidate.official_domain or not self.candidate.evidence:
            raise ValueError("qualified lead requires official domain and evidence")


@dataclass(frozen=True)
class SourceExhaustion:
    exhausted: bool
    scope: Literal["page", "partition", "source", "market", "budget", "time"]
    reason: str
    authoritative: bool
    next_cursor: Optional[DiscoveryCursor] = None


@dataclass(frozen=True)
class AdapterExecutionResult:
    adapter_id: str
    adapter_version: str
    candidates: Tuple[OpportunityCandidate, ...]
    exhaustion: SourceExhaustion
    operations: int
    cost_eur: float
    started_at: str
    completed_at: str
    warnings: Tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.operations < 0 or self.cost_eur < 0:
            raise ValueError("operations and cost must be non-negative")


@runtime_checkable
class SourceAdapter(Protocol):
    @property
    def capability(self) -> SourceCapability: ...

    async def discover(self, request: AdapterDiscoveryRequest) -> AdapterExecutionResult: ...


def normalize_opportunity_candidate(
    payload: Mapping[str, Any],
    *,
    adapter_id: str,
    adapter_version: str,
) -> OpportunityCandidate:
    """Normalize one external adapter payload exactly once at ingress.

    A small, explicit alias set is accepted only here for legacy boundaries.
    The returned object contains canonical names exclusively.
    """

    technical = payload.get("technical_report") if isinstance(payload.get("technical_report"), Mapping) else {}
    domain_verification = (
        technical.get("domain_verification")
        if isinstance(technical.get("domain_verification"), Mapping)
        else {}
    )
    official_domain = _official_domain(
        payload.get("official_domain")
        or payload.get("canonical_domain")
        or domain_verification.get("official_domain")
        or domain_verification.get("canonical_domain")
    )
    raw_evidence = payload.get("evidence") or payload.get("evidence_records") or ()
    if isinstance(raw_evidence, Mapping):
        raw_evidence = (raw_evidence,)
    evidence: List[EvidenceRecord] = []
    for item in raw_evidence if isinstance(raw_evidence, Sequence) and not isinstance(raw_evidence, (str, bytes)) else ():
        if not isinstance(item, Mapping):
            continue
        source_url = _clean(item.get("source_url") or item.get("url"))
        excerpt = _clean(item.get("excerpt") or item.get("evidence_excerpt") or item.get("text"))
        publisher = _clean(item.get("source_publisher") or item.get("publisher"))
        source_class = _clean(item.get("source_class") or item.get("type"))
        signal_id = _clean(item.get("signal_id") or payload.get("signal_id"))
        if not all((source_url, excerpt, publisher, source_class, signal_id)):
            continue
        evidence.append(EvidenceRecord(
            signal_id=signal_id,
            source_url=source_url,
            source_publisher=publisher,
            source_class=source_class,
            excerpt=excerpt,
            observed_at=_iso_date(item.get("observed_at")) or date.today().isoformat(),
            published_at=_iso_date(item.get("published_at") or item.get("date")),
            extraction_method=_clean(item.get("extraction_method")) or "unknown",
            confidence=max(0.0, min(1.0, float(item.get("confidence") or 0))),
            provenance=item.get("provenance") if isinstance(item.get("provenance"), Mapping) else {},
        ))
    raw_contacts = payload.get("contacts") or ()
    contacts: List[ContactRecord] = []
    for item in raw_contacts if isinstance(raw_contacts, Sequence) and not isinstance(raw_contacts, (str, bytes)) else ():
        if not isinstance(item, Mapping) or not _clean(item.get("value")):
            continue
        kind = _clean(item.get("kind")) or "other"
        if kind not in {"email", "phone", "social", "person", "other"}:
            kind = "other"
        contacts.append(ContactRecord(kind=kind, value=str(item["value"]).strip(), source_url=_clean(item.get("source_url")), verified=item.get("verified") is True))
    identifiers = payload.get("company_identifiers") if isinstance(payload.get("company_identifiers"), Mapping) else {}
    return OpportunityCandidate(
        canonical_company_name=_clean(payload.get("canonical_company_name") or payload.get("entity_name") or payload.get("company_name") or payload.get("name")) or "",
        company_identifiers={str(k): str(v) for k, v in identifiers.items() if _clean(k) and _clean(v)},
        official_domain=official_domain,
        entity_class=_clean(payload.get("entity_class")),
        geographies=_string_tuple(payload.get("geographies") or payload.get("geography") or payload.get("location")),
        buyer_fit=float(payload["buyer_fit"]) if payload.get("buyer_fit") is not None else None,
        signal_id=_clean(payload.get("signal_id")) or "",
        signal_date=_iso_date(payload.get("signal_date") or payload.get("published_at"))
        or next((item.published_at for item in evidence if item.published_at), None),
        evidence=tuple(evidence),
        why_now=_clean(payload.get("why_now")),
        contacts=tuple(contacts),
        confidence=max(0.0, min(1.0, float(payload.get("confidence") or 0))),
        contradiction_flags=_string_tuple(payload.get("contradiction_flags")),
        provenance=payload.get("provenance") if isinstance(payload.get("provenance"), Mapping) else {},
        adapter_id=adapter_id,
        adapter_version=adapter_version,
    )
