"""Ingest MIRAX leads into Universe (Python sidecar)."""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .canonical import (
    normalize_domain,
    normalize_email,
    normalize_phone,
    normalize_vat,
    slugify_location,
    slugify_name,
    slugify_technology,
)
from .models import (
    IngestResult,
    UniverseEntity,
    UniverseEntityAlias,
    UniverseEvent,
    UniverseObservation,
    UniverseRelationship,
)
from .repository import UniverseError, UniverseRepository

logger = logging.getLogger(__name__)


def _get(lead: Dict[str, Any], keys: List[str], default: Any = None) -> Any:
    for key in keys:
        if key in lead and lead[key] is not None:
            return lead[key]
    return default


def _to_number(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value) if value > 0 else None
    if isinstance(value, str):
        digits = "".join(ch for ch in value if ch.isdigit())
        if digits:
            n = int(digits)
            return n if n > 0 else None
    return None


def _resolve_name(lead: Dict[str, Any]) -> str:
    return (
        _get(lead, ["azienda", "nome", "companyName", "name", "ragioneSociale"])
        or "Unknown Entity"
    )


def _resolve_domain(lead: Dict[str, Any]) -> Optional[str]:
    return normalize_domain(_get(lead, ["sito", "website", "url"]))


def _resolve_city(lead: Dict[str, Any]) -> Optional[str]:
    return _get(lead, ["citta", "city", "localita"])


def _map_signal_to_event(signal_type: str) -> Optional[str]:
    mapping = {
        "hiring": "new_hiring",
        "new_hiring": "new_hiring",
        "registry_change": "registry_change",
        "funding_news": "funding_received",
        "funding_received": "funding_received",
        "site_stale": "website_changed",
        "website_changed": "website_changed",
        "meta_ads_started": "pixel_installed",
        "google_ads_started": "crm_installed",
        "crm_detected": "crm_installed",
    }
    return mapping.get(signal_type.lower())


def ingest_mirax_lead(
    repo: UniverseRepository,
    lead: Dict[str, Any],
    source: str,
    user_id: Optional[str] = None,
) -> IngestResult:
    now = datetime.now(timezone.utc).isoformat()
    name = _resolve_name(lead)
    domain = _resolve_domain(lead)
    city = _resolve_city(lead)
    country = lead.get("country", "IT")
    canonical_id = (
        domain
        or normalize_phone(_get(lead, ["telefono", "phone"]))
        or slugify_name(name)
    )

    if not canonical_id:
        raise UniverseError("CANONICAL_ID_MISSING", "Impossibile determinare canonical_id per il lead")

    aliases: List[UniverseEntityAlias] = []
    if domain:
        aliases.append(UniverseEntityAlias(entity_id="", alias_type="domain", alias_value=domain, confidence=1.0))
    vat = normalize_vat(_get(lead, ["partitaIva", "piva", "vatNumber"]))
    if vat:
        aliases.append(UniverseEntityAlias(entity_id="", alias_type="vat", alias_value=vat, confidence=0.95))
    phone = normalize_phone(_get(lead, ["telefono", "phone"]))
    if phone:
        aliases.append(UniverseEntityAlias(entity_id="", alias_type="phone", alias_value=phone, confidence=0.9))
    email = normalize_email(_get(lead, ["email"]))
    if email:
        aliases.append(UniverseEntityAlias(entity_id="", alias_type="email", alias_value=email, confidence=0.9))

    company_entity = UniverseEntity(
        canonical_id=canonical_id,
        entity_type="company",
        name=name,
        slug=slugify_name(name),
        country=country,
        city=city,
        region=lead.get("region"),
        metadata={
            "category": _get(lead, ["categoria", "category"]),
            "address": _get(lead, ["indirizzo", "address"]),
            **(lead.get("openapi_enriched") or {}),
        },
        confidence=1.0,
    )

    company, is_new = repo.upsert_entity(company_entity, aliases=aliases)

    observations: List[UniverseObservation] = []
    relationships: List[UniverseRelationship] = []
    events: List[UniverseEvent] = []

    last_audited_at = lead.get("last_audited_at") or now

    # Website + audit
    if domain:
        website, _ = repo.upsert_entity(
            UniverseEntity(
                canonical_id=domain,
                entity_type="website",
                name=domain,
                slug=slugify_name(domain),
                country=country,
                city=city,
                metadata={"url": _get(lead, ["sito", "website", "url"])},
                confidence=1.0,
            )
        )
        relationships.append(
            UniverseRelationship(
                source_entity_id=company.id,
                target_entity_id=website.id,
                relationship_type="owns",
                source=source,
                observed_at=now,
                confidence=1.0,
            )
        )

        audit_attrs = [
            ("meta_pixel", lead.get("meta_pixel") is True),
            ("google_tag_manager", lead.get("google_tag_manager") is True),
            ("google_analytics", lead.get("google_analytics") is True),
            ("ssl", lead.get("ssl") is True),
            ("mobile_friendly", lead.get("mobile_friendly") is True),
            ("seo_disaster", lead.get("seo_disaster") is True),
            ("load_speed_seconds", lead.get("load_speed_seconds") or lead.get("load_speed_s")),
            ("has_spf", lead.get("has_spf") is True),
            ("has_dmarc", lead.get("has_dmarc") is True),
        ]
        for attr, value in audit_attrs:
            if value is None:
                continue
            observations.append(
                UniverseObservation(
                    entity_id=website.id,
                    attribute=attr,
                    value=value,
                    source=source,
                    observed_at=last_audited_at,
                    confidence=1.0,
                    metadata={"source_entity": "website"},
                )
            )
            observations.append(
                UniverseObservation(
                    entity_id=company.id,
                    attribute=attr,
                    value=value,
                    source=source,
                    observed_at=last_audited_at,
                    confidence=0.95,
                    metadata={"mirrored_from": website.id},
                )
            )

    # Technologies
    tech_stack = lead.get("tech_stack") or []
    for tech in tech_stack:
        tech_slug = slugify_technology(tech)
        if not tech_slug:
            continue
        tech_entity, _ = repo.upsert_entity(
            UniverseEntity(
                canonical_id=tech_slug,
                entity_type="technology",
                name=tech,
                slug=tech_slug,
                confidence=1.0,
            )
        )
        relationships.append(
            UniverseRelationship(
                source_entity_id=company.id,
                target_entity_id=tech_entity.id,
                relationship_type="uses",
                source=source,
                observed_at=now,
                confidence=1.0,
            )
        )

    # Maps observations
    rating = lead.get("rating") if lead.get("rating") is not None else lead.get("google_rating")
    if rating is not None:
        observations.append(
            UniverseObservation(
                entity_id=company.id,
                attribute="rating",
                value=rating,
                source=source,
                observed_at=now,
                confidence=1.0,
            )
        )

    reviews_count = lead.get("reviews_count") if lead.get("reviews_count") is not None else lead.get("google_reviews_count")
    if reviews_count is not None:
        observations.append(
            UniverseObservation(
                entity_id=company.id,
                attribute="reviews_count",
                value=reviews_count,
                source=source,
                observed_at=now,
                confidence=1.0,
            )
        )

    if lead.get("is_claimed") is not None:
        observations.append(
            UniverseObservation(
                entity_id=company.id,
                attribute="is_claimed",
                value=lead.get("is_claimed"),
                source=source,
                observed_at=now,
                confidence=1.0,
            )
        )

    # Registry
    employees = _to_number(lead.get("dipendenti"))
    if employees is not None:
        observations.append(
            UniverseObservation(
                entity_id=company.id,
                attribute="employees",
                value=employees,
                source="openapi" if lead.get("openapi_enriched") else source,
                observed_at=now,
                confidence=0.95 if lead.get("openapi_enriched") else 0.6,
            )
        )

    revenue = _to_number(lead.get("fatturato"))
    if revenue is not None:
        observations.append(
            UniverseObservation(
                entity_id=company.id,
                attribute="revenue",
                value=revenue,
                source="openapi" if lead.get("openapi_enriched") else source,
                observed_at=now,
                confidence=0.95 if lead.get("openapi_enriched") else 0.6,
            )
        )

    if lead.get("formaGiuridica"):
        observations.append(
            UniverseObservation(
                entity_id=company.id,
                attribute="legal_form",
                value=lead.get("formaGiuridica"),
                source=source,
                observed_at=now,
                confidence=0.9,
            )
        )

    # Location
    if city:
        location_slug = slugify_location(city, country)
        if location_slug:
            location_entity, _ = repo.upsert_entity(
                UniverseEntity(
                    canonical_id=location_slug,
                    entity_type="location",
                    name=city,
                    slug=location_slug,
                    country=country,
                    city=city,
                    confidence=1.0,
                )
            )
            relationships.append(
                UniverseRelationship(
                    source_entity_id=company.id,
                    target_entity_id=location_entity.id,
                    relationship_type="located_in",
                    source=source,
                    observed_at=now,
                    confidence=1.0,
                )
            )

    # Business signals
    for signal in lead.get("business_signals") or []:
        signal_type = signal.get("signalType") or signal.get("type") or "unknown"
        event_type = _map_signal_to_event(signal_type)
        if event_type:
            events.append(
                UniverseEvent(
                    entity_id=company.id,
                    event_type=event_type,
                    payload={
                        "signal_type": signal_type,
                        "title": signal.get("title"),
                        "severity": signal.get("severity"),
                        "evidence": signal.get("evidence") or [],
                    },
                    source=signal.get("source") or source,
                    occurred_at=signal.get("detected_at") or now,
                )
            )

    # Hiring jobs
    for job in lead.get("business_hiring_jobs") or []:
        title = job.get("title")
        if not title:
            continue
        job_url = job.get("url")
        job_canonical = normalize_domain(job_url) or slugify_name(title)
        if not job_canonical:
            continue
        job_entity, _ = repo.upsert_entity(
            UniverseEntity(
                canonical_id=job_canonical,
                entity_type="job",
                name=title,
                slug=slugify_name(title),
                city=job.get("location") or city,
                metadata={"url": job_url, "location": job.get("location")},
                confidence=0.85,
            )
        )
        relationships.append(
            UniverseRelationship(
                source_entity_id=company.id,
                target_entity_id=job_entity.id,
                relationship_type="hires",
                source=job.get("source") or source,
                observed_at=now,
                confidence=0.85,
            )
        )
        events.append(
            UniverseEvent(
                entity_id=company.id,
                event_type="new_hiring",
                payload={
                    "job_title": title,
                    "job_url": job_url,
                    "job_location": job.get("location"),
                },
                source=job.get("source") or source,
                occurred_at=now,
            )
        )

    obs_count = repo.create_observations(observations)
    rel_count = repo.create_relationships(relationships)
    event_count = repo.append_events(events)

    return IngestResult(
        entity_id=company.id,
        entity_type="company",
        observations_created=obs_count,
        relationships_created=rel_count,
        events_created=event_count,
        aliases_created=len(aliases),
        is_new=is_new,
    )
