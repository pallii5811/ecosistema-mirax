"""Hiring qualification validators, employer identity, and revalidation queue."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping, Sequence, Tuple
from urllib.parse import urlparse

from backend_mirror.agents.portal_blacklist import is_blacklisted_domain, normalize_domain

QUALIFICATION_VALIDATOR_EPOCH = 2
MAX_DOMAIN_LOOKUPS = 5
DOMAIN_LOOKUP_COST_EUR = 0.005

_LOMBARDIA_ALIASES = frozenset({
    "lombardia", "lombardy", "lombardia nord", "milano", "milan", "bergamo", "brescia",
    "monza", "brianza", "varese", "como", "lecco", "pavia", "cremona", "mantova", "lodi",
    "sondrio", "sesto san giovanni", "arese", "trezzano sul naviglio", "trezzano",
    "moncalieri",
})
_PROVINCE_CODES = frozenset({"mi", "mb", "bg", "bs", "va", "co", "lc", "pv", "cr", "mn", "lo", "so"})
_CAREERS_PREFIXES = frozenset({"careers", "jobs", "job", "lavora", "work", "join", "recruiting"})
_ATS_HOSTS = (
    "boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co",
    "myworkdayjobs.com", "smartrecruiters.com", "teamtailor.com",
    "recruitee.com", "personio.de", "apply.workable.com",
)
_SALES_ROLE_RE = re.compile(
    r"\b(?:commerciale|consulente commerciale|\bsales\b|sales specialist|junior sales consultant|"
    r"sales manager|business developer|account manager|account executive|area manager|"
    r"\bsdr\b|\bbdr\b|agente di commercio|venditor[ei]|sales consultant|territory manager|"
    r"dpi sales specialist)\b",
    re.I,
)
_NON_SALES_ROLE_RE = re.compile(
    r"\b(?:application engineer|help desk|project manager|visual merchandiser|"
    r"informatore scientifico|magazziniere|tecnici?\s+ascensorist\w*|ascensorist\w*|"
    r"stage visual)\b",
    re.I,
)
_MARKETING_ROLE_RE = re.compile(
    r"\b(?:"
    r"marketing manager|head of marketing|chief marketing officer|\bcmo\b|"
    r"digital marketing(?:\s+manager|\s+specialist)?|"
    r"growth(?:\s+marketing)?\s+manager|growth manager|"
    r"performance marketing(?:\s+manager|\s+specialist)?|"
    r"paid media(?:\s+manager|\s+specialist)?|"
    r"acquisition manager|demand generation(?:\s+manager)?|"
    r"crm marketing(?:\s+manager|\s+specialist)?|"
    r"content marketing(?:\s+manager|\s+specialist)?|"
    r"social media manager|brand manager|product marketing manager|"
    r"marketing specialist|digital marketer|performance marketer"
    r")\b",
    re.I,
)
_NON_MARKETING_ROLE_RE = re.compile(
    r"\b(?:"
    r"sales manager|account executive|account manager|business developer|"
    r"recruiter|talent acquisition|hr business partner|"
    r"graphic designer|visual merchandiser|art director|"
    r"communication intern|customer service|customer care|"
    r"software engineer|backend developer|frontend developer|"
    r"project manager|product manager(?!\s+marketing)"
    r")\b",
    re.I,
)
_VACANCY_ID_RE = re.compile(r"[_-](r\d{5,}|jr\d{5,}|req[-_]?\d+|job/\d+)", re.I)
_EMPLOYER_IDENTITY_HINTS: Tuple[Tuple[re.Pattern[str], str, str, str], ...] = (
    (re.compile(r"verisure", re.I), "verisure.com", "Verisure", "brand_name"),
    (re.compile(r"teamsystem", re.I), "teamsystem.com", "TeamSystem", "legal_name"),
    (re.compile(r"dedalus", re.I), "dedalus.com", "Dedalus", "legal_name"),
    (re.compile(r"mango", re.I), "mango.com", "Mango", "brand_name"),
    (re.compile(r"vitalaire|vital air", re.I), "vitalaire.com", "VitalAire", "brand_name"),
    (re.compile(r"air liquide", re.I), "airliquide.com", "Air Liquide", "corporate_group"),
    (re.compile(r"lyreco", re.I), "lyreco.it", "Lyreco", "brand_name"),
    (re.compile(r"baker\s*hughes|nuovo\s*pignone", re.I), "bakerhughes.com", "Baker Hughes", "legal_name"),
    (re.compile(r"becton\s*dickinson|\bbd\s*sa\b", re.I), "bd.com", "BD", "brand_name"),
    (re.compile(r"\bbaxi\b|bdr thermea", re.I), "baxi.it", "BAXI", "brand_name"),
    (re.compile(r"s\.?a\.? studio santagostino|studio santagostino", re.I), "studiosantagostino.it", "Studio Santagostino", "legal_name"),
    (re.compile(r"techtronic|tti\b", re.I), "tti.com", "Techtronic Industries", "corporate_group"),
    (re.compile(r"solenis", re.I), "solenis.com", "Solenis", "legal_name"),
    (re.compile(r"convatec", re.I), "convatec.com", "Convatec", "legal_name"),
    (re.compile(r"\bing\b|ing bank", re.I), "ing.it", "ING", "brand_name"),
)


def _text(value: Any) -> str:
    return str(value or "").strip()


def _host(url: str) -> str:
    parsed = urlparse(url if "://" in url else f"https://{url}")
    return normalize_domain(parsed.hostname or "")


def _corporate_from_careers_host(host: str) -> str:
    host = (host or "").lower().removeprefix("www.")
    parts = host.split(".")
    if len(parts) >= 3 and parts[0] in _CAREERS_PREFIXES:
        return normalize_domain(".".join(parts[1:]))
    return ""


def vacancy_geography_matches(
    *,
    location: str,
    title: str = "",
    address_locality: str = "",
    address_region: str = "",
    geographies: Sequence[str],
) -> bool:
    """Match Lombardia using vacancy fields only (title/location/structured), not page body."""
    requested = [item.casefold() for item in geographies if item.casefold() not in {"italy", "italia"}]
    if not requested:
        return bool(location or title)
    scoped = " | ".join(filter(None, (
        _text(location).casefold(),
        _text(title).casefold(),
        _text(address_locality).casefold(),
        _text(address_region).casefold(),
    )))
    if not scoped.strip():
        return False
    for item in requested:
        if item in scoped:
            return True
        if item == "lombardia" and "lombardia nord" in scoped:
            return True
        if any(alias in scoped for alias in _LOMBARDIA_ALIASES):
            return True
        tokens = re.findall(r"\b[a-z]{2}\b", scoped)
        if item == "lombardia" and any(token in _PROVINCE_CODES for token in tokens):
            return True
    return False


def vacancy_role_matches_sales(*, title: str, description: str = "") -> Tuple[bool, str]:
    """Sales gate uses title first; description only for explicit commercial duties."""
    title_text = _text(title)
    if not title_text:
        return False, "VACANCY_TITLE_MISSING"
    if _NON_SALES_ROLE_RE.search(title_text):
        if not _SALES_ROLE_RE.search(title_text):
            return False, "HIRING_ROLE_MISMATCH"
    if _SALES_ROLE_RE.search(title_text):
        return True, ""
    desc = _text(description)
    if _SALES_ROLE_RE.search(desc) and not _NON_SALES_ROLE_RE.search(title_text):
        return True, ""
    return False, "HIRING_ROLE_MISMATCH"


def vacancy_role_matches_marketing(
    *,
    title: str,
    description: str = "",
    structured_role: str = "",
) -> Tuple[bool, str]:
    """Marketing gate: title/structured fields only — description alone never qualifies."""
    del description  # ponytail: description is accepted for API symmetry but must not qualify
    title_text = _text(title)
    structured = _text(structured_role)
    haystack = " ".join(filter(None, (title_text, structured)))
    if not haystack:
        return False, "VACANCY_TITLE_MISSING"
    if _NON_MARKETING_ROLE_RE.search(haystack) and not _MARKETING_ROLE_RE.search(haystack):
        return False, "HIRING_ROLE_MISMATCH"
    if _MARKETING_ROLE_RE.search(haystack):
        return True, ""
    return False, "HIRING_ROLE_MISMATCH"


def resolve_employer_identity(record: Mapping[str, Any]) -> dict[str, Any]:
    """Enrich employer fields from persisted parse data without refetch."""
    enriched = dict(record)
    displayed = _text(record.get("displayed_employer_name") or record.get("company_name") or record.get("name") or record.get("employer"))
    source_url = _text(record.get("source_url") or record.get("vacancy_url"))
    vacancy_source = _host(record.get("vacancy_source_domain") or source_url)
    org_url = _text(record.get("organization_website") or record.get("hiring_organization_url") or record.get("website"))
    official = _host(record.get("employer_official_domain") or record.get("official_domain") or org_url)
    resolution_method = _text(record.get("resolution_method"))
    confidence = float(record.get("confidence") or 0.0)
    evidence = list(record.get("domain_verification_evidence") or record.get("resolution_evidence") or ())

    if org_url:
        org_host = _host(org_url)
        if org_host and not any(org_host == h or org_host.endswith(f".{h}") for h in _ATS_HOSTS):
            corporate = _corporate_from_careers_host(org_host) or org_host
            if corporate and not is_blacklisted_domain(corporate):
                official = corporate
                resolution_method = resolution_method or "hiring_organization_url"
                confidence = max(confidence, 0.92)
                evidence.append("hiring_organization_url")

    corporate_from_source = _corporate_from_careers_host(vacancy_source)
    if corporate_from_source and not is_blacklisted_domain(corporate_from_source):
        official = corporate_from_source
        resolution_method = resolution_method or "careers_subdomain_corporate_link"
        confidence = max(confidence, 0.9)
        evidence.append("careers_subdomain_corporate_link")

    for pattern, domain, brand, kind in _EMPLOYER_IDENTITY_HINTS:
        if pattern.search(displayed):
            if not official or any(official == h or official.endswith(f".{h}") for h in _ATS_HOSTS):
                official = domain
                resolution_method = resolution_method or "employer_identity_hint"
                confidence = max(confidence, 0.88)
                evidence.append(f"employer_identity_hint:{kind}")
            enriched.setdefault("employer_brand", brand)
            break

    if official and vacancy_source and official == vacancy_source:
        corporate = _corporate_from_careers_host(vacancy_source)
        if corporate:
            official = corporate
            resolution_method = resolution_method or "careers_subdomain_corporate_link"
            confidence = max(confidence, 0.9)

    verified = bool(displayed and official and not is_blacklisted_domain(official))
    if verified and not any(official == h or official.endswith(f".{h}") for h in _ATS_HOSTS):
        direct = record.get("employer_is_direct")
        if direct is False:
            employer_is_direct = False
        else:
            employer_is_direct = True
        enriched.update({
            "displayed_employer_name": displayed,
            "legal_or_corporate_employer": _text(record.get("legal_or_corporate_employer")) or displayed,
            "company_name": displayed,
            "employer_official_domain": official,
            "official_domain": official,
            "vacancy_source_domain": vacancy_source,
            "official_domain_verified": True,
            "employer_is_direct": employer_is_direct,
            "resolution_method": resolution_method or "persisted_parse_data",
            "confidence": round(max(confidence, 0.85), 3),
            "resolution_evidence": tuple(sorted(set(evidence))),
            "entity_class": "operating_company",
            "source_class": _text(record.get("source_class")) or "company_careers",
            "active": True if record.get("active") is not False else False,
        })
    return enriched


def dedupe_key(record: Mapping[str, Any]) -> str:
    """Canonical dedupe key: employer identity + vacancy id or title/location."""
    official = _host(record.get("employer_official_domain") or record.get("official_domain") or "")
    employer = re.sub(r"[^a-z0-9]+", "", _text(record.get("company_name") or record.get("displayed_employer_name")).casefold())
    source_url = _text(record.get("source_url") or record.get("vacancy_url"))
    vacancy_id = ""
    match = _VACANCY_ID_RE.search(source_url)
    if match:
        vacancy_id = match.group(1).lower()
    if not vacancy_id:
        vacancy_id = re.sub(r"[^a-z0-9]+", "", _text(record.get("vacancy_title")).casefold())[:40]
    location = re.sub(r"[^a-z0-9]+", "", _text(record.get("location")).casefold())[:30]
    return f"{official or employer}|{vacancy_id}|{location}"


def _normalize_employer_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", _text(name).casefold())


def employer_key_from_domain(domain: str) -> str:
    host = _host(domain)
    if host:
        return f"domain:{host}"
    return ""


def employer_key_from_record(record: Mapping[str, Any]) -> str:
    domain_key = employer_key_from_domain(
        _text(record.get("employer_official_domain") or record.get("official_domain") or record.get("website"))
    )
    if domain_key:
        return domain_key
    name = _normalize_employer_name(_text(record.get("company_name") or record.get("displayed_employer_name") or record.get("name")))
    return f"name:{name}" if name else ""


def employer_key_from_payload(payload: Mapping[str, Any]) -> str:
    domain_key = employer_key_from_domain(
        _text(payload.get("employer_official_domain") or payload.get("sito") or payload.get("website"))
    )
    if domain_key:
        return domain_key
    name = _normalize_employer_name(_text(payload.get("azienda") or payload.get("name") or payload.get("legal_name")))
    return f"name:{name}" if name else ""


def related_opportunity_from_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    signals = payload.get("business_signals") if isinstance(payload.get("business_signals"), list) else []
    first = signals[0] if signals and isinstance(signals[0], Mapping) else {}
    return {
        "vacancy_url": _text(payload.get("vacancy_url") or first.get("source_url")),
        "vacancy_title": _text(first.get("evidence") or payload.get("why_now")),
        "location": _text(payload.get("citta")),
        "published_at": _text(first.get("published_at")),
        "source_url": _text(first.get("source_url") or payload.get("vacancy_url")),
        "employer_key": employer_key_from_payload(payload),
    }


def merge_related_opportunity(existing: Sequence[Mapping[str, Any]], related: Mapping[str, Any]) -> Tuple[dict[str, Any], ...]:
    rows = [dict(item) for item in existing if isinstance(item, Mapping)]
    related_url = _text(related.get("vacancy_url") or related.get("source_url")).lower().rstrip("/")
    if not related_url:
        return tuple(rows)
    for item in rows:
        prior_url = _text(item.get("vacancy_url") or item.get("source_url")).lower().rstrip("/")
        if prior_url == related_url:
            return tuple(rows)
    rows.append(dict(related))
    return tuple(rows)


def collect_processed_employer_keys(
    prior_keys: Sequence[str],
    payloads: Sequence[Mapping[str, Any]],
) -> Tuple[str, ...]:
    keys: list[str] = [str(item) for item in prior_keys if str(item or "").strip()]
    seen = set(keys)
    for payload in payloads:
        if not isinstance(payload, Mapping):
            continue
        key = employer_key_from_payload(payload)
        if key and key not in seen:
            keys.append(key)
            seen.add(key)
    return tuple(keys)


def count_unique_employer_keys(payloads: Sequence[Mapping[str, Any]]) -> int:
    return len({
        employer_key_from_payload(item)
        for item in payloads
        if isinstance(item, Mapping) and employer_key_from_payload(item)
    })


def outcome_to_record(outcome: Mapping[str, Any]) -> dict[str, Any]:
    """Rebuild a validation record from persisted url_outcome without refetch."""
    url = _text(outcome.get("canonical_url") or outcome.get("url") or outcome.get("final_url"))
    return {
        "company_name": _text(outcome.get("employer")),
        "displayed_employer_name": _text(outcome.get("employer")),
        "vacancy_title": _text(outcome.get("vacancy_title")),
        "hiring_title": _text(outcome.get("vacancy_title")),
        "location": _text(outcome.get("location")),
        "address_locality": _text(outcome.get("address_locality")),
        "address_region": _text(outcome.get("address_region")),
        "published_at": _text(outcome.get("publication_date") or outcome.get("published_at")),
        "evidence_date": _text(outcome.get("publication_date") or outcome.get("published_at")),
        "source_url": url,
        "vacancy_url": url,
        "source_class": _text(outcome.get("source_class")) or "company_careers",
        "vacancy_source_domain": _text(outcome.get("source_domain")),
        "extraction_method": _text(outcome.get("parser_selected")) or "persisted_outcome",
        "description": _text(outcome.get("description")),
        "evidence": _text(outcome.get("vacancy_title")),
        "active": True,
        "entity_class": "operating_company",
    }


def bootstrap_parsed_and_revalidation_queues(
    url_outcomes: Sequence[Mapping[str, Any]],
    *,
    qualification_validator_epoch: int,
) -> Tuple[Tuple[str, ...], Tuple[str, ...]]:
    """Build parsed_candidate_queue and revalidation_queue from persisted outcomes."""
    parsed: list[str] = []
    revalidation: list[str] = []
    for item in url_outcomes:
        if not isinstance(item, Mapping):
            continue
        if str(item.get("parser_result") or "") != "success":
            continue
        url = _text(item.get("canonical_url") or item.get("url"))
        if not url:
            continue
        parsed.append(url)
        if str(item.get("rejection_code") or "") != "ACCEPTED":
            revalidation.append(url)
    parsed_unique = tuple(dict.fromkeys(parsed))
    reval_unique = tuple(dict.fromkeys(revalidation))
    if qualification_validator_epoch >= QUALIFICATION_VALIDATOR_EPOCH:
        return parsed_unique, ()
    return parsed_unique, reval_unique


@dataclass
class ReplayResult:
    geography_pass: int = 0
    geography_fail: int = 0
    role_pass: int = 0
    role_fail: int = 0
    domain_resolved: int = 0
    duplicates_removed: int = 0
    orchestrator_qualified: int = 0
    lifecycle_accepted: int = 0
    rejection_counts: dict[str, int] | None = None
    qualified_records: Tuple[dict[str, Any], ...] = ()

    def __post_init__(self) -> None:
        if self.rejection_counts is None:
            self.rejection_counts = {}


def replay_parsed_candidates(
    outcomes: Sequence[Mapping[str, Any]],
    *,
    geographies: Sequence[str] = ("Lombardia",),
    signal_ids: Sequence[str] = ("hiring_sales",),
    freshness_max_age_days: int = 60,
    today=None,
) -> ReplayResult:
    """Offline revalidation of parsed candidates without fetch."""
    from datetime import date

    from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest
    from backend_mirror.source_adapters.hiring import _validate_record

    today = today or date(2026, 7, 15)
    request = AdapterDiscoveryRequest(
        intent="hiring",
        signal_ids=tuple(signal_ids),
        signal_match_mode="all",
        geographies=tuple(geographies),
        freshness_max_age_days=freshness_max_age_days,
        requested_count=5,
        budget_eur=0.125,
        query="commerciali Lombardia",
        sectors=(),
        technical_filters={},
        cursor=None,
    )
    result = ReplayResult()
    seen_keys: set[str] = set()
    qualified: list[dict[str, Any]] = []
    parsed_outcomes = [
        item for item in outcomes
        if isinstance(item, Mapping) and str(item.get("parser_result") or "") == "success"
    ]
    for outcome in parsed_outcomes:
        record = resolve_employer_identity(outcome_to_record(outcome))
        title = _text(record.get("vacancy_title"))
        location = _text(record.get("location"))
        if not vacancy_geography_matches(
            location=location,
            title=title,
            address_locality=_text(record.get("address_locality")),
            address_region=_text(record.get("address_region")),
            geographies=geographies,
        ):
            result.geography_fail += 1
            result.rejection_counts["GEOGRAPHY_MISMATCH"] = result.rejection_counts.get("GEOGRAPHY_MISMATCH", 0) + 1
            continue
        result.geography_pass += 1
        if "hiring_marketing" in signal_ids:
            role_ok, role_code = vacancy_role_matches_marketing(
                title=title,
                description=_text(record.get("description")),
                structured_role=_text(record.get("occupational_category") or record.get("role_category")),
            )
        else:
            role_ok, role_code = vacancy_role_matches_sales(title=title, description=_text(record.get("description")))
        if not role_ok:
            result.role_fail += 1
            code = role_code or "HIRING_ROLE_MISMATCH"
            result.rejection_counts[code] = result.rejection_counts.get(code, 0) + 1
            continue
        result.role_pass += 1
        if not record.get("employer_official_domain"):
            result.rejection_counts["OFFICIAL_DOMAIN_UNRESOLVED"] = result.rejection_counts.get("OFFICIAL_DOMAIN_UNRESOLVED", 0) + 1
            continue
        result.domain_resolved += 1
        key = dedupe_key(record)
        if key in seen_keys:
            result.duplicates_removed += 1
            result.rejection_counts["DUPLICATE_VACANCY"] = result.rejection_counts.get("DUPLICATE_VACANCY", 0) + 1
            continue
        seen_keys.add(key)
        valid, rejection = _validate_record(record, request, today)
        if valid:
            result.orchestrator_qualified += 1
            result.lifecycle_accepted += 1
            qualified.append(record)
        else:
            result.rejection_counts[rejection or "VALIDATION_FAILED"] = result.rejection_counts.get(rejection or "VALIDATION_FAILED", 0) + 1
    result.qualified_records = tuple(qualified)
    return result
