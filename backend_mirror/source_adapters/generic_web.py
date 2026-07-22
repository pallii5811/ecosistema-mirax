"""Explicitly partial generic web fallback for uncovered commercial signals."""

from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Mapping, MutableMapping, Optional, Sequence, Tuple
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from backend_mirror.agents.portal_blacklist import is_blacklisted_domain

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
from .generic_web_budget import (
    BUFFER_EUR,
    GenericWebDiscoveryState,
    IDENTITY_RESERVE_EUR,
    QUERY_COST_EUR,
    SEMANTIC_RESERVE_EUR,
    URLS_PER_WAVE,
    decode_generic_web_v2_payload,
    encode_generic_web_cursor,
    load_generic_web_state,
    persist_generic_web_state,
)
from .generic_web_budget import _url_key
from .generic_web_provenance import (
    append_query_telemetry,
    attach_generic_provenance,
    evidence_has_fetch_provenance,
    generic_record_has_fetch_provenance,
    is_careers_only_host,
    page_fetch_id,
    semantic_call_id,
)
_SIGNAL_ALIASES: Dict[str, Tuple[str, ...]] = {
    "seeking_supplier": ("ricerca fornitori", "nuovi fornitori", "albo fornitori", "supplier search"),
    "regulatory_change": ("adeguamento normativo", "nuovo obbligo", "nuova normativa", "compliance"),
    "compliance_gap": ("non conforme", "sanzione", "obbligo non rispettato", "compliance gap"),
    "leadership_change": ("nuovo amministratore delegato", "nuovo direttore", "nomina", "management change", "nuovo CEO"),
    "certification": ("ottiene la certificazione", "certificata", "certificazione ottenuta"),
    "partnership_search": ("ricerca partner", "nuovi partner", "partner commerciali"),
    "distributor_search": ("ricerca distributori", "nuovi distributori", "rete distributiva"),
    "acquisition": ("acquisisce", "acquisizione", "ha acquisito"),
    "merger": ("fusione", "si fonde", "merger"),
    "funding": ("ha raccolto", "round di investimento", "finanziamento", "venture capital", "funding"),
    "financing": ("finanziamento agevolato", "credito d'imposta", "fondo perduto"),
    "capital_investment": ("investimento di", "iniezione di capitale", "private equity"),
    "technology_adoption": ("adotta", "implementa", "sceglie la piattaforma", "CRM", "ERP"),
    "technology_migration": ("migrazione", "sostituzione sistema", "passaggio a"),
    "active_advertising": ("campagna pubblicitaria", "Meta Ads", "Google Ads", "investimento media"),
    "investing_marketing": ("campagna pubblicitaria", "investimento marketing", "media buyer"),
    "production_expansion": ("nuovo stabilimento", "ampliamento produttivo", "nuova unità produttiva", "capacità produttiva"),
    "new_location": ("nuova sede", "nuovo stabilimento", "inaugura", "apre una sede"),
    "geographic_expansion": ("espansione", "nuova sede", "nuovo mercato", "ampliamento"),
    "expansion": ("espansione", "ampliamento", "nuovo stabilimento", "nuova sede"),
}

_ITALY_COUNTRY_GEOGRAPHIES = frozenset({"italia", "italy", "it"})
_ITALY_LOCALITY_TO_REGION: Dict[str, str] = {
    **{name: "Valle d'Aosta" for name in ("valle d aosta", "aosta")},
    **{name: "Piemonte" for name in (
        "piemonte", "torino", "turin", "alessandria", "asti", "biella", "cuneo",
        "novara", "verbania", "vercelli",
    )},
    **{name: "Liguria" for name in ("liguria", "genova", "genoa", "imperia", "la spezia", "savona")},
    **{name: "Lombardia" for name in (
        "lombardia", "lombardy", "milano", "milan", "bergamo", "brescia", "monza",
        "brianza", "varese", "como", "lecco", "pavia", "cremona", "mantova", "lodi", "sondrio",
        "castrezzato", "travagliato", "brembate", "fara gera d adda",
    )},
    **{name: "Trentino-Alto Adige" for name in (
        "trentino alto adige", "trentino", "alto adige", "trento", "bolzano",
    )},
    **{name: "Veneto" for name in (
        "veneto", "belluno", "padova", "rovigo", "treviso", "venezia", "venice", "verona", "vicenza",
        "thiene", "occhiobello",
    )},
    **{name: "Friuli-Venezia Giulia" for name in (
        "friuli venezia giulia", "friuli", "gorizia", "pordenone", "trieste", "udine",
    )},
    **{name: "Emilia-Romagna" for name in (
        "emilia romagna", "bologna", "ferrara", "forli", "cesena", "modena", "parma",
        "piacenza", "ravenna", "reggio emilia", "rimini", "imola",
    )},
    **{name: "Toscana" for name in (
        "toscana", "arezzo", "firenze", "florence", "grosseto", "livorno", "lucca",
        "massa", "carrara", "pisa", "pistoia", "prato", "siena",
    )},
    **{name: "Umbria" for name in ("umbria", "perugia", "terni")},
    **{name: "Marche" for name in (
        "marche", "ancona", "ascoli piceno", "fermo", "macerata", "pesaro", "urbino",
    )},
    **{name: "Lazio" for name in (
        "lazio", "roma", "rome", "frosinone", "latina", "rieti", "viterbo", "pomezia",
    )},
    **{name: "Abruzzo" for name in (
        "abruzzo", "l aquila", "chieti", "pescara", "teramo",
    )},
    **{name: "Molise" for name in ("molise", "campobasso", "isernia")},
    **{name: "Campania" for name in (
        "campania", "napoli", "naples", "avellino", "benevento", "caserta", "salerno",
    )},
    **{name: "Puglia" for name in (
        "puglia", "apulia", "bari", "barletta", "andria", "trani", "brindisi", "foggia",
        "lecce", "taranto",
    )},
    **{name: "Basilicata" for name in ("basilicata", "lucania", "matera", "potenza")},
    **{name: "Calabria" for name in (
        "calabria", "calabrese", "catanzaro", "cosenza", "crotone", "reggio calabria", "vibo valentia",
    )},
    **{name: "Sicilia" for name in (
        "sicilia", "sicily", "agrigento", "caltanissetta", "catania", "enna", "messina",
        "palermo", "ragusa", "siracusa", "trapani",
    )},
    **{name: "Sardegna" for name in (
        "sardegna", "sardinia", "cagliari", "nuoro", "oristano", "sassari", "sud sardegna",
    )},
}
_ITALY_REGION_TO_MACRO: Dict[str, str] = {
    **{region: "north" for region in (
        "Valle d'Aosta", "Piemonte", "Liguria", "Lombardia", "Trentino-Alto Adige", "Veneto",
        "Friuli-Venezia Giulia", "Emilia-Romagna",
    )},
    **{region: "centre" for region in ("Toscana", "Umbria", "Marche", "Lazio")},
    **{region: "south" for region in (
        "Abruzzo", "Molise", "Campania", "Puglia", "Basilicata", "Calabria", "Sicilia", "Sardegna",
    )},
}
_ITALY_MACRO_ALIASES: Dict[str, str] = {
    "nord italia": "north", "italia settentrionale": "north", "northern italy": "north",
    "centro italia": "centre", "italia centrale": "centre", "central italy": "centre",
    "sud italia": "south", "italia meridionale": "south", "mezzogiorno": "south",
    "southern italy": "south",
}


@dataclass(frozen=True)
class GenericWebProviderResult:
    records: Tuple[Mapping[str, Any], ...]
    cost_eur: float = 0.0
    warnings: Tuple[str, ...] = ()


GenericWebProvider = Callable[[AdapterDiscoveryRequest, int, int], Awaitable[GenericWebProviderResult]]


def _text(value: Any) -> Optional[str]:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text or None


def _host(value: Any) -> str:
    text = _text(value) or ""
    parsed = urlparse(text if "://" in text else f"https://{text}")
    return (parsed.hostname or "").lower().removeprefix("www.")


def _primary_page_text(html: str) -> str:
    """Return candidate-bearing page content without navigation/related-item noise."""
    soup = BeautifulSoup(html or "", "html.parser")
    for node in soup.select("script,style,noscript,nav,header,footer,aside"):
        node.decompose()
    noisy = re.compile(
        r"(?:^|[-_\s])(related|recommended|latest|recent|sidebar|widget|navigation|menu|breadcrumb|footer|header)(?:$|[-_\s])",
        re.I,
    )
    for node in list(soup.find_all(True)):
        # ``decompose()`` clears descendant attributes. Because this loop walks
        # a snapshot, a child of a removed noisy container can still be visited
        # with ``attrs=None``; calling Tag.get would then reject the whole page.
        if getattr(node, "attrs", None) is None:
            continue
        marker = " ".join(
            [str(node.get("id") or ""), *[str(item) for item in (node.get("class") or ())]]
        )
        if marker and noisy.search(marker):
            node.decompose()
    for selector in ("article", "main", "[role='main']"):
        node = soup.select_one(selector)
        text = _text(node.get_text(" ", strip=True) if node else None) or ""
        if len(text) >= 120:
            return text
    return _text(soup.get_text(" ", strip=True)) or ""


def _normalized_geography_text(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", text.casefold()).strip()


def _contains_geography_term(blob: str, term: str) -> bool:
    return bool(re.search(rf"(?:^|\s){re.escape(term)}(?:$|\s)", blob))


def _explicit_requested_geography(
    request: AdapterDiscoveryRequest,
    *source_values: Any,
) -> Dict[str, Any]:
    """Ground geography only in source content, never in the retrieval query."""
    requested_pairs = [
        (str(item).strip(), _normalized_geography_text(item))
        for item in request.geographies
        if _normalized_geography_text(item)
    ]
    requested_specific = [(raw, norm) for raw, norm in requested_pairs if norm not in _ITALY_COUNTRY_GEOGRAPHIES]
    if not requested_specific:
        return {
            "geography": "",
            "geography_match": False,
            "requested_geographies": [raw for raw, _ in requested_pairs],
            "matched_geography": "",
            "geography_match_method": "country_only_unconstrained",
            "geography_match_evidence": "",
        }
    blob = _normalized_geography_text(" ".join(str(value or "") for value in source_values))
    if not blob:
        return {
            "geography": "",
            "geography_match": False,
            "requested_geographies": [raw for raw, _ in requested_pairs],
            "matched_geography": "",
            "geography_match_method": "no_source_geography",
            "geography_match_evidence": "",
        }
    for raw, norm in requested_specific:
        if _contains_geography_term(blob, norm):
            return {
                "geography": raw,
                "geography_match": True,
                "requested_geographies": [item for item, _ in requested_pairs],
                "matched_geography": raw,
                "geography_match_method": "explicit_source_geography",
                "geography_match_evidence": raw,
            }
    requested_norms = {norm for _, norm in requested_specific}
    requested_macros = {_ITALY_MACRO_ALIASES[norm] for norm in requested_norms if norm in _ITALY_MACRO_ALIASES}
    for locality in sorted(_ITALY_LOCALITY_TO_REGION, key=len, reverse=True):
        if not _contains_geography_term(blob, locality):
            continue
        region = _ITALY_LOCALITY_TO_REGION[locality]
        region_norm = _normalized_geography_text(region)
        region_macro = _ITALY_REGION_TO_MACRO.get(region)
        if region_norm in requested_norms or (region_macro and region_macro in requested_macros):
            return {
                "geography": region,
                "geography_match": True,
                "requested_geographies": [item for item, _ in requested_pairs],
                "matched_geography": region,
                "geography_match_method": "source_locality_to_region",
                "geography_match_evidence": locality,
            }
    return {
        "geography": "",
        "geography_match": False,
        "requested_geographies": [raw for raw, _ in requested_pairs],
        "matched_geography": "",
        "geography_match_method": "no_source_geography_match",
        "geography_match_evidence": "",
    }


def _iso_date(value: Any) -> Optional[str]:
    text = _text(value)
    if not text:
        return None
    for fmt in (None, "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"):
        try:
            parsed = date.fromisoformat(text[:10]) if fmt is None else datetime.strptime(text[:10], fmt).date()
            return parsed.isoformat()
        except ValueError:
            continue
    return None


_EMPLOYEE_COUNT_RE = re.compile(
    r"\b(?:circa\s+|oltre\s+|pi[uù]\s+di\s+|approximately\s+)?"
    r"(\d{1,3}(?:[.\s]\d{3})*|\d+)\s*(?:dipendenti|lavoratori|addetti|employees|headcount)\b",
    re.I,
)
_LISTED_HINT_RE = re.compile(r"\b(?:quotat[oa]|borsa\s+italiana|euronext|nasdaq|nyse)\b", re.I)
_FAKE_EMAIL_MARKERS = (
    "example.com", "sentry.io", "wixpress", "schema.org", "yourdomain", "email.com", "domain.com",
)


def _parse_employee_count(text: str) -> Optional[int]:
    match = _EMPLOYEE_COUNT_RE.search(str(text or ""))
    if not match:
        return None
    raw = re.sub(r"[^\d]", "", match.group(1) or "")
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if 1 <= value <= 500_000 else None


def _size_class_from_employees(employees: Optional[int]) -> str:
    if employees is None:
        return ""
    if employees <= 9:
        return "micro"
    if employees <= 49:
        return "small"
    if employees <= 249:
        return "medium"
    return "enterprise"


def _public_contacts_from_html(html: str, *, source_url: str = "", prefer_domain: str = "") -> Tuple[ContactRecord, ...]:
    """Deterministic public mailto/tel extraction — no invented contacts."""
    out: List[ContactRecord] = []
    seen: set[str] = set()
    preferred_domain = (prefer_domain or "").casefold().removeprefix("www.")
    source_host = _host(source_url)
    source_is_company_owned = bool(
        preferred_domain
        and (source_host == preferred_domain or source_host.endswith("." + preferred_domain))
    )
    emails: List[str] = []
    for match in re.finditer(
        r"mailto:([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})",
        html or "",
        re.I,
    ):
        email = match.group(1).split("?", 1)[0].strip().casefold()
        if not email or email in seen or any(marker in email for marker in _FAKE_EMAIL_MARKERS):
            continue
        seen.add(email)
        emails.append(email)
    # Bot-light contact pages often render the company email as plain text
    # without a mailto: href (Tecnoeka /contatti live canary).
    if preferred_domain:
        for match in re.finditer(
            rf"(?<![A-Z0-9._%+\-])([A-Z0-9._%+\-]+@{re.escape(preferred_domain)})(?![A-Z0-9.\-])",
            html or "",
            re.I,
        ):
            email = match.group(1).strip().casefold()
            if not email or email in seen or any(marker in email for marker in _FAKE_EMAIL_MARKERS):
                continue
            seen.add(email)
            emails.append(email)
        company_emails = [
            value for value in emails
            if value.endswith("@" + preferred_domain) or value.endswith("." + preferred_domain)
        ]
        emails = company_emails  # never publish third-party publisher mailtos as company contact
    for email in emails[:2]:
        out.append(ContactRecord(kind="email", value=email, source_url=source_url, verified=True))
    # A publisher page may expose its own newsroom telephone. With a known
    # company domain, only a company-owned page can verify a telephone.
    phone_html = html if not preferred_domain or source_is_company_owned else ""
    for match in re.finditer(r"tel:([+\d][\d\s./\-()]{6,})", phone_html, re.I):
        phone = re.sub(r"[^\d+]", "", match.group(1) or "")
        if len(re.sub(r"\D", "", phone)) < 8 or phone in seen:
            continue
        seen.add(phone)
        out.append(ContactRecord(kind="phone", value=phone, source_url=source_url, verified=True))
        break
    if phone_html and not any(item.kind == "phone" for item in out):
        for match in re.finditer(r"\+39[\s./-]?\d{2,4}[\s./-]?\d{5,8}", phone_html):
            phone = re.sub(r"[^\d+]", "", match.group(0) or "")
            if len(re.sub(r"\D", "", phone)) < 8 or phone in seen:
                continue
            seen.add(phone)
            out.append(ContactRecord(kind="phone", value=phone, source_url=source_url, verified=True))
            break
    return tuple(out)


def _organization_facts_from_html(html: str) -> Mapping[str, Any]:
    """Extract only explicit Organization JSON-LD facts from a fetched page."""
    soup = BeautifulSoup(html or "", "html.parser")
    for script in soup.find_all("script", attrs={"type": re.compile("ld\\+json", re.I)}):
        try:
            payload = json.loads(script.string or script.get_text() or "{}")
        except (TypeError, json.JSONDecodeError):
            continue
        for item in _iter_json(payload):
            raw_type = item.get("@type")
            types = raw_type if isinstance(raw_type, list) else [raw_type]
            if not any(str(value).casefold() in {"organization", "corporation", "localbusiness"} for value in types):
                continue
            employees = item.get("numberOfEmployees")
            if isinstance(employees, Mapping):
                employees = employees.get("value") or employees.get("maxValue")
            parent = item.get("parentOrganization")
            if isinstance(parent, Mapping):
                parent = parent.get("name") or parent.get("legalName")
            return {
                "legal_name": _text(item.get("legalName") or item.get("name")),
                "employee_count": employees,
                "parent_group": _text(parent),
                "email": _text(item.get("email")),
                "telephone": _text(item.get("telephone")),
            }
    return {}


def _enrich_record_from_page(row: MutableMapping[str, Any], *, html: str = "", text: str = "") -> MutableMapping[str, Any]:
    blob = " ".join(str(item or "") for item in (text, row.get("source_text"), row.get("evidence_excerpt"), html[:50_000]))
    if row.get("employee_count") is None:
        employees = _parse_employee_count(blob)
        if employees is not None:
            row["employee_count"] = employees
            row["company_size"] = _size_class_from_employees(employees)
    if not row.get("company_size") and row.get("employee_count") is not None:
        try:
            row["company_size"] = _size_class_from_employees(int(row["employee_count"]))
        except (TypeError, ValueError):
            pass
    if _LISTED_HINT_RE.search(blob):
        row["is_listed"] = True
    official_domain = _host(row.get("official_domain"))
    enrichment_url = str(row.get("official_enrichment_url") or "")
    page_url = enrichment_url or str(row.get("source_url") or "")
    page_host = _host(page_url)
    official_page = bool(
        official_domain
        and page_host
        and (page_host == official_domain or page_host.endswith("." + official_domain))
        and (enrichment_url or row.get("source_class") == "official_company_website")
    )
    organization = _organization_facts_from_html(html) if html and official_page else {}
    if organization:
        if row.get("employee_count") is None and organization.get("employee_count") is not None:
            try:
                employees = int(str(organization["employee_count"]).replace(".", "").strip())
                row["employee_count"] = employees
                row["company_size"] = _size_class_from_employees(employees)
            except (TypeError, ValueError):
                pass
        for key in ("legal_name", "parent_group"):
            if organization.get(key) and not row.get(key):
                row[key] = organization[key]
    contacts = list(row.get("contacts") or [])
    contact_kinds = {
        str(item.get("kind") or "")
        for item in contacts
        if isinstance(item, Mapping)
    }
    has_direct_contact = "email" in contact_kinds or "phone" in contact_kinds
    if not has_direct_contact and html:
        extracted = [
            {"kind": item.kind, "value": item.value, "source_url": item.source_url, "verified": item.verified}
            for item in _public_contacts_from_html(
                html,
                source_url=page_url,
                prefer_domain=official_domain,
            )
        ]
        if extracted:
            contacts = extracted
            row["contacts"] = contacts
            has_direct_contact = True
    if not has_direct_contact and organization:
        source = str(row.get("official_enrichment_url") or row.get("source_url") or "")
        email = str(organization.get("email") or "").removeprefix("mailto:").strip().casefold()
        phone = str(organization.get("telephone") or "").removeprefix("tel:").strip()
        domain = _host(row.get("official_domain"))
        if email and domain and email.endswith("@" + domain) and not any(marker in email for marker in _FAKE_EMAIL_MARKERS):
            contacts.append({"kind": "email", "value": email, "source_url": source, "verified": True})
        if phone and len(re.sub(r"\D", "", phone)) >= 8:
            contacts.append({"kind": "phone", "value": phone, "source_url": source, "verified": True})
        if contacts:
            row["contacts"] = contacts
    source_url = str(row.get("official_enrichment_url") or "")
    if not (row.get("contacts") or ()) and html and source_url:
        if "<form" in html.casefold() and re.search(
            r"\b(?:contatt\w*|contact\w*|richiedi informazioni)\b", blob, re.I
        ):
            row["contacts"] = [{
                "kind": "other", "value": source_url, "source_url": source_url, "verified": True,
            }]
    return row


def _enrich_from_official_domain(row: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    """Best-effort company homepage enrichment for size/public contacts (no SERP)."""
    domain = _host(row.get("official_domain"))
    if not domain or is_blacklisted_domain(domain):
        return row
    need_size = row.get("employee_count") is None and not _text(row.get("company_size"))
    existing = row.get("contacts") if isinstance(row.get("contacts"), list) else []
    need_contact = not any(
        isinstance(item, Mapping) and str(item.get("kind") or "") in {"email", "phone"} and str(item.get("value") or "").strip()
        for item in existing
    )
    if not need_size and not need_contact:
        return row
    import httpx

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml",
    }
    for path in ("/contatti", "/contatti/", "/contact", "/contact/", "/", "/azienda", "/about"):
        try:
            with httpx.Client(timeout=8.0, follow_redirects=True, headers=headers) as client:
                response = client.get(f"https://{domain}{path}")
            if response.status_code != 200 or "html" not in str(response.headers.get("content-type") or "").lower():
                continue
            html = response.text[:1_500_000]
            official_url = str(response.url)
            row["official_enrichment_url"] = official_url
            row = _enrich_record_from_page(row, html=html, text="")
            evidence = list(row.get("market_scope_evidence") or ())
            if row.get("employee_count") is not None or row.get("parent_group") or row.get("is_listed") is True:
                evidence.append({
                    "source_url": official_url,
                    "observed_at": datetime.now(timezone.utc).isoformat(),
                    "method": "official_website_structured_or_literal",
                    "authority_class": "official_company_website",
                    "employee_count": row.get("employee_count"),
                    "company_size": row.get("company_size"),
                    "parent_group": row.get("parent_group"),
                    "is_listed": row.get("is_listed"),
                })
                row["market_scope_evidence"] = evidence
            if (not need_size or row.get("employee_count") is not None or _text(row.get("company_size"))) and (
                not need_contact or (row.get("contacts") or ())
            ):
                # Prefer real email/phone over contact-form URL placeholders.
                contact_kinds = {
                    str(item.get("kind") or "")
                    for item in (row.get("contacts") or ())
                    if isinstance(item, Mapping)
                }
                if not need_contact or ("email" in contact_kinds or "phone" in contact_kinds):
                    break
        except Exception:
            continue
    return row


def _owned_or_verified_official_domain(row: Mapping[str, Any]) -> bool:
    """True when enriching the official host is safe (verified or same-host evidence)."""
    domain = _host(row.get("official_domain"))
    if not domain:
        return False
    if row.get("official_domain_verified") is True:
        return True
    source_host = _host(row.get("source_url") or row.get("sito") or row.get("website") or "")
    return bool(source_host and (source_host == domain or source_host.endswith("." + domain)))


def _maybe_enrich_from_official_domain(row: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    if not _owned_or_verified_official_domain(row):
        return row
    return _enrich_from_official_domain(row)


def backfill_lead_public_contacts(lead: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    """Fill missing email/phone from the official domain before acceptance gates.

    Shadow payloads can qualify on a news/event page that never carried mailto/tel.
    Contactability must still use the free official-site fetch, not reject a real PMI.
    """
    out = dict(lead)
    contatti = out.get("contatti") if isinstance(out.get("contatti"), Mapping) else {}
    has_email = bool(str(out.get("email") or "").strip() or (contatti.get("email") or ()))
    has_phone = bool(str(out.get("telefono") or out.get("phone") or "").strip() or (contatti.get("telefoni") or ()))
    if has_email or has_phone:
        return out
    domain = _host(out.get("official_domain") or out.get("sito") or out.get("website") or "")
    if not domain:
        return out
    row: Dict[str, Any] = {
        "official_domain": domain,
        "official_domain_verified": True,
        "source_url": str(out.get("sito") or out.get("website") or f"https://{domain}/"),
        "contacts": [],
    }
    row = _enrich_from_official_domain(row)
    contacts = row.get("contacts") if isinstance(row.get("contacts"), list) else []
    emails = [
        str(item.get("value") or "").strip()
        for item in contacts
        if isinstance(item, Mapping) and str(item.get("kind") or "") == "email" and str(item.get("value") or "").strip()
    ]
    phones = [
        str(item.get("value") or "").strip()
        for item in contacts
        if isinstance(item, Mapping) and str(item.get("kind") or "") == "phone" and str(item.get("value") or "").strip()
    ]
    if not emails and not phones:
        return out
    if emails:
        out["email"] = emails[0]
    if phones:
        out["telefono"] = phones[0]
        out["phone"] = phones[0]
    out["contatti"] = {
        "email": emails[:2],
        "telefoni": phones[:2],
    }
    if row.get("official_enrichment_url"):
        out["official_enrichment_url"] = row.get("official_enrichment_url")
    provenance = dict(out.get("field_provenance") or {}) if isinstance(out.get("field_provenance"), Mapping) else {}
    observed = datetime.now(timezone.utc).isoformat()
    source = str(row.get("official_enrichment_url") or f"https://{domain}/")
    if emails:
        provenance["email"] = {
            "value": emails[0],
            "source": source,
            "status": "verified",
            "confidence": 0.9,
            "observed_at": observed,
        }
    if phones:
        provenance["phone"] = {
            "value": phones[0],
            "source": source,
            "status": "verified",
            "confidence": 0.9,
            "observed_at": observed,
        }
    out["field_provenance"] = provenance
    return out


def _iter_json(value: Any) -> Iterable[Mapping[str, Any]]:
    if isinstance(value, Mapping):
        yield value
        graph = value.get("@graph")
        if isinstance(graph, list):
            for item in graph:
                yield from _iter_json(item)
    elif isinstance(value, list):
        for item in value:
            yield from _iter_json(item)


def _official_organization(soup: BeautifulSoup, page_host: str) -> Optional[Mapping[str, Any]]:
    for script in soup.find_all("script", attrs={"type": re.compile("ld\\+json", re.I)}):
        try:
            payload = json.loads(script.string or script.get_text() or "{}")
        except (TypeError, json.JSONDecodeError):
            continue
        for item in _iter_json(payload):
            raw_type = item.get("@type")
            types = raw_type if isinstance(raw_type, list) else [raw_type]
            if "Organization" in types and _host(item.get("url") or item.get("sameAs")) == page_host:
                return item
    return None


def _signal_phrases(request: AdapterDiscoveryRequest, signal_id: str) -> Tuple[str, ...]:
    configured = request.technical_filters.get("signal_keywords")
    if isinstance(configured, Mapping):
        values = configured.get(signal_id)
        if isinstance(values, (list, tuple)):
            cleaned = tuple(value for item in values if (value := _text(item)))
            if cleaned:
                return cleaned
    aliases = _SIGNAL_ALIASES.get(signal_id)
    if aliases:
        return aliases
    phrase = re.sub(r"[_-]+", " ", signal_id).strip()
    return (phrase,) if len(phrase) >= 5 else ()


def _matched_signals(blob: str, request: AdapterDiscoveryRequest) -> Tuple[str, ...]:
    lower = blob.casefold()
    matched = []
    for signal_id in request.signal_ids:
        phrases = _signal_phrases(request, signal_id)
        if phrases and any(phrase.casefold() in lower for phrase in phrases):
            matched.append(signal_id)
    return tuple(matched)


def parse_primary_evidence_page(
    html: str,
    source_url: str,
    request: AdapterDiscoveryRequest,
) -> List[Dict[str, Any]]:
    """Return only dated first-party evidence with explicit signal phrases."""
    host = _host(source_url)
    parsed_url = urlparse(source_url)
    if not host or is_blacklisted_domain(host) or (parsed_url.path or "/") in {"", "/"}:
        return []
    soup = BeautifulSoup(html or "", "html.parser")
    organization = _official_organization(soup, host)
    if not organization:
        return []
    company = _text(organization.get("name"))
    if not company:
        return []
    blob = _text(soup.get_text(" ", strip=True)) or ""
    matched = _matched_signals(blob, request)
    if request.signal_match_mode == "all" and len(matched) != len(request.signal_ids):
        return []
    if request.signal_match_mode == "any" and not matched:
        return []
    published = None
    for attrs in ({"property": "article:published_time"}, {"name": "date"}, {"itemprop": "datePublished"}):
        node = soup.find("meta", attrs=attrs)
        published = _iso_date(node.get("content") if node else None)
        if published:
            break
    if not published:
        node = soup.find("time")
        published = _iso_date(node.get("datetime") if node else None)
    if not published:
        return []
    positions = [blob.casefold().find(phrase.casefold()) for signal in matched for phrase in _signal_phrases(request, signal)]
    start = max(0, min((value for value in positions if value >= 0), default=0) - 180)
    excerpt = blob[start:start + 900]
    geography = _explicit_requested_geography(request, blob)
    publisher_meta = soup.find("meta", attrs={"property": "og:site_name"})
    publisher = _text(publisher_meta.get("content") if publisher_meta else None) or company
    employees_raw = organization.get("numberOfEmployees")
    if isinstance(employees_raw, Mapping):
        employees_raw = employees_raw.get("value") or employees_raw.get("maxValue")
    try:
        employees = int(employees_raw) if employees_raw not in (None, "") else None
    except (TypeError, ValueError):
        employees = None
    size = ""
    if employees is not None:
        size = "micro" if employees <= 9 else "small" if employees <= 49 else "medium" if employees <= 249 else "enterprise"
    return [{
        "company_name": company,
        "official_domain": host,
        "official_domain_verified": True,
        "entity_class": "operating_company",
        "matched_signal_ids": list(matched),
        "published_at": published,
        **geography,
        "source_url": source_url,
        "source_publisher": publisher,
        "source_class": "official_company_website",
        "evidence_excerpt": excerpt,
        "extraction_method": "deterministic_primary_page",
        "company_size": size,
        "employee_count": employees,
        "query_origin": request.technical_filters.get("query_origin") or request.query,
        "parent_query": request.technical_filters.get("parent_query") or request.query,
        "discovery_round": int(request.technical_filters.get("discovery_round") or 1),
    }]


def diversified_queries(request: AdapterDiscoveryRequest) -> Tuple[str, ...]:
    from .universal_strategy_queries import universal_strategy_queries_from_filters

    geography = " ".join(g for g in request.geographies if g.casefold() not in {"italy", "italia"}) or "Italia"
    sector = " ".join(request.sectors)
    phrases = [phrase for signal in request.signal_ids for phrase in _signal_phrases(request, signal)]
    signal_query = " OR ".join(f'"{phrase}"' for phrase in phrases[:8])
    base = _text(request.query) or ""
    universal = universal_strategy_queries_from_filters(
        request.technical_filters,
        signal_ids=request.signal_ids,
        max_queries=8,
    )
    # Prefer compiled strategy queries. The raw natural-language request and
    # sector-wide "comunicato/news" variants pull market roundups that burn
    # the second-lead SERP without company-level funding evidence.
    if universal:
        values: List[str] = list(universal)
        if "funding" in set(request.signal_ids):
            values.append(
                f'startup {geography} ("chiude un round" OR "ha raccolto" OR "seed round" OR "pre-seed") '
                f'(2025 OR 2026) -investitori -fondo -banca -"venture capital"'
            )
        return tuple(dict.fromkeys(value.strip() for value in values if value.strip()))
    values = (
        base,
        f"({signal_query}) {sector} {geography} (comunicato OR news OR aggiornamento)",
        f"({signal_query}) {sector} {geography} (site:.it OR site:.eu)",
    )
    return tuple(dict.fromkeys(value.strip() for value in values if value.strip()))


def _telemetry_bucket(request: AdapterDiscoveryRequest) -> Dict[str, Any]:
    bucket = request.technical_filters.get("universal_prefilter_telemetry")
    if isinstance(bucket, dict):
        return bucket
    return {}


def _record_prefilter(
    request: AdapterDiscoveryRequest,
    *,
    raw: int,
    accepted: int,
    rejected: int,
    codes: Mapping[str, int],
    pages: int = 0,
    provider_query: str = "",
) -> None:
    bucket = request.technical_filters.get("universal_prefilter_telemetry")
    if not isinstance(bucket, dict):
        return
    bucket["raw_discovery_hits"] = int(bucket.get("raw_discovery_hits") or 0) + raw
    bucket["prefilter_accepted"] = int(bucket.get("prefilter_accepted") or 0) + accepted
    bucket["prefilter_rejected"] = int(bucket.get("prefilter_rejected") or 0) + rejected
    merged = dict(bucket.get("prefilter_rejection_codes") or {})
    for key, value in codes.items():
        merged[key] = int(merged.get(key) or 0) + int(value)
    bucket["prefilter_rejection_codes"] = merged
    bucket["pages_opened_after_prefilter"] = int(bucket.get("pages_opened_after_prefilter") or 0) + pages
    if provider_query:
        queries = list(bucket.get("provider_queries") or [])
        queries.append(provider_query)
        bucket["provider_queries"] = queries


def _gate_serp_hits(
    request: AdapterDiscoveryRequest,
    hits: Sequence[Mapping[str, Any]],
    *,
    provider_query: str,
) -> List[DiscoveryHit]:
    from .cheap_discovery_prefilter import (
        DiscoveryHit,
        has_concrete_expansion_event,
        prefilter_discovery_hit,
    )

    accepted: List[DiscoveryHit] = []
    semantic_open_world = request.technical_filters.get("semantic_authority_required") is True
    codes: Dict[str, int] = {}
    raw = 0
    for item in hits:
        url = _text(item.get("url") or item.get("link")) or ""
        if not url:
            continue
        raw += 1
        hit = DiscoveryHit(
            title=str(item.get("title") or ""),
            url=url,
            snippet=str(item.get("snippet") or item.get("description") or ""),
            publisher=str(item.get("publisher") or ""),
        )
        expansion_signals = {
            "production_expansion", "new_location", "geographic_expansion", "expansion",
        }
        if expansion_signals.intersection(
            str(signal).strip() for signal in request.signal_ids
        ) and not has_concrete_expansion_event(hit.title, hit.snippet):
            codes["no_concrete_expansion_event"] = codes.get(
                "no_concrete_expansion_event", 0
            ) + 1
            continue
        decision = prefilter_discovery_hit(
            hit,
            # Keep event-hint gating even on semantic open-world — without it
            # hub/association SERPs burn interpretation budget (antincendio canary).
            require_event_hint=True,
            allow_admin_assoc=False,
        )
        if decision.accepted:
            accepted.append(hit)
        else:
            codes[decision.reason] = codes.get(decision.reason, 0) + 1
    _record_prefilter(
        request,
        raw=raw,
        accepted=len(accepted),
        rejected=raw - len(accepted),
        codes=codes,
        provider_query=provider_query,
    )
    filters = request.technical_filters if isinstance(request.technical_filters, dict) else {}
    append_query_telemetry(
        filters,
        query_text=provider_query,
        raw_provider_hits=raw,
        prefilter_accepted=len(accepted),
        prefilter_rejected=raw - len(accepted),
        rejection_histogram=codes,
        provider_error=None,
        cost_eur=QUERY_COST_EUR,
    )
    accepted.sort(key=_serp_fetch_priority)
    return accepted


_CONTENT_SHELL_HOST_SUFFIXES = (
    "borsaitaliana.it",
)
_PREFERRED_NEWS_HOST_SUFFIXES = (
    "repubblica.it",
    "ansa.it",
    "bebeez.it",
    "ilsole24ore.com",
    "corriere.it",
    "energiamercato.it",
    # startupitalia.eu frequently returns Cloudflare challenges to datacenter IPs;
    # keep it fetchable but not preferred over hosts that return real article HTML.
)
_CHALLENGE_PAGE_RE = re.compile(
    r"(just a moment|attention required|cf-browser-verification|checking your browser|"
    r"enable javascript and cookies|verify you are human|access denied|ddos-guard)",
    re.I,
)


def _hit_str(hit: Any, key: str) -> str:
    if isinstance(hit, Mapping):
        return str(hit.get(key) or "")
    return str(getattr(hit, key, "") or "")


def _serp_fetch_priority(hit: Any) -> Tuple[int, int, int, str]:
    """Fetch real articles before exchange/archive shells in the same SERP wave."""
    url = _hit_str(hit, "url")
    title = _hit_str(hit, "title")
    snippet = _hit_str(hit, "snippet")
    host = _host(url)
    if any(host == suffix or host.endswith("." + suffix) for suffix in _CONTENT_SHELL_HOST_SUFFIXES):
        tier = 2
    elif any(host == suffix or host.endswith("." + suffix) for suffix in _PREFERRED_NEWS_HOST_SUFFIXES):
        tier = 0
    else:
        tier = 1
    # Include URL path: resume meta often has empty title/snippet but paths like
    # /tec-med-adotta-veeva-crm-… still name the buyer event.
    headline = f"{title} {snippet} {url}"
    # Buyer tech-adoption headlines (CRM sceglie/adotta) before how-to guides.
    guide_penalty = 1 if re.search(
        r"\b(guida|tutorial|come\s+si\s+sceglie|come\s+scegliere|cos['']?\s*è|cose\s+è|miglior\s+crm)\b",
        headline,
        re.I,
    ) else 0
    job_board_penalty = 1 if re.search(
        r"(linkedin\.com|jobsora\.|jooble\.|careerjet\.|indeed\.|infojobs\.|pagepersonnel\.|experis\.|intervieweb\.)",
        url,
        re.I,
    ) else 0
    event_boost = 0 if re.search(
        r"\b(chiude un round|ha raccolto|seed round|pre-seed|raccoglie|funding round|"
        r"sceglie|adotta|implementa|migrazione\s+crm|nuovo\s+crm|adotta-veeva|sceglie-.*crm|"
        r"bando\s+di\s+gara|consip|accordo\s+quadro|gara\s+public\s+cloud)\b",
        headline,
        re.I,
    ) else 1
    return (tier, guide_penalty + job_board_penalty, event_boost, url.casefold())


def _hits_from_urls(urls: Sequence[str], *, query: str) -> List[Dict[str, str]]:
    """Normalize legacy URL-only providers without fabricating SERP evidence."""
    out: List[Dict[str, str]] = []
    for url in urls:
        out.append({"url": url, "title": "", "snippet": "", "source_type": "search", "provider": "legacy_url"})
    return out


def _record_url_outcome(filters: MutableMapping[str, Any], outcome: Mapping[str, Any]) -> None:
    bucket = filters.get("generic_web_url_outcomes")
    if not isinstance(bucket, list):
        bucket = []
        filters["generic_web_url_outcomes"] = bucket
    bucket.append(dict(outcome))


def _apply_free_identity(row: MutableMapping[str, Any], request: AdapterDiscoveryRequest) -> MutableMapping[str, Any]:
    from backend_mirror.agents.entity_identity_resolver import (
        COMMERCIAL_ENTITY_CLASSES,
        EntityIdentityRequest,
        resolve_entity_identity,
    )

    company = _text(row.get("company_name"))
    source_url = _text(row.get("source_url"))
    domain = _host(row.get("official_domain"))
    if domain and is_careers_only_host(domain):
        domain = ""
    identity = resolve_entity_identity(
        EntityIdentityRequest(
            company_name=company,
            evidence_url=source_url,
            presented_domain=domain,
            geography=_text(row.get("geography")) or "",
            budget_eur=0.0,
            allow_serp=False,
            allowed_entity_classes=tuple(COMMERCIAL_ENTITY_CLASSES),
            source_payload=dict(row),
        )
    )
    if identity.official_domain and str(identity.identity_status or "").lower() == "verified":
        if not is_careers_only_host(identity.official_domain):
            row["official_domain"] = identity.official_domain
            row["official_domain_verified"] = True
            row["entity_class"] = identity.entity_class or "operating_company"
            row["domain_verification"] = {
                "status": "verified",
                "confidence": float(identity.identity_confidence or 0.85),
                "score": int(round(float(identity.identity_confidence or 0.85) * 100)),
                "evidence": tuple(identity.identity_evidence or ("free_identity",)),
                "resolution_source": identity.resolution_source or "free_identity",
                "resolution_method": identity.resolution_method or "structured_or_owned_host",
                "adapter_id": "generic_web_research_v1",
                "url": f"https://{identity.official_domain}/",
            }
    return row


_GENERIC_TITLE_RE = re.compile(
    r"\b(?:news|notizie|comunicato|stampa|evento|eventi|home|homepage|blog|"
    r"finanziamento|funding|round|nomina|partnership|tecnologia|marketing|"
    r"guida|tutorial|come|perch[eé]|quando|chi|cos['']?[eè]|miglior)\b",
    re.I,
)
_LEGAL_ENTITY_RE = re.compile(
    r"\b([A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*(?:\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*){0,5}"
    r"\s+(?:S\.?\s?p\.?\s?A\.?|S\.?\s?r\.?\s?l\.?|Srl|Spa|S\.p\.A\.))\b"
)


def _structured_subject_identities(html: str, *, page_host: str = "") -> Tuple[Mapping[str, Any], ...]:
    """Extract explicit target organizations without treating the publisher as one.

    Only organizations linked from an event-bearing object (about, mentions,
    hiringOrganization) are accepted on third-party pages.  A page-level
    Organization is accepted only on a non-article page hosted on that same
    organization's domain.  This is identity discovery, never event matching.
    """
    soup = BeautifulSoup(html or "", "html.parser")
    items: List[Mapping[str, Any]] = []
    for script in soup.find_all("script", attrs={"type": re.compile("ld\\+json", re.I)}):
        try:
            payload = json.loads(script.string or script.get_text() or "{}")
        except (TypeError, json.JSONDecodeError):
            continue
        items.extend(_iter_json(payload))

    article_page = any(
        str(value) in {"Article", "NewsArticle", "Report", "BlogPosting"}
        for item in items
        for value in (item.get("@type") if isinstance(item.get("@type"), list) else [item.get("@type")])
    )
    identities: Dict[Tuple[str, str], Mapping[str, Any]] = {}
    for item in items:
        subjects: List[Any] = []
        for key in ("about", "mentions", "hiringOrganization"):
            value = item.get(key)
            subjects.extend(value if isinstance(value, list) else [value])
        raw_item_type = item.get("@type")
        item_types = raw_item_type if isinstance(raw_item_type, list) else [raw_item_type]
        item_url = item.get("url") or item.get("sameAs")
        if (
            not article_page
            and any(value in {"Organization", "Corporation", "LocalBusiness"} for value in item_types)
            and _host(item_url) == page_host
        ):
            subjects.append(item)
        for subject in subjects:
            if not isinstance(subject, Mapping):
                continue
            raw_type = subject.get("@type")
            types = raw_type if isinstance(raw_type, list) else [raw_type]
            if not any(value in {"Organization", "Corporation", "LocalBusiness"} for value in types):
                continue
            name = _text(subject.get("name")) or ""
            raw_urls = subject.get("url") or subject.get("sameAs") or ()
            urls = raw_urls if isinstance(raw_urls, list) else [raw_urls]
            official_url = next(
                (str(value) for value in urls if _host(value) and not is_blacklisted_domain(_host(value))),
                "",
            )
            domain = _host(official_url)
            if name and domain:
                identities[(name.casefold(), domain)] = {
                    "name": name,
                    "url": official_url,
                    "domain": domain,
                    "types": tuple(str(value) for value in types if value),
                }
    return tuple(identities.values())


def _structured_subject_company(html: str) -> str:
    identities = _structured_subject_identities(html)
    return str(identities[0].get("name") or "") if len(identities) == 1 else ""


def _structured_page_date(html: str) -> Optional[str]:
    soup = BeautifulSoup(html or "", "html.parser")
    for script in soup.find_all("script", attrs={"type": re.compile("ld\\+json", re.I)}):
        try:
            payload = json.loads(script.string or script.get_text() or "{}")
        except (TypeError, json.JSONDecodeError):
            continue
        for item in _iter_json(payload):
            for key in ("datePublished", "datePosted"):
                parsed = _iso_date(item.get(key))
                if parsed:
                    return parsed
    for attrs in (
        {"property": "article:published_time"}, {"name": "date"},
        {"itemprop": "datePublished"}, {"itemprop": "datePosted"},
    ):
        node = soup.find("meta", attrs=attrs)
        parsed = _iso_date(node.get("content") if node else None)
        if parsed:
            return parsed
    node = soup.find("time", attrs={"datetime": True})
    return _iso_date(node.get("datetime") if node else None)


_NEWS_INDEX_PATH_RE = re.compile(
    r"/(?:[a-z]{2}/)?(?:news|notizie|comunicati(?:-stampa)?|press-releases?)/?$",
    re.I,
)
_EXPANSION_ARTICLE_HREF_RE = re.compile(
    r"(stabiliment|ampliament|inaugur|nuov[oa].{0,24}(?:impianto|unit)|capacit[aà].{0,12}produttiv)",
    re.I,
)


def _infer_page_date(*, html: str = "", text: str = "", url: str = "", title: str = "", snippet: str = "") -> Optional[str]:
    """Best-effort publication/event day for news pages lacking machine metadata."""
    from .universal_evidence import _parse_event_date

    # Prefer SERP title/snippet over page-wide JSON-LD/meta: news hubs often expose
    # an unrelated stale article:published_time while the matched card is recent
    # (Divella /it/news → SIGNAL_STALE on 2023 meta despite "13 giugno 2026").
    for blob in (title, snippet):
        parsed = _parse_event_date(blob or "")
        if parsed:
            return parsed
    structured = _structured_page_date(html)
    if structured:
        return structured
    for blob in (text[:8000], url):
        parsed = _parse_event_date(blob or "")
        if parsed:
            return parsed
    # Corriere-style path: /24_agosto_27/… or /2025/03/15/
    path = urlparse(_text(url) or "").path or ""
    month_slug = re.search(
        r"/(\d{2})_(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)_(\d{1,2})/",
        path,
        re.I,
    )
    if month_slug:
        from .universal_evidence import _IT_MONTHS

        month = _IT_MONTHS.get(month_slug.group(2).casefold())
        if month:
            try:
                year = 2000 + int(month_slug.group(1))
                return date(year, month, int(month_slug.group(3))).isoformat()
            except ValueError:
                pass
    iso_path = re.search(r"/(20\d{2})/(\d{2})/(\d{2})/", path)
    if iso_path:
        try:
            return date(int(iso_path.group(1)), int(iso_path.group(2)), int(iso_path.group(3))).isoformat()
        except ValueError:
            return None
    return None


def _published_date_is_fresh(published: str, request: AdapterDiscoveryRequest, today: Optional[date] = None) -> bool:
    parsed = _iso_date(published)
    if not parsed:
        return False
    day = today or date.today()
    age = (day - date.fromisoformat(parsed)).days
    if age < 0:
        return False
    max_age = request.freshness_max_age_days
    if max_age is None:
        return True
    return age <= int(max_age)


def _canonical_token(value: str) -> str:
    return "".join(char.casefold() for char in _text(value) if char.isalnum())


_LEGAL_SUFFIX_RE = re.compile(
    r"\b(?:s\.?\s?r\.?\s?l\.?|s\.?\s?p\.?\s?a\.?|srl|spa|gmbh|inc|ltd|llc)\b",
    re.I,
)


def _company_core_tokens(value: str) -> set[str]:
    import unicodedata

    text = unicodedata.normalize("NFKC", (_text(value) or "").casefold())
    text = _LEGAL_SUFFIX_RE.sub(" ", text)
    stop = {"the", "and", "per", "del", "della", "delle", "dei", "degli", "della", "news", "notizie"}
    return {
        token
        for token in re.findall(r"[a-z0-9]{2,}", text)
        if token not in stop
    }


def company_hint_present_in_source(hint: str, source_text: str) -> bool:
    """True when the hinted company identity is evidenced in fetched page text."""
    if not _text(hint) or not _text(source_text):
        return False
    hint_tokens = _company_core_tokens(hint)
    if not hint_tokens:
        return False
    source_tokens = _company_core_tokens(source_text)
    if hint_tokens <= source_tokens:
        return True
    if len(hint_tokens) == 1:
        token = next(iter(hint_tokens))
        return token in source_tokens or token in _canonical_token(source_text)
    overlap = hint_tokens & source_tokens
    return len(overlap) >= max(1, len(hint_tokens) - 1)


_STARTUP_DESCRIPTOR = (
    r"(?:italiana|italo-americana|edutech|deeptech|fintech|foodtech|biotech|cleantech|saas|ai|tech)?"
)
_SNIPPET_COMPANY_PATTERNS = (
    # Buyer adoption headlines: "Valsir sceglie CDM … per implementare il CRM"
    # must keep the buyer (Valsir), not the vendor/publisher host.
    # Reject interrogatives: "Come si sceglie …" is a guide, not a buyer.
    re.compile(
        r"^(?!Come\b|Perch[eé]\b|Quando\b|Chi\b|Come\s+si\b)"
        r"([A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*(?:\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*){0,3})\s+"
        r"(?:sceglie|adotta|implementa|migra(?:\s+a)?|passa a)\b",
        re.I,
    ),
    # Facility expansion: "Elettromeccanica Tironi inaugura il nuovo stabilimento"
    # Keep "ha inaugurato" before bare "inaugurato" so "MARPOSS HA INAUGURATO"
    # does not capture "MARPOSS HA" as the company.
    re.compile(
        r"^(?!Inaugurazion\w*\b|Inaugurato\b|News\b|Press\b|Blog\b|Comunicato\b)"
        r"([A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*(?:\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*){0,4}?)\s+"
        r"(?:ha\s+inaugurato|ha\s+aperto|inaugura|inaugurato|apre|celebra)\b",
        re.I,
    ),
    # Institutional press: "Intesa Provincia Dana per l'avvio di una nuova unità…"
    # Keep the operating company, never Provincia/Regione/Comune.
    re.compile(
        r"\bIntesa\s+(?:con\s+)?(?:la\s+)?(?:Provincia|Regione|Comune)\s+"
        r"([A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*(?:\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*){0,3})"
        r"\s+per\b",
        re.I,
    ),
    # "Fendi grazie ad un accordo un nuovo stabilimento…"
    re.compile(
        r"^([A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*(?:\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*){0,3})\s+"
        r"grazie\s+ad?\s+un\s+accordo\b",
        re.I,
    ),
    # "Cembre: nuovo stabilimento …" / "DalterFood inaugura un nuovo stabilimento"
    re.compile(
        r"^([A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*(?:\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*){0,3})\s*[,:]\s+"
        r"(?:nuovo\s+stabilimento|nuova\s+unit[aà]|inaugur|ampliament)",
        re.I,
    ),
    # "… stabilimento della CONTROLLATA MG SPA" / "polo logistico della Bracchi"
    # Require a real capital letter for the company token (no re.I on the name).
    re.compile(
        r"(?i)\b(?:stabilimento|impianto|polo\s+logistico)\s+"
        r"(?:della\s+controllata\s+|della\s+|di\s+)?"
        r"(?-i:([A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*(?:\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*){0,3}"
        r"(?:\s+(?:S\.?\s?p\.?\s?A\.?|S\.?\s?r\.?\s?l\.?|Srl|Spa))?))",
    ),
    # Prefer "la startup … Name chiude/ha/annuncia" over topical prefixes.
    re.compile(
        rf"\bla startup(?:\s+{_STARTUP_DESCRIPTOR})?\s+"
        r"([A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*(?:\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*){0,3})\s+"
        r"(?:chiude|ha|annuncia|raccoglie)\b",
        re.I,
    ),
    # "La foodtech italiana PlanEat chiude …" (sector label, no "startup" token).
    re.compile(
        r"\b(?:la\s+)?(?:foodtech|fintech|edutech|deeptech|cleantech|biotech)"
        r"(?:\s+italiana|\s+italo-americana)?\s+"
        r"([A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*(?:\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*){0,3})\s+"
        r"(?:chiude|ha|annuncia|raccoglie)\b",
        re.I,
    ),
    re.compile(
        r"^([A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*(?:\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*){0,4})\s*,?\s*la startup",
        re.I,
    ),
    re.compile(
        r"^([A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*(?:\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*){0,3})\s+chiude un round",
        re.I,
    ),
    re.compile(
        r"^([A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*(?:\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*){0,3})\s+ha raccolto",
        re.I,
    ),
    re.compile(
        r"^([A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*(?:\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*){0,3})\s+raccoglie",
        re.I,
    ),
)


def _snippet_company_hint(snippet: str) -> str:
    text = (_text(snippet) or "").strip()
    for pattern in _SNIPPET_COMPANY_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        name = match.group(1).strip()
        if name and not _GENERIC_TITLE_RE.search(name) and _looks_like_company_name(name):
            return name
    return ""


_COMPANY_NAME_MAX_LEN = 45
_COMPANY_NAME_MAX_WORDS = 5
_TITLE_ACTION_TAIL_RE = re.compile(
    r"\s+(?:chiude un|chiude il|chiude la|ha raccolto|hanno raccolto|raccoglie|annuncia|annunciano|"
    r"sfiora|supera|porta a|sceglie|adotta|implementa|migra a|passa a|"
    r"inaugura|ha inaugurato|inaugurato|apre|ha aperto|celebra|"
    r"grazie ad|grazie a|per l['’]?avvio|per un nuovo)\b",
    re.I,
)

# Public bodies / ministries are news actors, never the expanding operating company.
_INSTITUTIONAL_ENTITY_RE = re.compile(
    r"^(?:il\s+|la\s+|lo\s+)?"
    r"(?:mimit|mise|mur|mef|ministero|assessorato|governo|prefettura|questura|"
    r"regione|provincia|comune|camera\s+di\s+commercio|consorzio\s+agrario|"
    r"asst|asl|ospedale|azienda\s+ospedaliera|azienda\s+sanitaria|"
    r"unione\s+europea|commissione\s+europea|parlamento|senato|inps|inail|agenzia\s+delle\s+entrate)"
    r"(?:\b|$)",
    re.I,
)


def _is_geography_token(value: str) -> bool:
    """True when the token is an Italian locality/region, not a company name."""
    norm = _normalized_geography_text(value)
    if not norm or len(norm) < 3:
        return False
    if norm in _ITALY_LOCALITY_TO_REGION:
        return True
    if norm in {_normalized_geography_text(region) for region in _ITALY_REGION_TO_MACRO}:
        return True
    if norm in _ITALY_COUNTRY_GEOGRAPHIES or norm in {"nord italia", "sud italia", "centro italia"}:
        return True
    return False


def _is_institutional_entity(value: str) -> bool:
    """True for ministries, assessorati, and other public bodies mistaken for firms."""
    text = (_text(value) or "").strip().strip(".")
    if not text:
        return False
    if _INSTITUTIONAL_ENTITY_RE.match(text):
        return True
    # Multi-token public offices: "Assessorato Attività produttive Industria 4.0"
    low = text.casefold()
    return bool(
        re.search(
            r"\b(?:assessorato|ministero|presidenza|segreteria\s+di\s+stato|"
            r"direzione\s+generale|ufficio\s+stampa\s+della\s+provincia|"
            r"compagnia\s+delle\s+opere|\bcdo\b)\b",
            low,
        )
    )


def _looks_like_company_name(value: str) -> bool:
    text = (_text(value) or "").strip().strip(".")
    if not text or len(text) > _COMPANY_NAME_MAX_LEN:
        return False
    if len(text.split()) > _COMPANY_NAME_MAX_WORDS:
        return False
    if _GENERIC_TITLE_RE.search(text):
        return False
    if re.match(
        r"^(Le|La|Lo|Gli|I|Un|Una|Uno|Più|Molte|Tutte|Tutti|Press|News|Blog|Home|Forum|"
        r"Lavoro\s+Urgente|Inaugurazione|Inaugurato|Comunicato|RSS|"
        r"Our|The|This|Just|Pubblicit[aà]|Imprese)\b",
        text,
        re.I,
    ):
        return False
    # Ministries and public offices must never seed company follow-up SERPs.
    if _is_institutional_entity(text):
        return False
    # Bare Italian function/saint tokens are never a stable firm identity
    # ("San" from "San Pellegrino", "Società", "Azienda").
    if re.fullmatch(
        r"san|santa|santo|societ[aà]|azienda|impresa|gruppo|studio|terme|hotel",
        text,
        re.I,
    ):
        return False
    # Local TV / newspaper chrome must not become the expanding company.
    if (
        re.search(r"(?:tv|tg)$", text, re.I)
        or re.search(
            r"(?:^|\b)(?:tv|tg|news|notizie|giornale|quotidiano|telegiornale|today|web\s*tv)(?:\b|$)",
            text,
            re.I,
        )
    ) and not re.search(r"\b(?:spa|srl|s\.p\.a|s\.r\.l)\b", text, re.I):
        return False
    # Italian localities/regions are never the operating company in news titles.
    if _is_geography_token(text):
        return False
    # Sector/topic labels and bot-challenge chrome are not companies.
    if re.fullmatch(
        r"(?:digital\s+)?(?:bio|fin|edu|clean|deep|health|food)?tech|"
        r"admissions?\s+process|just a moment(?:\s+\.+)?|equity crowdfunding",
        text,
        re.I,
    ):
        return False
    if re.match(
        r"^(?:foodtech|fintech|edutech|deeptech|cleantech|biotech)\b",
        text,
        re.I,
    ):
        return False
    # Job titles must never become funding followup targets.
    if re.search(
        r"\b(engineer|developer|developer|ingegnere|sviluppatore|manager|director|recruiter|"
        r"intern|stage|junior|senior|fullstack|full-stack|backend|frontend|devops)\b",
        text,
        re.I,
    ):
        return False
    if re.search(
        r"\b(milioni di investimenti|startup italiane|mercato|economia|notizie|modalit[aà]|"
        r"adesione|iscrizione|checking your browser)\b",
        text,
        re.I,
    ):
        return False
    # Codes, stock symbols and isolated initials (I845, HB) are not stable
    # operating-company identities. Compact names such as IBM remain valid.
    if not re.search(r"[A-Za-zÀ-ÖØ-öø-ÿ]{3,}", text):
        return False
    return bool(re.search(r"[A-Za-zÀ-ÖØ-öø-ÿ]", text))


def _is_challenge_or_empty_page(*, status_code: int, title: str, visible_text: str, html: str = "") -> bool:
    if int(status_code or 0) != 200:
        return True
    blob = f"{title} {visible_text[:2500]} {(html or '')[:2500]}"
    if _CHALLENGE_PAGE_RE.search(blob):
        return True
    # Only treat near-empty shells as missing content. Short fixture articles must remain valid.
    return len((visible_text or "").strip()) < 24


def _company_hint_from_url(url: str) -> str:
    """Recover buyer identity from adoption slugs when SERP title/snippet are empty."""
    from urllib.parse import urlparse

    path = (urlparse(_text(url) or "").path or "").strip("/")
    if not path:
        return ""
    match = re.search(
        r"(?P<company>[A-Za-z0-9]+(?:-[A-Za-z0-9]+){0,4})"
        r"-(?:adotta|sceglie|implementa|migra)-",
        path,
        re.I,
    )
    if not match:
        return ""
    raw = match.group("company").replace("-", " ").strip()
    # Keep compact legal-style tokens: "tec med" → "Tec Med"
    candidate = " ".join(part.capitalize() for part in raw.split())
    if candidate and _looks_like_company_name(candidate):
        return candidate
    return ""


def _serp_company_hint(*, title: str, snippet: str, url: str = "") -> str:
    """Company identity from SERP fields only — used before/without HTML body."""
    for text in (title, snippet, f"{title} {snippet}"):
        hint = _snippet_company_hint(text)
        if hint and _looks_like_company_name(hint) and not _is_institutional_entity(hint):
            return hint
    leading = _title_company_leading(title)
    if leading and _looks_like_company_name(leading) and not _is_institutional_entity(leading):
        return leading
    # News headlines: "… nuovo stabilimento … di Fine Foods …"
    owned = re.search(
        r"\b(?:di|della|del|dello)\s+([A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,4})\b",
        f"{title} {snippet}".strip(),
    )
    if owned:
        owned_name = owned.group(1).strip(" ,;-")
        if owned_name and _looks_like_company_name(owned_name) and not _is_institutional_entity(owned_name):
            return owned_name
    # Ministry-led headlines often bury the real firm later in the SERP text.
    legal = _LEGAL_ENTITY_RE.search(f"{title} {snippet}".strip())
    if legal:
        legal_name = legal.group(1).strip()
        if legal_name and _looks_like_company_name(legal_name):
            return legal_name
    agricola = re.search(
        r"\b(Azienda\s+Agricola\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*"
        r"(?:\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ&.'’+-]*){0,3})\b",
        f"{title} {snippet}",
    )
    if agricola:
        parts = agricola.group(1).strip().split()
        # Title/snippet concatenation can glue a trailing ministry token
        # ("… Ponte Reale" + "MIMIT, 12 milioni…").
        while len(parts) > 2 and _is_institutional_entity(parts[-1]):
            parts.pop()
        name = " ".join(parts)
        if _looks_like_company_name(name):
            return name
    return _company_hint_from_url(url)


def _trim_title_company_candidate(value: str) -> str:
    candidate = (_text(value) or "").strip()
    match = _TITLE_ACTION_TAIL_RE.search(candidate)
    if match:
        candidate = candidate[: match.start()].strip(" ,:-")
    return candidate


def _candidate_official_domain(*, page_host: str, source_class: str, semantic_required: bool) -> str:
    host = _host(page_host) or ""
    if source_class == "recognized_news" and semantic_required:
        return ""
    if not host or is_blacklisted_domain(host):
        return ""
    return host


def _shell_recovery_query(company: str, *, failed_host: str, request: Any = None) -> str:
    """Recovery SERP must match the active signal — not always funding."""
    exclude = f" -site:{failed_host}" if failed_host else ""
    signals = {
        str(item).strip().casefold()
        for item in (getattr(request, "signal_ids", None) or ())
        if str(item).strip()
    }
    filters = getattr(request, "technical_filters", None)
    filters = filters if isinstance(filters, Mapping) else {}
    active_items = filters.get("universal_active_strategies") or ()
    active = next((item for item in active_items if isinstance(item, Mapping)), None)
    if active is None or not str(active.get("hypothesis_id") or "").strip():
        return ""
    signal = str(active.get("signal_type") or "").strip().casefold()
    if not signal or (signals and signal not in signals):
        return ""
    blob = " ".join((str(getattr(request, "query", "") or ""), signal)).casefold()
    if "crm" in blob or signal == "technology_adoption":
        social_exclude = " -site:linkedin.com -site:facebook.com -site:instagram.com"
        return (
            f'"{company}" CRM ("selezione" OR "valutazione" OR "migrazione" OR '
            f'"in cerca" OR gara OR RFP OR "progetto CRM" OR sceglie OR adotta)'
            f'{exclude}{social_exclude}'
        )
    terms = tuple(_SIGNAL_ALIASES.get(signal) or ())
    event_type = str(active.get("event_type") or "").strip()
    if not terms and event_type:
        terms = (event_type.replace("_", " "),)
    if not terms:
        return ""
    event_or = " OR ".join(f'"{term}"' for term in terms[:5])
    return f'"{company}" ({event_or}){exclude}'


def _crm_shell_company_ok(company: str) -> bool:
    """Reject observatory/vendor shells that burn CRM recovery SERPs."""
    text = (_text(company) or "").strip()
    if not text or not _looks_like_company_name(text):
        return False
    low = text.casefold()
    if re.search(r"\b(osservatorio|capterra|partner|agenzia|wiki|consulting)\b", low):
        return False
    if "crm" in low and not re.search(r"\b(spa|srl|s\.p\.a|s\.r\.l|group|societ)\b", low):
        return False
    # Prefer legal-form / multi-token operating names over dotted acronyms (A.E.C.I.).
    if re.fullmatch(r"(?:[A-Za-z]\.){2,}[A-Za-z]\.?", text):
        return False
    return bool(re.search(r"\b(spa|srl|s\.p\.a|s\.r\.l|group|societ|[A-Z][a-z]{3,})\b", text))


def _enqueue_same_host_expansion_articles(
    state: GenericWebDiscoveryState,
    *,
    html: str,
    page_url: str,
    title: str = "",
    snippet: str = "",
    limit: int = 3,
) -> int:
    """News-index SERP hits: queue same-host article URLs that look like expansions."""
    path = urlparse(_text(page_url) or "").path or ""
    if not _NEWS_INDEX_PATH_RE.search(path):
        return 0
    if not _EXPANSION_ARTICLE_HREF_RE.search(f"{title} {snippet} {html[:12000]}"):
        return 0
    from urllib.parse import urljoin

    page_host = _host(page_url)
    if not page_host or not html:
        return 0
    soup = BeautifulSoup(html, "html.parser")
    terminal = {str(item).strip().lower().rstrip("/") for item in state.processed_terminal_urls}
    pending = {str(item).strip().lower().rstrip("/") for item in state.pending_urls}
    queued = 0
    for anchor in soup.find_all("a", href=True):
        if queued >= limit:
            break
        href = str(anchor.get("href") or "").strip()
        label = " ".join(anchor.stripped_strings)[:240]
        target = urljoin(page_url, href)
        key = target.strip().lower().rstrip("/")
        if not key or key in terminal or key in pending:
            continue
        if _host(target) != page_host:
            continue
        if _NEWS_INDEX_PATH_RE.search(urlparse(target).path or ""):
            continue
        blob = f"{label} {href}"
        if not _EXPANSION_ARTICLE_HREF_RE.search(blob):
            continue
        state.pending_urls = tuple(dict.fromkeys((*state.pending_urls, target)))
        pending.add(key)
        meta_key = key
        existing_meta = {
            str(item.get("url") or "").strip().lower().rstrip("/"): dict(item)
            for item in state.url_meta
            if isinstance(item, Mapping) and item.get("url")
        }
        if meta_key not in existing_meta:
            state.url_meta = (
                *state.url_meta,
                {
                    "url": target,
                    "title": label,
                    "snippet": snippet,
                    "source_type": "news_index_followup",
                    "provider": "generic_web",
                },
            )
        queued += 1
    return queued


def _enqueue_content_shell_followup(
    state: GenericWebDiscoveryState,
    *,
    identity_hint: str,
    failed_url: str,
    request: Any = None,
) -> None:
    """When a SERP hit is a content shell, queue a targeted recovery query."""
    company = (_text(identity_hint) or "").strip()
    if not company or not _looks_like_company_name(company) or _is_institutional_entity(company):
        return
    if _is_geography_token(company):
        return
    # Section titles / publisher hubs mistaken for firms (ilqi "Logistica & Industriale").
    if "&" in company:
        return
    # CRM seeking recovery queries burned the €0.05 envelope on agency-page
    # shells (e.g. engage.it/agenzie/...): those pages mention CRM as a service
    # but often do not ground "operating company adopts/chooses a CRM".
    # Skip recovery to let the main SERP wave explore other hits.
    failed_url_lc = (failed_url or "").casefold()
    failed_host = _host(failed_url)
    if failed_host and failed_host.endswith("engage.it") and "/agenzie/" in failed_url_lc:
        return
    signals = {
        str(item).strip().casefold()
        for item in (getattr(request, "signal_ids", None) or ())
        if str(item).strip()
    }
    blob = " ".join(
        (
            str(getattr(request, "query", "") or ""),
            " ".join(sorted(signals)),
        )
    ).casefold()
    if ("crm" in blob or "technology_adoption" in signals) and not _crm_shell_company_ok(company):
        return
    if len(state.followup_queries) >= 2:
        return
    company_key = company.casefold()
    # One recovery wave per company — don't burn both slots on the same name.
    if any(company_key in str(item).casefold() for item in state.followup_queries):
        return
    if any(company_key in str(item).casefold() for item in state.executed_query_keys):
        return
    failed_host = _host(failed_url)
    followup = _shell_recovery_query(company, failed_host=failed_host or "", request=request)
    if not followup:
        return
    existing = {item.casefold() for item in state.followup_queries}
    existing.update(item.casefold() for item in state.executed_query_keys)
    if followup.casefold() in existing:
        return
    state.followup_queries = (*state.followup_queries, followup)


def _remember_candidate_source_url(state: GenericWebDiscoveryState, url: str) -> None:
    key = (_text(url) or "").strip()
    if not key:
        return
    state.candidate_source_urls = tuple(dict.fromkeys((*state.candidate_source_urls, key)))


def _title_company_leading(title: str) -> str:
    text = (_text(title) or "").strip()
    # Prefer explicit "… la startup [descriptor] Name chiude/ha/annuncia …".
    startup_named = _snippet_company_hint(text)
    if startup_named and _looks_like_company_name(startup_named):
        return startup_named
    # Locality-prefix news: "Castrezzato: nuovo polo logistico Bracchi …"
    # Keep the expanding company, never the place name before the colon.
    if ":" in text:
        left, right = text.split(":", 1)
        left_candidate = _trim_title_company_candidate(left)
        right_hint = _snippet_company_hint(right.strip())
        if (
            right_hint
            and _looks_like_company_name(right_hint)
            and (
                _is_geography_token(left_candidate)
                or right_hint.casefold() != left_candidate.casefold()
            )
        ):
            return right_hint
        if left_candidate and _looks_like_company_name(left_candidate) and not _is_geography_token(left_candidate):
            return left_candidate
    leading = re.split(r"\s+[|–—-]\s+|:\s+", text, maxsplit=1)[0].strip()
    # When the headline is "Topic, la startup Name …", skip the topical clause.
    if ", la startup" in leading.casefold() or ", la startup" in text.casefold():
        startup_named = _snippet_company_hint(text)
        if startup_named and _looks_like_company_name(startup_named):
            return startup_named
    for raw in (leading.split(",", 1)[0].strip(), leading):
        candidate = _trim_title_company_candidate(raw)
        if _looks_like_company_name(candidate) and not _is_geography_token(candidate):
            return candidate
    return ""


def _literal_excerpt_for_hint(hint: str, visible_text: str, title: str, snippet: str) -> str:
    for candidate in (title.strip(), snippet.strip()):
        if candidate and candidate in visible_text:
            return candidate[:1200]
    tokens = _company_core_tokens(hint)
    if not tokens or not visible_text:
        return ""
    needle = next(iter(sorted(tokens, key=len, reverse=True)))
    idx = visible_text.casefold().find(needle.casefold())
    if idx < 0:
        return ""
    start = max(0, idx - 180)
    return visible_text[start : start + 900].strip()


def _append_semantic_deferred_news_record(
    *,
    records: List[Mapping[str, Any]],
    request: AdapterDiscoveryRequest,
    company_hint: str,
    visible_text: str,
    title: str,
    snippet: str,
    html: str,
    final_url: str,
    page_host: str,
    fetch_provenance: Mapping[str, Any],
    scope: str,
    state: GenericWebDiscoveryState,
    provider_query: str,
    search_provider: str,
    item: Any,
) -> bool:
    published = _infer_page_date(
        html=html,
        text=visible_text,
        url=final_url,
        title=title,
        snippet=snippet,
    )
    # Semantic authority can recover event_date from page text; case-study HTML
    # often omits machine-readable dates (Q2 Erba Vita / vendor portfolios).
    if not visible_text:
        return False
    if not published and request.technical_filters.get("semantic_authority_required") is not True:
        return False
    # Stale pages must not become deferred semantic candidates — they burn the
    # grounding budget and never qualify under freshness_max_age_days.
    if published and not _published_date_is_fresh(published, request):
        return False
    excerpt = _literal_excerpt_for_hint(company_hint, visible_text, title, snippet)
    if not excerpt:
        return False
    publisher = str(item.get("publisher") or title or page_host) if isinstance(item, Mapping) else (title or page_host)
    # News pages contain unrelated navigation and recommended-article locations.
    # Bind geography to the candidate-bearing title/snippet/excerpt only.
    source_geography = _explicit_requested_geography(request, title, snippet, excerpt)
    row: Dict[str, Any] = {
        "company_name": company_hint,
        "official_domain": _candidate_official_domain(
            page_host=page_host,
            source_class="recognized_news",
            semantic_required=request.technical_filters.get("semantic_authority_required") is True,
        ),
        "official_domain_verified": False,
        "entity_class": "operating_company",
        "matched_signal_ids": list(request.signal_ids),
        "published_at": published or "",
        **source_geography,
        "source_url": final_url,
        "source_publisher": publisher,
        "source_class": "recognized_news",
        "evidence_excerpt": excerpt,
        "extraction_method": "semantic_deferred_news_candidate",
        "source_text": visible_text[:250_000],
        "page_title": title,
        "search_snippet": snippet,
        "query_origin": request.technical_filters.get("query_origin") or request.query,
        "parent_query": request.technical_filters.get("parent_query") or request.query,
        "discovery_round": int(request.technical_filters.get("discovery_round") or 1),
        "provider_query": provider_query,
        "search_provider": search_provider,
    }
    attach_generic_provenance(
        row,
        adapter_id="generic_web_research_v1",
        search_scope=scope,
        execution_round=int(request.technical_filters.get("discovery_round") or state.provider_calls or 1),
        provider_call_id=f"serp:{scope}:{state.provider_calls}",
        page_fetch_id_value=page_fetch_id(
            search_scope=scope,
            url=str(fetch_provenance["final_url"]),
            wave_index=state.pages_fetched,
        ),
        source_text=visible_text,
        cursor_version=request.cursor.value if request.cursor else "generic-web:v2",
    )
    row = _apply_free_identity(row, request)
    row = _enrich_record_from_page(row, html=html or "", text=visible_text)
    row = _maybe_enrich_from_official_domain(row)
    records.append(row)
    _remember_candidate_source_url(state, final_url)
    return True


def _company_identity_hint(*, title: str, snippet: str, html: str) -> str:
    """Return only an identity explicitly present in acquired evidence."""
    visible = _text(BeautifulSoup(html or "", "html.parser").get_text(" ", strip=True)) or ""
    if _is_challenge_or_empty_page(status_code=200, title=title, visible_text=visible, html=html):
        # Challenge/empty HTML must not invent identities; SERP fields remain usable.
        return _serp_company_hint(title=title, snippet=snippet)
    serp_text = f"{title} {snippet}".casefold()
    # Prefer explicit startup-name patterns over topical title prefixes
    # ("Digital biotech, la startup italiana GenomeUp …").
    for text in (snippet, title, f"{title} {snippet}"):
        snippet_hint = _snippet_company_hint(text)
        if snippet_hint and snippet_hint.casefold() in serp_text and _looks_like_company_name(snippet_hint):
            return snippet_hint
    leading = _title_company_leading(title)
    if leading and leading.casefold() in serp_text and _looks_like_company_name(leading):
        return leading
    combined = f"{title} {snippet} {visible[:100_000]}"
    legal = _LEGAL_ENTITY_RE.search(combined)
    if legal:
        legal_name = legal.group(1).strip()
        if legal_name and _company_core_tokens(legal_name) & _company_core_tokens(f"{title} {snippet}"):
            return legal_name
    structured = _structured_subject_company(html)
    if structured and _company_core_tokens(structured) & _company_core_tokens(f"{title} {snippet}"):
        return structured
    return ""


async def _default_generic_provider(request: AdapterDiscoveryRequest, offset: int, limit: int) -> GenericWebProviderResult:
    import asyncio
    import httpx
    from backend_mirror.agents.search_serp import search_hits_http, search_urls_http
    from .universal_evidence import extract_evidence_from_text

    queries = diversified_queries(request)
    state = load_generic_web_state(request.cursor, request.technical_filters)
    # Round budgets may already exclude a semantic reserve. Discovery soft/hard
    # accounting must use the true search hard cap, otherwise reserved_floor
    # zeros SERP and the wave returns empty (pages=0, cost=0).
    try:
        true_hard_cap = float(request.technical_filters.get("hard_cost_eur") or request.budget_eur)
    except (TypeError, ValueError):
        true_hard_cap = float(request.budget_eur)
    hard_cap = true_hard_cap
    batch_budget = float(request.budget_eur)
    # Per-strategy cursors reset discovery_spent_eur. Carry engine-wide SERP burn
    # so industrial_1/2 cannot re-soft-cap against the same €0.10 envelope
    # (antincendio 45acce51: 15 SERPs, pending TEXA/Mancinardi never fetched).
    try:
        prior_serp = float((request.technical_filters or {}).get("cumulative_serp_eur") or 0.0)
    except (TypeError, ValueError):
        prior_serp = 0.0
    if prior_serp > float(state.discovery_spent_eur):
        state.discovery_spent_eur = round(prior_serp, 6)
    # discovery_spent_eur is cumulative SERP spend for this search. Subtract it
    # from the hard discovery pool — not from the residual batch envelope alone,
    # or resume with followups strands when prior SERP already exceeds batch_budget.
    discovery_left = float(state.discovery_remaining_eur(hard_cap))
    remaining_for_query = max(0.0, min(batch_budget, discovery_left))
    max_queries = min(len(queries) + len(state.followup_queries), math.floor((remaining_for_query + 1e-9) / QUERY_COST_EUR))
    # Follow-up recoveries only need SERP + governor room; don't drop them when
    # soft-cap math is tight but batch_budget still covers one query.
    if (
        max_queries < 1
        and state.followup_queries
        and batch_budget + 1e-9 >= QUERY_COST_EUR
    ):
        max_queries = 1
    plan_search_cap = request.technical_filters.get("maximum_search_calls")
    try:
        if plan_search_cap is not None:
            max_queries = min(max_queries, max(1, int(plan_search_cap)))
    except (TypeError, ValueError):
        pass
    scope = hashlib.sha256(f"{request.query}|{request.signal_ids}|{request.geographies}".encode()).hexdigest()[:20]
    target = min(100, max(limit, URLS_PER_WAVE))
    universal = bool((request.technical_filters or {}).get("universal_engine"))
    spy_search = (request.technical_filters or {}).get("universal_serp_search")
    spent = 0.0
    accepted_hits: List[Any] = []
    seen: set[str] = set()
    provider_warnings: List[str] = []
    raw_meta = {
        str(item.get("url") or "").lower().rstrip("/"): dict(item)
        for item in state.url_meta
        if isinstance(item, Mapping) and item.get("url")
    }
    terminal = {str(item).strip().lower().rstrip("/") for item in state.processed_terminal_urls}
    for url in state.pending_urls:
        key = str(url).strip().lower().rstrip("/")
        if key and key not in terminal and key not in seen:
            seen.add(key)
            accepted_hits.append(raw_meta.get(key) or {"url": url, "title": "", "snippet": "", "source_type": "search", "provider": "resume"})
    # Resume must re-queue SERP hits persisted in url_meta even when pending_urls was empty.
    for meta in state.url_meta:
        if not isinstance(meta, Mapping):
            continue
        url = str(meta.get("url") or "")
        key = url.strip().lower().rstrip("/")
        if key and key not in terminal and key not in seen:
            seen.add(key)
            accepted_hits.append(dict(meta))
    # Time-limit salvage: pages that already emitted candidates were marked
    # terminal before orchestrator finished semantic. Re-open them unless the
    # company domain is already in processed_employer_keys.
    if (
        universal
        and request.technical_filters.get("semantic_authority_required") is True
        and not accepted_hits
        and state.candidate_source_urls
    ):
        processed_domains = {
            str(item).split("domain:", 1)[-1].casefold().removeprefix("www.")
            for item in (request.technical_filters.get("processed_employer_keys") or ())
            if str(item).startswith("domain:")
        }
        already_salvaged = {_url_key(item) for item in state.salvaged_urls}
        salvage_keys: List[str] = []
        for url in state.candidate_source_urls:
            key = str(url).strip().lower().rstrip("/")
            if not key or key in seen or key in already_salvaged:
                continue
            meta = raw_meta.get(key) or {"url": url, "title": "", "snippet": "", "source_type": "search", "provider": "resume"}
            hint = _serp_company_hint(
                title=str(meta.get("title") or ""),
                snippet=str(meta.get("snippet") or ""),
                url=str(meta.get("url") or url),
            )
            compact = re.sub(r"[^a-z0-9]", "", (hint or "").casefold())
            if compact and any(compact in domain.replace(".", "") or domain.replace(".", "") in compact for domain in processed_domains):
                continue
            seen.add(key)
            salvage_keys.append(key)
            accepted_hits.append(dict(meta))
            if len(salvage_keys) >= max(2, min(limit, URLS_PER_WAVE)):
                break
        if salvage_keys:
            salvage_set = set(salvage_keys)
            state.salvaged_urls = tuple(dict.fromkeys((*state.salvaged_urls, *salvage_keys)))
            state.processed_terminal_urls = tuple(
                item for item in state.processed_terminal_urls
                if str(item).strip().lower().rstrip("/") not in salvage_set
            )
            terminal = {str(item).strip().lower().rstrip("/") for item in state.processed_terminal_urls}
    pending_queries = list(state.followup_queries) + list(queries[state.query_index:])
    # Deduplicate while preserving follow-up priority.
    seen_q: set[str] = set()
    deduped_queries: List[str] = []
    for query in pending_queries:
        key = str(query or "").strip().casefold()
        if not key or key in seen_q or key in {str(item).casefold() for item in state.executed_query_keys}:
            continue
        seen_q.add(key)
        deduped_queries.append(str(query))
    pending_queries = deduped_queries
    from cost_context import current_cost_governor
    governor = current_cost_governor()
    remaining_governor = float(getattr(governor, "remaining_eur", 0.0) or 0.0) if governor is not None else float("inf")
    if not accepted_hits and max_queries > 0:
        if universal and not state.can_reserve_serp(
            hard_cap_eur=hard_cap,
            spent_eur=(
                float(getattr(governor, "committed_micro_eur", 0) or 0) / 1_000_000
                if governor is not None
                else spent
            ),
            governor_remaining=remaining_governor,
        ):
            return GenericWebProviderResult((), 0.0, ("DISCOVERY_BUDGET_RESERVED",))
    queries_run = 0
    if not accepted_hits:
        for index, query in enumerate(pending_queries[:max_queries]):
            if queries_run > 0:
                break
            if spent + QUERY_COST_EUR > batch_budget + 1e-9:
                break
            if spent + QUERY_COST_EUR > request.budget_eur + 1e-9:
                break
            if callable(spy_search):
                found_hits = await asyncio.to_thread(spy_search, query, target)
                spent += QUERY_COST_EUR
                if found_hits and isinstance(found_hits[0], str):
                    found_hits = _hits_from_urls(found_hits, query=query)
            else:
                if universal:
                    found_hits = await asyncio.to_thread(
                        search_hits_http, query, target, cost_scope=f"generic-web:{scope}:{index}",
                    )
                else:
                    found_urls = await asyncio.to_thread(
                        search_urls_http, query, target, cost_scope=f"generic-web:{scope}:{index}",
                    )
                    found_hits = _hits_from_urls(found_urls, query=query)
                spent += QUERY_COST_EUR
            queries_run += 1
            if query in state.followup_queries:
                state.followup_queries = tuple(item for item in state.followup_queries if item != query)
            else:
                state.query_index += 1
            state.executed_query_keys = tuple(dict.fromkeys((*state.executed_query_keys, query)))
            state.provider_calls += 1
            state.discovery_spent_eur = round(float(state.discovery_spent_eur) + QUERY_COST_EUR, 6)
            if universal:
                gated = _gate_serp_hits(request, found_hits, provider_query=query)
                rich_by_url = {
                    str(item.get("url") or item.get("link") or "").lower().rstrip("/"): item
                    for item in found_hits
                    if isinstance(item, Mapping)
                }
                for hit in gated:
                    key = hit.url.lower().rstrip("/")
                    if key in terminal:
                        continue
                    if key not in seen:
                        seen.add(key)
                        original = rich_by_url.get(key) or {}
                        accepted_hits.append({
                            "url": hit.url,
                            "title": hit.title,
                            "snippet": hit.snippet,
                            "publisher": hit.publisher,
                            "source_type": str(original.get("source_type") or "search"),
                            "provider": str(original.get("provider") or "unknown"),
                            "rank": int(original.get("rank") or 0),
                            "provider_query": query,
                        })
            else:
                for item in found_hits:
                    url = str(item.get("url") or "")
                    key = url.lower().rstrip("/")
                    if url and key not in seen:
                        seen.add(key)
                        accepted_hits.append(item)
            if accepted_hits:
                break

    records: List[Mapping[str, Any]] = []
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    pages_opened = 0
    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True, headers=headers) as client:
        page_fetch = (request.technical_filters or {}).get("universal_page_fetch")
        next_pending_urls: List[str] = []
        next_url_meta: Dict[str, Dict[str, Any]] = dict(raw_meta)
        # Page fetches are free. After a paid SERP (or on pending-only resume),
        # drain more hits in-wave — URLS_PER_WAVE=5 left PMI URLs stranded when
        # the next orchestrator round could not afford estimated_cost SERP.
        wave_cap = max(3, min(limit, URLS_PER_WAVE))
        if universal:
            wave_cap = max(wave_cap, min(len(accepted_hits), max(limit * 5, 20)))
        wave = sorted(accepted_hits, key=_serp_fetch_priority)[:wave_cap]
        for item in wave:
            url = item.url if hasattr(item, "url") else str(item.get("url") or "")
            title = item.title if hasattr(item, "title") else str(item.get("title") or "")
            snippet = item.snippet if hasattr(item, "snippet") else str(item.get("snippet") or "")
            search_provider = str(item.get("provider") or "unknown") if isinstance(item, Mapping) else "unknown"
            provider_query = str(item.get("provider_query") or request.query) if isinstance(item, Mapping) else request.query
            key = url.lower().rstrip("/")
            if key:
                next_url_meta[key] = {
                    "url": url,
                    "title": title,
                    "snippet": snippet,
                    "provider": search_provider,
                    "source_type": str(item.get("source_type") or "search") if isinstance(item, Mapping) else "search",
                    "rank": int(item.get("rank") or 0) if isinstance(item, Mapping) else 0,
                    "provider_query": provider_query,
                }
            try:
                if callable(page_fetch):
                    html, final_url = await asyncio.to_thread(page_fetch, url)
                    status_code = 200
                else:
                    response = await client.get(url)
                    status_code = int(response.status_code)
                    if status_code != 200 or "html" not in str(response.headers.get("content-type") or "").lower():
                        filters = request.technical_filters if isinstance(request.technical_filters, dict) else {}
                        _record_url_outcome(filters, {
                            "url": url,
                            "query": provider_query,
                            "fetch_attempted": True,
                            "status_code": status_code,
                            "parse_status": "rejected_fetch",
                            "rejection_code": "PAGE_FETCH_FAILED",
                        })
                        # Recover from blocked preferred hosts using SERP identity.
                        if request.technical_filters.get("semantic_authority_required") is True:
                            serp_hint = _serp_company_hint(title=title, snippet=snippet, url=url)
                            if serp_hint:
                                _enqueue_content_shell_followup(
                                    state,
                                    identity_hint=serp_hint,
                                    failed_url=url,
                                    request=request,
                                )
                        state.wave_terminal_rejections += 1
                        state.processed_terminal_urls = (*state.processed_terminal_urls, url)
                        continue
                    html = response.text[:2_000_000]
                    final_url = str(response.url)
                pages_opened += 1
                state.pages_fetched += 1
                state.processed_terminal_urls = (*state.processed_terminal_urls, url)
                visible_text = _text(BeautifulSoup(html or "", "html.parser").get_text(" ", strip=True)) or ""
                semantic_text = _primary_page_text(html or "") or visible_text
                fetch_provenance = {
                    "scope": scope,
                    "final_url": final_url,
                    "source_text": semantic_text,
                }
                if universal:
                    page_host = _host(final_url)
                    if request.technical_filters.get("semantic_authority_required") is True:
                        identity_hint = _company_identity_hint(title=title, snippet=snippet, html=html)
                        shell_host = any(
                            page_host == suffix or page_host.endswith("." + suffix)
                            for suffix in _CONTENT_SHELL_HOST_SUFFIXES
                        )
                        challenge_page = _is_challenge_or_empty_page(
                            status_code=status_code if not callable(page_fetch) else 200,
                            title=title,
                            visible_text=visible_text,
                            html=html,
                        )
                        missing_company = bool(identity_hint) and not company_hint_present_in_source(
                            identity_hint, semantic_text
                        )
                        if identity_hint and (missing_company or shell_host or challenge_page):
                            filters = request.technical_filters if isinstance(request.technical_filters, dict) else {}
                            _record_url_outcome(filters, {
                                "url": url,
                                "query": provider_query,
                                "fetch_attempted": True,
                                "status_code": 200,
                                "parse_status": "rejected_content",
                                "rejection_code": "PAGE_CONTENT_MISSING",
                            })
                            recover_hint = identity_hint if not challenge_page else _serp_company_hint(
                                title=title, snippet=snippet, url=final_url or url
                            )
                            _enqueue_content_shell_followup(
                                state,
                                identity_hint=recover_hint or identity_hint,
                                failed_url=final_url or url,
                                request=request,
                            )
                            state.wave_terminal_rejections += 1
                            continue
                        if challenge_page and not identity_hint:
                            filters = request.technical_filters if isinstance(request.technical_filters, dict) else {}
                            _record_url_outcome(filters, {
                                "url": url,
                                "query": provider_query,
                                "fetch_attempted": True,
                                "status_code": 200,
                                "parse_status": "rejected_content",
                                "rejection_code": "PAGE_CONTENT_MISSING",
                            })
                            recover_hint = _serp_company_hint(title=title, snippet=snippet, url=final_url or url)
                            if recover_hint:
                                _enqueue_content_shell_followup(
                                    state,
                                    identity_hint=recover_hint,
                                    failed_url=final_url or url,
                                    request=request,
                                )
                            state.wave_terminal_rejections += 1
                            continue
                    # Dynamic relationships are acquisition hypotheses only.
                    # Final event type, role and query match are decided by the
                    # semantic interpreter and exact grounding verifier.
                    semantic_contract = request.technical_filters.get("semantic_query_contract")
                    identities: Tuple[Mapping[str, Any], ...] = ()
                    if isinstance(semantic_contract, Mapping):
                        identities = _structured_subject_identities(html, page_host=page_host)
                    if identities:
                        published = _infer_page_date(
                            html=html,
                            text=str(fetch_provenance.get("source_text") or ""),
                            url=final_url,
                            title=title,
                            snippet=snippet,
                        )
                        if published and not _published_date_is_fresh(published, request):
                            filters = request.technical_filters if isinstance(request.technical_filters, dict) else {}
                            _record_url_outcome(filters, {
                                "url": url,
                                "query": provider_query,
                                "fetch_attempted": True,
                                "status_code": 200,
                                "parse_status": "rejected_content",
                                "rejection_code": "SIGNAL_STALE",
                            })
                            _enqueue_same_host_expansion_articles(
                                state,
                                html=html or "",
                                page_url=final_url or url,
                                title=title,
                                snippet=snippet,
                            )
                            stale_hint = _serp_company_hint(title=title, snippet=snippet, url=final_url or url)
                            if stale_hint:
                                _enqueue_content_shell_followup(
                                    state,
                                    identity_hint=stale_hint,
                                    failed_url=final_url or url,
                                    request=request,
                                )
                            state.wave_terminal_rejections += 1
                            continue
                        visible_text = fetch_provenance["source_text"]
                        structured_before = len(records)
                        if visible_text and (
                            published
                            or request.technical_filters.get("semantic_authority_required") is True
                        ):
                            for identity in identities:
                                company = str(identity.get("name") or "")
                                if not _looks_like_company_name(company):
                                    continue
                                domain = str(identity.get("domain") or "")
                                excerpt = title.strip() if title.strip() and title.strip() in visible_text else visible_text[:1200]
                                source_geography = _explicit_requested_geography(request, title, snippet, excerpt)
                                row = {
                                    "company_name": company,
                                    "official_domain": domain,
                                    "organization_url": identity.get("url"),
                                    "official_domain_verified": False,
                                    "entity_class": "operating_company",
                                    "matched_signal_ids": list(request.signal_ids),
                                    "published_at": published or "",
                                    **source_geography,
                                    "source_url": final_url,
                                    "source_publisher": str(item.get("publisher") or title or page_host) if isinstance(item, Mapping) else (title or page_host),
                                    "source_class": "official_company_website" if domain == page_host else "recognized_news",
                                    "evidence_excerpt": excerpt,
                                    "extraction_method": "structured_identity_semantic_candidate",
                                    "source_text": visible_text[:250_000],
                                    "page_title": title,
                                    "search_snippet": snippet,
                                    "structured_metadata": {"target_organization": dict(identity)},
                                    "query_origin": request.technical_filters.get("query_origin") or request.query,
                                    "parent_query": request.technical_filters.get("parent_query") or request.query,
                                    "discovery_round": int(request.technical_filters.get("discovery_round") or 1),
                                    "provider_query": provider_query,
                                    "search_provider": search_provider,
                                }
                                attach_generic_provenance(
                                    row,
                                    adapter_id="generic_web_research_v1",
                                    search_scope=scope,
                                    execution_round=int(request.technical_filters.get("discovery_round") or state.provider_calls or 1),
                                    provider_call_id=f"serp:{scope}:{state.provider_calls}",
                                    page_fetch_id_value=page_fetch_id(
                                        search_scope=scope,
                                        url=str(fetch_provenance["final_url"]),
                                        wave_index=state.pages_fetched,
                                    ),
                                    source_text=visible_text,
                                    cursor_version=request.cursor.value if request.cursor else "generic-web:v2",
                                )
                                row = _apply_free_identity(row, request)
                                row = _enrich_record_from_page(row, html=html or "", text=visible_text)
                                row = _maybe_enrich_from_official_domain(row)
                                records.append(row)
                                _remember_candidate_source_url(state, str(fetch_provenance.get("final_url") or final_url or url))
                            if len(records) > structured_before:
                                continue
                        provider_warnings.append("SEMANTIC_SOURCE_PROVENANCE_INCOMPLETE")
                    # Open-world pages often lack JSON-LD about/mentions. Keep the
                    # page as source_text via universal evidence extraction so
                    # SemanticCommercialEventInterpreter can still run.
                    company_hint = _company_identity_hint(title=title, snippet=snippet, html=html)
                    if not company_hint:
                        provider_warnings.append("COMPANY_IDENTITY_UNRESOLVED")
                        state.wave_terminal_rejections += 1
                        continue
                    page_published = _infer_page_date(
                        html=html,
                        text=semantic_text,
                        url=final_url,
                        title=title,
                        snippet=snippet,
                    )
                    if page_published and not _published_date_is_fresh(page_published, request):
                        filters = request.technical_filters if isinstance(request.technical_filters, dict) else {}
                        _record_url_outcome(filters, {
                            "url": url,
                            "query": provider_query,
                            "fetch_attempted": True,
                            "status_code": 200,
                            "parse_status": "rejected_content",
                            "rejection_code": "SIGNAL_STALE",
                        })
                        _enqueue_same_host_expansion_articles(
                            state,
                            html=html or "",
                            page_url=final_url or url,
                            title=title,
                            snippet=snippet,
                        )
                        if company_hint:
                            _enqueue_content_shell_followup(
                                state,
                                identity_hint=company_hint,
                                failed_url=final_url or url,
                                request=request,
                            )
                        state.wave_terminal_rejections += 1
                        continue
                    # News hubs: pull concrete article URLs before spending semantic budget
                    # on the index page itself.
                    _enqueue_same_host_expansion_articles(
                        state,
                        html=html or "",
                        page_url=final_url or url,
                        title=title,
                        snippet=snippet,
                    )
                    page_records_before = len(records)
                    events = extract_evidence_from_text(
                        text=semantic_text,
                        source_url=final_url,
                        source_class="recognized_news",
                        publisher=title or _host(final_url),
                        company_name_hint=company_hint,
                        page_date=page_published,
                        requested_signals=request.signal_ids,
                    )
                    if not events and snippet and request.technical_filters.get("semantic_authority_required") is not True:
                        events = extract_evidence_from_text(
                            text=f"{title}. {snippet}",
                            source_url=final_url,
                            source_class="recognized_news",
                            publisher=title or _host(final_url),
                            company_name_hint=company_hint,
                            page_date=page_published,
                            requested_signals=request.signal_ids,
                        )
                    # Never invent publisher host as the target company domain.
                    for event in events:
                        if not event.company_name or not event.evidence_excerpt or not event.event_date:
                            continue
                        domain = _candidate_official_domain(
                            page_host=_host(final_url) or "",
                            source_class="recognized_news",
                            semantic_required=request.technical_filters.get("semantic_authority_required") is True,
                        ) or (event.official_domain_candidate or "")
                        matched_ids = []
                        if event.event_type and event.event_type in request.signal_ids:
                            matched_ids = [event.event_type]
                        else:
                            related = {
                                "active_advertising": {"investing_marketing", "active_advertising", "rebranding"},
                                "funding": {"funding", "financing", "capital_investment"},
                                "technology_adoption": {"technology_adoption", "technology_migration"},
                                "regulatory_change": {"regulatory_change", "compliance_gap", "certification"},
                                "leadership_change": {"leadership_change"},
                                "production_expansion": {
                                    "production_expansion", "new_location", "geographic_expansion", "expansion",
                                },
                                "new_location": {
                                    "new_location", "production_expansion", "geographic_expansion", "expansion",
                                },
                                "geographic_expansion": {
                                    "geographic_expansion", "production_expansion", "new_location", "expansion",
                                },
                            }
                            for req in request.signal_ids:
                                family = related.get(event.event_type or "", set()) | {event.event_type or ""}
                                if req in family or event.event_type == req:
                                    matched_ids.append(req)
                        if not matched_ids and isinstance(semantic_contract, Mapping):
                            matched_ids = list(request.signal_ids)
                        if not matched_ids:
                            continue
                        source_geography = _explicit_requested_geography(
                            request, title, snippet, event.evidence_excerpt
                        )
                        row = {
                            "company_name": event.company_name,
                            "official_domain": domain,
                            "official_domain_verified": False,
                            "entity_class": "operating_company",
                            "matched_signal_ids": matched_ids,
                            "published_at": event.event_date,
                            **source_geography,
                            "source_url": event.source_url,
                            "source_publisher": event.publisher,
                            "source_class": event.source_class,
                            "evidence_excerpt": event.evidence_excerpt,
                            "extraction_method": "universal_evidence",
                            "source_text": semantic_text[:250_000],
                            "why_now": event.evidence_excerpt[:260],
                            "buyer_fit": 0.75,
                            "query_origin": request.technical_filters.get("query_origin") or request.query,
                            "parent_query": request.technical_filters.get("parent_query") or request.query,
                            "discovery_round": int(request.technical_filters.get("discovery_round") or 1),
                            "provider_query": provider_query,
                            "search_provider": search_provider,
                        }
                        attach_generic_provenance(
                            row,
                            adapter_id="generic_web_research_v1",
                            search_scope=scope,
                            execution_round=int(request.technical_filters.get("discovery_round") or state.provider_calls or 1),
                            provider_call_id=f"serp:{scope}:{state.provider_calls}",
                            page_fetch_id_value=page_fetch_id(
                                search_scope=scope,
                                url=str(fetch_provenance["final_url"]),
                                wave_index=state.pages_fetched,
                            ),
                            source_text=semantic_text,
                            cursor_version=request.cursor.value if request.cursor else "generic-web:v2",
                        )
                        row = _apply_free_identity(row, request)
                        row = _enrich_record_from_page(row, html=html or "", text=visible_text)
                        row = _maybe_enrich_from_official_domain(row)
                        records.append(row)
                        _remember_candidate_source_url(state, str(fetch_provenance.get("final_url") or final_url or url))
                    if (
                        len(records) == page_records_before
                        and request.technical_filters.get("semantic_authority_required") is True
                    ):
                        if not _append_semantic_deferred_news_record(
                            records=records,
                            request=request,
                            company_hint=company_hint,
                            visible_text=semantic_text,
                            title=title,
                            snippet=snippet,
                            html=html,
                            final_url=final_url,
                            page_host=page_host or "",
                            fetch_provenance=fetch_provenance,
                            scope=scope,
                            state=state,
                            provider_query=provider_query,
                            search_provider=search_provider,
                            item=item,
                        ):
                            # Page had a company hint but yielded no candidate —
                            # queue at most one targeted recovery SERP for that company.
                            if (
                                company_hint
                                and len(state.followup_queries) < 2
                                and re.search(
                                    r"\b(chiude un round|ha raccolto|seed round|pre-seed|raccoglie|"
                                    r"nuovo stabilimento|ampliamento(?:\s+dello\s+stabilimento|\s+produttivo)?|"
                                    r"inaugur\w*|nuova unit[aà] produttiva|capacit[aà]\s+produttiva)\b",
                                    f"{title} {snippet}",
                                    re.I,
                                )
                            ):
                                _enqueue_content_shell_followup(
                                    state,
                                    identity_hint=company_hint,
                                    failed_url=final_url or url,
                                    request=request,
                                )
                            state.wave_terminal_rejections += 1
                else:
                    records.extend(parse_primary_evidence_page(html, final_url, request))
                filters = request.technical_filters if isinstance(request.technical_filters, dict) else {}
                _record_url_outcome(filters, {
                    "url": url,
                    "query": provider_query,
                    "fetch_attempted": True,
                    "status_code": 200,
                    "final_url": final_url,
                    "source_text_chars": len(visible_text),
                    "parse_status": "parsed",
                })
            except Exception as exc:
                filters = request.technical_filters if isinstance(request.technical_filters, dict) else {}
                _record_url_outcome(filters, {
                    "url": url,
                    "query": provider_query,
                    "fetch_attempted": True,
                    "parse_status": "rejected_fetch",
                    "rejection_code": "PAGE_FETCH_FAILED",
                    "error": type(exc).__name__,
                })
                provider_warnings.append(f"PAGE_FETCH_FAILED:{type(exc).__name__}")
                state.wave_terminal_rejections += 1
                state.processed_terminal_urls = (*state.processed_terminal_urls, url)
                continue
        terminal_end = {str(item).strip().lower().rstrip("/") for item in state.processed_terminal_urls}
        for item in accepted_hits:
            url = item.url if hasattr(item, "url") else str(item.get("url") or "")
            key = url.lower().rstrip("/")
            if url and key not in terminal_end:
                next_pending_urls.append(url)
        # Preserve article URLs queued from news-index HTML mid-wave.
        for url in state.pending_urls:
            key = str(url).strip().lower().rstrip("/")
            if url and key and key not in terminal_end:
                next_pending_urls.append(url)
        state.pending_urls = tuple(dict.fromkeys(next_pending_urls))
        for meta in state.url_meta:
            if not isinstance(meta, Mapping) or not meta.get("url"):
                continue
            meta_key = str(meta.get("url") or "").strip().lower().rstrip("/")
            if meta_key and meta_key not in next_url_meta:
                next_url_meta[meta_key] = dict(meta)
        state.url_meta = tuple(next_url_meta.values())
        persist_generic_web_state(request.technical_filters, state)
    if universal:
        _record_prefilter(request, raw=0, accepted=0, rejected=0, codes={}, pages=pages_opened)
    return GenericWebProviderResult(tuple(records), spent, tuple(provider_warnings))


def _cursor_offset(cursor: Optional[DiscoveryCursor]) -> int:
    if not cursor:
        return 0
    if cursor.value.startswith("generic-web:v2:"):
        payload = decode_generic_web_v2_payload(cursor.value)
        if isinstance(payload, Mapping):
            try:
                return max(0, int(payload.get("legacy_offset") or 0))
            except (TypeError, ValueError):
                return 0
        return 0
    match = re.fullmatch(r"generic-web:v1:(\d+)", cursor.value)
    if not match:
        raise ValueError("invalid generic web cursor")
    return int(match.group(1))


def _requires_sme(request: AdapterDiscoveryRequest) -> bool:
    return bool(re.search(r"\b(?:pmi|piccol[ae]|medi[ae]|microimprese?|sme)\b", request.query, re.I))


def _valid_record(record: Mapping[str, Any], request: AdapterDiscoveryRequest, today: date) -> Tuple[bool, str]:
    company = _text(record.get("company_name"))
    domain = _host(record.get("official_domain"))
    universal = bool((request.technical_filters or {}).get("universal_engine"))
    semantic_required = request.technical_filters.get("semantic_authority_required") is True
    source_class = _text(record.get("source_class")) or ""
    if not company or not _looks_like_company_name(company):
        return False, "COMPANY_MISSING"
    if semantic_required and source_class == "recognized_news":
        if domain and is_blacklisted_domain(domain):
            return False, "OFFICIAL_DOMAIN_UNRESOLVED"
    elif not domain or is_blacklisted_domain(domain):
        return False, "OFFICIAL_DOMAIN_UNRESOLVED"
    if universal:
        ok_prov, prov_code = generic_record_has_fetch_provenance(record)
        if not ok_prov:
            return False, prov_code
    if record.get("official_domain_verified") is not True:
        if not semantic_required:
            return False, "OFFICIAL_DOMAIN_UNVERIFIED"
        if not domain and source_class != "recognized_news":
            return False, "OFFICIAL_DOMAIN_UNRESOLVED"
    if (_text(record.get("entity_class")) or "") != "operating_company":
        return False, "NON_OPERATING_ENTITY"
    if universal:
        if source_class not in {"official_company_website", "recognized_news", "industry_publication", "corporate_newsroom"}:
            return False, "NON_PRIMARY_SOURCE"
    elif source_class != "official_company_website":
        return False, "NON_PRIMARY_SOURCE"
    if not all((_text(record.get("source_url")), _text(record.get("source_publisher")), _text(record.get("evidence_excerpt")))):
        return False, "SOURCE_PROVENANCE_MISSING"
    if universal and not semantic_required and not _text(record.get("why_now")):
        return False, "WHY_NOW_MISSING"
    if universal and not semantic_required and record.get("buyer_fit") is None:
        return False, "BUYER_FIT_MISSING"
    published = _iso_date(record.get("published_at"))
    if not published:
        # Semantic path grounds event_date from source text; vendor case studies
        # frequently lack article:published_time (still valid commercial evidence).
        if not (universal and semantic_required):
            return False, "SIGNAL_DATE_MISSING"
    else:
        age = (today - date.fromisoformat(published)).days
        if age < 0 or (request.freshness_max_age_days is not None and age > request.freshness_max_age_days):
            return False, "SIGNAL_STALE"
    matched_raw = record.get("matched_signal_ids")
    matched = {str(item).strip() for item in matched_raw} if isinstance(matched_raw, (list, tuple, set)) else set()
    required = set(request.signal_ids)
    if request.signal_match_mode == "all" and not required.issubset(matched):
        return False, "ALL_SIGNALS_INCOMPLETE"
    if request.signal_match_mode == "any" and not required.intersection(matched):
        return False, "NO_REQUESTED_SIGNAL_EVIDENCE"
    excerpt = _text(record.get("evidence_excerpt")) or ""
    if not universal:
        verified = _matched_signals(excerpt, request)
        if not set(verified).issuperset(matched.intersection(required)):
            return False, "EVIDENCE_PATTERN_UNPROVEN"
    requested_geo = [
        _normalized_geography_text(item)
        for item in request.geographies
        if _normalized_geography_text(item) not in _ITALY_COUNTRY_GEOGRAPHIES
    ]
    geography = _normalized_geography_text(record.get("geography"))
    if requested_geo and not geography:
        return False, "GEOGRAPHY_EVIDENCE_MISSING"
    if requested_geo:
        requested_norms = set(requested_geo)
        source_region = _ITALY_LOCALITY_TO_REGION.get(geography)
        geography_region = _normalized_geography_text(source_region or geography)
        requested_macros = {
            _ITALY_MACRO_ALIASES[norm] for norm in requested_norms if norm in _ITALY_MACRO_ALIASES
        }
        geography_macro = _ITALY_REGION_TO_MACRO.get(source_region or next(
            (region for region in _ITALY_REGION_TO_MACRO if _normalized_geography_text(region) == geography_region),
            "",
        ))
        if not (
            geography in requested_norms
            or geography_region in requested_norms
            or (geography_macro and geography_macro in requested_macros)
        ):
            return False, "GEOGRAPHY_MISMATCH"
    if _requires_sme(request):
        size = (_text(record.get("company_size")) or "").casefold()
        try:
            employees = int(record.get("employee_count")) if record.get("employee_count") is not None else None
        except (TypeError, ValueError):
            employees = None
        if size in {"enterprise", "large"} or (employees is not None and employees > 249):
            return False, "ENTERPRISE_OUT_OF_TARGET"
        # Open-world semantic path: market-scope acceptance verifies PMI later.
        # Rejecting unknown size here zeroed discovery on every "PMI …" query
        # (news pages rarely expose employee counts in acquisition HTML).
        if (
            size not in {"micro", "small", "medium", "pmi", "sme"}
            and employees is None
            and not semantic_required
        ):
            return False, "SME_STATUS_UNVERIFIED"
    return True, ""


class GenericWebResearchAdapter:
    CAPABILITY = SourceCapability(
        adapter_id="generic_web_research_v1", adapter_version="1.0.0",
        supported_intents=("*",), supported_signals=("*",),
        source_classes=("search_snippet", "official_company_website"), geographic_coverage=("global",),
        freshness_max_age_days=None, discovery_mode="generic_fallback", supports_pagination=True,
        supports_cursor_resume=True, max_results_per_page=100, max_results_per_run=None,
        estimated_cost_eur_per_operation=QUERY_COST_EUR,
        authentication_requirements=("search_provider_with_cost_governor",), rate_limit_per_minute=20,
        provenance_guarantees=("query_origin", "parent_query", "discovery_round", "source_url", "publisher"),
        evidence_guarantees=("explicit_signal_phrase", "published_at", "official_company_identity"),
        exhaustion_semantics="best_effort", coverage_status="generic_fallback_partial",
    )

    def __init__(self, providers: Sequence[GenericWebProvider] = (_default_generic_provider,)) -> None:
        if not providers:
            raise ValueError("at least one generic web provider is required")
        self._providers = tuple(providers)

    @property
    def capability(self) -> SourceCapability:
        return self.CAPABILITY

    async def discover(self, request: AdapterDiscoveryRequest) -> AdapterExecutionResult:
        offset = _cursor_offset(request.cursor)
        page_size = min(100, max(request.requested_count * 4, 20))
        started = datetime.now(timezone.utc).isoformat()
        results: List[GenericWebProviderResult] = []
        spent = 0.0
        for provider in self._providers:
            remaining = max(0.0, request.budget_eur - spent)
            bounded = AdapterDiscoveryRequest(
                intent=request.intent, signal_ids=request.signal_ids, signal_match_mode=request.signal_match_mode,
                geographies=request.geographies, freshness_max_age_days=request.freshness_max_age_days,
                requested_count=request.requested_count, budget_eur=remaining, query=request.query,
                sectors=request.sectors, technical_filters=request.technical_filters, cursor=request.cursor,
            )
            result = await provider(bounded, offset, page_size)
            if result.cost_eur > remaining + 1e-9:
                raise RuntimeError("GENERIC_WEB_PROVIDER_EXCEEDED_HARD_COST_CAP")
            results.append(result)
            spent += result.cost_eur
        observed = datetime.now(timezone.utc).isoformat()
        state = load_generic_web_state(request.cursor, request.technical_filters)
        next_legacy_offset = max(offset + page_size, int(state.legacy_offset or 0))
        state.legacy_offset = next_legacy_offset
        persist_generic_web_state(request.technical_filters, state)
        warnings = [warning for result in results for warning in result.warnings]
        candidates: List[OpportunityCandidate] = []
        seen: set[str] = set()
        universal = bool((request.technical_filters or {}).get("universal_engine"))
        semantic_required = request.technical_filters.get("semantic_authority_required") is True
        for result in results:
            for record in result.records:
                domain = _host(record.get("official_domain"))
                company = _text(record.get("company_name")) or ""
                source_url = _text(record.get("source_url")) or ""
                valid, rejection = _valid_record(record, request, date.today())
                if not valid:
                    warnings.append(rejection)
                    continue
                source_class = _text(record.get("source_class")) or "official_company_website"
                dedupe_key = (
                    f"company:{company.casefold()}"
                    if semantic_required and source_class == "recognized_news"
                    else (domain or f"company:{company.casefold()}")
                )
                if dedupe_key in seen:
                    warnings.append("DUPLICATE_COMPANY")
                    continue
                seen.add(dedupe_key)
                matched = tuple(str(item) for item in record.get("matched_signal_ids") or () if str(item) in request.signal_ids)
                if not matched:
                    warnings.append("NO_REQUESTED_SIGNAL_EVIDENCE")
                    continue
                published = _iso_date(record.get("published_at"))
                source_url = _text(record.get("source_url")) or ""
                publisher = _text(record.get("source_publisher")) or ""
                excerpt = _text(record.get("evidence_excerpt")) or ""
                source_class = _text(record.get("source_class")) or "official_company_website"
                why_now = _text(record.get("why_now")) or ""
                if len(why_now) < 20 and excerpt:
                    prefix = why_now or "Evidenza primaria recente"
                    why_now = f"{prefix}: {excerpt[:240]}".strip()
                if semantic_required:
                    buyer_fit = None
                else:
                    why_now = why_now or f"Evidenza primaria recente: {excerpt[:260]}"
                    try:
                        buyer_fit = float(record.get("buyer_fit") if record.get("buyer_fit") is not None else 0.75)
                    except (TypeError, ValueError):
                        buyer_fit = 0.75
                if isinstance(record.get("domain_verification"), Mapping):
                    domain_verification = record.get("domain_verification")
                elif domain:
                    domain_verification = {
                        "status": "verified", "confidence": 0.80, "score": 80,
                        "evidence": ("schema_org_identity_match", "official_page_host_match"),
                        "resolution_source": "source_adapter",
                        "resolution_method": "verified_source_adapter",
                        "adapter_id": self.capability.adapter_id,
                        "url": f"https://{domain}/",
                    }
                else:
                    domain_verification = {
                        "status": "deferred",
                        "confidence": 0.0,
                        "score": 0,
                        "evidence": ("post_semantic_identity_required",),
                        "resolution_source": "deferred",
                        "resolution_method": "news_source_without_target_domain",
                        "adapter_id": self.capability.adapter_id,
                        "url": "",
                    }
                evidence = tuple(EvidenceRecord(
                    signal_id=signal, source_url=source_url, source_publisher=publisher,
                    source_class=source_class, excerpt=excerpt[:1200], observed_at=observed,
                    published_at=published, extraction_method=_text(record.get("extraction_method")) or "deterministic_primary_page",
                    confidence=0.72,
                    provenance={
                        "query_origin": record.get("query_origin") or request.query,
                        "parent_query": record.get("parent_query") or request.query,
                        "discovery_round": record.get("discovery_round") or 1,
                        "provider_query": record.get("provider_query"),
                        "coverage": "generic_fallback_partial",
                        "source_text": record.get("source_text") or excerpt,
                        "page_title": record.get("page_title"),
                        "search_snippet": record.get("search_snippet"),
                        "structured_metadata": record.get("structured_metadata") or {},
                        "origin_adapter_id": record.get("origin_adapter_id"),
                        "origin_execution_round": record.get("origin_execution_round"),
                        "origin_provider_call_id": record.get("origin_provider_call_id"),
                        "origin_page_fetch_id": record.get("origin_page_fetch_id"),
                        "origin_source_text_hash": record.get("origin_source_text_hash"),
                        "origin_cursor_version": record.get("origin_cursor_version"),
                        "company_size": record.get("company_size"),
                        "employee_count": record.get("employee_count"),
                        "requested_geographies": record.get("requested_geographies") or list(request.geographies),
                        "geography_match": record.get("geography_match") is True,
                        "matched_geography": record.get("matched_geography"),
                        "geography_match_method": record.get("geography_match_method"),
                        "geography_match_evidence": record.get("geography_match_evidence"),
                    },
                ) for signal in matched)
                if not evidence:
                    warnings.append("NO_CANONICAL_EVIDENCE")
                    continue
                # Hard reject incomplete universal candidates.
                if universal and not semantic_required and not all((company, domain, matched, published, excerpt, source_url, source_class, domain_verification)):
                    warnings.append("UNIVERSAL_CANDIDATE_INCOMPLETE")
                    continue
                if universal and semantic_required and not all((company, matched, excerpt, source_url, source_class)):
                    warnings.append("UNIVERSAL_CANDIDATE_INCOMPLETE")
                    continue
                raw_contacts = record.get("contacts") if isinstance(record.get("contacts"), list) else []
                contacts = tuple(
                    ContactRecord(
                        kind=str(item.get("kind") or "email"),
                        value=str(item.get("value") or "").strip(),
                        source_url=str(item.get("source_url") or source_url),
                        verified=item.get("verified") is True,
                    )
                    for item in raw_contacts
                    if isinstance(item, Mapping) and str(item.get("value") or "").strip()
                )
                if not contacts:
                    contacts = _public_contacts_from_html(
                        str(record.get("source_html") or ""),
                        source_url=source_url,
                        prefer_domain=domain,
                    )
                if not contacts and domain:
                    enrich_row = _maybe_enrich_from_official_domain({
                        "official_domain": domain,
                        "official_domain_verified": bool(record.get("official_domain_verified")),
                        "source_url": source_url,
                        "contacts": [],
                    })
                    contacts = tuple(
                        ContactRecord(
                            kind=str(item.get("kind") or "email"),
                            value=str(item.get("value") or "").strip(),
                            source_url=str(item.get("source_url") or source_url),
                            verified=item.get("verified") is True,
                        )
                        for item in (enrich_row.get("contacts") or ())
                        if isinstance(item, Mapping) and str(item.get("value") or "").strip()
                    )
                candidates.append(OpportunityCandidate(
                    canonical_company_name=company,
                    company_identifiers={}, official_domain=domain, entity_class="operating_company",
                    geographies=tuple(filter(None, (_text(record.get("geography")) or "",))), buyer_fit=buyer_fit,
                    signal_id=matched[0], signal_date=published, evidence=evidence,
                    why_now=why_now, contacts=contacts, confidence=0.55 if semantic_required else 0.72,
                    contradiction_flags=("GENERIC_FALLBACK_PARTIAL",),
                    provenance={
                        "adapter_id": self.capability.adapter_id,
                        "query_origin": record.get("query_origin") or request.query,
                        "parent_query": record.get("parent_query") or request.query,
                        "discovery_round": record.get("discovery_round") or 1,
                        "provider_query": record.get("provider_query"),
                        "limitations": "sampled web evidence; no global source exhaustion claim",
                        "domain_verification": domain_verification,
                        "company_size": record.get("company_size"),
                        "employee_count": record.get("employee_count"),
                        "is_listed": bool(record.get("is_listed")),
                        "requested_geographies": record.get("requested_geographies") or list(request.geographies),
                        "geography_match": record.get("geography_match") is True,
                        "matched_geography": record.get("matched_geography"),
                        "geography_match_method": record.get("geography_match_method"),
                        "geography_match_evidence": record.get("geography_match_evidence"),
                        "origin_adapter_id": record.get("origin_adapter_id"),
                        "origin_execution_round": record.get("origin_execution_round"),
                        "origin_provider_call_id": record.get("origin_provider_call_id"),
                        "origin_page_fetch_id": record.get("origin_page_fetch_id"),
                        "origin_source_text_hash": record.get("origin_source_text_hash"),
                        "origin_cursor_version": record.get("origin_cursor_version"),
                    },
                    adapter_id=self.capability.adapter_id, adapter_version=self.capability.adapter_version,
                    official_domain_verified=bool(domain) and record.get("official_domain_verified") is True,
                    official_domain_confidence=float(domain_verification.get("confidence") or 0.0) if domain else 0.0,
                ))
                if len(candidates) >= request.requested_count:
                    break
            if len(candidates) >= request.requested_count:
                break
        final_state = load_generic_web_state(request.cursor, request.technical_filters)
        filters = request.technical_filters if isinstance(request.technical_filters, dict) else {}
        from .universal_strategy_queries import universal_strategy_queries_from_filters

        query_pool = universal_strategy_queries_from_filters(
            request.technical_filters,
            signal_ids=request.signal_ids,
        ) or diversified_queries(request)
        executed = {str(x).strip().casefold() for x in final_state.executed_query_keys if str(x).strip()}
        remaining_queries = [
            q
            for q in list(final_state.followup_queries) + list(query_pool[final_state.query_index :])
            if str(q).strip() and str(q).strip().casefold() not in executed
        ]
        dead_end = (
            universal
            and len(candidates) == 0
            and not final_state.queue_has_work()
            and not remaining_queries
        )
        return AdapterExecutionResult(
            adapter_id=self.capability.adapter_id, adapter_version=self.capability.adapter_version,
            candidates=tuple(candidates),
            exhaustion=SourceExhaustion(
                exhausted=dead_end,
                scope="partition",
                reason=(
                    "empty_serp_and_queue_exhausted"
                    if dead_end
                    else (
                        "requested_count_reached_partial_coverage"
                        if len(candidates) >= request.requested_count
                        else "sample_partition_complete_not_global_exhaustion"
                    )
                ),
                authoritative=False,
                next_cursor=encode_generic_web_cursor(final_state),
            ),
            operations=sum(len(result.records) for result in results), cost_eur=spent,
            started_at=started, completed_at=observed, warnings=tuple(sorted(set(warnings))),
            telemetry={
                "pages_fetched": final_state.pages_fetched,
                "provider_queries": final_state.provider_calls,
                "query_telemetry": list(filters.get("generic_web_query_telemetry") or ()),
                "url_outcomes": list(filters.get("generic_web_url_outcomes") or ()),
                "acquisition": {
                    "pages_fetched": final_state.pages_fetched,
                    "provider_queries": final_state.provider_calls,
                    "pending_urls": list(final_state.pending_urls),
                },
            },
        )
