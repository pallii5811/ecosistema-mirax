"""Contract adapter over the proven Maps + website audit path.

The adapter deliberately delegates acquisition and technical inspection to the
legacy runner. It only owns the canonical boundary, deduplication, evidence
projection and truthful exhaustion metadata.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import re
import zlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlparse

try:
    from ..maps_pagination import maps_identity_hash
except ImportError:  # pragma: no cover - deployed worker imports from backend root
    from maps_pagination import maps_identity_hash

from .contracts import (
    AdapterDiscoveryRequest,
    AdapterExecutionResult,
    ContactRecord,
    DiscoveryCursor,
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
    "missing_advertising_pixel",
    "no_pixel",
    "no_gtm",
    "outdated_technology",
    "cybersecurity_exposure",
    "no_dmarc",
    "seo_errors",
    "missing_instagram",
    "missing_google_ads",
)

SEO_GROUP_SIGNALS = frozenset({"website_weakness", "seo_errors", "site_stale"})
TRACKING_ABSENCE_SIGNALS = frozenset({
    "missing_advertising_pixel", "missing_analytics", "no_pixel", "no_gtm",
})

DEFAULT_MAPS_BATCH_SIZE = 15
DEFAULT_MAPS_BATCH_GROWTH = 10
DEFAULT_MAPS_MAX_FETCH = 200
DEFAULT_RAW_CANDIDATE_BUDGET_MIN = 30
DEFAULT_PER_ROUND_RAW_CAP = 50
DEFAULT_MAXIMUM_SAFETY_RAW_CAP = 100_000
DEFAULT_YIELD_FLOOR = 0.05
DEFAULT_ADAPTIVE_MARGIN = 1.25
_CURSOR_PREFIX_V1 = "da:v1:"
_CURSOR_PREFIX_V2 = "da:v2:"
_CURSOR_PREFIX = "da:v3:"

_CATEGORY_PARTITION_ALIASES: Dict[str, Tuple[str, ...]] = {
    "imprese di pulizia": (
        "imprese di pulizia",
        "impresa di pulizie",
        "servizi di pulizia",
    ),
}

_GEOGRAPHY_PARTITIONS: Dict[str, Tuple[str, ...]] = {
    "milano": (
        "Milano", "Milano Centro", "Milano Nord", "Milano Sud", "Milano Est", "Milano Ovest",
        "Milano Niguarda", "Milano Lambrate", "Milano Baggio",
    ),
    "lombardia": (
        "Milano", "Bergamo", "Brescia", "Monza", "Como", "Varese", "Pavia", "Cremona",
        "Lecco", "Lodi", "Mantova", "Sondrio",
    ),
}


@dataclass(frozen=True)
class DigitalAuditCursorState:
    requested_qualified_count: int
    cumulative_raw_unique: int = 0
    cumulative_audited: int = 0
    cumulative_qualified_unique: int = 0
    processed_identity_hashes: Tuple[str, ...] = ()
    provider_offset: int = 0
    partition_index: int = 0
    observed_yield: float = 0.0
    adaptive_raw_target: int = 0
    termination_state: str = "active"

    @property
    def processed_place_ids_ref(self) -> str:
        payload = "\n".join(self.processed_identity_hashes).encode("utf-8")
        return hashlib.sha256(payload).hexdigest() if payload else "empty"

_CANONICAL_CATEGORY_ALIASES: Dict[str, frozenset[str]] = {
    "imprese di pulizia": frozenset({
        "imprese di pulizia", "impresa di pulizia", "impresa di pulizie", "imprese di pulizie",
        "servizio di pulizia", "servizi di pulizia", "servizi pulizia", "cleaning service",
        "cleaning company", "impresa pulizie",
    }),
}

_EXCLUDED_CATEGORY_MARKERS = frozenset({
    "lavanderia", "lavanderie", "laundry", "detergenti", "detergente",
    "negozio di prodotti", "vendita detergenti", "prodotti per la pulizia",
})


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


def is_valid_digital_audit_official_domain(value: Any) -> bool:
    """Reject social profiles, portals and directories as company domains."""
    domain = _domain(value)
    if not domain:
        return False
    try:
        from agents.portal_blacklist import is_blacklisted_domain, is_source_portal_url
    except ImportError:
        from backend_mirror.agents.portal_blacklist import is_blacklisted_domain, is_source_portal_url
    return not is_blacklisted_domain(domain) and not is_source_portal_url(str(value or ""))


def _audit_succeeded(raw: Mapping[str, Any]) -> bool:
    return bool(
        _text(raw.get("website"))
        and raw.get("website_status") == "HAS_WEBSITE"
        and raw.get("website_has_html") is True
        and not _text(raw.get("website_error"))
    )


def signal_groups_from_required_signals(signals: Sequence[str]) -> Optional[List[List[str]]]:
    seo = [signal for signal in signals if signal in SEO_GROUP_SIGNALS]
    tracking = [signal for signal in signals if signal in TRACKING_ABSENCE_SIGNALS]
    if seo and tracking:
        return [seo, tracking]
    return None


def _normalize_category_label(value: Optional[str]) -> str:
    if not value:
        return ""
    text = value.casefold().strip()
    return re.sub(r"\s+", " ", text)


def _category_family_for_requested(requested: str) -> frozenset[str]:
    norm = _normalize_category_label(requested)
    for key, aliases in _CANONICAL_CATEGORY_ALIASES.items():
        if norm == key or norm in aliases:
            return frozenset(set(aliases) | {key})
    return frozenset({norm}) if norm else frozenset()


def category_matches_target(
    requested: str,
    discovery: Optional[str],
    *,
    business_name: Optional[str] = None,
) -> Tuple[bool, str, str]:
    family = _category_family_for_requested(requested)
    discovery_norm = _normalize_category_label(discovery)
    name_norm = _normalize_category_label(business_name)
    combined = f"{discovery_norm} {name_norm}".strip()

    if any(marker in combined for marker in _EXCLUDED_CATEGORY_MARKERS):
        if "puliz" not in combined and "clean" not in combined:
            return False, discovery_norm or discovery or "", discovery_norm or discovery or ""

    if discovery_norm in family:
        return True, discovery_norm, discovery_norm
    for alias in sorted(family, key=len, reverse=True):
        if alias and alias in combined:
            return True, discovery_norm or alias, alias
    if "imprese di pulizia" in family or any("puliz" in alias for alias in family):
        if "puliz" in name_norm or "cleaning" in name_norm:
            return True, discovery_norm, "business_name_cleaning_context"
    return False, discovery_norm or "", discovery_norm or ""


def _tech_stack_labels(raw: Mapping[str, Any]) -> set[str]:
    stack = raw.get("tech_stack") or ()
    if isinstance(stack, str):
        stack = (stack,)
    return {str(item).strip().upper() for item in stack if str(item).strip()}


def _optional_bool(raw: Mapping[str, Any], *keys: str) -> Optional[bool]:
    for key in keys:
        if key not in raw:
            continue
        value = raw.get(key)
        if value is None:
            continue
        return bool(value)
    return None


def _ga4_present(raw: Mapping[str, Any], technical: Mapping[str, Any], labels: set[str]) -> bool:
    if technical.get("has_ga4") is True or raw.get("has_ga4") is True or raw.get("has_google_analytics") is True:
        return True
    return "GA4" in labels or "GOOGLE ANALYTICS" in labels


def _meta_pixel_present(raw: Mapping[str, Any], audit: Mapping[str, Any], labels: set[str]) -> bool:
    if raw.get("meta_pixel") is True or raw.get("has_meta_pixel") is True:
        return True
    if audit.get("has_facebook_pixel") is True:
        return True
    return "Meta Pixel" in labels


def _gtm_present(raw: Mapping[str, Any], audit: Mapping[str, Any], labels: set[str]) -> bool:
    if raw.get("google_tag_manager") is True or raw.get("has_gtm") is True:
        return True
    if audit.get("has_gtm") is True:
        return True
    return "GTM" in labels


def per_round_raw_cap_for(technical_filters: Mapping[str, Any]) -> int:
    explicit = technical_filters.get("per_round_raw_cap")
    if explicit is not None:
        try:
            return min(DEFAULT_MAPS_MAX_FETCH, max(1, int(explicit)))
        except (TypeError, ValueError):
            pass
    try:
        configured = int(os.getenv("MIRAX_DIGITAL_AUDIT_PER_ROUND_RAW_CAP", str(DEFAULT_PER_ROUND_RAW_CAP)))
    except ValueError:
        configured = DEFAULT_PER_ROUND_RAW_CAP
    return min(DEFAULT_MAPS_MAX_FETCH, max(1, configured))


def maximum_safety_raw_cap_for(
    requested_qualified: int,
    technical_filters: Mapping[str, Any],
) -> int:
    explicit = technical_filters.get("maximum_safety_raw_cap")
    if explicit is not None:
        try:
            return max(requested_qualified, int(explicit))
        except (TypeError, ValueError):
            pass
    try:
        configured = int(os.getenv(
            "MIRAX_DIGITAL_AUDIT_MAX_CUMULATIVE_RAW",
            str(DEFAULT_MAXIMUM_SAFETY_RAW_CAP),
        ))
    except ValueError:
        configured = DEFAULT_MAXIMUM_SAFETY_RAW_CAP
    return max(requested_qualified, configured)


def adaptive_raw_target_for(
    *,
    requested_qualified: int,
    cumulative_qualified: int,
    cumulative_raw: int,
    technical_filters: Mapping[str, Any],
) -> Tuple[int, float]:
    try:
        yield_floor = float(technical_filters.get("configured_yield_floor") or DEFAULT_YIELD_FLOOR)
    except (TypeError, ValueError):
        yield_floor = DEFAULT_YIELD_FLOOR
    try:
        margin = float(technical_filters.get("adaptive_raw_margin") or DEFAULT_ADAPTIVE_MARGIN)
    except (TypeError, ValueError):
        margin = DEFAULT_ADAPTIVE_MARGIN
    yield_floor = min(1.0, max(0.001, yield_floor))
    margin = max(1.0, margin)
    observed_yield = cumulative_qualified / cumulative_raw if cumulative_raw else 0.0
    remaining = max(0, requested_qualified - cumulative_qualified)
    estimated_remaining = math.ceil(remaining / max(observed_yield, yield_floor)) if remaining else 0
    return cumulative_raw + math.ceil(estimated_remaining * margin), observed_yield


def raw_candidate_budget_for(requested_qualified: int, technical_filters: Mapping[str, Any]) -> int:
    """Backward-compatible name for the initial adaptive cumulative target."""
    target, _ = adaptive_raw_target_for(
        requested_qualified=requested_qualified,
        cumulative_qualified=0,
        cumulative_raw=0,
        technical_filters=technical_filters,
    )
    return min(maximum_safety_raw_cap_for(requested_qualified, technical_filters), max(
        DEFAULT_RAW_CANDIDATE_BUDGET_MIN,
        target,
    ))


def maps_batch_size_for(technical_filters: Mapping[str, Any]) -> int:
    explicit = technical_filters.get("maps_batch_size")
    if explicit is not None:
        try:
            return max(1, int(explicit))
        except (TypeError, ValueError):
            pass
    return DEFAULT_MAPS_BATCH_SIZE


def _partition_plan(category: str, location: str, technical_filters: Mapping[str, Any]) -> Tuple[Tuple[str, str], ...]:
    explicit = technical_filters.get("digital_audit_partitions")
    if isinstance(explicit, list) and explicit:
        parsed: List[Tuple[str, str]] = []
        for item in explicit:
            if not isinstance(item, Mapping):
                continue
            item_category = _text(item.get("category")) or category
            item_location = _text(item.get("location")) or location
            parsed.append((item_category, item_location))
        if parsed:
            return tuple(dict.fromkeys(parsed))
    canonical_category = _normalize_category_label(category)
    aliases = _CATEGORY_PARTITION_ALIASES.get(canonical_category, (category,))
    geographies = _GEOGRAPHY_PARTITIONS.get(_normalize_category_label(location), (location,))
    return tuple(dict.fromkeys((alias, geography) for geography in geographies for alias in aliases))


def _raw_identity_hash(raw: Mapping[str, Any]) -> str:
    return maps_identity_hash(raw)


def _confirmed_signal_values(raw: Mapping[str, Any]) -> Dict[str, str]:
    technical = raw.get("technical_report") if isinstance(raw.get("technical_report"), Mapping) else {}
    audit = raw.get("audit") if isinstance(raw.get("audit"), Mapping) else {}
    labels = _tech_stack_labels(raw)
    confirmed: Dict[str, str] = {}
    if _text(raw.get("website")):
        confirmed["company_identity"] = "official website observed from the business record"
    if not _audit_succeeded(raw):
        return confirmed
    pixel_present = _meta_pixel_present(raw, audit, labels)
    pixel_absent = (
        "MISSING FB PIXEL" in labels
        or raw.get("pixel_missing") is True
        or (
            not pixel_present
            and _optional_bool(raw, "meta_pixel", "has_meta_pixel") is False
        )
    )
    if pixel_absent:
        confirmed["no_pixel"] = "Meta/Facebook Pixel absent in direct HTML audit"
        confirmed["missing_advertising_pixel"] = "Meta/Facebook Pixel absent in direct HTML audit"
    gtm_present = _gtm_present(raw, audit, labels)
    gtm_absent = (
        _optional_bool(raw, "google_tag_manager", "has_gtm") is False
        or "MISSING GTM" in labels
    ) and not gtm_present
    if gtm_absent:
        confirmed["no_gtm"] = "Google Tag Manager absent in direct HTML audit"
    ga4_present = _ga4_present(raw, technical, labels)
    if "MISSING GA4" in labels or (
        not ga4_present and (
            technical.get("has_ga4") is False
            or raw.get("has_ga4") is False
            or raw.get("has_google_analytics") is False
        )
    ):
        confirmed["missing_analytics"] = "GA4 absent in direct technical audit"
    if technical.get("has_google_ads") is False or "MISSING GOOGLE ADS" in labels:
        confirmed["missing_google_ads"] = "Google Ads conversion tag absent in direct technical audit"
    if technical.get("has_dmarc") is False:
        confirmed["no_dmarc"] = "DMARC record absent in direct DNS audit"
        confirmed["cybersecurity_exposure"] = "DMARC record absent in direct DNS audit"
    if (
        technical.get("seo_disaster") is True
        or int(raw.get("html_errors") or 0) > 0
        or "DISASTRO SEO (NO H1/TITLE)" in labels
    ):
        confirmed["seo_errors"] = "critical SEO/HTML issues observed in direct audit"
        confirmed["website_weakness"] = "critical SEO/HTML issues observed in direct audit"
    speed = technical.get("load_speed_seconds")
    if speed is None:
        speed = technical.get("load_speed_s")
    if speed is None:
        speed = raw.get("load_speed_s")
    try:
        if speed is not None and float(speed) > 4:
            confirmed["website_weakness"] = f"homepage load time {float(speed):.2f}s"
    except (TypeError, ValueError):
        pass
    if "SITO LENTO" in labels and "website_weakness" not in confirmed:
        confirmed["website_weakness"] = "slow homepage observed in direct audit"
    if raw.get("site_stale") is True or technical.get("site_stale") is True:
        confirmed["site_stale"] = "site content appears stale in direct audit"
    if raw.get("instagram_missing") is True or audit.get("missing_instagram") is True:
        confirmed["missing_instagram"] = "Instagram profile absent from official website audit"
    return confirmed


def _tracking_fully_present(raw: Mapping[str, Any]) -> bool:
    if not _audit_succeeded(raw):
        return False
    technical = raw.get("technical_report") if isinstance(raw.get("technical_report"), Mapping) else {}
    audit = raw.get("audit") if isinstance(raw.get("audit"), Mapping) else {}
    labels = _tech_stack_labels(raw)
    return _meta_pixel_present(raw, audit, labels) and _ga4_present(raw, technical, labels) and _gtm_present(raw, audit, labels)


def _seo_weakness_confirmed(confirmed: Mapping[str, str]) -> bool:
    return any(signal in confirmed for signal in SEO_GROUP_SIGNALS)


def _tracking_absence_confirmed(confirmed: Mapping[str, str]) -> bool:
    return any(signal in confirmed for signal in TRACKING_ABSENCE_SIGNALS)


@dataclass(frozen=True)
class CandidateProjectionDecision:
    accepted: bool
    candidate: Optional[OpportunityCandidate] = None
    rejection_code: Optional[str] = None
    rejection_details: Dict[str, Any] = field(default_factory=dict)


def _evaluate_signal_match(
    raw: Mapping[str, Any],
    request: AdapterDiscoveryRequest,
    confirmed: Mapping[str, str],
) -> Tuple[bool, Optional[str], List[str]]:
    groups = request.technical_filters.get("signal_groups")
    if isinstance(groups, list) and groups:
        matched: List[str] = []
        failed_groups: List[List[str]] = []
        for group in groups:
            if not isinstance(group, (list, tuple)):
                continue
            group_ids = [str(item) for item in group]
            hits = [signal for signal in group_ids if signal in confirmed]
            if hits:
                matched.extend(hits)
            else:
                failed_groups.append(group_ids)
        if failed_groups:
            if not _audit_succeeded(raw):
                return False, "AUDIT_EVIDENCE_INCOMPLETE", matched
            tracking_failed = any(set(group).intersection(TRACKING_ABSENCE_SIGNALS) for group in failed_groups)
            seo_failed = any(set(group).intersection(SEO_GROUP_SIGNALS) for group in failed_groups)
            if tracking_failed and _tracking_fully_present(raw):
                return False, "TRACKING_ABSENCE_NOT_VERIFIED", matched
            if seo_failed:
                return False, "SEO_WEAKNESS_NOT_VERIFIED", matched
            if tracking_failed:
                return False, "TRACKING_ABSENCE_NOT_VERIFIED", matched
            return False, "SIGNAL_GROUP_MISMATCH", matched
        return True, None, list(dict.fromkeys(matched))

    requested = tuple(dict.fromkeys(request.signal_ids or ("company_identity",)))
    matched = [signal for signal in requested if signal in confirmed]
    enough = bool(matched) if request.signal_match_mode == "any" else len(matched) == len(requested)
    if not enough:
        if not _audit_succeeded(raw):
            return False, "AUDIT_EVIDENCE_INCOMPLETE", matched
        if requested and any(signal in SEO_GROUP_SIGNALS for signal in requested) and not _seo_weakness_confirmed(confirmed):
            return False, "SEO_WEAKNESS_NOT_VERIFIED", matched
        if requested and any(signal in TRACKING_ABSENCE_SIGNALS for signal in requested):
            if _tracking_fully_present(raw):
                return False, "TRACKING_ABSENCE_NOT_VERIFIED", matched
            return False, "TRACKING_ABSENCE_NOT_VERIFIED", matched
        return False, "SIGNAL_GROUP_MISMATCH", matched
    return True, None, matched


def project_candidate_from_raw(
    raw: Mapping[str, Any],
    request: AdapterDiscoveryRequest,
    *,
    observed_at: str,
) -> CandidateProjectionDecision:
    name = _text(raw.get("business_name") or raw.get("azienda") or raw.get("name"))
    website = _text(raw.get("website") or raw.get("sito"))
    canonical_domain = _domain(website)
    if not name:
        return CandidateProjectionDecision(False, rejection_code="OFFICIAL_DOMAIN_MISSING", rejection_details={"reason": "missing_company_name"})
    if not canonical_domain or not website:
        return CandidateProjectionDecision(False, rejection_code="OFFICIAL_DOMAIN_MISSING", rejection_details={"reason": "missing_website", "company_name": name})
    if not is_valid_digital_audit_official_domain(website):
        return CandidateProjectionDecision(
            False,
            rejection_code="OFFICIAL_DOMAIN_NOT_COMPANY_OWNED",
            rejection_details={"company_name": name, "rejected_domain": canonical_domain},
        )

    discovery_category = _text(raw.get("category") or raw.get("categoria"))
    requested_category = next((_text(value) for value in request.sectors if _text(value)), None)
    category_ok, normalized_category, matched_alias = category_matches_target(
        requested_category or "",
        discovery_category,
        business_name=name,
    )
    if not category_ok:
        return CandidateProjectionDecision(
            False,
            rejection_code="CATEGORY_TARGET_MISMATCH",
            rejection_details={
                "company_name": name,
                "maps_category": discovery_category,
                "normalized_category": normalized_category,
                "requested_category": requested_category,
                "matched_alias": matched_alias,
            },
        )

    confirmed = _confirmed_signal_values(raw)
    signal_ok, rejection_code, matched = _evaluate_signal_match(raw, request, confirmed)
    if not signal_ok or not matched:
        return CandidateProjectionDecision(
            False,
            rejection_code=rejection_code or "SIGNAL_GROUP_MISMATCH",
            rejection_details={
                "company_name": name,
                "confirmed_signals": sorted(confirmed),
                "requested_signals": list(request.signal_ids),
                "signal_match_mode": request.signal_match_mode,
                "matched_signals": matched,
            },
        )

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
    candidate = OpportunityCandidate(
        canonical_company_name=name,
        company_identifiers={"place_id": _text(raw.get("place_id")) or ""} if _text(raw.get("place_id")) else {},
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
            "normalized_category": normalized_category,
            "matched_category_alias": matched_alias,
            "matched_signal_ids": matched,
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
    return CandidateProjectionDecision(True, candidate=candidate)


def _signal_group_status(
    request: AdapterDiscoveryRequest,
    confirmed: Mapping[str, str],
) -> Tuple[bool, bool, List[str], List[str]]:
    groups = request.technical_filters.get("signal_groups")
    seo_ok = _seo_weakness_confirmed(confirmed)
    tracking_ok = _tracking_absence_confirmed(confirmed)
    seo_hits = [signal for signal in confirmed if signal in SEO_GROUP_SIGNALS]
    tracking_hits = [signal for signal in confirmed if signal in TRACKING_ABSENCE_SIGNALS]
    if isinstance(groups, list) and groups:
        for group in groups:
            if not isinstance(group, (list, tuple)):
                continue
            group_ids = [str(item) for item in group]
            if set(group_ids).intersection(SEO_GROUP_SIGNALS):
                seo_ok = bool(set(group_ids).intersection(confirmed))
                seo_hits = [signal for signal in group_ids if signal in confirmed]
            if set(group_ids).intersection(TRACKING_ABSENCE_SIGNALS):
                tracking_ok = bool(set(group_ids).intersection(confirmed))
                tracking_hits = [signal for signal in group_ids if signal in confirmed]
    return seo_ok, tracking_ok, seo_hits, tracking_hits


def _audit_payload_summary(raw: Mapping[str, Any]) -> Dict[str, Any]:
    technical = raw.get("technical_report") if isinstance(raw.get("technical_report"), Mapping) else {}
    audit = raw.get("audit") if isinstance(raw.get("audit"), Mapping) else {}
    labels = sorted(_tech_stack_labels(raw))
    speed = technical.get("load_speed_seconds")
    if speed is None:
        speed = technical.get("load_speed_s")
    if speed is None:
        speed = raw.get("load_speed_s")
    return {
        "website_status": raw.get("website_status"),
        "website_has_html": raw.get("website_has_html"),
        "website_error": _text(raw.get("website_error")),
        "html_errors": raw.get("html_errors"),
        "seo_disaster": technical.get("seo_disaster"),
        "load_time_seconds": speed,
        "site_stale": raw.get("site_stale") if raw.get("site_stale") is not None else technical.get("site_stale"),
        "has_ga4": technical.get("has_ga4") if technical.get("has_ga4") is not None else raw.get("has_ga4"),
        "has_google_analytics": raw.get("has_google_analytics"),
        "has_gtm": audit.get("has_gtm") if audit.get("has_gtm") is not None else raw.get("has_gtm"),
        "has_meta_pixel": raw.get("has_meta_pixel") if raw.get("has_meta_pixel") is not None else audit.get("has_facebook_pixel"),
        "meta_pixel": raw.get("meta_pixel"),
        "google_tag_manager": raw.get("google_tag_manager"),
        "pixel_missing": raw.get("pixel_missing"),
        "tech_stack": list(raw.get("tech_stack") or ()),
        "tech_stack_labels": labels,
    }


def trace_candidate_projection(
    raw: Mapping[str, Any],
    request: AdapterDiscoveryRequest,
    *,
    observed_at: Optional[str] = None,
) -> Dict[str, Any]:
    observed = observed_at or datetime.now(timezone.utc).isoformat()
    confirmed = _confirmed_signal_values(raw)
    discovery_category = _text(raw.get("category") or raw.get("categoria"))
    requested_category = next((_text(value) for value in request.sectors if _text(value)), None)
    category_ok, normalized_category, matched_alias = category_matches_target(
        requested_category or "",
        discovery_category,
        business_name=_text(raw.get("business_name") or raw.get("name")),
    )
    decision = project_candidate_from_raw(raw, request, observed_at=observed)
    signal_ok, rejection_code, matched = _evaluate_signal_match(raw, request, confirmed)
    seo_ok, tracking_ok, seo_hits, tracking_hits = _signal_group_status(request, confirmed)
    audit_summary = _audit_payload_summary(raw)
    website = _text(raw.get("website") or raw.get("sito"))
    return {
        "company_name": _text(raw.get("business_name") or raw.get("name")),
        "place_id": _text(raw.get("place_id")),
        "maps_url": _text(raw.get("maps_url")),
        "maps_category": discovery_category,
        "normalized_category": normalized_category,
        "category_match": category_ok,
        "category_scoped": category_ok,
        "matched_category_alias": matched_alias,
        "official_domain": _domain(website),
        "official_website": website,
        "audit_payload": audit_summary,
        "tech_stack_original": audit_summary.get("tech_stack"),
        "has_ga4": audit_summary.get("has_ga4"),
        "has_google_analytics": audit_summary.get("has_google_analytics"),
        "has_gtm": audit_summary.get("has_gtm"),
        "has_meta_pixel": audit_summary.get("has_meta_pixel"),
        "meta_pixel": audit_summary.get("meta_pixel"),
        "seo_errors": audit_summary.get("html_errors") or audit_summary.get("seo_disaster"),
        "load_time_seconds": audit_summary.get("load_time_seconds"),
        "site_stale": audit_summary.get("site_stale"),
        "website_weakness": "website_weakness" in confirmed,
        "website_weakness_evidence": confirmed.get("website_weakness") or confirmed.get("seo_errors"),
        "missing_advertising_pixel": "missing_advertising_pixel" in confirmed,
        "missing_advertising_pixel_evidence": confirmed.get("missing_advertising_pixel") or confirmed.get("no_pixel"),
        "missing_analytics": "missing_analytics" in confirmed,
        "missing_analytics_evidence": confirmed.get("missing_analytics"),
        "normalized_signals": {
            "website_weakness": "website_weakness" in confirmed,
            "missing_advertising_pixel": "missing_advertising_pixel" in confirmed,
            "missing_analytics": "missing_analytics" in confirmed,
            "no_gtm": "no_gtm" in confirmed,
        },
        "signal_group_seo": {"passed": seo_ok, "matched_signals": seo_hits},
        "signal_group_tracking": {"passed": tracking_ok, "matched_signals": tracking_hits},
        "signal_match_mode": request.signal_match_mode,
        "signal_groups": request.technical_filters.get("signal_groups"),
        "signal_match_result": signal_ok,
        "matched_signals": matched,
        "accepted": decision.accepted,
        "rejected": not decision.accepted,
        "candidate_projection": "pass" if decision.accepted else "fail",
        "rejection_code": decision.rejection_code or rejection_code or ("ACCEPTED" if decision.accepted else "PROJECTION_REJECTED"),
        "rejection_function": "project_candidate_from_raw",
        "rejection_details": decision.rejection_details,
        "observed_at": observed,
    }


def _candidate_from_raw(
    raw: Mapping[str, Any],
    request: AdapterDiscoveryRequest,
    *,
    observed_at: str,
) -> Optional[OpportunityCandidate]:
    decision = project_candidate_from_raw(raw, request, observed_at=observed_at)
    return decision.candidate if decision.accepted else None


def _parse_cursor(cursor: Optional[DiscoveryCursor], *, requested_count: int) -> DigitalAuditCursorState:
    if cursor is None:
        return DigitalAuditCursorState(requested_qualified_count=requested_count)
    if cursor.value.startswith(_CURSOR_PREFIX):
        payload = cursor.value[len(_CURSOR_PREFIX):]
        try:
            decoded = zlib.decompress(base64.urlsafe_b64decode(payload.encode("ascii")))
            state = json.loads(decoded.decode("utf-8"))
            if not isinstance(state, Mapping):
                raise ValueError("cursor payload must be an object")
            return DigitalAuditCursorState(
                requested_qualified_count=max(1, int(state.get("requested_qualified_count") or requested_count)),
                cumulative_raw_unique=max(0, int(state.get("cumulative_raw_unique") or 0)),
                cumulative_audited=max(0, int(state.get("cumulative_audited") or 0)),
                cumulative_qualified_unique=max(0, int(state.get("cumulative_qualified_unique") or 0)),
                processed_identity_hashes=tuple(
                    dict.fromkeys(str(item) for item in state.get("processed_identity_hashes") or () if str(item))
                ),
                provider_offset=max(0, int(state.get("provider_offset") or 0)),
                partition_index=max(0, int(state.get("partition_index") or 0)),
                observed_yield=max(0.0, float(state.get("observed_yield") or 0.0)),
                adaptive_raw_target=max(0, int(state.get("adaptive_raw_target") or 0)),
                termination_state=str(state.get("termination_state") or "active"),
            )
        except (ValueError, TypeError, json.JSONDecodeError, zlib.error, base64.binascii.Error):
            return DigitalAuditCursorState(requested_qualified_count=requested_count)
    if cursor.value.startswith(_CURSOR_PREFIX_V2):
        payload = cursor.value[len(_CURSOR_PREFIX_V2):]
        parts = payload.split(":")
        if len(parts) == 3:
            try:
                start = int(parts[0])
                return DigitalAuditCursorState(
                    requested_qualified_count=requested_count,
                    cumulative_raw_unique=start,
                    cumulative_audited=start,
                    provider_offset=start,
                    adaptive_raw_target=max(start, int(parts[2])),
                    termination_state="migrated_v2",
                )
            except ValueError:
                return DigitalAuditCursorState(requested_qualified_count=requested_count)
    if cursor.value.startswith(_CURSOR_PREFIX_V1):
        payload = cursor.value[len(_CURSOR_PREFIX_V1):]
        if ":" not in payload:
            return 0, 0, 0
        start_text, _, cap_text = payload.partition(":")
        try:
            start = int(start_text)
            return DigitalAuditCursorState(
                requested_qualified_count=requested_count,
                cumulative_raw_unique=start,
                cumulative_audited=start,
                provider_offset=start,
                adaptive_raw_target=max(start, int(cap_text)),
                termination_state="migrated_v1",
            )
        except ValueError:
            return DigitalAuditCursorState(requested_qualified_count=requested_count)
    return DigitalAuditCursorState(requested_qualified_count=requested_count)


def _build_cursor(state: DigitalAuditCursorState) -> DiscoveryCursor:
    payload = {
        "requested_qualified_count": state.requested_qualified_count,
        "cumulative_raw_unique": state.cumulative_raw_unique,
        "cumulative_audited": state.cumulative_audited,
        "cumulative_qualified_unique": state.cumulative_qualified_unique,
        "processed_identity_hashes": list(state.processed_identity_hashes),
        "processed_place_ids_ref": state.processed_place_ids_ref,
        "provider_offset": state.provider_offset,
        "partition_index": state.partition_index,
        "observed_yield": round(state.observed_yield, 8),
        "adaptive_raw_target": state.adaptive_raw_target,
        "termination_state": state.termination_state,
    }
    encoded = base64.urlsafe_b64encode(zlib.compress(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8"),
        level=9,
    )).decode("ascii")
    return DiscoveryCursor(f"{_CURSOR_PREFIX}{encoded}", partition=str(state.partition_index), exhausted=False)


def _initial_batch_cap(batch_size: int) -> int:
    return min(DEFAULT_MAPS_MAX_FETCH, max(batch_size, DEFAULT_MAPS_BATCH_SIZE))


def _dedupe_key(raw: Mapping[str, Any], candidate: OpportunityCandidate) -> str:
    place_id = _text(raw.get("place_id"))
    if place_id:
        return f"place:{place_id}"
    domain = candidate.official_domain
    if domain:
        return f"domain:{domain}"
    return f"name:{candidate.canonical_company_name.casefold()}"


class DigitalAuditAdapter:
    CAPABILITY = SourceCapability(
        adapter_id="legacy_digital_audit_v1",
        adapter_version="1.0.0",
        supported_intents=("maps", "hybrid", "digital_audit", "commercial_search"),
        supported_signals=_TECHNICAL_SIGNALS,
        source_classes=("google_business_maps", "technology_audit", "official_company_website"),
        geographic_coverage=("country", "region", "province", "city", "locality", "italy"),
        freshness_max_age_days=1,
        discovery_mode="discovery_first",
        supports_pagination=True,
        supports_cursor_resume=True,
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
        category = next((_text(value) for value in request.sectors if _text(value)), None)
        location = next((_text(value) for value in request.geographies if _text(value) and value.lower() not in {"italy", "italia"}), None)
        location = location or next((_text(value) for value in request.geographies if _text(value)), None)
        if not category or not location:
            raise ValueError("Digital Audit requires a concrete category and geography")

        technical_filters = dict(request.technical_filters)
        if not technical_filters.get("signal_groups"):
            groups = signal_groups_from_required_signals(request.signal_ids)
            if groups:
                technical_filters["signal_groups"] = groups
        enriched_request = AdapterDiscoveryRequest(
            intent=request.intent,
            signal_ids=request.signal_ids,
            signal_match_mode=request.signal_match_mode,
            geographies=request.geographies,
            freshness_max_age_days=request.freshness_max_age_days,
            requested_count=request.requested_count,
            budget_eur=request.budget_eur,
            query=request.query,
            sectors=request.sectors,
            technical_filters=technical_filters,
            cursor=request.cursor,
        )

        requested_total = max(
            request.requested_count,
            int(technical_filters.get("requested_qualified_count") or request.requested_count),
        )
        cursor_state = _parse_cursor(request.cursor, requested_count=requested_total)
        persisted_hashes = tuple(
            dict.fromkeys(str(item) for item in technical_filters.get("processed_identity_hashes") or () if str(item))
        )
        if persisted_hashes or technical_filters.get("cumulative_raw_unique") or technical_filters.get("cumulative_audited"):
            cursor_state = DigitalAuditCursorState(
                **{
                    **cursor_state.__dict__,
                    "cumulative_raw_unique": max(
                        cursor_state.cumulative_raw_unique,
                        int(technical_filters.get("cumulative_raw_unique") or 0),
                    ),
                    "cumulative_audited": max(
                        cursor_state.cumulative_audited,
                        int(technical_filters.get("cumulative_audited") or 0),
                    ),
                    "processed_identity_hashes": tuple(dict.fromkeys(
                        (*cursor_state.processed_identity_hashes, *persisted_hashes)
                    )),
                }
            )
        if "processed_employer_keys" in technical_filters:
            # Persisted lifecycle identities are authoritative after a prior
            # payload is invalidated (for example, a social URL masquerading
            # as an official domain).  Taking max(cursor, lifecycle) would
            # retain the rejected lead forever and can create an infinite
            # completed/resumable loop.
            prior_qualified = len(tuple(technical_filters.get("processed_employer_keys") or ()))
        else:
            prior_qualified = cursor_state.cumulative_qualified_unique
        partitions = _partition_plan(category, location, technical_filters)
        per_round_cap = per_round_raw_cap_for(technical_filters)
        safety_cap = maximum_safety_raw_cap_for(requested_total, technical_filters)
        adaptive_target, observed_yield = adaptive_raw_target_for(
            requested_qualified=requested_total,
            cumulative_qualified=prior_qualified,
            cumulative_raw=cursor_state.cumulative_raw_unique,
            technical_filters=technical_filters,
        )
        adaptive_target = min(safety_cap, max(cursor_state.cumulative_raw_unique, adaptive_target))

        if cursor_state.cumulative_raw_unique >= safety_cap:
            observed_at = datetime.now(timezone.utc).isoformat()
            paused_state = DigitalAuditCursorState(
                **{
                    **cursor_state.__dict__,
                    "requested_qualified_count": requested_total,
                    "cumulative_qualified_unique": prior_qualified,
                    "observed_yield": observed_yield,
                    "adaptive_raw_target": adaptive_target,
                    "termination_state": "raw_safety_cap_reached",
                }
            )
            return AdapterExecutionResult(
                adapter_id=self.capability.adapter_id,
                adapter_version=self.capability.adapter_version,
                candidates=(),
                exhaustion=SourceExhaustion(
                    exhausted=True,
                    scope="budget",
                    reason="raw_safety_cap_reached",
                    authoritative=False,
                    next_cursor=_build_cursor(paused_state),
                ),
                operations=0,
                cost_eur=0.0,
                started_at=observed_at,
                completed_at=observed_at,
                warnings=("raw_safety_cap_reached",),
                telemetry={
                    "projection_traces": [],
                    "acquisition": {
                        "requested_qualified_count": requested_total,
                        "per_round_raw_cap": per_round_cap,
                        "maximum_safety_raw_cap": safety_cap,
                        "cumulative_raw_unique": cursor_state.cumulative_raw_unique,
                        "cumulative_audited": cursor_state.cumulative_audited,
                        "cumulative_qualified_unique": prior_qualified,
                        "observed_yield": observed_yield,
                        "adaptive_raw_target": adaptive_target,
                        "processed_place_ids_ref": paused_state.processed_place_ids_ref,
                        "partition_index": cursor_state.partition_index,
                        "partition_count": len(partitions),
                        "termination_hint": "raw_safety_cap_reached",
                        "provider_exhausted_authoritative": False,
                    },
                },
            )

        partition_index = cursor_state.partition_index
        provider_offset = cursor_state.provider_offset
        while provider_offset >= DEFAULT_MAPS_MAX_FETCH and partition_index < len(partitions):
            partition_index += 1
            provider_offset = 0
        if partition_index >= len(partitions):
            observed_at = datetime.now(timezone.utc).isoformat()
            return AdapterExecutionResult(
                adapter_id=self.capability.adapter_id,
                adapter_version=self.capability.adapter_version,
                candidates=(),
                exhaustion=SourceExhaustion(
                    exhausted=True,
                    scope="source",
                    reason="provider_exhausted_authoritative",
                    authoritative=True,
                    next_cursor=None,
                ),
                operations=0,
                cost_eur=0.0,
                started_at=observed_at,
                completed_at=observed_at,
                warnings=("provider_exhausted_authoritative",),
                telemetry={"projection_traces": [], "acquisition": {
                    "requested_qualified_count": requested_total,
                    "cumulative_raw_unique": cursor_state.cumulative_raw_unique,
                    "cumulative_audited": cursor_state.cumulative_audited,
                    "cumulative_qualified_unique": prior_qualified,
                    "partition_index": partition_index,
                    "partition_count": len(partitions),
                    "provider_exhausted_authoritative": True,
                    "termination_hint": "provider_exhausted_authoritative",
                }},
            )

        remaining_adaptive = max(1, adaptive_target - cursor_state.cumulative_raw_unique)
        remaining_safety = max(1, safety_cap - cursor_state.cumulative_raw_unique)
        page_size = min(per_round_cap, remaining_adaptive, remaining_safety, DEFAULT_MAPS_MAX_FETCH - provider_offset)
        fetch_cap = provider_offset + page_size
        partition_category, partition_location = partitions[partition_index]

        started_at = datetime.now(timezone.utc).isoformat()
        raw = await self._legacy_runner(
            category=partition_category,
            location=partition_location,
            zone=str(fetch_cap),
            intent={
                "required_signals": list(enriched_request.signal_ids),
                "technical_filters": dict(enriched_request.technical_filters),
                "signal_match_mode": enriched_request.signal_match_mode,
                "source_adapter": self.capability.adapter_id,
                "maps_start_index": provider_offset,
                "maps_page_size": page_size,
                "maps_fetch_cap": fetch_cap,
                "processed_identity_hashes": list(cursor_state.processed_identity_hashes),
                "per_round_raw_cap": per_round_cap,
                "maximum_safety_raw_cap": safety_cap,
                "partition_index": partition_index,
            },
        )
        provider_records_total = max(
            (int(item.get("_maps_acquired_total") or 0) for item in raw if isinstance(item, Mapping)),
            default=provider_offset + len(raw),
        )
        provider_page_count = max(
            (int(item.get("_maps_provider_page_count") or 0) for item in raw if isinstance(item, Mapping)),
            default=len(raw),
        )
        raw = [
            {**item, "category": item.get("category") or item.get("categoria") or category}
            for item in raw
            if item.get("_maps_control_only") is not True
        ]
        observed_at = datetime.now(timezone.utc).isoformat()
        raw_slice = raw[:page_size]
        candidates: List[OpportunityCandidate] = []
        projection_traces: List[Dict[str, Any]] = []
        seen: set[str] = set()
        processed_hashes = set(cursor_state.processed_identity_hashes)
        processed_domains = {
            _domain(value) for value in technical_filters.get("processed_domains") or () if _domain(value)
        }
        candidate_limit = max(0, min(request.requested_count, requested_total - prior_qualified))
        duplicate_skips = 0
        for item in raw_slice:
            identity_hash = _raw_identity_hash(item)
            if identity_hash in processed_hashes:
                duplicate_skips += 1
                continue
            processed_hashes.add(identity_hash)
            trace = trace_candidate_projection(item, enriched_request, observed_at=observed_at)
            projection_traces.append(trace)
            decision = project_candidate_from_raw(item, enriched_request, observed_at=observed_at)
            if not decision.accepted or decision.candidate is None:
                continue
            key = _dedupe_key(item, decision.candidate)
            if key in seen or (decision.candidate.official_domain and decision.candidate.official_domain in processed_domains):
                duplicate_skips += 1
                continue
            seen.add(key)
            if len(candidates) < candidate_limit:
                candidates.append(decision.candidate)

        new_raw_unique = max(0, len(processed_hashes) - len(cursor_state.processed_identity_hashes))
        cumulative_raw = cursor_state.cumulative_raw_unique + new_raw_unique
        cumulative_audited = cursor_state.cumulative_audited + len(raw_slice)
        cumulative_qualified = prior_qualified + len(candidates)
        next_adaptive_target, next_yield = adaptive_raw_target_for(
            requested_qualified=requested_total,
            cumulative_qualified=cumulative_qualified,
            cumulative_raw=cumulative_raw,
            technical_filters=technical_filters,
        )
        next_adaptive_target = min(safety_cap, max(cumulative_raw, next_adaptive_target))
        partition_exhausted = provider_records_total < fetch_cap or fetch_cap >= DEFAULT_MAPS_MAX_FETCH
        next_partition_index = partition_index + 1 if partition_exhausted else partition_index
        next_provider_offset = 0 if partition_exhausted else fetch_cap
        all_partitions_exhausted = partition_exhausted and next_partition_index >= len(partitions)
        safety_cap_reached = cumulative_raw >= safety_cap
        next_state = DigitalAuditCursorState(
            requested_qualified_count=requested_total,
            cumulative_raw_unique=cumulative_raw,
            cumulative_audited=cumulative_audited,
            cumulative_qualified_unique=cumulative_qualified,
            processed_identity_hashes=tuple(sorted(processed_hashes)),
            provider_offset=next_provider_offset,
            partition_index=next_partition_index,
            observed_yield=next_yield,
            adaptive_raw_target=next_adaptive_target,
            termination_state=(
                "provider_exhausted_authoritative" if all_partitions_exhausted
                else "raw_safety_cap_reached" if safety_cap_reached
                else "partition_exhausted" if partition_exhausted
                else "page_complete"
            ),
        )
        if all_partitions_exhausted:
            exhausted = True
            termination_hint = "provider_exhausted_authoritative"
            next_cursor = None
        elif safety_cap_reached:
            exhausted = True
            termination_hint = "raw_safety_cap_reached"
            next_cursor = _build_cursor(next_state)
        elif partition_exhausted:
            exhausted = False
            termination_hint = "partition_exhausted"
            next_cursor = _build_cursor(next_state)
        else:
            exhausted = False
            termination_hint = "page_complete"
            next_cursor = _build_cursor(next_state)

        warnings: List[str] = []
        rejected_count = sum(1 for trace in projection_traces if trace.get("rejected"))
        if rejected_count:
            warnings.append(f"projection_rejections:{rejected_count}")
        warnings.append(termination_hint)
        if duplicate_skips:
            warnings.append(f"duplicate_skips:{duplicate_skips}")

        return AdapterExecutionResult(
            adapter_id=self.capability.adapter_id,
            adapter_version=self.capability.adapter_version,
            candidates=tuple(candidates),
            exhaustion=SourceExhaustion(
                exhausted=exhausted,
                scope="source" if all_partitions_exhausted else ("budget" if safety_cap_reached else ("partition" if partition_exhausted else "page")),
                reason=termination_hint,
                authoritative=all_partitions_exhausted,
                next_cursor=next_cursor,
            ),
            operations=len(raw_slice),
            cost_eur=0.0,
            started_at=started_at,
            completed_at=observed_at,
            warnings=tuple(warnings),
            telemetry={
                "projection_traces": projection_traces,
                "acquisition": {
                    "cursor_version": 3,
                    "requested_qualified_count": requested_total,
                    "per_round_raw_cap": per_round_cap,
                    "maximum_safety_raw_cap": safety_cap,
                    "provider_fetch_cap": fetch_cap,
                    "provider_offset": provider_offset,
                    "next_provider_offset": next_provider_offset,
                    "maps_records_total": provider_records_total,
                    "provider_page_count": provider_page_count,
                    "records_read": len(raw_slice),
                    "raw_new": new_raw_unique,
                    "cumulative_raw_unique": cumulative_raw,
                    "cumulative_audited": cumulative_audited,
                    "cumulative_qualified_unique": cumulative_qualified,
                    "unique_candidates": len(candidates),
                    "duplicate_skips": duplicate_skips,
                    "observed_yield": next_yield,
                    "adaptive_raw_target": next_adaptive_target,
                    "processed_place_ids_ref": next_state.processed_place_ids_ref,
                    "processed_identity_hashes": list(next_state.processed_identity_hashes),
                    "partition_index": partition_index,
                    "next_partition_index": next_partition_index,
                    "partition_count": len(partitions),
                    "partition_category": partition_category,
                    "partition_location": partition_location,
                    "partition_exhausted": partition_exhausted,
                    "termination_hint": termination_hint,
                    "provider_exhausted": all_partitions_exhausted,
                    "provider_exhausted_authoritative": all_partitions_exhausted,
                },
            },
        )
