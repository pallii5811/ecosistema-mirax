"""Hiring qualification validators, employer identity, and revalidation queue."""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Mapping, Sequence, Tuple
from urllib.parse import urlparse

from backend_mirror.agents.portal_blacklist import is_blacklisted_domain, normalize_domain
from backend_mirror.source_adapters.hiring_ats_parsers import detect_ats_vendor

QUALIFICATION_VALIDATOR_EPOCH = 8
_EXPLICIT_SIZE_CONSTRAINT_RE = re.compile(
    r"\b(?:"
    r"pmi|sme|microimprese?|"
    r"piccol[ae]\s+(?:imprese|aziende|impresa|azienda)|"
    r"medie\s+(?:imprese|aziende)|"
    r"piccola\s+(?:impresa|azienda)|"
    r"media\s+(?:impresa|azienda)|"
    r"multinazional[ei]|grande\s+gruppo"
    r")\b",
    re.I,
)
MAX_DOMAIN_LOOKUPS = 5
DOMAIN_LOOKUP_COST_EUR = 0.005

_LOMBARDIA_ALIASES = frozenset({
    "lombardia", "lombardy", "lombardia nord", "milano", "milan", "bergamo", "brescia",
    "monza", "brianza", "varese", "como", "lecco", "pavia", "cremona", "mantova", "lodi",
    "sondrio", "sesto san giovanni", "arese", "trezzano sul naviglio", "trezzano",
})
_PROVINCE_CODES = frozenset({"mi", "mb", "bg", "bs", "va", "co", "lc", "pv", "cr", "mn", "lo", "so"})
_ITALY_ALIASES = frozenset({"italia", "italy"})
_ITALY_STRUCTURED_COUNTRY_CODES = frozenset({"it", "ita", "italia", "italy"})
_ITALIAN_REGIONS_AND_LOCALITIES = frozenset({
    "abruzzo", "basilicata", "calabria", "campania", "emilia romagna", "friuli venezia giulia",
    "lazio", "liguria", "lombardia", "marche", "molise", "piemonte", "puglia", "sardegna",
    "sicilia", "toscana", "trentino alto adige", "umbria", "valle d aosta", "veneto",
    "agrigento", "alessandria", "ancona", "aosta", "arezzo", "ascoli piceno", "asti",
    "avellino", "bari", "barletta", "belluno", "benevento", "bergamo", "biella", "bologna",
    "bolzano", "brescia", "brindisi", "cagliari", "caltanissetta", "campobasso", "caserta",
    "catania", "catanzaro", "chieti", "como", "cosenza", "cremona", "crotone", "cuneo",
    "enna", "fermo", "ferrara", "firenze", "florence", "foggia", "forli", "frosinone",
    "genova", "genoa", "gorizia", "grosseto", "imperia", "isernia", "la spezia", "l aquila",
    "latina", "lecce", "lecco", "livorno", "lodi", "lucca", "macerata", "mantova",
    "massa", "matera", "messina", "milano", "milan", "modena", "monza", "napoli", "naples",
    "novara", "nuoro", "oristano", "padova", "palermo", "parma", "pavia", "perugia",
    "pesaro", "pescara", "piacenza", "pisa", "pistoia", "pordenone", "potenza", "prato",
    "ragusa", "ravenna", "reggio calabria", "reggio emilia", "rieti", "rimini", "roma", "rome",
    "rovigo", "salerno", "sassari", "savona", "siena", "siracusa", "sondrio", "taranto",
    "teramo", "terni", "torino", "turin", "trapani", "trento", "treviso", "trieste", "udine",
    "varese", "venezia", "venice", "verbania", "vercelli", "verona", "vibo valentia",
    "vicenza", "viterbo", "sesto san giovanni", "trezzano sul naviglio", "arese",
})
_NON_ITALIAN_COUNTRY_MARKERS = frozenset({
    "united states", "usa", "u s a", "australia", "mexico", "mexico city", "canada", "india",
    "united kingdom", "uk", "great britain", "france", "germany", "spain", "portugal", "brazil",
    "argentina", "japan", "china", "singapore", "netherlands", "belgium", "switzerland",
    "austria", "poland", "sweden", "norway", "denmark", "finland", "ireland",
})
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
    # growth manager only when not product/revenue/business/services growth
    r"(?<!product\s)(?<!revenue\s)(?<!business\s)(?<!services\s)growth(?:\s+marketing)?\s+manager|"
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
    r"project manager|product manager(?!\s+marketing)|"
    r"product growth manager|revenue growth manager|business growth manager|"
    r"digital services product growth"
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


def _normalized_geo_text(value: Any) -> str:
    text = unicodedata.normalize("NFKD", _text(value)).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", text.casefold()).strip()


def _location_values(value: Any) -> Tuple[str, ...]:
    if isinstance(value, Mapping):
        parts = [value.get(key) for key in ("addressLocality", "addressRegion", "addressCountry", "name")]
        return tuple(item for raw in parts if (item := _normalized_geo_text(raw)))
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        values: list[str] = []
        for item in value:
            values.extend(_location_values(item))
        return tuple(dict.fromkeys(values))
    text = _normalized_geo_text(value)
    return (text,) if text else ()


def _contains_term(blob: str, term: str) -> bool:
    return bool(re.search(rf"(?:^|\s){re.escape(term)}(?:$|\s)", blob))


@dataclass(frozen=True)
class VacancyGeographyAssessment:
    geography_match: bool
    requested_geographies: Tuple[str, ...]
    normalized_country: str
    matched_geography: str
    geography_match_method: str
    geography_match_evidence: str
    geography_rejection_code: str

    def __bool__(self) -> bool:
        return self.geography_match

    def to_dict(self) -> dict[str, Any]:
        return {
            "geography_match": self.geography_match,
            "requested_geographies": list(self.requested_geographies),
            "normalized_country": self.normalized_country,
            "matched_geography": self.matched_geography,
            "geography_match_method": self.geography_match_method,
            "geography_match_evidence": self.geography_match_evidence,
            "geography_rejection_code": self.geography_rejection_code,
        }


def evaluate_vacancy_geography(
    *,
    location: str,
    title: str = "",
    address_locality: str = "",
    address_region: str = "",
    address_country: str = "",
    additional_locations: Any = (),
    source_url: str = "",
    geographies: Sequence[str],
) -> VacancyGeographyAssessment:
    """Canonical vacancy-scoped geography gate; URL locale and page language are never evidence."""
    del source_url  # Explicitly excluded from country inference (for example Workday /it-it/).
    requested = tuple(dict.fromkeys(_normalized_geo_text(item) for item in geographies if _normalized_geo_text(item)))
    if not requested:
        return VacancyGeographyAssessment(True, (), "", "", "unconstrained", "no geography requested", "")

    location_text = _normalized_geo_text(location)
    locality = _normalized_geo_text(address_locality)
    region = _normalized_geo_text(address_region)
    country = _normalized_geo_text(address_country)
    title_text = _normalized_geo_text(title)
    additional = _location_values(additional_locations)
    vacancy_fields = tuple(filter(None, (location_text, locality, region, *additional)))

    def passed(normalized_country: str, matched: str, method: str, evidence: str) -> VacancyGeographyAssessment:
        return VacancyGeographyAssessment(True, requested, normalized_country, matched, method, evidence, "")

    def failed(normalized_country: str = "") -> VacancyGeographyAssessment:
        evidence = " | ".join(vacancy_fields) or "no vacancy-scoped geography evidence"
        return VacancyGeographyAssessment(False, requested, normalized_country, "", "no_match", evidence, "GEO_OUT_OF_SCOPE")

    wants_lombardia = any(item in {"lombardia", "lombardy"} for item in requested)
    wants_italy = wants_lombardia or any(item in _ITALY_ALIASES for item in requested)

    if wants_lombardia:
        for item in additional:
            if any(_contains_term(item, marker) for marker in _NON_ITALIAN_COUNTRY_MARKERS):
                continue
            for alias in sorted(_LOMBARDIA_ALIASES, key=len, reverse=True):
                if _contains_term(item, alias):
                    return passed("IT", alias, "additional_location_mapping", alias)
        if country and country not in _ITALY_STRUCTURED_COUNTRY_CODES:
            return failed(country.upper())
        primary_location = " | ".join(filter(None, (location_text, locality, region)))
        has_foreign_primary = any(_contains_term(primary_location, marker) for marker in _NON_ITALIAN_COUNTRY_MARKERS)
        has_explicit_italy = any(_contains_term(primary_location, alias) for alias in _ITALY_ALIASES)
        if has_foreign_primary and not has_explicit_italy:
            detected = next(marker for marker in _NON_ITALIAN_COUNTRY_MARKERS if _contains_term(primary_location, marker))
            return failed(detected.upper())
        scoped = " | ".join(filter(None, (primary_location, title_text)))
        for alias in sorted(_LOMBARDIA_ALIASES, key=len, reverse=True):
            if _contains_term(scoped, alias):
                return passed("IT", alias, "lombardia_location_mapping", alias)
        if any(token in _PROVINCE_CODES for token in re.findall(r"\b[a-z]{2}\b", " ".join((locality, region)))):
            return passed("IT", "lombardia", "structured_province_code", "structured locality/region province code")
        return failed("IT" if country in _ITALY_STRUCTURED_COUNTRY_CODES else "")

    if wants_italy:
        if country in _ITALY_STRUCTURED_COUNTRY_CODES:
            return passed("IT", "Italia", "structured_address_country", address_country)
        for item in additional:
            if any(_contains_term(item, alias) for alias in _ITALY_ALIASES):
                return passed("IT", "Italia", "additional_location_explicit_country", item)
            if any(_contains_term(item, marker) for marker in _NON_ITALIAN_COUNTRY_MARKERS):
                continue
            for locality_name in sorted(_ITALIAN_REGIONS_AND_LOCALITIES, key=len, reverse=True):
                if _contains_term(item, locality_name):
                    return passed("IT", locality_name, "additional_location_mapping", locality_name)
        if country:
            return failed(country.upper())
        for item in filter(None, (location_text, locality, region)):
            if any(_contains_term(item, alias) for alias in _ITALY_ALIASES):
                return passed("IT", "Italia", "explicit_country_location", item)
            if any(_contains_term(item, marker) for marker in _NON_ITALIAN_COUNTRY_MARKERS):
                continue
            for locality_name in sorted(_ITALIAN_REGIONS_AND_LOCALITIES, key=len, reverse=True):
                if _contains_term(item, locality_name):
                    return passed("IT", locality_name, "italian_locality_mapping", locality_name)
        if re.search(r"\bremote\s+(?:in\s+)?italy\b|\bitaly\s+remote\b", title_text):
            return passed("IT", "Italia", "explicit_remote_country", title)
        detected_foreign = next((marker for marker in _NON_ITALIAN_COUNTRY_MARKERS if any(_contains_term(item, marker) for item in vacancy_fields)), "")
        return failed(detected_foreign.upper())

    scoped = " | ".join(filter(None, (location_text, locality, region, title_text, *additional)))
    for requested_item in requested:
        if _contains_term(scoped, requested_item):
            return passed(country.upper(), requested_item, "explicit_vacancy_field", requested_item)
    return failed(country.upper())


def vacancy_geography_matches(**kwargs: Any) -> bool:
    """Compatibility boolean delegating to the single canonical assessment."""
    return bool(evaluate_vacancy_geography(**kwargs))


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
    from backend_mirror.source_adapters.hiring_ats_parsers import (
        _workday_corporate_guess,
        detect_ats_vendor,
        inspect_workday_url,
    )

    enriched = dict(record)
    displayed = _text(record.get("displayed_employer_name") or record.get("company_name") or record.get("name") or record.get("employer"))
    source_url = _text(record.get("source_url") or record.get("vacancy_url"))
    vacancy_source = _host(record.get("vacancy_source_domain") or source_url)
    org_url = _text(record.get("organization_website") or record.get("hiring_organization_url") or record.get("website"))
    official = _host(record.get("employer_official_domain") or record.get("official_domain") or org_url)
    resolution_method = _text(record.get("resolution_method") or record.get("employer_resolution_method"))
    confidence = float(record.get("confidence") or 0.0)
    evidence = list(record.get("domain_verification_evidence") or record.get("resolution_evidence") or ())

    def _is_ats_host(host: str) -> bool:
        return bool(host) and any(host == h or host.endswith(f".{h}") for h in _ATS_HOSTS)

    # Never treat ATS/Workday host as employer official domain.
    if _is_ats_host(official):
        official = ""
        evidence.append("rejected_ats_host_as_official_domain")

    if org_url:
        org_host = _host(org_url)
        if org_host and not _is_ats_host(org_host):
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

    if (not official or _is_ats_host(official)) and detect_ats_vendor(source_url) == "workday":
        corporate = _workday_corporate_guess(source_url)
        if corporate and not is_blacklisted_domain(corporate):
            official = corporate
            tenant = str(inspect_workday_url(source_url).get("tenant") or "")
            resolution_method = resolution_method or "workday_tenant_corporate_map"
            confidence = max(confidence, 0.93)
            evidence.extend([
                "workday_tenant_corporate_map",
                f"workday_tenant:{tenant}",
                f"corporate_domain:{corporate}",
            ])
            apply_first_party_ats_metadata(enriched, tenant=tenant)

    for pattern, domain, brand, kind in _EMPLOYER_IDENTITY_HINTS:
        if pattern.search(displayed or ""):
            if not official or _is_ats_host(official):
                official = domain
                resolution_method = resolution_method or "employer_identity_hint"
                confidence = max(confidence, 0.88)
                evidence.append(f"employer_identity_hint:{kind}")
            enriched.setdefault("employer_brand", brand)
            if detect_ats_vendor(source_url) == "workday":
                apply_first_party_ats_metadata(enriched)
            break

    if official and vacancy_source and official == vacancy_source:
        corporate = _corporate_from_careers_host(vacancy_source)
        if corporate:
            official = corporate
            resolution_method = resolution_method or "careers_subdomain_corporate_link"
            confidence = max(confidence, 0.9)

    verified = bool(displayed and official and not is_blacklisted_domain(official) and not _is_ats_host(official))
    if verified:
        direct = record.get("employer_is_direct")
        if direct is False:
            employer_is_direct = False
        else:
            employer_is_direct = True
        source_class = _text(enriched.get("source_class") or record.get("source_class")) or "company_careers"
        enriched.update({
            "displayed_employer_name": displayed,
            "legal_or_corporate_employer": _text(record.get("legal_or_corporate_employer")) or displayed,
            "company_name": displayed,
            "employer_official_domain": official,
            "official_domain": official,
            "website": f"https://{official}",
            "vacancy_source_domain": vacancy_source,
            "official_domain_verified": True,
            "employer_is_direct": employer_is_direct,
            "resolution_method": resolution_method or "persisted_parse_data",
            "employer_resolution_method": resolution_method or "persisted_parse_data",
            "confidence": round(max(confidence, 0.85), 3),
            "resolution_evidence": tuple(sorted(set(evidence))),
            "domain_verification_evidence": tuple(sorted(set(evidence))),
            "entity_class": "operating_company",
            "source_class": source_class,
        })
        if "active" in record:
            enriched["active"] = record.get("active")
        if detect_ats_vendor(source_url) == "workday" and official:
            apply_first_party_ats_metadata(enriched, tenant=str(enriched.get("workday_tenant") or ""))
    return enriched


def apply_first_party_ats_metadata(record: dict[str, Any], *, tenant: str = "") -> dict[str, Any]:
    """Canonical source_class=company_careers with first-party ATS subtype."""
    source_url = _text(record.get("source_url") or record.get("vacancy_url"))
    vendor = detect_ats_vendor(source_url)
    if vendor:
        record["ats_vendor"] = vendor
    if tenant:
        record["workday_tenant"] = tenant
    if vendor == "workday" and (
        record.get("employer_official_domain")
        or record.get("official_domain_verified")
        or record.get("source_subtype") == "first_party_ats"
    ):
        record["source_class"] = "company_careers"
        record["source_subtype"] = "first_party_ats"
        record["ats_vendor"] = "workday"
    return record


def explicit_size_constraint_in_text(text: str) -> bool:
    return bool(_EXPLICIT_SIZE_CONSTRAINT_RE.search(_text(text)))


def size_constraint_policy(request: Any) -> dict[str, Any]:
    """Materialize size-gate inputs; compiler target sizes alone do not activate the gate."""
    from backend_mirror.source_adapters.contracts import AdapterDiscoveryRequest

    if isinstance(request, AdapterDiscoveryRequest):
        tf = dict(request.technical_filters or {})
        raw_query = _text(tf.get("parent_query") or tf.get("raw_query") or request.query)
    elif isinstance(request, Mapping):
        tf = dict(request.get("technical_filters") or {})
        raw_query = _text(tf.get("parent_query") or tf.get("raw_query") or request.get("query"))
    else:
        tf = {}
        raw_query = ""
    ui_explicit = str(tf.get("size_constraint_provenance") or tf.get("company_size_filter_provenance") or "") == "user_explicit"
    query_explicit = explicit_size_constraint_in_text(raw_query)
    explicit_constraints = tuple(
        str(item) for item in (tf.get("explicit_user_constraints") or ()) if explicit_size_constraint_in_text(str(item))
    )
    active = ui_explicit or query_explicit or bool(explicit_constraints)
    reason = "none"
    if ui_explicit:
        reason = "user_explicit_ui_filter"
    elif query_explicit:
        reason = "raw_query_explicit_size_terms"
    elif explicit_constraints:
        reason = "explicit_user_constraints"
    return {
        "raw_query": raw_query,
        "canonical_plan_target_company_sizes": tuple(str(item) for item in (tf.get("company_sizes") or ())),
        "required_attributes": tuple(str(item) for item in (tf.get("required_attributes") or ())),
        "explicit_user_constraints": explicit_constraints,
        "local_business_preference": tf.get("local_business_preference", tf.get("localBusinessPreference")),
        "company_size_policy_active": active,
        "policy_reason": reason,
    }


def requires_sme_size_gate(request: Any) -> bool:
    return bool(size_constraint_policy(request).get("company_size_policy_active"))


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
    row: dict[str, Any] = {
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
        "source_subtype": _text(outcome.get("source_subtype")),
        "ats_vendor": _text(outcome.get("ats_vendor")),
        "vacancy_source_domain": _text(outcome.get("source_domain")),
        "employer_official_domain": _text(outcome.get("employer_official_domain") or outcome.get("official_domain")),
        "official_domain_verified": outcome.get("official_domain_verified"),
        "workday_tenant": _text(outcome.get("tenant") or outcome.get("workday_tenant")),
        "extraction_method": _text(outcome.get("parser_selected")) or "persisted_outcome",
        "description": _text(outcome.get("description")),
        "evidence": _text(outcome.get("vacancy_title")),
        "entity_class": "operating_company",
    }
    if "active" in outcome:
        row["active"] = outcome.get("active")
    elif outcome.get("vacancy_active") is not None:
        row["active"] = outcome.get("vacancy_active")
    row["active_evidence"] = _text(outcome.get("active_evidence"))
    row["active_checked_at"] = _text(outcome.get("active_checked_at"))
    row["active_verification_method"] = _text(outcome.get("active_verification_method"))
    return row


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
        missing_active_provenance = (
            ("active" not in item and item.get("vacancy_active") is None)
            or not item.get("active_evidence")
            or not item.get("active_verification_method")
        )
        if missing_active_provenance or str(item.get("rejection_code") or "") != "ACCEPTED":
            revalidation.append(url)
    parsed_unique = tuple(dict.fromkeys(parsed))
    reval_unique = tuple(dict.fromkeys(revalidation))
    if qualification_validator_epoch >= QUALIFICATION_VALIDATOR_EPOCH:
        active_refetch = tuple(
            url for url in reval_unique
            if any(
                _text(item.get("canonical_url") or item.get("url")) == url
                and (
                    ("active" not in item and item.get("vacancy_active") is None)
                    or not item.get("active_evidence")
                    or not item.get("active_verification_method")
                )
                for item in url_outcomes if isinstance(item, Mapping)
            )
        )
        return parsed_unique, active_refetch
    # Validator epoch advanced: offline-revalidate every successful parse, including
    # prior ACCEPTED rows that must pass a newer semantic verifier version.
    return parsed_unique, parsed_unique


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
        geography = evaluate_vacancy_geography(
            location=location,
            title=title,
            address_locality=_text(record.get("address_locality")),
            address_region=_text(record.get("address_region")),
            address_country=_text(record.get("address_country")),
            additional_locations=record.get("additional_locations") or (),
            source_url=_text(record.get("source_url")),
            geographies=geographies,
        )
        record.update(geography.to_dict())
        if not geography:
            result.geography_fail += 1
            code = geography.geography_rejection_code or "GEO_OUT_OF_SCOPE"
            result.rejection_counts[code] = result.rejection_counts.get(code, 0) + 1
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
