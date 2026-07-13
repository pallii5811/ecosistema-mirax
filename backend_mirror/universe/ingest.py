"""Ingest MIRAX leads into Universe (Python sidecar)."""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .canonical import (
    normalize_domain,
    normalize_email,
    normalize_linkedin,
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
from .relation_extractors import (
    extract_business_signal_relations,
    extract_job_relations,
    extract_news_relations,
    extract_tender_relations,
    extract_web_relations,
)
from .repository import (
    UniverseError,
    UniverseRepository,
    _event_dedup_key,
    _observation_dedup_key,
)

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


def _avg(values: List[Any]) -> Optional[float]:
    numbers = [v for v in values if isinstance(v, (int, float))]
    return sum(numbers) / len(numbers) if numbers else None


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
        "google_ads_started": "ads_started",
        "ads_started": "ads_started",
        "crm_detected": "crm_installed",
        "crm_installed": "crm_installed",
        "tender_won": "tender_won",
        "sector_investment": "sector_investment",
        "revenue_changed": "revenue_changed",
        "employees_changed": "employees_changed",
        "new_location": "registry_change",
        "expansion": "registry_change",
        "partnership": "registry_change",
        "acquisition": "registry_change",
        "price_change": "registry_change",
        "executive_change": "new_director",
    }
    return mapping.get(signal_type.lower())


def _build_event_payload(signal: Dict[str, Any], event_type: str) -> Dict[str, Any]:
    base = {
        "signal_type": signal.get("signalType") or signal.get("type"),
        "title": signal.get("title"),
        "severity": signal.get("severity"),
        "evidence": signal.get("evidence") or [],
    }
    if event_type in ("funding_received", "funding_news"):
        base.update({
            "amount": signal.get("amount"),
            "currency": signal.get("currency") or "EUR",
            "round": signal.get("round"),
            "lead_investor": signal.get("lead_investor"),
            "valuation": signal.get("valuation"),
        })
    if event_type in ("revenue_changed", "employees_changed"):
        base.update({
            "value": signal.get("value") or signal.get("new_value"),
            "previous_value": signal.get("previous_value"),
            "unit": signal.get("unit"),
        })
    if event_type == "new_director":
        base.update({
            "executive_name": signal.get("executive_name") or signal.get("name"),
            "role": signal.get("role"),
        })
    return base


def ingest_mirax_lead(
    repo: UniverseRepository,
    lead: Dict[str, Any],
    source: str,
    user_id: Optional[str] = None,
    enable_live_sources: bool = False,
) -> IngestResult:
    now = datetime.now(timezone.utc).isoformat()
    name = _resolve_name(lead)
    domain = _resolve_domain(lead)
    city = _resolve_city(lead)
    country = lead.get("country", "IT")
    vat = normalize_vat(_get(lead, ["partitaIva", "piva", "vatNumber"]))
    canonical_id = (
        domain
        or vat
        or normalize_phone(_get(lead, ["telefono", "phone"]))
        or slugify_name(name)
    )

    if not canonical_id:
        raise UniverseError("CANONICAL_ID_MISSING", "Impossibile determinare canonical_id per il lead")

    aliases: List[UniverseEntityAlias] = []
    if domain:
        aliases.append(UniverseEntityAlias(entity_id="", alias_type="domain", alias_value=domain, confidence=1.0))
    if vat:
        aliases.append(UniverseEntityAlias(entity_id="", alias_type="vat", alias_value=vat, confidence=0.95))
    phone = normalize_phone(_get(lead, ["telefono", "phone"]))
    if phone:
        aliases.append(UniverseEntityAlias(entity_id="", alias_type="phone", alias_value=phone, confidence=0.9))
    email = normalize_email(_get(lead, ["email"]))
    if email:
        aliases.append(UniverseEntityAlias(entity_id="", alias_type="email", alias_value=email, confidence=0.9))
    for social_key, alias_type in [("linkedin", "linkedin"), ("facebook", "facebook"), ("instagram", "instagram")]:
        social_url = normalize_linkedin(_get(lead, [social_key])) if alias_type == "linkedin" else _get(lead, [social_key])
        if social_url:
            aliases.append(
                UniverseEntityAlias(entity_id="", alias_type=alias_type, alias_value=social_url, confidence=0.85)
            )

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
            ("has_chatbot", lead.get("has_chatbot") is True),
            ("has_booking_system", lead.get("has_booking_system") is True),
            ("has_ecommerce", lead.get("has_ecommerce") is True),
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
                    dedup_key=_observation_dedup_key(website.id, attr, source, last_audited_at),
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
                    dedup_key=_observation_dedup_key(company.id, attr, source, last_audited_at),
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
                dedup_key=_observation_dedup_key(company.id, "rating", source, now),
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
                dedup_key=_observation_dedup_key(company.id, "reviews_count", source, now),
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
                dedup_key=_observation_dedup_key(company.id, "is_claimed", source, now),
            )
        )

    google_reviews = lead.get("google_reviews") or []
    if google_reviews:
        review_summary = {
            "count": len(google_reviews),
            "avg_stars": _avg([r.get("stars") for r in google_reviews if r.get("stars") is not None]),
            "snippets": [r.get("text", "")[:300] for r in google_reviews if r.get("text")],
        }
        observations.append(
            UniverseObservation(
                entity_id=company.id,
                attribute="google_reviews",
                value=review_summary,
                source=source,
                observed_at=now,
                confidence=0.8,
                dedup_key=_observation_dedup_key(company.id, "google_reviews", source, now),
            )
        )

    review_sentiment = lead.get("review_sentiment")
    if review_sentiment and isinstance(review_sentiment, dict):
        observations.append(
            UniverseObservation(
                entity_id=company.id,
                attribute="review_sentiment",
                value={
                    "score": review_sentiment.get("score"),
                    "label": review_sentiment.get("label"),
                    "count": len(review_sentiment.get("reviews") or []),
                },
                source=source,
                observed_at=now,
                confidence=0.75,
                dedup_key=_observation_dedup_key(company.id, "review_sentiment", source, now),
            )
        )

    # Registry
    employees = _to_number(lead.get("dipendenti"))
    if employees is not None:
        employees_source = "openapi" if lead.get("openapi_enriched") else source
        observations.append(
            UniverseObservation(
                entity_id=company.id,
                attribute="employees",
                value=employees,
                source=employees_source,
                observed_at=now,
                confidence=0.95 if lead.get("openapi_enriched") else 0.6,
                dedup_key=_observation_dedup_key(company.id, "employees", employees_source, now),
            )
        )
        events.append(
            UniverseEvent(
                entity_id=company.id,
                event_type="employees_changed",
                payload={"value": employees, "source": employees_source},
                source=employees_source,
                occurred_at=now,
                dedup_key=_event_dedup_key(company.id, "employees_changed", employees_source, now, {"value": employees}),
            )
        )

    revenue = _to_number(lead.get("fatturato"))
    if revenue is not None:
        revenue_source = "openapi" if lead.get("openapi_enriched") else source
        observations.append(
            UniverseObservation(
                entity_id=company.id,
                attribute="revenue",
                value=revenue,
                source=revenue_source,
                observed_at=now,
                confidence=0.95 if lead.get("openapi_enriched") else 0.6,
                dedup_key=_observation_dedup_key(company.id, "revenue", revenue_source, now),
            )
        )
        events.append(
            UniverseEvent(
                entity_id=company.id,
                event_type="revenue_changed",
                payload={"value": revenue, "unit": "EUR", "source": revenue_source},
                source=revenue_source,
                occurred_at=now,
                dedup_key=_event_dedup_key(company.id, "revenue_changed", revenue_source, now, {"value": revenue}),
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
                dedup_key=_observation_dedup_key(company.id, "legal_form", source, now),
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

    # Business signals -> events + advanced relations (tender, funding, partner, executive)
    business_signals = lead.get("business_signals") or []
    for signal in business_signals:
        signal_type = signal.get("signalType") or signal.get("type") or "unknown"
        event_type = _map_signal_to_event(signal_type)
        if event_type:
            payload = _build_event_payload(signal, event_type)
            occurred_at = signal.get("detected_at") or now
            events.append(
                UniverseEvent(
                    entity_id=company.id,
                    event_type=event_type,
                    payload=payload,
                    source=signal.get("source") or source,
                    occurred_at=occurred_at,
                    dedup_key=_event_dedup_key(company.id, event_type, signal.get("source") or source, occurred_at, payload),
                )
            )

    rel_obs, rel_rels = extract_business_signal_relations(
        repo,
        company.id,
        business_signals,
        source,
        now,
    )
    observations.extend(rel_obs)
    relationships.extend(rel_rels)

    # News / descriptions -> partnership / investment / customer / supply edges
    news_texts: List[str] = []
    for n in lead.get("news") or lead.get("news_items") or []:
        if isinstance(n, dict):
            text = " ".join(
                str(v) for v in [n.get("title"), n.get("summary"), n.get("text"), n.get("content")] if v
            )
        else:
            text = str(n)
        if text.strip():
            news_texts.append(text)
    if lead.get("description"):
        news_texts.append(str(lead["description"]))
    news_obs, news_rels = extract_news_relations(repo, company.id, news_texts, source, now)
    observations.extend(news_obs)
    relationships.extend(news_rels)

    # Optional live sources: website relation extraction + ANAC tenders.
    if enable_live_sources:
        if domain:
            try:
                web_obs, web_rels = extract_web_relations(repo, company.id, domain, source, now)
                observations.extend(web_obs)
                relationships.extend(web_rels)
            except Exception as exc:
                logger.warning("web_relations failed for %s: %s", domain, exc)
        if name and name != "Unknown Entity":
            try:
                tender_obs, tender_rels = extract_tender_relations(repo, company.id, name, source, now)
                observations.extend(tender_obs)
                relationships.extend(tender_rels)
            except Exception as exc:
                logger.warning("tender_relations failed for %s: %s", name, exc)

    # Local competitors -> competes_with relationships
    for competitor in lead.get("local_competitors") or []:
        comp_name = str(competitor.get("name") or "").strip()
        comp_website = str(competitor.get("website") or "").strip()
        if not comp_name and not comp_website:
            continue
        comp_canonical = normalize_domain(comp_website) or slugify_name(comp_name)
        if not comp_canonical:
            continue
        comp_entity, _ = repo.upsert_entity(
            UniverseEntity(
                canonical_id=comp_canonical,
                entity_type="company",
                name=comp_name or comp_canonical,
                slug=slugify_name(comp_name or comp_canonical),
                city=competitor.get("city") or city,
                country=country,
                metadata={"category": competitor.get("category"), "website": comp_website},
                confidence=0.75,
            )
        )
        if comp_website:
            repo._upsert_aliases(comp_entity.id, [
                UniverseEntityAlias(entity_id="", alias_type="domain", alias_value=normalize_domain(comp_website), confidence=0.9)
            ])
        relationships.append(
            UniverseRelationship(
                source_entity_id=company.id,
                target_entity_id=comp_entity.id,
                relationship_type="competes_with",
                source=source,
                observed_at=now,
                confidence=0.75,
                metadata={"local": True},
            )
        )

    # Hiring jobs + hiring signals -> job/technology entities + hires edges
    jobs = list(lead.get("business_hiring_jobs") or [])
    for signal in business_signals:
        signal_type = str(signal.get("signalType") or signal.get("type") or "").lower()
        if signal_type in ("hiring", "new_hiring"):
            jobs.append(
                {
                    "title": signal.get("title") or signal.get("job_title"),
                    "url": signal.get("url") or signal.get("job_url"),
                    "role": signal.get("role"),
                    "location": signal.get("location") or signal.get("job_location"),
                    "department": signal.get("department"),
                    "seniority": signal.get("seniority"),
                    "salary": signal.get("salary"),
                    "contract_type": signal.get("contract_type"),
                    "skills": signal.get("skills") or signal.get("required_skills"),
                    "source": signal.get("source") or source,
                }
            )

    job_obs, job_rels, job_events = extract_job_relations(repo, company.id, jobs, source, now)
    observations.extend(job_obs)
    relationships.extend(job_rels)
    events.extend(job_events)

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
