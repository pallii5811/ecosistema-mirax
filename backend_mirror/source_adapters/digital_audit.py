"""Contract adapter over the proven Maps + website audit path.

The adapter deliberately delegates acquisition and technical inspection to the
legacy runner. It only owns the canonical boundary, deduplication, evidence
projection and truthful exhaustion metadata.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlparse

from .contracts import (
    AdapterDiscoveryRequest,
    AdapterExecutionResult,
    ContactRecord,
    EvidenceRecord,
    OpportunityCandidate,
    SourceCapability,
    SourceExhaustion,
)


LegacyRunner = Callable[..., Awaitable[List[Dict[str, Any]]]]

_TECHNICAL_SIGNALS = (
    "company_identity",
    "website_weakness",
    "site_stale",
    "missing_analytics",
    "no_pixel",
    "no_gtm",
    "outdated_technology",
    "cybersecurity_exposure",
    "no_dmarc",
    "seo_errors",
    "missing_instagram",
    "missing_google_ads",
)


async def _default_legacy_runner(**kwargs: Any) -> List[Dict[str, Any]]:
    from backend_mirror.worker_supabase import _run_core_scraper

    return await _run_core_scraper(**kwargs)


def _text(value: Any) -> Optional[str]:
    result = str(value or "").strip()
    return result or None


def _domain(value: Any) -> Optional[str]:
    text = _text(value)
    if not text:
        return None
    parsed = urlparse(text if "://" in text else f"https://{text}")
    host = (parsed.hostname or "").lower().removeprefix("www.")
    return host or None


def _audit_succeeded(raw: Mapping[str, Any]) -> bool:
    return bool(
        _text(raw.get("website"))
        and raw.get("website_status") == "HAS_WEBSITE"
        and raw.get("website_has_html") is True
        and not _text(raw.get("website_error"))
    )


def _confirmed_signal_values(raw: Mapping[str, Any]) -> Dict[str, str]:
    technical = raw.get("technical_report") if isinstance(raw.get("technical_report"), Mapping) else {}
    audit = raw.get("audit") if isinstance(raw.get("audit"), Mapping) else {}
    confirmed: Dict[str, str] = {}
    if _text(raw.get("website")):
        confirmed["company_identity"] = "official website observed from the business record"
    if not _audit_succeeded(raw):
        return confirmed
    if raw.get("meta_pixel") is False and audit.get("has_facebook_pixel") is False:
        confirmed["no_pixel"] = "Meta/Facebook Pixel absent in direct HTML audit"
    if raw.get("google_tag_manager") is False and audit.get("has_gtm") is False:
        confirmed["no_gtm"] = "Google Tag Manager absent in direct HTML audit"
    if technical.get("has_ga4") is False:
        confirmed["missing_analytics"] = "GA4 absent in direct technical audit"
    if technical.get("has_google_ads") is False:
        confirmed["missing_google_ads"] = "Google Ads conversion tag absent in direct technical audit"
    if technical.get("has_dmarc") is False:
        confirmed["no_dmarc"] = "DMARC record absent in direct DNS audit"
        confirmed["cybersecurity_exposure"] = "DMARC record absent in direct DNS audit"
    if technical.get("seo_disaster") is True or int(raw.get("html_errors") or 0) > 0:
        confirmed["seo_errors"] = "critical SEO/HTML issues observed in direct audit"
        confirmed["website_weakness"] = "critical SEO/HTML issues observed in direct audit"
    speed = technical.get("load_speed_seconds")
    try:
        if speed is not None and float(speed) > 4:
            confirmed["website_weakness"] = f"homepage load time {float(speed):.2f}s"
    except (TypeError, ValueError):
        pass
    if raw.get("instagram_missing") is True or audit.get("missing_instagram") is True:
        confirmed["missing_instagram"] = "Instagram profile absent from official website audit"
    return confirmed


def _candidate_from_raw(
    raw: Mapping[str, Any],
    request: AdapterDiscoveryRequest,
    *,
    observed_at: str,
) -> Optional[OpportunityCandidate]:
    name = _text(raw.get("business_name") or raw.get("azienda") or raw.get("name"))
    website = _text(raw.get("website") or raw.get("sito"))
    canonical_domain = _domain(website)
    if not name or not canonical_domain or not website:
        return None
    confirmed = _confirmed_signal_values(raw)
    discovery_category = _text(raw.get("category") or raw.get("categoria"))
    requested_category = next((_text(value) for value in request.sectors if _text(value)), None)
    category_scoped = bool(
        discovery_category
        and requested_category
        and discovery_category.casefold() == requested_category.casefold()
    )
    if not category_scoped:
        return None
    requested = tuple(dict.fromkeys(request.signal_ids or ("company_identity",)))
    matched = [signal for signal in requested if signal in confirmed]
    enough = bool(matched) if request.signal_match_mode == "any" else len(matched) == len(requested)
    if not enough:
        return None
    evidence = tuple(EvidenceRecord(
        signal_id=signal,
        source_url=website,
        source_publisher=name,
        source_class="technology_audit" if signal != "company_identity" else "official_company_website",
        excerpt=confirmed[signal],
        observed_at=observed_at,
        published_at=observed_at[:10],
        extraction_method="legacy_maps_and_direct_audit",
        confidence=0.94 if signal != "company_identity" else 0.86,
        provenance={
            "adapter_id": DigitalAuditAdapter.CAPABILITY.adapter_id,
            "adapter_version": DigitalAuditAdapter.CAPABILITY.adapter_version,
            "result_index": raw.get("result_index"),
            "audit_succeeded": _audit_succeeded(raw),
        },
    ) for signal in matched)
    contacts: List[ContactRecord] = []
    for kind, key in (("email", "email"), ("phone", "phone"), ("social", "instagram"), ("social", "facebook")):
        if value := _text(raw.get(key)):
            contacts.append(ContactRecord(kind=kind, value=value, source_url=website, verified=True))  # type: ignore[arg-type]
    return OpportunityCandidate(
        canonical_company_name=name,
        company_identifiers={},
        official_domain=canonical_domain,
        entity_class="operating_company",
        geographies=tuple(dict.fromkeys(filter(None, (_text(raw.get("city")), _text(raw.get("address")))))) or request.geographies,
        buyer_fit=0.72,
        signal_id=matched[0],
        signal_date=observed_at[:10],
        evidence=evidence,
        why_now="; ".join(confirmed[signal] for signal in matched),
        contacts=tuple(contacts),
        confidence=min(item.confidence for item in evidence),
        contradiction_flags=(),
        provenance={
            "adapter_id": DigitalAuditAdapter.CAPABILITY.adapter_id,
            "adapter_version": DigitalAuditAdapter.CAPABILITY.adapter_version,
            "legacy_result_index": raw.get("result_index"),
            "maps_rating": raw.get("rating"),
            "maps_reviews_count": raw.get("reviews_count"),
            "buyer_fit_basis": "category_scoped_maps_discovery",
            "discovery_category": discovery_category,
            "domain_verification": {
                "status": "verified", "confidence": 0.86, "score": 86,
                "evidence": ("maps_business_website", "direct_website_audit"),
                "resolution_source": "source_adapter",
                "resolution_method": "verified_source_adapter",
                "adapter_id": DigitalAuditAdapter.CAPABILITY.adapter_id,
                "url": website,
            },
        },
        adapter_id=DigitalAuditAdapter.CAPABILITY.adapter_id,
        adapter_version=DigitalAuditAdapter.CAPABILITY.adapter_version,
        official_domain_verified=True,
        official_domain_confidence=0.86,
    )


class DigitalAuditAdapter:
    CAPABILITY = SourceCapability(
        adapter_id="legacy_digital_audit_v1",
        adapter_version="1.0.0",
        supported_intents=("maps", "hybrid", "digital_audit", "commercial_search"),
        supported_signals=_TECHNICAL_SIGNALS,
        source_classes=("google_business_maps", "technology_audit", "official_company_website"),
        geographic_coverage=("italy",),
        freshness_max_age_days=1,
        discovery_mode="discovery_first",
        supports_pagination=False,
        supports_cursor_resume=False,
        max_results_per_page=200,
        max_results_per_run=200,
        estimated_cost_eur_per_operation=0.011,
        authentication_requirements=("google_maps_browser_access",),
        rate_limit_per_minute=10,
        provenance_guarantees=("company_name", "official_domain", "audit_observed_at"),
        evidence_guarantees=("direct_observation", "signal_id", "source_url", "excerpt"),
        exhaustion_semantics="best_effort",
        coverage_status="supported",
    )

    def __init__(self, legacy_runner: LegacyRunner = _default_legacy_runner) -> None:
        self._legacy_runner = legacy_runner

    @property
    def capability(self) -> SourceCapability:
        return self.CAPABILITY

    async def discover(self, request: AdapterDiscoveryRequest) -> AdapterExecutionResult:
        if request.requested_count > (self.capability.max_results_per_run or 0):
            raise ValueError("requested_count exceeds the bounded legacy Digital Audit run")
        category = next((_text(value) for value in request.sectors if _text(value)), None)
        location = next((_text(value) for value in request.geographies if _text(value) and value.lower() not in {"italy", "italia"}), None)
        location = location or next((_text(value) for value in request.geographies if _text(value)), None)
        if not category or not location:
            raise ValueError("Digital Audit requires a concrete category and geography")
        started_at = datetime.now(timezone.utc).isoformat()
        raw = await self._legacy_runner(
            category=category,
            location=location,
            zone=str(request.requested_count),
            intent={
                "required_signals": list(request.signal_ids),
                "technical_filters": dict(request.technical_filters),
                "signal_match_mode": request.signal_match_mode,
                "source_adapter": self.capability.adapter_id,
            },
        )
        raw = [
            {**item, "category": item.get("category") or item.get("categoria") or category}
            for item in raw
        ]
        observed_at = datetime.now(timezone.utc).isoformat()
        deduplicated: List[OpportunityCandidate] = []
        seen: set[str] = set()
        for item in raw:
            candidate = _candidate_from_raw(item, request, observed_at=observed_at)
            if not candidate:
                continue
            key = candidate.official_domain or candidate.canonical_company_name.casefold()
            if key in seen:
                continue
            seen.add(key)
            deduplicated.append(candidate)
            if len(deduplicated) >= request.requested_count:
                break
        target_reached = len(deduplicated) >= request.requested_count
        return AdapterExecutionResult(
            adapter_id=self.capability.adapter_id,
            adapter_version=self.capability.adapter_version,
            candidates=tuple(deduplicated),
            exhaustion=SourceExhaustion(
                exhausted=not target_reached,
                scope="page" if target_reached else "source",
                reason="requested_count_reached" if target_reached else "legacy_source_returned_less_than_requested",
                authoritative=False,
            ),
            operations=len(raw),
            cost_eur=0.0,
            started_at=started_at,
            completed_at=observed_at,
            warnings=() if target_reached else ("best_effort_source_exhaustion",),
        )
