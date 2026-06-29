"""MIRAX Universe Data Model — Python SDK."""

from .canonical import (
    normalize_domain,
    normalize_phone,
    normalize_email,
    normalize_vat,
    normalize_linkedin,
    slugify_technology,
    slugify_location,
    slugify_name,
)
from .repository import UniverseRepository
from .ingest import ingest_mirax_lead
from .sidecar import is_universe_enabled, ingest_leads_batch, ingest_single_lead

__all__ = [
    "normalize_domain",
    "normalize_phone",
    "normalize_email",
    "normalize_vat",
    "normalize_linkedin",
    "slugify_technology",
    "slugify_location",
    "slugify_name",
    "UniverseRepository",
    "ingest_mirax_lead",
    "is_universe_enabled",
    "ingest_leads_batch",
    "ingest_single_lead",
]
