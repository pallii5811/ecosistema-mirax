"""HTTP domain resolver — trova sito ufficiale PMI prima dell'audit."""
from __future__ import annotations

import logging
import difflib
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from .portal_blacklist import (
    is_blacklisted_domain,
    is_blacklisted_name,
    normalize_domain,
)

logger = logging.getLogger("domain_resolver")

_URL_VALIDATE_TIMEOUT = 8.0
_DOMAIN_IDENTITY_MIN_SCORE = int(__import__("os").getenv("DOMAIN_IDENTITY_MIN_SCORE", "55") or "55")

_LEGAL_TOKENS = {
    "srl", "spa", "srls", "sas", "snc", "societa", "cooperativa", "coop",
    "italia", "italy", "group", "gruppo", "holding", "the", "and",
}


def _identity_tokens(value: str) -> List[str]:
    normalized = re.sub(r"[^a-z0-9]+", " ", (value or "").lower())
    return [token for token in normalized.split() if len(token) >= 3 and token not in _LEGAL_TOKENS]


def _jsonld_organization_names(soup: BeautifulSoup) -> List[str]:
    names: List[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, list):
            for child in value:
                walk(child)
            return
        if not isinstance(value, dict):
            return
        raw_type = value.get("@type")
        types = raw_type if isinstance(raw_type, list) else [raw_type]
        if any(t in {"Organization", "Corporation", "LocalBusiness"} for t in types):
            name = str(value.get("name") or value.get("legalName") or "").strip()
            if name:
                names.append(name)
        walk(value.get("@graph"))

    for script in soup.find_all("script", attrs={"type": re.compile("ld\\+json", re.I)}):
        try:
            walk(json.loads(script.string or script.get_text() or "{}"))
        except (TypeError, json.JSONDecodeError):
            continue
    return names


def score_domain_identity(
    company_name: str,
    url: str,
    html: str,
    location: str = "",
) -> Dict[str, Any]:
    """Pure identity scorer used by resolver and offline regression tests."""
    tokens = _identity_tokens(company_name)
    if not tokens:
        return {"score": 0, "confidence": 0.0, "evidence": ["company_name_unusable"]}
    host = normalize_domain(url)
    host_compact = re.sub(r"[^a-z0-9]", "", host.split(".")[0])
    soup = BeautifulSoup(html or "", "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True)).lower()[:250_000]
    title_lower = title.lower()

    host_hits = sum(1 for token in tokens if token in host_compact)
    text_hits = sum(1 for token in tokens if re.search(rf"\b{re.escape(token)}\b", text))
    title_hits = sum(1 for token in tokens if re.search(rf"\b{re.escape(token)}\b", title_lower))
    host_coverage = host_hits / len(tokens)
    text_coverage = text_hits / len(tokens)
    title_coverage = title_hits / len(tokens)

    org_names = _jsonld_organization_names(soup)
    company_norm = " ".join(tokens)
    schema_ratio = max(
        [difflib.SequenceMatcher(None, company_norm, " ".join(_identity_tokens(name))).ratio() for name in org_names]
        or [0.0]
    )

    score = 0
    evidence: List[str] = []
    if host_coverage >= 1:
        score += 40
        evidence.append("company_tokens_in_host")
    elif host_coverage >= 0.5:
        score += 28
        evidence.append("partial_company_tokens_in_host")
    if text_coverage >= 1:
        score += 25
        evidence.append("legal_name_in_page")
    elif text_coverage >= 0.5:
        score += 12
        evidence.append("partial_name_in_page")
    if title_coverage >= 1:
        score += 15
        evidence.append("legal_name_in_title")
    elif title_coverage >= 0.5:
        score += 7
        evidence.append("partial_name_in_title")
    if schema_ratio >= 0.9:
        score += 30
        evidence.append("schema_org_identity_match")
    elif schema_ratio >= 0.7:
        score += 18
        evidence.append("schema_org_identity_probable")
    location_tokens = _identity_tokens(location)
    if location_tokens and any(token in text for token in location_tokens):
        score += 5
        evidence.append("location_match")
    if any(marker in text for marker in ("partita iva", "p. iva", "privacy policy", "contatti")):
        score += 5
        evidence.append("official_site_markers")

    # A news article can repeat the company name everywhere. Without a host or
    # schema.org identity match it must not be promoted to official domain.
    if host_coverage == 0 and schema_ratio < 0.7:
        score = min(score, 45)
        evidence.append("missing_domain_ownership_proof")
    if text_coverage < 0.5 and schema_ratio < 0.7:
        score = min(score, 35)
        evidence.append("insufficient_page_identity")

    score = max(0, min(100, score))
    return {
        "score": score,
        "confidence": round(score / 100, 3),
        "evidence": evidence,
        "host": host,
        "schema_names": org_names[:5],
    }


def verify_company_domain(company_name: str, url: str, location: str = "") -> Optional[Dict[str, Any]]:
    target = _normalize_url(url)
    if not target or is_blacklisted_domain(normalize_domain(target)):
        return None
    try:
        import httpx

        with httpx.Client(follow_redirects=True, timeout=_URL_VALIDATE_TIMEOUT, verify=True) as client:
            response = client.get(target, headers={"User-Agent": "Mozilla/5.0 (compatible; MIRAX-Identity/2.0)"})
        if response.status_code != 200:
            return None
        content_type = str(response.headers.get("content-type") or "").lower()
        if "html" not in content_type and "xhtml" not in content_type:
            return None
        final_url = str(response.url)
        scored = score_domain_identity(company_name, final_url, response.text, location)
        if int(scored["score"]) < _DOMAIN_IDENTITY_MIN_SCORE:
            logger.info(
                "domain identity rejected company=%r host=%s score=%s",
                company_name[:60],
                scored.get("host"),
                scored.get("score"),
            )
            return None
        parsed = urlparse(final_url)
        canonical_url = f"{parsed.scheme or 'https'}://{parsed.netloc}/"
        return {
            "url": canonical_url,
            **scored,
            "status": "verified" if int(scored["score"]) >= 70 else "probable",
            "resolution_method": "positive_page_identity",
            "resolved_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        logger.debug("verify_company_domain failed url=%s: %s", target[:80], exc)
        return None

# Re-export for callers
is_blocked_domain = is_blacklisted_domain
is_blocked_company_name = is_blacklisted_name


def _normalize_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    if not raw.startswith("http"):
        raw = f"https://{raw}"
    return raw


def validate_url_reachable(url: str) -> bool:
    """
    True solo se HTTP 200 (HEAD poi GET). Timeout rigido 8s.
    Scarta timeout, SSL error, redirect chain senza 200 finale.
    """
    target = _normalize_url(url)
    if not target:
        return False
    try:
        import httpx

        with httpx.Client(
            follow_redirects=True,
            timeout=_URL_VALIDATE_TIMEOUT,
            verify=True,
        ) as client:
            for method in ("HEAD", "GET"):
                try:
                    resp = client.request(method, target)
                    if resp.status_code == 200:
                        return True
                except Exception:
                    continue
    except Exception as exc:
        logger.debug("validate_url_reachable failed url=%s: %s", target[:80], exc)
    return False


def _accept_resolved_url(url: str) -> Optional[str]:
    """Final gate: blacklist + HTTP 200 before returning any company website."""
    target = _normalize_url(url)
    if not target:
        return None
    host = normalize_domain(target)
    if not host or is_blacklisted_domain(host):
        logger.info("domain resolve: rejected blacklisted url %s", target[:80])
        return None
    if not validate_url_reachable(target):
        return None
    if is_blacklisted_domain(normalize_domain(target)):
        return None
    return target


def resolve_company_website(
    company_name: str,
    website: str = "",
    location: str = "",
    *,
    max_results: int = 5,
) -> Optional[str]:
    identity = resolve_company_identity(
        company_name,
        website,
        location,
        max_results=max_results,
    )
    return str(identity.get("url")) if identity else None


def resolve_company_identity(
    company_name: str,
    website: str = "",
    location: str = "",
    *,
    max_results: int = 5,
) -> Optional[Dict[str, Any]]:
    """
    Validate AI-extracted website or SERP fallback.
    github.com/foo/bar → discarded → SERP by company name.
    If SERP returns a blacklisted giant (e.g. brave.com), returns None.
    """
    name = (company_name or "").strip()
    if not name or len(name) < 2 or is_blacklisted_name(name):
        return None

    raw_site = (website or "").strip()
    if raw_site.lower() in {"null", "none", "n/a", "n/d"}:
        raw_site = ""
    domain = normalize_domain(raw_site)

    if domain and is_blacklisted_domain(domain):
        logger.info(
            "domain resolve: discard blacklisted extracted url %s for %r",
            raw_site[:80],
            name[:60],
        )
        domain = ""
        raw_site = ""

    if domain:
        candidate = raw_site if raw_site.startswith("http") else f"https://{domain}"
        verified = verify_company_domain(name, candidate, location)
        if verified:
            verified["resolution_source"] = "extracted_website"
            return verified
        logger.info("domain resolve: extracted url unreachable %s for %r", candidate[:80], name[:60])

    return resolve_official_identity(name, location, max_results=max_results)


def resolve_official_domain(
    company_name: str,
    location: str = "",
    *,
    max_results: int = 5,
) -> Optional[str]:
    identity = resolve_official_identity(company_name, location, max_results=max_results)
    return str(identity.get("url")) if identity else None


def resolve_official_identity(
    company_name: str,
    location: str = "",
    *,
    max_results: int = 5,
) -> Optional[Dict[str, Any]]:
    """
    Ricerca HTTP veloce: "{nome}" {location} sito ufficiale.
    Ritorna URL https del primo dominio non in blacklist con HTTP 200.
    """
    name = (company_name or "").strip()
    if not name or len(name) < 2 or is_blacklisted_name(name):
        return None

    loc = (location or "").strip()
    # Prefer owned-host guesses before paying for SERP. Brand.TLD names and
    # compact token hosts (siriusgame.it) often verify while news SERPs do not.
    try:
        from backend_mirror.agents.entity_identity_resolver import (
            company_owns_host,
            domain_candidates_from_company_name,
        )
    except Exception:  # pragma: no cover - packaging fallback
        from .entity_identity_resolver import (  # type: ignore
            company_owns_host,
            domain_candidates_from_company_name,
        )

    for host in domain_candidates_from_company_name(name):
        if not company_owns_host(name, host):
            continue
        verified = verify_company_domain(name, f"https://{host}/", location)
        if verified:
            verified["resolution_source"] = "name_shaped_host"
            return verified

    query = f'"{name}" {loc} (sito ufficiale OR "official website" OR homepage)'.strip()
    try:
        from .search_serp import search_urls_http

        urls = search_urls_http(
            query,
            max(3, min(max_results, 8)),
            cost_scope=f"domain_resolution:{name.lower()}:{loc.lower()}",
        )
    except Exception as exc:
        logger.warning("domain resolve SERP failed name=%r: %s", name[:60], exc)
        return None

    seen: Set[str] = set()
    verified_candidates: List[Dict[str, Any]] = []
    # Score owned hosts first so news/directory SERP noise is deprioritized.
    ranked_urls = sorted(
        enumerate(urls),
        key=lambda pair: (
            0 if company_owns_host(name, normalize_domain(pair[1])) else 1,
            pair[0],
        ),
    )
    for _idx, url in ranked_urls:
        host = normalize_domain(url)
        if not host or host in seen:
            continue
        seen.add(host)
        if is_blacklisted_domain(host):
            continue
        candidate = url if url.startswith("http") else f"https://{host}"
        verified = verify_company_domain(name, candidate, location)
        if verified:
            verified["resolution_source"] = "serp_identity"
            verified_candidates.append(verified)
        logger.info("domain resolve: skip dead url %s for %r", candidate[:80], name[:60])

    if verified_candidates:
        verified_candidates.sort(key=lambda item: int(item.get("score") or 0), reverse=True)
        return verified_candidates[0]

    logger.info("domain resolve: no reachable domain for %r", name[:60])
    return None


def _self_check() -> None:
    assert validate_url_reachable("") is False
    assert validate_url_reachable("not-a-url") is False
    assert is_blacklisted_domain("github.com") is True
    assert is_blacklisted_domain("brave.com") is True
    assert _accept_resolved_url("https://github.com/brave/brave-core") is None
    # ponytail: no network in self-check — logic-only
    assert _normalize_url("example.com") == "https://example.com"


if __name__ == "__main__":
    _self_check()
    print("domain_resolver self-check OK")
