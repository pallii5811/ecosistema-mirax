"""HTTP SERP fallback (Bing/Brave/DDG) — paginazione resiliente, no Playwright."""
from __future__ import annotations

import json
import hashlib
import logging
import os
import re
import time
from html import unescape
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import parse_qs, parse_qsl, quote, unquote, urlencode, urlparse, urljoin, urlunparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError

logger = logging.getLogger("search_serp")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

DEFAULT_SERP_TARGET = 25


class SerperCreditsExhausted(RuntimeError):
    """Serper returned HTTP 400 Not enough credits — fail closed, do not burn budget."""

    code = "FAILED_EXTERNAL_CONFIGURATION"
PAGE_FETCH_TIMEOUT = 8.0


def _env_int(name: str, default: int, min_value: int, max_value: int) -> int:
    try:
        value = int(os.getenv(name, str(default)) or default)
    except (TypeError, ValueError):
        value = default
    return max(min_value, min(max_value, value))


def _env_float(name: str, default: float, min_value: float, max_value: float) -> float:
    try:
        value = float(os.getenv(name, str(default)) or default)
    except (TypeError, ValueError):
        value = default
    return max(min_value, min(max_value, value))


def _env_bool(name: str, default: bool = True) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() not in {"0", "false", "no", "off", "disabled"}


API_FETCH_TIMEOUT = _env_float("SERP_API_TIMEOUT_SEC", 18.0, 3.0, 60.0)
# Serper free/start plans reject many complex B2B queries when num > 10
# ("Query pattern not allowed for free accounts"). Keep calls small and page.
SERPER_RESULTS_PER_PAGE = _env_int("SERPER_RESULTS_PER_PAGE", 10, 10, 10)
SERPER_MAX_PAGES = _env_int("SERPER_MAX_PAGES", 5, 1, 5)
SERPER_NEWS_ENABLED = _env_bool("SERPER_NEWS_ENABLED", True)

_BLOCKED_HOSTS = (
    "google.", "gstatic", "youtube.com", "youtu.be", "facebook.com", "instagram.com",
    "wikipedia.", "bing.com", "duckduckgo.com", "brave.com", "github.com", "medium.com",
    "amazon.", "ebay.",
    "paginegialle.", "paginebianche.", "pmi.com",
)

_BLOCKED_PATH_EXTENSIONS = (
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".zip", ".rar",
)

_TRACKING_QUERY_PREFIXES = ("utm_",)
_TRACKING_QUERY_KEYS = {"fbclid", "gclid", "msclkid", "igshid", "mc_cid", "mc_eid"}
_OPENAI_WEB_SEARCH_DISABLED_UNTIL = 0.0
_OPENAI_WEB_SEARCH_LAST_ERROR = ""

_HIGH_VALUE_PATH_RE = re.compile(
    r"/(careers?|jobs?|lavora-con-noi|posizioni-aperte|join-us|news|notizie|"
    r"press|stampa|comunicati|blog|eventi|partner|partnership|case-stud(y|ies)|"
    r"success-stor(y|ies)|landing|contatti|contact)",
    re.I,
)
_HIRING_TERMS_RE = re.compile(
    r"\b(SDR|BDR|sales development|business developer|inside sales|account executive|"
    r"sales account|commerciale|sviluppo commerciale|new business|outbound|prospecting|pipeline)\b",
    re.I,
)
_BUYING_SIGNAL_TERMS_RE = re.compile(
    r"\b(assume|assunzioni|cerchiamo|posizioni aperte|lavora con noi|round|finanziamento|"
    r"espansione|nuova sede|nuovo mercato|partnership|accordo commerciale|fiera|evento|"
    r"albo fornitori|manifestazione di interesse|richiesta preventivo|campagna|landing page|"
    r"inserzioni attive|Google Ads|Meta Ads|CRM|migrazione|digital transformation)\b",
    re.I,
)
_NEWSY_QUERY_RE = re.compile(
    r"\b(comunicato|news|notizie|round|finanziamento|espansione|partnership|accordo|"
    r"nuova sede|nuovo mercato|evento|fiera|appalto|aggiudicazione|investimento)\b",
    re.I,
)
_LOW_VALUE_HOST_RE = re.compile(
    r"(paginegialle|paginebianche|wikipedia|youtube|facebook|instagram|amazon|ebay|github|medium|pmi\.com|"
    r"canonical\.com|factorial|jethr|jet-hr|personio|salesforce|hubspot|oracle|sap|microsoft|google)",
    re.I,
)
_BIG_FAMOUS_HOST_RE = re.compile(
    r"(bmw\.|simest\.|confindustria\.|infocamere\.|emergency\.|italiaonline\.|adecco\.|"
    r"wuerth\.|q8\.|lactalis|leroymerlin|skyscanner|glassdoor\.|staff\.it|"
    r"jeffersonwells|manpower|randstad|gi\s*group|hays\.|michaelpage|"
    r"poste\.|enel\.|eni\.|tim\.|telecomitalia|vodafone|fastweb|"
    r"intesasanpaolo|unicredit|generali|allianz|axa)",
    re.I,
)


def configured_search_providers() -> List[str]:
    providers: List[str] = []
    if os.getenv("SERPER_API_KEY", "").strip():
        providers.append("serper")
    if os.getenv("BRAVE_SEARCH_API_KEY", "").strip():
        providers.append("brave")
    if _env_bool("OPENAI_WEB_SEARCH_ENABLED", False) and "":
        providers.append("openai_web_search")
    return providers


def search_provider_status() -> Dict[str, Any]:
    return {
        "configured": configured_search_providers(),
        "serper": bool(os.getenv("SERPER_API_KEY", "").strip()),
        "brave": bool(os.getenv("BRAVE_SEARCH_API_KEY", "").strip()),
        "openai_enabled": _env_bool("OPENAI_WEB_SEARCH_ENABLED", False),
        "openai_key": bool(""),
        "openai_rate_limited": time.monotonic() < _OPENAI_WEB_SEARCH_DISABLED_UNTIL,
        "openai_last_error": _OPENAI_WEB_SEARCH_LAST_ERROR,
    }


def _target_limit(max_results: int) -> int:
    return max(1, min(int(max_results or DEFAULT_SERP_TARGET), 100))


def _dedupe_urls(urls: Iterable[str], limit: int) -> List[str]:
    out: List[str] = []
    seen: Set[str] = set()
    for raw in urls:
        url = _clean_result_url(str(raw or ""))
        if not url:
            continue
        if not _allowed(url):
            continue
        key = url.lower().rstrip("/")
        if key in seen:
            continue
        seen.add(key)
        out.append(url)
        if len(out) >= limit:
            break
    return out


def _candidate_host(url: str) -> str:
    try:
        return (urlparse(url).netloc or "").lower().replace("www.", "")
    except Exception:
        return ""


def _result_score(query: str, url: str, title: str = "", snippet: str = "", source_type: str = "search") -> int:
    """Rank URLs before scraping: evidence-rich pages first, generic noise last."""
    clean_url = _clean_result_url(url)
    if not clean_url or not _allowed(clean_url):
        return -10_000
    host = _candidate_host(clean_url)
    path = (urlparse(clean_url).path or "").lower()
    blob = f"{query} {title} {snippet} {clean_url}".lower()
    score = 0

    if host.endswith(".it"):
        score += 10
    if _LOW_VALUE_HOST_RE.search(host):
        score -= 120
    if _BIG_FAMOUS_HOST_RE.search(host):
        score -= 160
    if _HIGH_VALUE_PATH_RE.search(path):
        score += 35
    if source_type == "news":
        score += 18
    if re.search(r"\b(indeed\.it|infojobs\.it|linkedin\.com|inrecruiting|join|careers?)\b", host):
        score += 25
    if _HIRING_TERMS_RE.search(blob):
        score += 35
    if _BUYING_SIGNAL_TERMS_RE.search(blob):
        score += 30
    if re.search(r"\b(PMI|piccola|media impresa|startup|scaleup|srl|societ[aà]|azienda italiana)\b", f"{title} {snippet}", re.I):
        score += 12
    if re.search(r"\b(home|homepage|chi-siamo|about|contatti|contact)\b", path, re.I):
        score += 8
    if re.search(r"\b(login|signin|signup|privacy|cookie|terms|tag|category|author)\b", path, re.I):
        score -= 35
    if (
        "/jobsearch/" in path
        or re.fullmatch(r"/offerte-lavoro/[^/]+/?", path)
        or path.rstrip("/") in {"/jobs", "/lavoro"}
        or path.startswith(("/jobs/search", "/jobs/collections"))
    ):
        score -= 220
    if len(path) <= 1 and not host.endswith(".it"):
        score -= 10
    return score


def _dedupe_ranked_hits(
    candidates: Iterable[Tuple[str, str, str, str, str]],
    limit: int,
    query: str = "",
) -> List[Dict[str, str]]:
    """Deduplicate rich SERP hits by URL and cap host dominance after ranking."""
    scored: List[Tuple[int, Dict[str, str]]] = []
    seen: Set[str] = set()
    for raw_url, title, snippet, source_type, provider in candidates:
        url = _clean_result_url(str(raw_url or ""))
        if not url or not _allowed(url):
            continue
        key = url.lower().rstrip("/")
        if key in seen:
            continue
        seen.add(key)
        scored.append((
            _result_score(query, url, title, snippet, source_type),
            {
                "url": url,
                "title": str(title or ""),
                "snippet": str(snippet or ""),
                "source_type": str(source_type or "search"),
                "provider": str(provider or "unknown"),
            },
        ))

    scored.sort(key=lambda item: item[0], reverse=True)
    out: List[Dict[str, str]] = []
    host_counts: Dict[str, int] = {}
    max_per_host = max(2, int(os.getenv("SERPER_MAX_URLS_PER_HOST", "4") or "4"))
    for score, hit in scored:
        if score < -100:
            continue
        url = hit["url"]
        host = _candidate_host(url)
        if host_counts.get(host, 0) >= max_per_host:
            continue
        host_counts[host] = host_counts.get(host, 0) + 1
        out.append(hit)
        if len(out) >= limit:
            break
    return out


def _dedupe_ranked_candidates(candidates: Iterable[Tuple[str, str, str, str]], limit: int, query: str = "") -> List[str]:
    """Backward-compatible URL projection of ranked SERP candidates."""
    rich = ((url, title, snippet, source_type, "unknown") for url, title, snippet, source_type in candidates)
    return [hit["url"] for hit in _dedupe_ranked_hits(rich, limit, query)]


def _clean_result_url(raw_url: str) -> str:
    url = unquote(unescape(str(raw_url or ""))).strip()
    if "](" in url:
        url = url.split("](", 1)[0]
    if "[" in url:
        url = url.split("[", 1)[0]
    url = url.rstrip(").,;]'\"")
    if not url.startswith("http"):
        return ""
    try:
        parsed = urlparse(url)
        query_items = []
        for key, value in parse_qsl(parsed.query, keep_blank_values=True):
            key_l = key.lower()
            if key_l in _TRACKING_QUERY_KEYS or any(key_l.startswith(prefix) for prefix in _TRACKING_QUERY_PREFIXES):
                continue
            query_items.append((key, value))
        return urlunparse(
            (
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                parsed.params,
                urlencode(query_items, doseq=True),
                "",
            )
        )
    except Exception:
        return url


def _post_json(url: str, payload: Dict[str, Any], headers: Dict[str, str], timeout: float = API_FETCH_TIMEOUT) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = Request(url, data=body, headers=headers, method="POST")
    with urlopen(req, timeout=timeout) as res:
        raw = res.read(2_000_000)
        enc = res.headers.get_content_charset() or "utf-8"
        return json.loads(raw.decode(enc, errors="ignore") or "{}")


def _get_json(url: str, headers: Dict[str, str], timeout: float = API_FETCH_TIMEOUT) -> Dict[str, Any]:
    req = Request(url, headers=headers)
    with urlopen(req, timeout=timeout) as res:
        raw = res.read(2_000_000)
        enc = res.headers.get_content_charset() or "utf-8"
        return json.loads(raw.decode(enc, errors="ignore") or "{}")


def _collect_urls_from_json(value: Any) -> List[str]:
    urls: List[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            key_l = str(key).lower()
            if key_l in {"url", "link", "source_url", "uri"} and isinstance(child, str):
                urls.append(child)
            else:
                urls.extend(_collect_urls_from_json(child))
    elif isinstance(value, list):
        for child in value:
            urls.extend(_collect_urls_from_json(child))
    elif isinstance(value, str):
        urls.extend(re.findall(r"https?://[^\s\"'<>]+", value))
    return urls


def _serper_rows(endpoint: str, query: str, *, num: int, page: int = 1) -> List[Dict[str, Any]]:
    key = os.getenv("SERPER_API_KEY", "").strip()
    if not key:
        return []
    payload: Dict[str, Any] = {"q": query, "num": num, "gl": "it", "hl": "it"}
    if page > 1:
        payload["page"] = page
    data = _post_json(
        f"https://google.serper.dev/{endpoint}",
        payload,
        {"X-API-KEY": key, "Content-Type": "application/json", "User-Agent": USER_AGENT},
    )
    if not isinstance(data, dict):
        return []
    key_name = "news" if endpoint == "news" else "organic"
    rows = data.get(key_name)
    return [row for row in rows or [] if isinstance(row, dict)]


def _simplify_serper_query(query: str, *, remove_negatives: bool = False) -> str:
    """Serper is less tolerant than Google UI for very complex Boolean queries."""
    q = query or ""
    if remove_negatives:
        q = re.sub(r'\s-\s*"[^"]+"|\s-"[^"]+"|\s-\S+', " ", q)
    else:
        q = re.sub(r'-"([^"]+)"', r'-\1', q)
    q = re.sub(r"[()]", " ", q)
    q = q.replace('"', " ")
    q = re.sub(r"\bOR\b", " ", q, flags=re.I)
    q = re.sub(r"\s+", " ", q).strip()
    return q[:380].strip()


def _serper_query_variants(query: str) -> List[str]:
    variants: List[str] = []
    for candidate in (
        query,
        _simplify_serper_query(query),
        _simplify_serper_query(query, remove_negatives=True),
    ):
        if candidate and candidate.lower() not in {q.lower() for q in variants}:
            variants.append(candidate)
    return variants


def _search_serper_hits(query: str, target: int) -> List[Dict[str, str]]:
    key = os.getenv("SERPER_API_KEY", "").strip()
    if not key:
        return []
    last_error: Optional[Exception] = None
    for active_query in _serper_query_variants(query):
        retry_next_variant = False
        candidates: List[Tuple[str, str, str, str, str]] = []
        per_page = min(SERPER_RESULTS_PER_PAGE, max(10, target))
        pages = min(SERPER_MAX_PAGES, max(1, (target + per_page - 1) // per_page + 1))
        for page in range(1, pages + 1):
            try:
                rows = _serper_rows("search", active_query, num=per_page, page=page)
            except HTTPError as exc:
                last_error = exc
                if exc.code == 400 and active_query != query:
                    logger.info("SERPER API: simplified query still rejected query=%r", active_query[:70])
                elif exc.code == 400:
                    logger.info("SERPER API: query rejected, retrying simplified variant query=%r", query[:70])
                else:
                    logger.warning("SERPER API failed query=%r: %s", active_query[:70], exc)
                retry_next_variant = True
                break
            except Exception as exc:
                last_error = exc
                logger.warning("SERPER API failed query=%r: %s", active_query[:70], exc)
                retry_next_variant = True
                break
            if not rows:
                break
            for row in rows:
                candidates.append((
                    str(row.get("link") or ""),
                    str(row.get("title") or ""),
                    str(row.get("snippet") or ""),
                    "search",
                    "serper",
                ))
            if len(candidates) >= target * 2:
                break

        if retry_next_variant:
            continue

        if SERPER_NEWS_ENABLED and len(candidates) < target and _NEWSY_QUERY_RE.search(active_query):
            try:
                for row in _serper_rows("news", active_query, num=min(10, max(3, target // 3)), page=1):
                    candidates.append((
                        str(row.get("link") or ""),
                        str(row.get("title") or ""),
                        str(row.get("snippet") or ""),
                        "news",
                        "serper",
                    ))
            except Exception as exc:
                logger.debug("SERPER news failed query=%r: %s", active_query[:70], exc)

        found = _dedupe_ranked_hits(candidates, target, active_query)
        if found:
            logger.info("SERPER API: %s ranked urls for query=%r candidates=%s", len(found), active_query[:70], len(candidates))
        return found
    if last_error:
        logger.warning("SERPER API exhausted query variants query=%r last=%s", query[:70], last_error)
        body = ""
        if isinstance(last_error, HTTPError):
            try:
                body = last_error.read().decode("utf-8", errors="replace")
            except Exception:
                body = str(last_error)
            # HTTPError body can only be read once; stash on the exception for callers.
            setattr(last_error, "_mirax_body", body)
        blob = f"{last_error} {body}".casefold()
        if "not enough credits" in blob or "insufficient credits" in blob:
            raise SerperCreditsExhausted("SERPER_CREDITS_EXHAUSTED") from last_error
    return []


def _search_serper_api(query: str, target: int) -> List[str]:
    return [hit["url"] for hit in _search_serper_hits(query, target)]


def _search_brave_hits(query: str, target: int) -> List[Dict[str, str]]:
    key = os.getenv("BRAVE_SEARCH_API_KEY", "").strip()
    if not key:
        return []
    try:
        url = (
            "https://api.search.brave.com/res/v1/web/search"
            f"?q={quote(query)}&count={min(target, 20)}&country=it&search_lang=it"
        )
        data = _get_json(url, {"X-Subscription-Token": key, "Accept": "application/json", "User-Agent": USER_AGENT})
        rows = ((data.get("web") or {}).get("results") or []) if isinstance(data, dict) else []
        candidates = [
            (
                str(row.get("url") or ""),
                str(row.get("title") or ""),
                str(row.get("description") or ""),
                "search",
                "brave",
            )
            for row in rows
            if isinstance(row, dict)
        ]
        found = _dedupe_ranked_hits(candidates, target, query)
        if found:
            logger.info("BRAVE API: %s urls for query=%r", len(found), query[:70])
        return found
    except Exception as exc:
        logger.warning("BRAVE API failed query=%r: %s", query[:70], exc)
        return []


def _search_brave_api(query: str, target: int) -> List[str]:
    return [hit["url"] for hit in _search_brave_hits(query, target)]


def _openai_web_search_payload(query: str, target: int, model: str, tool_type: str) -> Dict[str, Any]:
    return {
        "model": model,
        "input": (
            "Use web search to find primary source URLs for this B2B lead discovery query. "
            "Return up to "
            f"{target} distinct useful URLs. Prefer official company pages, careers pages, job posts, "
            "press/news pages, and sources with concrete evidence. "
            "Avoid social login pages, code repositories, generic directories and marketplaces. "
            f"Query: {query}"
        ),
        "tools": [
            {
                "type": tool_type,
                "search_context_size": "medium",
                "user_location": {"type": "approximate", "country": "IT"},
            }
        ],
        "tool_choice": {"type": tool_type},
        "include": ["web_search_call.action.sources"],
        "max_output_tokens": max(600, min(1600, target * 80)),
    }


def _search_openai_web(query: str, target: int) -> List[str]:
    global _OPENAI_WEB_SEARCH_DISABLED_UNTIL, _OPENAI_WEB_SEARCH_LAST_ERROR
    if not _env_bool("OPENAI_WEB_SEARCH_ENABLED", False):
        logger.info("OPENAI web search disabled by OPENAI_WEB_SEARCH_ENABLED")
        return []
    if time.monotonic() < _OPENAI_WEB_SEARCH_DISABLED_UNTIL:
        logger.warning("OPENAI web search circuit open; skipping query=%r", query[:70])
        return []
    key = ""
    if not key:
        return []
    model_candidates = [
        "",
        "",
    ]
    tool_candidates = [
        "",
        "web_search",
    ]
    tried: Set[str] = set()
    for model in [m for m in model_candidates if m]:
        for tool_type in [t for t in tool_candidates if t]:
            sig = f"{model}:{tool_type}"
            if sig in tried:
                continue
            tried.add(sig)
            try:
                data = _post_json(
                    'data:,mirax-legacy-provider-removed',
                    _openai_web_search_payload(query, target, model, tool_type),
                    {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": USER_AGENT},
                    timeout=max(API_FETCH_TIMEOUT, 30.0),
                )
                found = _dedupe_urls(_collect_urls_from_json(data), target)
                if found:
                    logger.info(
                        "OPENAI web search: %s urls model=%s tool=%s query=%r",
                        len(found),
                        model,
                        tool_type,
                        query[:70],
                    )
                    return found
            except HTTPError as exc:
                if exc.code == 429:
                    cooldown = _env_float("OPENAI_WEB_SEARCH_CIRCUIT_BREAKER_SEC", 900.0, 30.0, 86400.0)
                    _OPENAI_WEB_SEARCH_DISABLED_UNTIL = time.monotonic() + cooldown
                    _OPENAI_WEB_SEARCH_LAST_ERROR = f"HTTP_429 rate_limited cooldown={cooldown:.0f}s"
                    logger.error(
                        "OPENAI web search rate-limited; circuit opened %.0fs model=%s tool=%s query=%r",
                        cooldown,
                        model,
                        tool_type,
                        query[:70],
                    )
                    return []
                _OPENAI_WEB_SEARCH_LAST_ERROR = f"HTTP_{exc.code}"
                logger.warning("OPENAI web search failed model=%s tool=%s query=%r: %s", model, tool_type, query[:70], exc)
            except Exception as exc:
                _OPENAI_WEB_SEARCH_LAST_ERROR = str(exc)[:180]
                logger.warning("OPENAI web search failed model=%s tool=%s query=%r: %s", model, tool_type, query[:70], exc)
    return []


def _fetch_html(url: str, timeout: float = PAGE_FETCH_TIMEOUT) -> str:
    try:
        req = Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "it-IT,it;q=0.9"})
        with urlopen(req, timeout=timeout) as res:
            body = res.read(600_000)
            enc = res.headers.get_content_charset() or "utf-8"
            return body.decode(enc, errors="ignore")
    except Exception as exc:
        logger.debug("SERP fetch skip %s: %s", url[:80], exc)
        return ""


def _decode_href(href: str) -> str:
    href = unescape(href or "")
    if href.startswith("//"):
        href = "https:" + href
    if "duckduckgo.com/l/?" in href or href.startswith("/l/?"):
        qs = parse_qs(urlparse(href).query)
        return unquote(qs.get("uddg", [""])[0] or href)
    if href.startswith("/url?"):
        return parse_qs(urlparse(href).query).get("q", [""])[0]
    return href


def _allowed(url: str) -> bool:
    try:
        host = (urlparse(url).netloc or "").lower().replace("www.", "")
        path = (urlparse(url).path or "").lower()
        if not url.startswith("http") or not host:
            return False
        if any(path.endswith(ext) for ext in _BLOCKED_PATH_EXTENSIONS):
            return False
        return not any(b in host for b in _BLOCKED_HOSTS)
    except Exception:
        return False


def _extract_links_from_html(
    html: str,
    base_url: str,
    seen_urls: Set[str],
    host_counts: Dict[str, int],
    *,
    max_per_host: int = 4,
) -> List[str]:
    out: List[str] = []
    if not html:
        return out
    for m in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\']', html, re.I):
        href = _clean_result_url(_decode_href(unquote(m.group(1)).split("#", 1)[0]))
        if not href.startswith("http"):
            href = urljoin(base_url, href)
        if not _allowed(href):
            continue
        host = urlparse(href).netloc.lower().replace("www.", "")
        key = href.lower().rstrip("/")
        if key in seen_urls or host_counts.get(host, 0) >= max_per_host:
            continue
        seen_urls.add(key)
        host_counts[host] = host_counts.get(host, 0) + 1
        out.append(href)
    return out


def _bing_pages(query: str, target: int) -> List[str]:
    """Bing pagine 1-3 (first=1, 11, 21)."""
    urls: List[str] = []
    seen_urls: Set[str] = set()
    host_counts: Dict[str, int] = {}
    q = quote(query)
    for first in range(1, min(target, 100) + 1, 10):
        if len(urls) >= target:
            break
        search_url = f"https://www.bing.com/search?q={q}&setlang=it-IT&cc=IT&count=15&first={first}"
        html = _fetch_html(search_url)
        found = _extract_links_from_html(html, search_url, seen_urls, host_counts)
        urls.extend(found)
        if not found:
            break
    return urls[:target]


def _ddg_pages(query: str, target: int) -> List[str]:
    """DuckDuckGo HTML — pagina 1 e 2 (offset s=0, s=30). Timeout → skip pagina."""
    urls: List[str] = []
    seen_urls: Set[str] = set()
    host_counts: Dict[str, int] = {}
    q = quote(query)
    for offset in range(0, min(target, 100), 30):
        if len(urls) >= target:
            break
        suffix = f"&s={offset}" if offset else ""
        search_url = f"https://duckduckgo.com/html/?q={q}{suffix}"
        html = _fetch_html(search_url)
        if not html:
            logger.info("DDG page offset=%s timeout/empty — skip", offset)
            continue
        found = _extract_links_from_html(html, search_url, seen_urls, host_counts)
        urls.extend(found)
        if not found:
            break
    return urls[:target]


def _brave_page(
    query: str,
    target: int,
    seen_urls: Set[str],
    host_counts: Dict[str, int],
) -> List[str]:
    q = quote(query)
    search_url = f"https://search.brave.com/search?q={q}&source=web"
    html = _fetch_html(search_url)
    return _extract_links_from_html(html, search_url, seen_urls, host_counts)[:target]


def _url_hits(urls: Iterable[str], provider: str) -> List[Dict[str, str]]:
    return [
        {"url": url, "title": "", "snippet": "", "source_type": "search", "provider": provider}
        for url in urls
        if url
    ]


def search_hits_http(
    query: str,
    max_results: int = DEFAULT_SERP_TARGET,
    *,
    cost_scope: Optional[str] = None,
) -> List[Dict[str, str]]:
    """
    API/browsing first, HTML fallback last.
    Target default 25 URL; non blocca se una sorgente SERP fallisce.
    """
    target = _target_limit(max_results)
    governor = None
    reservation_key = None
    estimated_cost = max(0.0, float(os.getenv("MIRAX_SUPPLEMENTAL_SERP_RESERVED_EUR", "0.005") or "0.005"))
    if cost_scope:
        from cost_context import current_cost_governor

        governor = current_cost_governor()
        if governor is None:
            raise RuntimeError("PAID_SEARCH_BLOCKED_WITHOUT_COST_GOVERNOR")
        paid_provider = (
            "serper" if os.getenv("SERPER_API_KEY", "").strip()
            else "brave" if os.getenv("BRAVE_SEARCH_API_KEY", "").strip()
            else None
        )
        if paid_provider:
            digest = hashlib.sha256(f"{cost_scope}:{query}:{target}".encode("utf-8")).hexdigest()[:20]
            # Covers the configured API request bundle; HTML fallbacks are free.
            reservation_key = f"serp-supplemental:{digest}"
            reservation = governor.reserve(
                reservation_key,
                "web_search",
                estimated_cost,
                provider=paid_provider,
                source_class="supplemental_domain_resolution",
                metadata={"target_results": target},
            )
            if reservation.status != "reserved":
                reservation_key = None
                logger.info("supplemental SERP idempotency hit status=%s; paid providers skipped", reservation.status)
    collected: List[Dict[str, str]] = []
    collected_keys: Set[str] = set()
    seen_urls: Set[str] = set()
    host_counts: Dict[str, int] = {}

    paid_providers = ()
    if not cost_scope or reservation_key:
        if os.getenv("SERPER_API_KEY", "").strip():
            paid_providers = (_search_serper_hits,)
        elif os.getenv("BRAVE_SEARCH_API_KEY", "").strip():
            paid_providers = (_search_brave_hits,)
    provider_failed = False
    for provider in paid_providers:
        try:
            provider_hits = provider(query, target)
        except SerperCreditsExhausted:
            if reservation_key and governor:
                governor.settle(
                    reservation_key,
                    0.0,
                    metadata={"result_count": 0, "error": "SERPER_CREDITS_EXHAUSTED"},
                )
            raise
        except Exception as exc:
            provider_failed = True
            logger.warning("paid SERP provider failed query=%r: %s", query[:70], exc)
            provider_hits = []
        for hit in provider_hits:
            key = hit["url"].lower().rstrip("/")
            if key not in collected_keys:
                collected_keys.add(key)
                collected.append(hit)
            if len(collected) >= target:
                if reservation_key and governor:
                    governor.settle(reservation_key, estimated_cost, metadata={"result_count": len(collected)})
                return collected[:target]

    if (not cost_scope or reservation_key) and len(collected) < target:
        for hit in _url_hits(_search_openai_web(query, target), "openai_web_search"):
            key = hit["url"].lower().rstrip("/")
            if key not in collected_keys:
                collected_keys.add(key)
                collected.append(hit)
            if len(collected) >= target:
                break

    if len(collected) >= target:
        if reservation_key and governor:
            governor.settle(reservation_key, estimated_cost, metadata={"result_count": len(collected)})
        return collected[:target]

    if reservation_key and governor:
        # Paid API errors should not consume the canary hard-cap. A true empty
        # organic page still settles the reserved SERP cost.
        actual = 0.0 if provider_failed else estimated_cost
        governor.settle(
            reservation_key,
            actual,
            metadata={"result_count": len(collected), "paid_empty": not collected, "provider_failed": provider_failed},
        )

    for hit in _url_hits(_ddg_pages(query, target), "duckduckgo_html"):
        key = hit["url"].lower().rstrip("/")
        if key not in collected_keys:
            collected_keys.add(key)
            collected.append(hit)
        if len(collected) >= target:
            return collected[:target]

    for hit in _url_hits(_bing_pages(query, target - len(collected)), "bing_html"):
        key = hit["url"].lower().rstrip("/")
        if key not in collected_keys:
            collected_keys.add(key)
            collected.append(hit)
        if len(collected) >= target:
            return collected[:target]

    for hit in _url_hits(_brave_page(query, target - len(collected), seen_urls, host_counts), "brave_html"):
        key = hit["url"].lower().rstrip("/")
        if key not in collected_keys:
            collected_keys.add(key)
            collected.append(hit)
        if len(collected) >= target:
            break

    return collected[:target]


def search_urls_http(
    query: str,
    max_results: int = DEFAULT_SERP_TARGET,
    *,
    cost_scope: Optional[str] = None,
) -> List[str]:
    """Backward-compatible URL projection. Performs exactly one SERP execution."""
    return [hit["url"] for hit in search_hits_http(query, max_results, cost_scope=cost_scope)]
