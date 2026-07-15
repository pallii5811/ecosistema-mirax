"""Contract adapter over the proven Maps + website audit path.

The adapter deliberately delegates acquisition and technical inspection to the
legacy runner. It only owns the canonical boundary, deduplication, evidence
projection and truthful exhaustion metadata.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlparse

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
DEFAULT_RAW_CANDIDATE_BUDGET_MAX = 50
_CURSOR_PREFIX_V1 = "da:v1:"
_CURSOR_PREFIX = "da:v2:"

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


def raw_candidate_budget_for(requested_qualified: int, technical_filters: Mapping[str, Any]) -> int:
    explicit = technical_filters.get("raw_candidate_budget")
    if explicit is not None:
        try:
            return min(DEFAULT_RAW_CANDIDATE_BUDGET_MAX, max(DEFAULT_RAW_CANDIDATE_BUDGET_MIN, int(explicit)))
        except (TypeError, ValueError):
            pass
    return min(DEFAULT_RAW_CANDIDATE_BUDGET_MAX, max(DEFAULT_RAW_CANDIDATE_BUDGET_MIN, requested_qualified * 6))


def maps_batch_size_for(technical_filters: Mapping[str, Any]) -> int:
    explicit = technical_filters.get("maps_batch_size")
    if explicit is not None:
        try:
            return max(1, int(explicit))
        except (TypeError, ValueError):
            pass
    return DEFAULT_MAPS_BATCH_SIZE


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


def _parse_cursor(cursor: Optional[DiscoveryCursor]) -> Tuple[int, int, int]:
    if cursor is None:
        return 0, 0, 0
    if cursor.value.startswith(_CURSOR_PREFIX):
        payload = cursor.value[len(_CURSOR_PREFIX):]
        parts = payload.split(":")
        if len(parts) == 3:
            try:
                return int(parts[0]), int(parts[1]), int(parts[2])
            except ValueError:
                return 0, 0, 0
    if cursor.value.startswith(_CURSOR_PREFIX_V1):
        payload = cursor.value[len(_CURSOR_PREFIX_V1):]
        if ":" not in payload:
            return 0, 0, 0
        start_text, _, cap_text = payload.partition(":")
        try:
            return int(start_text), int(cap_text), 0
        except ValueError:
            return 0, 0, 0
    return 0, 0, 0


def _build_cursor(start_index: int, batch_cap: int, raw_budget: int) -> DiscoveryCursor:
    return DiscoveryCursor(f"{_CURSOR_PREFIX}{start_index}:{batch_cap}:{raw_budget}", exhausted=False)


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
        if request.requested_count > (self.capability.max_results_per_run or 0):
            raise ValueError("requested_count exceeds the bounded legacy Digital Audit run")
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

        start_index, previous_batch_cap, cursor_raw_budget = _parse_cursor(request.cursor)
        batch_size = maps_batch_size_for(technical_filters)
        raw_budget = cursor_raw_budget or raw_candidate_budget_for(request.requested_count, technical_filters)
        batch_cap = previous_batch_cap or _initial_batch_cap(batch_size)
        if start_index > 0:
            batch_cap = min(DEFAULT_MAPS_MAX_FETCH, batch_cap + DEFAULT_MAPS_BATCH_GROWTH)

        if start_index >= raw_budget:
            observed_at = datetime.now(timezone.utc).isoformat()
            return AdapterExecutionResult(
                adapter_id=self.capability.adapter_id,
                adapter_version=self.capability.adapter_version,
                candidates=(),
                exhaustion=SourceExhaustion(
                    exhausted=True,
                    scope="budget",
                    reason="raw_budget_reached",
                    authoritative=False,
                    next_cursor=None,
                ),
                operations=0,
                cost_eur=0.0,
                started_at=observed_at,
                completed_at=observed_at,
                warnings=("raw_budget_reached",),
                telemetry={
                    "projection_traces": [],
                    "acquisition": {
                        "requested_qualified_count": request.requested_count,
                        "raw_candidate_budget": raw_budget,
                        "maps_batch_size": batch_size,
                        "start_index": start_index,
                        "termination_hint": "raw_budget_reached",
                    },
                },
            )

        remaining_budget = raw_budget - start_index
        fetch_cap = min(batch_cap, raw_budget)

        started_at = datetime.now(timezone.utc).isoformat()
        raw = await self._legacy_runner(
            category=category,
            location=location,
            zone=str(fetch_cap),
            intent={
                "required_signals": list(enriched_request.signal_ids),
                "technical_filters": dict(enriched_request.technical_filters),
                "signal_match_mode": enriched_request.signal_match_mode,
                "source_adapter": self.capability.adapter_id,
                "maps_start_index": start_index,
                "raw_candidate_budget": raw_budget,
                "maps_batch_size": batch_size,
            },
        )
        raw = [
            {**item, "category": item.get("category") or item.get("categoria") or category}
            for item in raw
        ]
        observed_at = datetime.now(timezone.utc).isoformat()
        raw_slice = raw[start_index:start_index + remaining_budget] if start_index < len(raw) else []
        candidates: List[OpportunityCandidate] = []
        projection_traces: List[Dict[str, Any]] = []
        seen: set[str] = set()
        duplicate_skips = 0
        for item in raw_slice:
            trace = trace_candidate_projection(item, enriched_request, observed_at=observed_at)
            projection_traces.append(trace)
            decision = project_candidate_from_raw(item, enriched_request, observed_at=observed_at)
            if not decision.accepted or decision.candidate is None:
                continue
            key = _dedupe_key(item, decision.candidate)
            if key in seen:
                duplicate_skips += 1
                continue
            seen.add(key)
            candidates.append(decision.candidate)

        next_start = start_index + len(raw_slice)
        raw_budget_reached = next_start >= raw_budget
        provider_exhausted = len(raw) < fetch_cap
        if provider_exhausted:
            exhausted = True
            termination_hint = "provider_exhausted"
            next_cursor = None
        elif raw_budget_reached:
            exhausted = True
            termination_hint = "raw_budget_reached"
            next_cursor = None
        else:
            exhausted = False
            termination_hint = "batch_cap_reached"
            next_cursor = _build_cursor(next_start, batch_cap, raw_budget)

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
                scope="source" if provider_exhausted else ("budget" if raw_budget_reached else "partition"),
                reason=termination_hint,
                authoritative=provider_exhausted,
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
                    "requested_qualified_count": request.requested_count,
                    "raw_candidate_budget": raw_budget,
                    "maps_batch_size": batch_size,
                    "batch_cap": fetch_cap,
                    "start_index": start_index,
                    "next_start_index": next_start,
                    "maps_records_total": len(raw),
                    "records_read": len(raw_slice),
                    "unique_candidates": len(candidates),
                    "duplicate_skips": duplicate_skips,
                    "termination_hint": termination_hint,
                    "provider_exhausted": provider_exhausted,
                },
            },
        )
