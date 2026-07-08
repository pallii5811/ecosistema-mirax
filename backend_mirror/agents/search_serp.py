"""HTTP SERP fallback (Bing/Brave/DDG) — paginazione resiliente, no Playwright."""
from __future__ import annotations

import logging
import re
from html import unescape
from typing import Dict, List, Set
from urllib.parse import parse_qs, quote, unquote, urlparse, urljoin
from urllib.request import Request, urlopen

logger = logging.getLogger("search_serp")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

DEFAULT_SERP_TARGET = 25
PAGE_FETCH_TIMEOUT = 8.0

_BLOCKED_HOSTS = (
    "google.", "gstatic", "youtube.com", "youtu.be", "facebook.com", "instagram.com",
    "wikipedia.", "bing.com", "duckduckgo.com", "brave.com", "amazon.", "ebay.",
    "paginegialle.", "paginebianche.",
)


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
        if not url.startswith("http") or not host:
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
        href = _decode_href(unquote(m.group(1)).split("#", 1)[0])
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


def search_urls_http(query: str, max_results: int = DEFAULT_SERP_TARGET) -> List[str]:
    """
    DDG (paginato) → Bing (paginato) → Brave.
    Target default 25 URL; non blocca se una pagina SERP fallisce.
    """
    target = max(15, min(max_results, 100))
    collected: List[str] = []
    seen_urls: Set[str] = set()
    host_counts: Dict[str, int] = {}

    for url in _ddg_pages(query, target):
        if url not in collected:
            collected.append(url)
        if len(collected) >= target:
            return collected[:target]

    for url in _bing_pages(query, target - len(collected)):
        if url not in collected:
            collected.append(url)
        if len(collected) >= target:
            return collected[:target]

    for url in _brave_page(query, target - len(collected), seen_urls, host_counts):
        if url not in collected:
            collected.append(url)
        if len(collected) >= target:
            break

    return collected[:target]
