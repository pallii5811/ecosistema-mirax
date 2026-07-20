"""Careers/ATS host classification without source_adapters package imports."""
from __future__ import annotations

_CAREERS_HOST_PREFIXES = frozenset({"careers", "jobs", "job", "lavora", "work", "join", "recruiting"})
_ATS_MARKERS = ("myworkdayjobs", "greenhouse", "lever.co", "smartrecruiters")


def is_careers_only_host(domain: str) -> bool:
    host = str(domain or "").lower().removeprefix("www.")
    parts = host.split(".")
    if not parts:
        return False
    if parts[0] in _CAREERS_HOST_PREFIXES:
        return True
    return any(part in _ATS_MARKERS for part in parts)
