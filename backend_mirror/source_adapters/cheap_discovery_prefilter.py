"""Cheap discovery prefilter — title/URL/snippet triage before costly fetches."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlparse


_DIRECTORY_HOST_RE = re.compile(
    r"(paginegialle|pagesjaunes|yelp|tripadvisor|facebook|instagram|tiktok|"
    r"wikipedia|amazon\.|ebay\.|booking\.|immobiliare\.|subito\.|"
    r"kompass\.|europages|dnb\.com|zoominfo|crunchbase)",
    re.I,
)
_PUBLISHER_AS_COMPANY_RE = re.compile(
    r"\b(redazione|giornale|quotidiano|magazine|blog|newsletter|podcast)\b",
    re.I,
)
_ADMIN_ASSOC_RE = re.compile(
    r"\b(comune di|regione |provincia di|ministero|camera di commercio|"
    r"associazione|confartigianato|confcommercio|confindustria|unindustria|"
    r"compagnia\s+delle\s+opere|\bcdo\b|"
    r"sindacato|fondazione|italia\s+nostra|onlus|ong\b)\b",
    re.I,
)
_FORM_OR_HUB_PATH_RE = re.compile(
    r"(richiedi[-_/]?informazioni|/contatti?/|/contact|/form|/newsletter|"
    r"italia-che-fa-impresa|/category/|/tag/|/topics?/|"
    r"bandi\.regione|/prodotti-e-servizi/|/fondo-perduto|"
    r"instagram\.com|linkedin\.com)",
    re.I,
)
_EVENT_HINT_RE = re.compile(
    r"\b(assum\w*|inaugur\w*|apertur\w*|nuova sede|nuovo stabilimento|nuova unit[aà] produttiva|"
    r"ampliamento\s+(?:produttivo|dello\s+stabilimento|della\s+sede)|ampliar\w*\s+la\s+produzione|"
    r"capacit[aà]\s+produttiva|nuovo\s+impianto|linea\s+di\s+produzione|espans\w*|aggiudic\w*|"
    r"finanz\w*|investiment\w*|nomina\w*|CEO|direttore|certific\w*|adeguament\w*|"
    r"campagna\w*|rebrand\w*|migrazion\w*|implementa\w*|raccolt\w*|CRM|ERP|Meta Ads|Google Ads|pubblicitaria|"
    r"round\b|seed\b|series\s+[a-c]|chiude\s+un\s+round|ha\s+raccolto|funding|"
    r"destinat\w*\s+(?:nuove\s+)?risorse|nuove\s+risorse|operazion\w*\s+di\s+crescita)\b",
    re.I,
)
_STALE_YEAR_RE = re.compile(r"\b(20(?:0\d|1\d|2[0-2]))\b")
_OPPOSITION_EXPANSION_RE = re.compile(
    r"\b(?:contro\s+(?:il|l['’])\s+(?:discusso\s+)?progetto|opposizione\s+a|"
    r"no\s+all['’]ampliamento|bloccato\s+l['’]ampliamento|"
    r"vantaggi\s+(?:alle\s+)?multinazional\w*)\b",
    re.I,
)
_FAMOUS_OR_GLOBAL_EXPANSION_RE = re.compile(
    r"\b(?:acqua\s+vera|san\s+pellegrino|nestl[eé]|ferrero|barilla\b|lavazza|"
    r"coca[\s-]?cola|pepsi|chiesi\b|fendi\b|luxottica|essilor|thelios|"
    r"bmw(?:\s+group)?|edison(?:\s+next)?|iris\s+ceramica)\b",
    re.I,
)
# Centro/Sud place names in expansion SERP titles — Nord-Italia PMI canaries
# still receive them despite -orvieto style excludes (Google soft-negatives).
_OUT_OF_SCOPE_GEO_RE = re.compile(
    r"\b(?:orvieto|umbria|toscana|lazio|marche|abruzzo|puglia|campania|sicilia|"
    r"sardegna|calabria|basilicata|molise)\b",
    re.I,
)

# Static descriptions such as "capacità produttiva annuale" are not evidence
# that a facility changed recently. This stricter check is applied only to
# canonical expansion/location signals before any page fetch.
_CONCRETE_EXPANSION_EVENT_RE = re.compile(
    r"\b(?:inaugur\w*|apre\s+(?:un|il)\s+nuov\w*|ha\s+aperto\s+(?:un|il)\s+nuov\w*|"
    r"nuov[oa]\s+(?:stabilimento|impianto|unit[aà]\s+produttiva|sede\s+produttiva|linea\s+di\s+produzione)|"
    r"ampliament\w*\s+(?:produttiv\w*|dello\s+stabilimento|dell['’]impianto|della\s+sede)|"
    r"espansion\w*\s+(?:produttiv\w*|dello\s+stabilimento)|"
    r"increment\w*\s+(?:la\s+)?capacit[aà]\s+produttiva)\b",
    re.I,
)
# Soft SERP recall: industrial/editorial pages may carry the event only in the body.
_INDUSTRIAL_OR_EDITORIAL_RE = re.compile(
    r"\b(?:stabiliment\w*|impiant\w*|fabbric\w*|produzion\w*|industri\w*|meccanic\w*|"
    r"automat\w*|macchin\w*|linea\s+di\s+produzione|revamping|industria\s+4\.0|"
    r"manifattur\w*|officin\w*|fonderi\w*|s\.?p\.?a\.?|s\.?r\.?l\.?|"
    r"comunicato\s+stampa|newsroom|ufficio\s+stampa|redazione)\b",
    re.I,
)
_NEWS_HOST_RE = re.compile(
    r"(repubblica|corriere|sole24ore|ansa\.|ilmattino|ilgazzettino|lagazzettadelmezzogiorno|"
    r"quotidiano|giornale|news|press|comunicati)",
    re.I,
)


def has_concrete_expansion_event(*values: str) -> bool:
    """Return true only for a literal facility/capacity change event."""
    return bool(_CONCRETE_EXPANSION_EVENT_RE.search(" ".join(str(value or "") for value in values)))


def looks_plausible_industrial_fetch(hit: "DiscoveryHit") -> bool:
    """SERP may omit the event; still fetch company/news pages that look industrial."""
    host = _host(hit.url)
    blob = f"{hit.title} {hit.snippet} {hit.publisher}".strip()
    if not host or not blob:
        return False
    if _DIRECTORY_HOST_RE.search(host) or _DIRECTORY_HOST_RE.search(blob):
        return False
    if _FORM_OR_HUB_PATH_RE.search(hit.url):
        return False
    industrial = bool(_INDUSTRIAL_OR_EDITORIAL_RE.search(blob))
    editorial = bool(_NEWS_HOST_RE.search(host) or _NEWS_HOST_RE.search(blob))
    companyish = bool(
        _looks_company_owned(host, hit.title, hit.snippet)
        or re.search(r"\b(?:spa|srl|s\.p\.a|s\.r\.l)\b", blob, re.I)
    )
    # Company-owned alone is not enough ("Acme homepage / chi siamo"): need an
    # industrial or editorial cue that makes a buyer-trigger event plausible.
    if editorial and (industrial or companyish or len(blob) >= 40):
        return True
    if industrial and (companyish or editorial or len(blob) >= 40):
        return True
    return False


@dataclass(frozen=True)
class DiscoveryHit:
    title: str
    url: str
    snippet: str
    publisher: str = ""
    rank: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class PrefilterDecision:
    accepted: bool
    reason: str
    discovery_confidence: float
    company_owned_host: bool
    probable_company_name: Optional[str] = None


def _host(url: str) -> str:
    parsed = urlparse(url if "://" in url else f"https://{url}")
    return (parsed.hostname or "").lower().removeprefix("www.")


def _looks_company_owned(host: str, title: str, snippet: str) -> bool:
    if not host or _DIRECTORY_HOST_RE.search(host):
        return False
    if host.endswith(".gov.it") or host.endswith(".edu.it"):
        return False
    blob = f"{title} {snippet}".casefold()
    token = host.split(".")[0]
    return len(token) >= 4 and token.casefold() in blob


def _probable_company(title: str, snippet: str) -> Optional[str]:
    for candidate in (title, snippet.split(".")[0] if snippet else ""):
        text = re.sub(r"\s+", " ", candidate or "").strip(" -|:")
        if not text:
            continue
        # Drop publisher-ish titles.
        if _PUBLISHER_AS_COMPANY_RE.search(text):
            continue
        # Prefer "Company – event" patterns.
        left = re.split(r"\s+[–\-|:]\s+", text, maxsplit=1)[0].strip()
        if 3 <= len(left) <= 120:
            return left
    return None


def prefilter_discovery_hit(
    hit: DiscoveryHit,
    *,
    require_event_hint: bool = True,
    allow_admin_assoc: bool = False,
    excluded_domains: Sequence[str] = (),
) -> PrefilterDecision:
    host = _host(hit.url)
    blob = f"{hit.title} {hit.snippet} {hit.publisher}".strip()
    if not hit.url or not host:
        return PrefilterDecision(False, "missing_url", 0.0, False)
    if any(host == ex.removeprefix("www.") or host.endswith(ex) for ex in excluded_domains):
        return PrefilterDecision(False, "excluded_domain", 0.0, False)
    if _DIRECTORY_HOST_RE.search(host) or _DIRECTORY_HOST_RE.search(blob):
        return PrefilterDecision(False, "directory", 0.0, False)
    if _PUBLISHER_AS_COMPANY_RE.search(hit.title) and not _EVENT_HINT_RE.search(blob):
        return PrefilterDecision(False, "publisher_as_company", 0.05, False)
    if not allow_admin_assoc and _ADMIN_ASSOC_RE.search(blob):
        return PrefilterDecision(False, "admin_or_association", 0.1, False)
    if _FORM_OR_HUB_PATH_RE.search(hit.url) or _FORM_OR_HUB_PATH_RE.search(blob):
        return PrefilterDecision(False, "form_or_hub_page", 0.1, False)
    if require_event_hint and not _EVENT_HINT_RE.search(blob):
        # Recall-first: defer event proof to page body when the SERP looks like a
        # real company/news industrial candidate. Hard-reject only clear non-events.
        if looks_plausible_industrial_fetch(hit):
            company_owned = _looks_company_owned(host, hit.title, hit.snippet)
            return PrefilterDecision(
                True,
                "accepted_deferred_event_proof",
                0.35 if company_owned else 0.28,
                company_owned,
                _probable_company(hit.title, hit.snippet),
            )
        return PrefilterDecision(False, "no_event_hint", 0.15, False)
    # Protest / politics coverage about an expansion is not a buyer signal.
    if _OPPOSITION_EXPANSION_RE.search(blob):
        return PrefilterDecision(False, "opposition_or_protest_coverage", 0.12, False)
    # Famous / global brands are never the PMI canary target.
    if _FAMOUS_OR_GLOBAL_EXPANSION_RE.search(blob):
        return PrefilterDecision(False, "famous_or_global_brand", 0.12, False)
    if _OUT_OF_SCOPE_GEO_RE.search(blob):
        return PrefilterDecision(False, "out_of_scope_geography", 0.12, False)
    # Stale year without recent year nearby.
    stale = _STALE_YEAR_RE.findall(blob)
    if stale and not re.search(r"\b(202[4-6])\b", blob):
        return PrefilterDecision(False, "stale_year", 0.2, False)

    company_owned = _looks_company_owned(host, hit.title, hit.snippet)
    confidence = 0.45
    if company_owned:
        confidence += 0.25
    if _EVENT_HINT_RE.search(blob):
        confidence += 0.15
    if hit.snippet and len(hit.snippet) > 40:
        confidence += 0.05
    confidence = min(0.95, confidence)
    return PrefilterDecision(
        True,
        "accepted",
        confidence,
        company_owned,
        _probable_company(hit.title, hit.snippet),
    )


def cheap_rank_hits(
    hits: Iterable[Mapping[str, Any] | DiscoveryHit],
    *,
    excluded_domains: Sequence[str] = (),
) -> Tuple[Tuple[DiscoveryHit, PrefilterDecision], ...]:
    """Accept/reject and rank by discovery confidence (company-owned first)."""
    ranked: List[Tuple[DiscoveryHit, PrefilterDecision]] = []
    seen_url: set[str] = set()
    seen_company: set[str] = set()
    for index, raw in enumerate(hits):
        if isinstance(raw, DiscoveryHit):
            hit = raw
        else:
            hit = DiscoveryHit(
                title=str(raw.get("title") or ""),
                url=str(raw.get("url") or raw.get("link") or ""),
                snippet=str(raw.get("snippet") or raw.get("description") or ""),
                publisher=str(raw.get("publisher") or ""),
                rank=int(raw.get("rank") or index),
            )
        url_key = hit.url.strip().casefold()
        if not url_key or url_key in seen_url:
            continue
        decision = prefilter_discovery_hit(hit, excluded_domains=excluded_domains)
        if not decision.accepted:
            continue
        company_key = (decision.probable_company_name or "").casefold()
        if company_key and company_key in seen_company:
            continue
        seen_url.add(url_key)
        if company_key:
            seen_company.add(company_key)
        ranked.append((hit, decision))
    ranked.sort(key=lambda item: (-item[1].discovery_confidence, -int(item[1].company_owned_host), item[0].rank))
    return tuple(ranked)
