"""SSRF-safe public web access primitives for MIRAX crawlers and audits."""
from __future__ import annotations

import asyncio
import ipaddress
import socket
import threading
import time
from typing import Any, Dict, Tuple
from urllib.parse import urljoin, urlparse


class UnsafeUrlError(ValueError):
    pass


_DNS_TTL_SECONDS = 300
_dns_cache: Dict[str, Tuple[float, Tuple[str, ...]]] = {}
_dns_lock = threading.Lock()


def _resolve(hostname: str) -> Tuple[str, ...]:
    now = time.monotonic()
    with _dns_lock:
        cached = _dns_cache.get(hostname)
        if cached and cached[0] > now:
            return cached[1]
    try:
        addresses = tuple(sorted({row[4][0] for row in socket.getaddrinfo(hostname, None)}))
    except socket.gaierror as exc:
        raise UnsafeUrlError("URL_HOST_UNRESOLVABLE") from exc
    if not addresses:
        raise UnsafeUrlError("URL_HOST_UNRESOLVABLE")
    with _dns_lock:
        _dns_cache[hostname] = (now + _DNS_TTL_SECONDS, addresses)
    return addresses


def assert_safe_public_url(value: str) -> str:
    raw = str(value or "").strip()
    try:
        parsed = urlparse(raw)
    except ValueError as exc:
        raise UnsafeUrlError("URL_INVALID") from exc
    if parsed.scheme.lower() not in {"http", "https"}:
        raise UnsafeUrlError("URL_SCHEME_FORBIDDEN")
    if parsed.username or parsed.password:
        raise UnsafeUrlError("URL_CREDENTIALS_FORBIDDEN")
    hostname = (parsed.hostname or "").strip(".").lower()
    if not hostname or hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".localhost"):
        raise UnsafeUrlError("URL_HOST_FORBIDDEN")
    try:
        port = parsed.port
    except ValueError as exc:
        raise UnsafeUrlError("URL_PORT_INVALID") from exc
    if port not in {None, 80, 443}:
        raise UnsafeUrlError("URL_PORT_FORBIDDEN")
    try:
        literal = ipaddress.ip_address(hostname.strip("[]"))
        addresses = (str(literal),)
    except ValueError:
        addresses = _resolve(hostname)
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise UnsafeUrlError("URL_PRIVATE_OR_RESERVED_ADDRESS")
    return raw


async def assert_safe_public_url_async(value: str) -> str:
    return await asyncio.to_thread(assert_safe_public_url, value)


async def safe_async_get(client: Any, url: str, *, max_redirects: int = 5, **kwargs: Any) -> Any:
    current = assert_safe_public_url(url)
    for _ in range(max_redirects + 1):
        response = await client.get(current, follow_redirects=False, **kwargs)
        if response.status_code not in {301, 302, 303, 307, 308}:
            assert_safe_public_url(str(response.url))
            return response
        location = response.headers.get("location")
        if not location:
            return response
        current = assert_safe_public_url(urljoin(current, location))
    raise UnsafeUrlError("URL_REDIRECT_LIMIT_EXCEEDED")


def safe_requests_get(session: Any, url: str, *, max_redirects: int = 5, **kwargs: Any) -> Any:
    current = assert_safe_public_url(url)
    for _ in range(max_redirects + 1):
        response = session.get(current, allow_redirects=False, **kwargs)
        if response.status_code not in {301, 302, 303, 307, 308}:
            assert_safe_public_url(str(getattr(response, "url", current)))
            return response
        location = response.headers.get("location")
        if not location:
            return response
        current = assert_safe_public_url(urljoin(current, location))
    raise UnsafeUrlError("URL_REDIRECT_LIMIT_EXCEEDED")


async def install_playwright_ssrf_guard(page: Any) -> None:
    async def guard(route: Any) -> None:
        try:
            await assert_safe_public_url_async(route.request.url)
            await route.continue_()
        except Exception:
            await route.abort("blockedbyclient")

    await page.route("**/*", guard)
