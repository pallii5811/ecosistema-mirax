"""Extract B2B relationships from a company website.

Discovers and fetches common pages (/clienti, /partner, /fornitori,
/case-study, /distribuzione) and infers edges such as has_customer,
partner_of, supplies, buys_from, sells_to.

No LLM is used; the logic is deterministic and conservative.  All network
errors are swallowed so the caller never crashes.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from ..canonical import normalize_domain, slugify_name
from ..models import UniverseEntity, UniverseEntityAlias, UniverseObservation, UniverseRelationship
from ..repository import UniverseRepository

logger = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

LEGAL_FORMS = re.compile(
    r"\b(?:"
    r"s\.?r\.?l\.?(?:\s+s\.?u\.?)?|"
    r"s\.?p\.?a\.?|s\.?r\.?l\.?s\.?|s\.?a\.?s\.?|s\.?n\.?c\.?|"
    r"s\.?c\.?p\.?a\.?|s\.?c\.?a\.?r\.?l\.?|s\.?d\.?f\.?|s\.?a\.?p\.?a\.?|"
    r"coop\.?(?:erativa)?|a\.?p\.?s\.?|e\.?t\.?s\.?|onlus|"
    r"srl|spa|srls|sas|snc|scpa|scarl"
    r")\b",
    re.IGNORECASE,
)

# (path slug fragment, page_type label)
SPECIAL_PAGE_RULES: List[Tuple[str, str]] = [
    ("clienti", "clienti"),
    ("customers", "clienti"),
    ("customer", "clienti"),
    ("partner", "partner"),
    ("partners", "partner"),
    ("fornitori", "fornitori"),
    ("suppliers", "fornitori"),
    ("supplier", "fornitori"),
    ("case-study", "case_study"),
    ("case-studies", "case_study"),
    ("case_study", "case_study"),
    ("casestudy", "case_study"),
    ("distribuzione", "distribuzione"),
    ("distributori", "distribuzione"),
    ("distributors", "distribuzione"),
    ("distributor", "distribuzione"),
    ("rivenditori", "distribuzione"),
    ("resellers", "distribuzione"),
]

NAVIGATION_LABELS = {
    "clienti": "clienti",
    "i nostri clienti": "clienti",
    "customers": "clienti",
    "our customers": "clienti",
    "partner": "partner",
    "partners": "partner",
    "i nostri partner": "partner",
    "our partners": "partner",
    "fornitori": "fornitori",
    "suppliers": "fornitori",
    "case study": "case_study",
    "case studies": "case_study",
    "distributori": "distribuzione",
    "distributors": "distribuzione",
    "rivenditori": "distribuzione",
    "resellers": "distribuzione",
}


class _WebRelationsError(Exception):
    pass


def _headers() -> Dict[str, str]:
    return {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9",
        "Referer": "https://www.google.com/",
    }


def _fetch_url(
    url: str,
    client: Optional[httpx.Client] = None,
    retries: int = 2,
    timeout: float = 10.0,
) -> Optional[str]:
    """Fetch a URL with retries and sensible timeouts.  Returns HTML text or None."""
    last_exc: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            if client is not None:
                resp = client.get(url, timeout=timeout)
            else:
                with httpx.Client(
                    follow_redirects=True, headers=_headers(), timeout=timeout
                ) as c:
                    resp = c.get(url)
            if resp.status_code == 200:
                return resp.text
            if 400 <= resp.status_code < 500:
                return None
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            logger.debug("fetch %s attempt %s failed: %s", url, attempt, exc)
    if last_exc:
        logger.debug("fetch %s failed after %s attempts: %s", url, retries + 1, last_exc)
    return None


def _absolute_url(base_url: str, href: str) -> Optional[str]:
    if not href or href.startswith(("mailto:", "tel:", "javascript:", "#")):
        return None
    try:
        return urljoin(base_url, href.split("#")[0])
    except Exception:  # noqa: BLE001
        return None


def _page_type_from_href(href: str) -> Optional[str]:
    try:
        path = urlparse(href).path.lower()
    except Exception:  # noqa: BLE001
        return None
    segments = {segment for segment in path.split("/") if segment}
    for fragment, page_type in SPECIAL_PAGE_RULES:
        if fragment in segments:
            return page_type
    return None


def _is_same_site(base_url: str, candidate_url: str) -> bool:
    def host(value: str) -> str:
        parsed = urlparse(value if "://" in value else f"https://{value}")
        return (parsed.hostname or "").lower().removeprefix("www.")

    return bool(host(base_url) and host(base_url) == host(candidate_url))


def _discover_special_pages(
    base_url: str, homepage_html: Optional[str] = None
) -> Dict[str, str]:
    """Return {page_type: absolute_url} for known B2B pages.

    First inspects homepage links, then probes common paths directly.
    """
    discovered: Dict[str, str] = {}

    if homepage_html is None:
        homepage_html = _fetch_url(base_url)

    if homepage_html:
        try:
            soup = BeautifulSoup(homepage_html, "html.parser")
            for a in soup.find_all("a", href=True):
                href = str(a.get("href") or "").strip()
                page_type = _page_type_from_href(href)
                if not page_type:
                    # Accept only exact navigation labels. Article headlines
                    # containing words such as "partnership" are not evidence
                    # that the publisher is a party to that relationship.
                    text = re.sub(r"\s+", " ", a.get_text(separator=" ", strip=True).lower())
                    page_type = NAVIGATION_LABELS.get(text)
                if page_type:
                    abs_url = _absolute_url(base_url, href)
                    if abs_url and _is_same_site(base_url, abs_url):
                        discovered[page_type] = abs_url
        except Exception as exc:  # noqa: BLE001
            logger.debug("homepage parsing failed: %s", exc)

    # Probe direct paths for any page type not found yet.
    seen_fragments = {url.lower().rstrip("/") for url in discovered.values()}
    for fragment, page_type in SPECIAL_PAGE_RULES:
        if page_type in discovered:
            continue
        candidate = f"{base_url.rstrip('/')}/{fragment}/"
        if candidate.lower().rstrip("/") in seen_fragments:
            continue
        html = _fetch_url(candidate)
        if html:
            discovered[page_type] = candidate
            seen_fragments.add(candidate.lower().rstrip("/"))

    return discovered


def _extract_text_chunks(html: str) -> List[str]:
    try:
        soup = BeautifulSoup(html, "html.parser")
        # Remove script/style/nav/footer to reduce noise.
        for tag in soup(["script", "style", "nav", "footer", "noscript"]):
            tag.decompose()
        text = soup.get_text(separator="\n")
        return [line.strip() for line in text.splitlines() if line.strip()]
    except Exception as exc:  # noqa: BLE001
        logger.debug("html parsing failed: %s", exc)
        return []


def _normalize_legal_form(name: str) -> str:
    """Strip dots/spaces from Italian legal forms so names are canonical."""
    text = name
    text = re.sub(r"\bs\.?\s*r\.?\s*l\.?\s*s\.?\s*u\.?\b", " Srl SU", text, flags=re.IGNORECASE)
    text = re.sub(r"\bs\.?\s*r\.?\s*l\.?\s*s\.?\b", " Srls", text, flags=re.IGNORECASE)
    text = re.sub(r"\bs\.?\s*r\.?\s*l\.?\b", " Srl", text, flags=re.IGNORECASE)
    text = re.sub(r"\bs\.?\s*p\.?\s*a\.?\b", " SpA", text, flags=re.IGNORECASE)
    text = re.sub(r"\bs\.?\s*a\.?\s*s\.?\b", " Sas", text, flags=re.IGNORECASE)
    text = re.sub(r"\bs\.?\s*n\.?\s*c\.?\b", " Snc", text, flags=re.IGNORECASE)
    text = re.sub(r"\bs\.?\s*c\.?\s*p\.?\s*a\.?\b", " Scpa", text, flags=re.IGNORECASE)
    text = re.sub(r"\bs\.?\s*c\.?\s*a\.?\s*r\.?\s*l\.?\b", " Scarl", text, flags=re.IGNORECASE)
    text = re.sub(r"\bcoop\.?(?:erativa)?\b", " Cooperativa", text, flags=re.IGNORECASE)
    text = re.sub(r"\ba\.?\s*p\.?\s*s\.?\b", " APS", text, flags=re.IGNORECASE)
    text = re.sub(r"\be\.?\s*t\.?\s*s\.?\b", " ETS", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()


def _looks_like_company_name(text: str) -> bool:
    text = text.strip()
    if len(text) < 3 or len(text) > 90:
        return False
    if not LEGAL_FORMS.search(text):
        return False
    tokens = re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ0-9]+", text)
    if len(tokens) < 2 or len(tokens) > 10:
        return False
    lower = text.lower()
    if " - " in lower:
        return False
    if any(
        phrase in lower
        for phrase in (
            "processo di ",
            "nuovo sito web",
            "nuovo logo",
            "utilizzando i tasti",
            "compilarli con",
            "progettazione ed allestimento",
            "parola di ",
            "regolarne la ",
            "società di sviluppo e gestione",
            "acconsento a ricevere",
            "acconsentito al trattamento",
            "autorizzo ",
            "informativa sulla privacy",
            "dati personali",
            "titolare del trattamento",
            "inviando la richiesta",
            "questo indirizzo email",
            "chi siamo",
            "i nostri clienti",
            "tutto quello che serve",
            "tutto scorre",
            "via nazario",
            "via ca'",
        )
    ):
        return False
    noisy_prefixes = (
        "ad di ", "amministratore ", "avete ", "clienti ", "come agenzia ",
        "copyright", "costituzione ", "da ottobre ", "dalla fondazione",
        "eliminare ", "gestione integrata ", "gli ", "ministry ", "monografia ",
        "nel ", "niente ", "oltre a ", "partners & projects", "per ",
        "prenotazioni ", "presidente ", "pulizia ", "report ", "ristorante ",
        "ristrutturazioni ", "servizio ", "siamo ", "srl o ", "titolare ",
        "una nuova ", "web agency ", "whatsapp ", "impresa edile ",
        "onoranze funebri ", "agenzia qualificata ",
    )
    if lower.startswith(noisy_prefixes):
        return False
    connectors = {"di", "del", "della", "dei", "delle", "e"}
    legal = {"srl", "srls", "spa", "sas", "snc", "scpa", "scarl", "coop", "cooperativa", "aps", "ets", "onlus"}
    meaningful = [token for token in tokens if token.lower() not in connectors | legal]
    if not meaningful:
        return False
    generic = {
        "azienda", "clienti", "partner", "partners", "servizio", "servizi", "report",
        "prenotazioni", "fondazione", "consorzio", "cooperativa", "adempimenti",
    }
    if all(token.lower() in generic for token in meaningful):
        return False
    title_like = sum(1 for token in meaningful if token[0].isupper() or token.isupper())
    return title_like / len(meaningful) >= 0.6


def _extract_company_names(html: str) -> List[str]:
    """Extract candidate company names from HTML.

    Returns deduplicated, cleaned names ordered by appearance.
    """
    chunks = _extract_text_chunks(html)
    names: List[str] = []
    seen: set = set()

    # Pattern for Italian legal forms: "Name S.r.l.", "Foo & Bar S.p.A.", etc.
    pattern = re.compile(
        r"(?<![A-Za-zÀ-ÖØ-öø-ÿ0-9])"
        r"[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ0-9\.&\-'’]*"
        r"(?:\s+(?:[A-ZÀ-ÖØ-Þ0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9\.&\-'’]*|&|di|del|della|dei|delle|e)){0,7}\s+"
        + r"(?i:s\.?r\.?l\.?(?:\s+s\.?u\.?)?|s\.?p\.?a\.?|s\.?r\.?l\.?s\.?|"
        + r"s\.?a\.?s\.?|s\.?n\.?c\.?|s\.?c\.?p\.?a\.?|s\.?c\.?a\.?r\.?l\.?|"
        + r"coop\.?(?:erativa)?|a\.?p\.?s\.?|e\.?t\.?s\.?|srl|spa|srls|sas|snc|scpa|scarl|"
        + r"onlus)",
    )

    for chunk in chunks:
        for match in pattern.finditer(chunk):
            name = match.group(0).strip()
            # Trim trailing punctuation.
            name = re.sub(r"[\.,;:\)\(\[\]\"\']+$", "", name).strip()
            name = _normalize_legal_form(name)
            if _looks_like_company_name(name):
                key = name.lower()
                if key not in seen:
                    seen.add(key)
                    names.append(name)

    return names


def _ensure_company_entity(
    repo: UniverseRepository,
    name: str,
    domain: Optional[str] = None,
    country: str = "IT",
    confidence: float = 0.55,
) -> Optional[UniverseEntity]:
    canonical = normalize_domain(domain) if domain else slugify_name(name)
    if not canonical:
        return None
    aliases: List[UniverseEntityAlias] = []
    if domain:
        norm = normalize_domain(domain)
        if norm:
            aliases.append(UniverseEntityAlias(entity_id="", alias_type="domain", alias_value=norm, confidence=0.8))
    entity = UniverseEntity(
        canonical_id=canonical,
        entity_type="company",
        name=name,
        slug=slugify_name(name) or canonical,
        country=country,
        metadata={"inferred_from": "web_relations"},
        confidence=confidence,
    )
    return repo.upsert_entity(entity, aliases=aliases if aliases else None)[0]


def _build_relationships(
    company_id: str,
    page_type: str,
    target_id: str,
    source: str,
    observed_at: str,
    source_url: str = "",
    extracted_name: str = "",
) -> List[UniverseRelationship]:
    """Return the right edges for a given special page type."""
    rels: List[UniverseRelationship] = []
    base_meta = {
        "source": "web_relations",
        "page_type": page_type,
        "source_url": source_url,
        "extracted_name": extracted_name,
        "evidence_method": "legal_name_on_explicit_relationship_page",
    }
    confidence = 0.8 if page_type in {"clienti", "partner"} else 0.75

    if page_type == "clienti":
        # "I nostri clienti" -> these are customers of the source company.
        rels.extend(
            [
                UniverseRelationship(
                    source_entity_id=company_id,
                    target_entity_id=target_id,
                    relationship_type="has_customer",
                    source=source,
                    observed_at=observed_at,
                    confidence=confidence,
                    metadata=base_meta,
                ),
                UniverseRelationship(
                    source_entity_id=target_id,
                    target_entity_id=company_id,
                    relationship_type="customer_of",
                    source=source,
                    observed_at=observed_at,
                    confidence=confidence,
                    metadata=base_meta,
                ),
            ]
        )
    elif page_type == "partner":
        rels.extend(
            [
                UniverseRelationship(
                    source_entity_id=company_id,
                    target_entity_id=target_id,
                    relationship_type="partner_of",
                    source=source,
                    observed_at=observed_at,
                    confidence=confidence,
                    metadata=base_meta,
                ),
                UniverseRelationship(
                    source_entity_id=target_id,
                    target_entity_id=company_id,
                    relationship_type="partner_of",
                    source=source,
                    observed_at=observed_at,
                    confidence=confidence,
                    metadata=base_meta,
                ),
            ]
        )
    elif page_type == "fornitori":
        # The listed companies are suppliers -> source buys from them.
        rels.extend(
            [
                UniverseRelationship(
                    source_entity_id=company_id,
                    target_entity_id=target_id,
                    relationship_type="buys_from",
                    source=source,
                    observed_at=observed_at,
                    confidence=confidence,
                    metadata=base_meta,
                ),
                UniverseRelationship(
                    source_entity_id=target_id,
                    target_entity_id=company_id,
                    relationship_type="sells_to",
                    source=source,
                    observed_at=observed_at,
                    confidence=confidence,
                    metadata=base_meta,
                ),
            ]
        )
    elif page_type == "case_study":
        # Source company supplies the featured customer.
        rels.extend(
            [
                UniverseRelationship(
                    source_entity_id=company_id,
                    target_entity_id=target_id,
                    relationship_type="supplies",
                    source=source,
                    observed_at=observed_at,
                    confidence=confidence,
                    metadata=base_meta,
                ),
                UniverseRelationship(
                    source_entity_id=target_id,
                    target_entity_id=company_id,
                    relationship_type="supplied_by",
                    source=source,
                    observed_at=observed_at,
                    confidence=confidence,
                    metadata=base_meta,
                ),
            ]
        )
    elif page_type == "distribuzione":
        # Treat distributors as commercial partners.
        rels.extend(
            [
                UniverseRelationship(
                    source_entity_id=company_id,
                    target_entity_id=target_id,
                    relationship_type="partner_of",
                    source=source,
                    observed_at=observed_at,
                    confidence=confidence,
                    metadata=base_meta,
                ),
                UniverseRelationship(
                    source_entity_id=target_id,
                    target_entity_id=company_id,
                    relationship_type="partner_of",
                    source=source,
                    observed_at=observed_at,
                    confidence=confidence,
                    metadata=base_meta,
                ),
            ]
        )

    return rels


def extract_web_relations(
    repo: UniverseRepository,
    company_id: str,
    domain: str,
    source: str,
    observed_at: str,
    homepage_html: Optional[str] = None,
    max_pages: int = 6,
) -> Tuple[List[UniverseObservation], List[UniverseRelationship]]:
    """Extract relations from a company website.

    Parameters
    ----------
    repo
        Universe repository.
    company_id
        Source company entity id.
    domain
        Normalised domain, e.g. ``example.it``.
    source
        Source label to attach to edges.
    observed_at
        ISO timestamp for edges.
    homepage_html
        Optional pre-fetched HTML.  If provided no network call is made for
        the homepage, but discovered special pages are still fetched.
    max_pages
        Maximum number of special pages to fetch.

    Returns
    -------
    Tuple of (observations, relationships).
    """
    observations: List[UniverseObservation] = []
    relationships: List[UniverseRelationship] = []

    if not domain:
        return observations, relationships

    base_url = f"https://{domain}"

    try:
        pages = _discover_special_pages(base_url, homepage_html)
    except Exception as exc:  # noqa: BLE001
        logger.warning("web_relations discovery failed for %s: %s", domain, exc)
        return observations, relationships

    # Limit to the most informative page types.
    page_items = list(pages.items())[:max_pages]
    for page_type, url in page_items:
        try:
            html = _fetch_url(url)
            if not html:
                continue
            names = _extract_company_names(html)
            for name in names:
                target = _ensure_company_entity(repo, name, country="IT", confidence=0.55)
                if not target or target.id == company_id:
                    continue
                relationships.extend(
                    _build_relationships(
                        company_id,
                        page_type,
                        target.id,
                        source,
                        observed_at,
                        source_url=url,
                        extracted_name=name,
                    )
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("web_relations extraction failed for %s (%s): %s", url, page_type, exc)
            continue

    return observations, relationships
