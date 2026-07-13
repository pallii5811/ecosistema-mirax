"""Extract entities and relationships from MIRAX business signals.

Sources: business_signals list produced by business_events_enrich.py and waterfall_enrich.py.
Creates:
- tender entities + awarded_to / awarded_by relationships
- investor entities + received_investment_from relationships
- partner company entities + partner_of relationships
- person entities + has relationships for executive changes
"""

from typing import Any, Dict, List, Tuple

from ..canonical import normalize_domain, slugify_name
from ..models import UniverseEntity, UniverseEntityAlias, UniverseObservation, UniverseRelationship
from ..repository import UniverseRepository, _observation_dedup_key
from ._base import (
    clean_text,
    company_canonical_id,
    investor_canonical_id,
    now_iso,
    person_canonical_id,
    tender_canonical_id,
    to_number,
)


def _ensure_company_entity(
    repo: UniverseRepository,
    name: str,
    domain: str = "",
    city: str = "",
    country: str = "IT",
    metadata: Dict[str, Any] | None = None,
    confidence: float = 0.7,
) -> UniverseEntity | None:
    canonical = company_canonical_id(name, domain)
    if not canonical:
        return None
    entity = UniverseEntity(
        canonical_id=canonical,
        entity_type="company",
        name=name or canonical,
        slug=slugify_name(name or canonical),
        city=city,
        country=country,
        metadata=metadata or {},
        confidence=confidence,
    )
    aliases: List[UniverseEntityAlias] = []
    if domain:
        aliases.append(UniverseEntityAlias(entity_id="", alias_type="domain", alias_value=normalize_domain(domain), confidence=0.9))
    company, _ = repo.upsert_entity(entity, aliases=aliases if aliases else None)
    return company


def _extract_tender_relations(
    repo: UniverseRepository,
    company_id: str,
    signal: Dict[str, Any],
    source: str,
    now: str,
) -> Tuple[List[UniverseObservation], List[UniverseRelationship]]:
    observations: List[UniverseObservation] = []
    relationships: List[UniverseRelationship] = []

    canonical = tender_canonical_id(signal)
    if not canonical:
        return observations, relationships

    title = clean_text(signal.get("title") or signal.get("oggetto") or signal.get("object") or "Gara")
    authority = clean_text(signal.get("authority") or signal.get("stazione_appaltante") or signal.get("tender_authority"))
    amount = to_number(signal.get("amount") or signal.get("importo") or signal.get("tender_amount"))
    date = clean_text(signal.get("date") or signal.get("data") or signal.get("tender_date"))
    cig = clean_text(signal.get("cig") or signal.get("tender_cig") or signal.get("CIG"))
    province = clean_text(signal.get("province"))
    region = clean_text(signal.get("region"))
    status = clean_text(signal.get("status"))
    source_url = clean_text(signal.get("source_url"))

    tender_meta: Dict[str, Any] = {"title": title}
    if authority:
        tender_meta["authority"] = authority
    if cig:
        tender_meta["cig"] = cig
    if date:
        tender_meta["date"] = date
    if province:
        tender_meta["province"] = province
    if region:
        tender_meta["region"] = region
    if status:
        tender_meta["status"] = status
    if source_url:
        tender_meta["source_url"] = source_url

    tender_entity, _ = repo.upsert_entity(
        UniverseEntity(
            canonical_id=canonical,
            entity_type="tender",
            name=title[:200],
            slug=slugify_name(title) or canonical,
            city=province or region,
            region=region,
            metadata=tender_meta,
            confidence=0.8,
        )
    )

    rel_meta: Dict[str, Any] = {}
    if cig:
        rel_meta["cig"] = cig
    if source_url:
        rel_meta["source_url"] = source_url

    relationships.append(
        UniverseRelationship(
            source_entity_id=company_id,
            target_entity_id=tender_entity.id,
            relationship_type="awarded_to",
            source=source,
            observed_at=date or now,
            confidence=0.8,
            metadata=rel_meta,
        )
    )

    if amount is not None:
        observations.append(
            UniverseObservation(
                entity_id=tender_entity.id,
                attribute="amount",
                value=amount,
                source=source,
                observed_at=date or now,
                confidence=0.8,
                dedup_key=_observation_dedup_key(tender_entity.id, "amount", source, date or now),
            )
        )

    if authority:
        authority_entity = _ensure_company_entity(
            repo,
            name=authority,
            city=province or region,
            country="IT",
            metadata={"is_public_body": True, "region": region, "province": province},
            confidence=0.7,
        )
        if authority_entity:
            relationships.append(
                UniverseRelationship(
                    source_entity_id=tender_entity.id,
                    target_entity_id=authority_entity.id,
                    relationship_type="awarded_by",
                    source=source,
                    observed_at=date or now,
                    confidence=0.75,
                )
            )

    return observations, relationships


def _extract_funding_relations(
    repo: UniverseRepository,
    company_id: str,
    signal: Dict[str, Any],
    source: str,
    now: str,
) -> Tuple[List[UniverseObservation], List[UniverseRelationship]]:
    observations: List[UniverseObservation] = []
    relationships: List[UniverseRelationship] = []

    investor_name = clean_text(
        signal.get("investor")
        or signal.get("lead_investor")
        or signal.get("leadInvestor")
        or signal.get("investor_name")
    )
    if not investor_name or len(investor_name) < 2:
        return observations, relationships

    amount = to_number(signal.get("amount") or signal.get("funding_amount"))
    round_name = clean_text(signal.get("round") or signal.get("funding_round"))
    date = clean_text(signal.get("date") or signal.get("funding_date"))

    canonical = investor_canonical_id(investor_name)
    if not canonical:
        return observations, relationships

    investor_meta: Dict[str, Any] = {}
    if round_name:
        investor_meta["round"] = round_name

    investor_entity, _ = repo.upsert_entity(
        UniverseEntity(
            canonical_id=canonical,
            entity_type="investor",
            name=investor_name[:200],
            slug=slugify_name(investor_name) or canonical,
            metadata=investor_meta,
            confidence=0.75,
        )
    )

    relationships.append(
        UniverseRelationship(
            source_entity_id=company_id,
            target_entity_id=investor_entity.id,
            relationship_type="received_investment_from",
            source=source,
            observed_at=date or now,
            confidence=0.8,
        )
    )

    if amount is not None:
        observations.append(
            UniverseObservation(
                entity_id=company_id,
                attribute="funding_amount",
                value=amount,
                source=source,
                observed_at=date or now,
                confidence=0.8,
                dedup_key=_observation_dedup_key(company_id, "funding_amount", source, date or now),
            )
        )

    return observations, relationships


def _extract_partnership_relations(
    repo: UniverseRepository,
    company_id: str,
    signal: Dict[str, Any],
    source: str,
    now: str,
) -> Tuple[List[UniverseObservation], List[UniverseRelationship]]:
    observations: List[UniverseObservation] = []
    relationships: List[UniverseRelationship] = []

    partner_name = clean_text(
        signal.get("partner_name")
        or signal.get("partner")
        or signal.get("company")
        or signal.get("azienda")
    )
    if not partner_name or len(partner_name) < 3:
        return observations, relationships

    partner_domain = clean_text(signal.get("partner_domain") or signal.get("partner_website"))
    date = clean_text(signal.get("date") or signal.get("partnership_date"))

    partner_entity = _ensure_company_entity(
        repo,
        name=partner_name,
        domain=partner_domain,
        metadata={"relationship": "partner"},
        confidence=0.75,
    )
    if not partner_entity:
        return observations, relationships

    relationships.append(
        UniverseRelationship(
            source_entity_id=company_id,
            target_entity_id=partner_entity.id,
            relationship_type="partner_of",
            source=source,
            observed_at=date or now,
            confidence=0.75,
        )
    )
    relationships.append(
        UniverseRelationship(
            source_entity_id=partner_entity.id,
            target_entity_id=company_id,
            relationship_type="partner_of",
            source=source,
            observed_at=date or now,
            confidence=0.75,
        )
    )

    return observations, relationships


def _extract_executive_relations(
    repo: UniverseRepository,
    company_id: str,
    signal: Dict[str, Any],
    source: str,
    now: str,
) -> Tuple[List[UniverseObservation], List[UniverseRelationship]]:
    observations: List[UniverseObservation] = []
    relationships: List[UniverseRelationship] = []

    name = clean_text(
        signal.get("executive_name")
        or signal.get("name")
        or signal.get("executive")
        or signal.get("director")
    )
    if not name or len(name) < 2:
        return observations, relationships

    role = clean_text(signal.get("role") or signal.get("position") or signal.get("ruolo"))
    date = clean_text(signal.get("date") or signal.get("executive_change_date"))

    canonical = person_canonical_id(name, role)
    if not canonical:
        return observations, relationships

    person_meta: Dict[str, Any] = {}
    if role:
        person_meta["role"] = role

    person_entity, _ = repo.upsert_entity(
        UniverseEntity(
            canonical_id=canonical,
            entity_type="person",
            name=name[:200],
            slug=slugify_name(name) or canonical,
            metadata=person_meta,
            confidence=0.75,
        )
    )

    relationships.append(
        UniverseRelationship(
            source_entity_id=company_id,
            target_entity_id=person_entity.id,
            relationship_type="has",
            source=source,
            observed_at=date or now,
            confidence=0.75,
            metadata={"relation_subtype": "executive"},
        )
    )

    if role:
        observations.append(
            UniverseObservation(
                entity_id=person_entity.id,
                attribute="role",
                value=role,
                source=source,
                observed_at=date or now,
                confidence=0.75,
                dedup_key=_observation_dedup_key(person_entity.id, "role", source, date or now),
            )
        )

    return observations, relationships


SIGNAL_EXTRACTORS = {
    "tender_won": _extract_tender_relations,
    "funding_received": _extract_funding_relations,
    "funding_news": _extract_funding_relations,
    "partnership": _extract_partnership_relations,
    "partnership_announced": _extract_partnership_relations,
    "executive_change": _extract_executive_relations,
    "new_director": _extract_executive_relations,
}


def extract_business_signal_relations(
    repo: UniverseRepository,
    company_id: str,
    signals: List[Dict[str, Any]],
    source: str,
    now: str | None = None,
) -> Tuple[List[UniverseObservation], List[UniverseRelationship]]:
    """Extract observations and relationships from structured business signals."""
    observations: List[UniverseObservation] = []
    relationships: List[UniverseRelationship] = []
    if not signals:
        return observations, relationships

    ts = now or now_iso()
    for signal in signals:
        if not isinstance(signal, dict):
            continue
        signal_type = str(
            signal.get("signalType") or signal.get("type") or signal.get("signal_type") or ""
        ).strip()
        extractor = SIGNAL_EXTRACTORS.get(signal_type)
        if not extractor:
            continue
        try:
            sig_obs, sig_rel = extractor(repo, company_id, signal, source, ts)
            observations.extend(sig_obs)
            relationships.extend(sig_rel)
        except Exception as exc:
            # Never fail the whole ingest because of one signal.
            import logging
            logging.getLogger(__name__).warning("business_signal_relations skip: %s", exc)

    return observations, relationships
