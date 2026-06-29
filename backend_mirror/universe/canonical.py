"""Canonical ID normalisation helpers (Python mirror of src/lib/universe/canonical.ts)."""

import re
from typing import Optional
from urllib.parse import urlparse


_RE_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize_domain(input_value: Optional[str]) -> Optional[str]:
    if not input_value:
        return None
    try:
        url = input_value.strip().lower()
        if not re.match(r"^https?://", url):
            url = f"https://{url}"
        parsed = urlparse(url)
        host = parsed.hostname or ""
        host = re.sub(r"^www\.", "", host)
        host = re.sub(r":\d+$", "", host)
        return host or None
    except Exception:
        return None


def normalize_phone(input_value: Optional[str]) -> Optional[str]:
    if not input_value:
        return None
    digits = re.sub(r"\D", "", input_value)
    if len(digits) < 6:
        return None
    if digits.startswith("39") and len(digits) >= 10:
        return digits
    if digits.startswith("3") and len(digits) == 10:
        return f"39{digits}"
    return digits


def normalize_email(input_value: Optional[str]) -> Optional[str]:
    if not input_value:
        return None
    email = input_value.strip().lower()
    if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
        return None
    return email


def normalize_vat(input_value: Optional[str]) -> Optional[str]:
    if not input_value:
        return None
    digits = re.sub(r"\D", "", input_value)
    if len(digits) != 11:
        return None
    return f"IT{digits}"


def normalize_linkedin(input_value: Optional[str]) -> Optional[str]:
    if not input_value:
        return None
    try:
        url = input_value.strip().lower()
        parsed = urlparse(url)
        path = parsed.path.rstrip("/")
        if path.startswith("/in/") or path.startswith("/company/"):
            return f"linkedin.com{path}"
        return None
    except Exception:
        return None


def slugify_technology(input_value: Optional[str]) -> Optional[str]:
    if not input_value:
        return None
    slug = input_value.lower().strip()
    slug = re.sub(r"\s+", "_", slug)
    slug = re.sub(r"[^a-z0-9_]", "", slug)
    return slug or None


def slugify_location(city: Optional[str], country: str = "IT") -> Optional[str]:
    if not city:
        return None
    slug = city.lower().strip()
    slug = re.sub(r"\s+", "_", slug)
    slug = re.sub(r"[^a-z0-9_]", "", slug)
    return f"{country.lower()}:{slug}" if slug else None


def slugify_name(input_value: Optional[str]) -> Optional[str]:
    if not input_value:
        return None
    slug = input_value.lower().strip()
    slug = re.sub(r"\s+", "-", slug)
    slug = re.sub(r"[^a-z0-9\-]", "", slug)
    slug = re.sub(r"-+", "-", slug)
    slug = slug.strip("-")
    return slug or None
