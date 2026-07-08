"""Blacklist condivisa portali fonte + colossi (USE)."""
from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urlparse

SOURCE_PORTAL_DOMAINS = frozenset({
    "indeed.it", "indeed.com", "infojobs.it", "linkedin.com", "glassdoor.com",
    "ilsole24ore.com", "repubblica.it", "corriere.it", "ansa.it", "lastampa.it",
    "startupitalia.eu", "startupitalia.it", "italian.tech", "italiantech.info",
    "wired.it", "milanofinanza.it", "forbes.it", "huffingtonpost.it",
    "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com",
    "wikipedia.org", "wikidata.org", "paginegialle.it", "paginebianche.it",
    "registroimprese.it", "infocamere.it", "anac.gov.it", "gazzettaufficiale.it",
    "amazon.com", "amazon.it", "amazonaws.com", "google.com", "google.it",
    "microsoft.com", "microsoft.it", "apple.com", "meta.com", "ibm.com",
    "oracle.com", "sap.com", "nttdata.com", "ntt.com", "accenture.com",
    "deloitte.com", "pwc.com", "ey.com", "kpmg.com", "capgemini.com",
    "infosys.com", "tcs.com", "wipro.com", "cognizant.com",
    "bending-spoons.com", "bendingspoons.com", "tim.it", "telecomitalia.it",
    # Code hosts, package registries, tech giants (never valid PMI targets)
    "github.com", "github.io", "gitlab.com", "stackoverflow.com", "stackexchange.com",
    "npmjs.com", "pypi.org", "medium.com", "substack.com", "brave.com",
    "mozilla.org", "mozilla.com", "opera.com",
})

# Evidence sources and lead websites are different trust domains. News, job
# boards and public registers are useful evidence, but must never become the
# official website of the company mentioned in them.
EXTRACTION_BLOCKED_SOURCE_DOMAINS = frozenset({
    "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com",
    "wikipedia.org", "wikidata.org", "paginegialle.it", "paginebianche.it",
    "amazon.com", "amazon.it", "amazonaws.com", "google.com", "google.it",
    "github.com", "github.io", "gitlab.com", "stackoverflow.com", "stackexchange.com",
    "npmjs.com", "pypi.org", "medium.com", "substack.com",
})

# Substring roots matched case-insensitively on normalized host (e.g. api.github.com)
BLACKLIST_DOMAIN_ROOTS = (
    "github.", "gitlab.", "stackoverflow.", "stackexchange.", "npmjs.", "pypi.",
    "medium.", "substack.", "brave.com", "mozilla.", "opera.", "apple.", "microsoft.",
)

BLACKLIST_NAME_PATTERNS = (
    r"\bindeed\b", r"\blinkedin\b", r"\bil\s*sole\s*24\s*ore\b", r"\brepubblica\b",
    r"\bamazon\b", r"\bgoogle\b", r"\bmicrosoft\b", r"\bapple\b", r"\bmeta\b",
    r"\bfacebook\b", r"\bntt\s*data\b", r"\bntt\b", r"\bibm\b", r"\baccenture\b",
    r"\bdeloitte\b", r"\bstartup\s*italia\b",
    r"\bgithub\b", r"\bgitlab\b", r"\bstackoverflow\b", r"\bstackexchange\b",
    r"\bnpm\b", r"\bpypi\b", r"\bmedium\b", r"\bsubstack\b", r"\bbrave\b",
    r"\bmozilla\b", r"\bopera\b",
)

_BLACKLIST_NAME_RES = [re.compile(p, re.I) for p in BLACKLIST_NAME_PATTERNS]


def normalize_domain(url: str) -> str:
    raw = (url or "").strip().lower()
    if not raw:
        return ""
    if "://" not in raw:
        raw = f"https://{raw}"
    try:
        host = urlparse(raw).netloc or urlparse(raw).path
    except Exception:
        host = raw
    return host.replace("www.", "").split(":")[0].rstrip("/")


def is_blacklisted_domain(domain: str) -> bool:
    d = normalize_domain(domain)
    if not d:
        return False
    d_lower = d.lower()
    for root in BLACKLIST_DOMAIN_ROOTS:
        if root in d_lower:
            return True
    for blocked in SOURCE_PORTAL_DOMAINS:
        if d == blocked or d.endswith("." + blocked) or blocked in d:
            return True
    return False


def is_extraction_blocked_source(url: str) -> bool:
    """True for code repos, package registries, news/tech giants — skip LLM extraction."""
    domain = normalize_domain(url)
    if not domain:
        return True
    return any(
        domain == blocked or domain.endswith("." + blocked)
        for blocked in EXTRACTION_BLOCKED_SOURCE_DOMAINS
    )


def is_blacklisted_name(name: str) -> bool:
    n = (name or "").strip()
    if not n:
        return False
    return any(rx.search(n) for rx in _BLACKLIST_NAME_RES)


def is_source_portal_url(url: str) -> bool:
    return is_blacklisted_domain(normalize_domain(url))
