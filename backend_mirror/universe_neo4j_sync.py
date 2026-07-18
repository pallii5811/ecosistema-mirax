"""
Phase 3.2 — Neo4j sidecar sync (Strangler Fig).
Postgres/search_leads = source of truth; Neo4j = knowledge graph (rebuildable).
"""
from __future__ import annotations

import atexit
import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("universe_neo4j_sync")

_DRIVER: Any = None
_EMPTY = {"", "n/a", "n/d", "n.d.", "none", "null", "-", "?"}

try:
    from search_leads_sync import (
        extract_has_pixel,
        extract_partita_iva,
        extract_website_domain,
    )
except ImportError:
    extract_website_domain = extract_partita_iva = extract_has_pixel = None  # type: ignore

try:
    from entity_matcher import lead_city, lead_name
except ImportError:
    lead_name = lead_city = None  # type: ignore

try:
    from universe.canonical import slugify_name, slugify_technology
except ImportError:
    slugify_name = slugify_technology = None  # type: ignore


def is_neo4j_enabled() -> bool:
    flag = os.getenv("NEO4J_ENABLED", "0").strip().lower() in {"1", "true", "yes"}
    if not flag:
        return False
    return bool(os.getenv("NEO4J_URI", "").strip())


def get_neo4j_database() -> str:
    """Aura DB name is often a hash (e.g. 3304bbc5), not the default 'neo4j'."""
    return (os.getenv("NEO4J_DATABASE") or "neo4j").strip() or "neo4j"


def get_neo4j_driver() -> Any:
    """Singleton driver — chiuso via atexit allo shutdown processo."""
    global _DRIVER
    if _DRIVER is not None:
        return _DRIVER

    uri = os.getenv("NEO4J_URI", "").strip()
    username = (os.getenv("NEO4J_USERNAME") or os.getenv("NEO4J_USER") or "").strip()
    password = os.getenv("NEO4J_PASSWORD", "").strip()
    if not uri or not username or not password:
        raise RuntimeError("Neo4j env missing: NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD")

    from neo4j import GraphDatabase

    database = get_neo4j_database()
    _DRIVER = GraphDatabase.driver(
        uri,
        auth=(username, password),
        max_connection_pool_size=10,
        connection_acquisition_timeout=15.0,
        max_transaction_retry_time=15.0,
    )
    ensure_neo4j_schema(_DRIVER, database)
    logger.info("neo4j driver initialized (database=%s, uri=%s)", database, uri.split("@")[-1])
    atexit.register(close_neo4j_driver)
    return _DRIVER


def ensure_neo4j_schema(driver: Any, database: Optional[str] = None) -> None:
    """Install idempotent constraints required for concurrent MERGE safety."""
    db = database or get_neo4j_database()
    statements = (
        "CREATE CONSTRAINT mirax_company_merge_key IF NOT EXISTS FOR (n:Company) REQUIRE n.merge_key IS UNIQUE",
        "CREATE CONSTRAINT mirax_company_canonical IF NOT EXISTS FOR (n:Company) REQUIRE n.canonical_id IS UNIQUE",
        "CREATE CONSTRAINT mirax_technology_slug IF NOT EXISTS FOR (n:Technology) REQUIRE n.slug IS UNIQUE",
        "CREATE CONSTRAINT mirax_technology_canonical IF NOT EXISTS FOR (n:Technology) REQUIRE n.canonical_id IS UNIQUE",
        "CREATE CONSTRAINT mirax_signal_slug IF NOT EXISTS FOR (n:Signal) REQUIRE n.slug IS UNIQUE",
        "CREATE CONSTRAINT mirax_signal_canonical IF NOT EXISTS FOR (n:Signal) REQUIRE n.canonical_id IS UNIQUE",
        "CREATE CONSTRAINT mirax_person_canonical IF NOT EXISTS FOR (n:Person) REQUIRE n.canonical_id IS UNIQUE",
        "CREATE CONSTRAINT mirax_universe_id IF NOT EXISTS FOR (n:UniverseEntity) REQUIRE n.universe_id IS UNIQUE",
        "CREATE CONSTRAINT mirax_event_canonical IF NOT EXISTS FOR (n:Event) REQUIRE n.canonical_id IS UNIQUE",
        "CREATE CONSTRAINT mirax_evidence_canonical IF NOT EXISTS FOR (n:Evidence) REQUIRE n.canonical_id IS UNIQUE",
        "CREATE CONSTRAINT mirax_source_canonical IF NOT EXISTS FOR (n:Source) REQUIRE n.canonical_id IS UNIQUE",
        "CREATE CONSTRAINT mirax_search_canonical IF NOT EXISTS FOR (n:Search) REQUIRE n.canonical_id IS UNIQUE",
        "CREATE CONSTRAINT mirax_location_canonical IF NOT EXISTS FOR (n:Location) REQUIRE n.canonical_id IS UNIQUE",
        "CREATE CONSTRAINT mirax_graph_health IF NOT EXISTS FOR (n:MiraxGraphHealth) REQUIRE n.id IS UNIQUE",
    )
    with driver.session(database=db) as session:
        for statement in statements:
            session.run(statement).consume()


def close_neo4j_driver() -> None:
    global _DRIVER
    if _DRIVER is not None:
        try:
            _DRIVER.close()
        except Exception as exc:
            logger.warning("neo4j driver close failed: %s", exc)
        _DRIVER = None


def _pick_str(lead: Dict[str, Any], keys: Tuple[str, ...]) -> Optional[str]:
    for key in keys:
        val = lead.get(key)
        if val is None:
            continue
        s = str(val).strip()
        if s and s.lower() not in _EMPTY:
            return s
    return None


def _slugify(value: Optional[str]) -> Optional[str]:
    if slugify_technology:
        return slugify_technology(value)
    if not value:
        return None
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower().strip()).strip("_")
    return slug or None


def _slugify_company_name(value: Optional[str]) -> Optional[str]:
    if slugify_name:
        return slugify_name(value)
    if not value:
        return None
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower().strip()).strip("-")
    return slug or None


def _company_merge_key(lead: Dict[str, Any]) -> Optional[str]:
    domain = extract_website_domain(lead) if extract_website_domain else None
    if domain:
        return f"web:{domain}"

    piva = extract_partita_iva(lead) if extract_partita_iva else None
    if not piva:
        raw = _pick_str(lead, ("partita_iva", "piva", "vat"))
        digits = re.sub(r"\D+", "", raw or "")
        if len(digits) == 11:
            piva = digits
    if piva:
        return f"piva:{piva}"

    name = (lead_name(lead) if lead_name else None) or _pick_str(
        lead, ("azienda", "nome", "name", "company", "business_name")
    )
    city = (lead_city(lead) if lead_city else None) or _pick_str(lead, ("citta", "city", "localita"))
    name_slug = _slugify_company_name(name)
    city_slug = _slugify_company_name(city) if city else None
    if name_slug and city_slug:
        return f"name:{name_slug}:{city_slug}"
    if name_slug:
        return f"name:{name_slug}"
    return None


def _company_props(lead: Dict[str, Any], merge_key: str) -> Dict[str, Any]:
    domain = extract_website_domain(lead) if extract_website_domain else None
    piva = extract_partita_iva(lead) if extract_partita_iva else None
    name = (lead_name(lead) if lead_name else None) or _pick_str(
        lead, ("azienda", "nome", "name", "company", "business_name")
    )
    props: Dict[str, Any] = {
        "merge_key": merge_key,
        "name": name,
        "website_domain": domain,
        "partita_iva": piva,
        "city": (lead_city(lead) if lead_city else None) or _pick_str(lead, ("citta", "city")),
        "category": _pick_str(lead, ("categoria", "category")),
        "phone": _pick_str(lead, ("telefono", "phone")),
        "email": _pick_str(lead, ("email",)),
        "website": _pick_str(lead, ("sito", "website", "url")),
    }
    return {k: v for k, v in props.items() if v is not None}


def _extract_technologies(lead: Dict[str, Any]) -> List[Dict[str, str]]:
    techs: List[Dict[str, str]] = []
    seen: set[str] = set()

    def add(name: str) -> None:
        slug = _slugify(name)
        if not slug or slug in seen:
            return
        seen.add(slug)
        techs.append({"slug": slug, "name": name})

    if lead.get("meta_pixel") is True:
        add("Meta Pixel")
    if lead.get("google_tag_manager") is True:
        add("Google Tag Manager")
    if lead.get("google_analytics") is True:
        add("Google Analytics")
    if lead.get("google_ads") is True:
        add("Google Ads")
    if lead.get("ssl") is True:
        add("SSL")

    stack = lead.get("tech_stack") or []
    if isinstance(stack, list):
        for item in stack:
            s = str(item or "").strip()
            if not s:
                continue
            low = s.lower()
            if any(x in low for x in ("verifica in corso", "audit in arrivo", "stack in arrivo", "contatto da verificare")):
                continue
            if low.startswith("no "):
                continue
            add(s)

    return techs


def _extract_signals(lead: Dict[str, Any]) -> List[Dict[str, Any]]:
    signals: List[Dict[str, Any]] = []
    seen: set[str] = set()

    def add(name: str, kind: str, confidence: float = 0.8) -> None:
        slug = _slugify(f"{kind}_{name}") or _slugify(name) or _slugify(kind)
        if not slug or slug in seen:
            return
        seen.add(slug)
        signals.append({"slug": slug, "name": name, "kind": kind, "confidence": confidence})

    pixel = extract_has_pixel(lead) if extract_has_pixel else lead.get("meta_pixel")
    if pixel is False:
        add("No Meta Pixel", "technology_gap", 0.9)

    jobs = lead.get("business_hiring_jobs") or []
    if isinstance(jobs, list) and jobs:
        add("Hiring", "hiring", 0.85)

    raw_signals = lead.get("business_signals") or []
    if isinstance(raw_signals, list):
        for sig in raw_signals:
            if not isinstance(sig, dict):
                continue
            sig_type = str(sig.get("type") or sig.get("signal_type") or "signal").strip()
            label = str(sig.get("label") or sig.get("title") or sig_type).strip()
            conf_raw = sig.get("confidence") or sig.get("score")
            try:
                confidence = float(conf_raw) if conf_raw is not None else 0.75
            except (TypeError, ValueError):
                confidence = 0.75
            add(label or sig_type, sig_type or "signal", min(1.0, max(0.0, confidence)))

    return signals


def _write_lead_tx(tx: Any, merge_key: str, props: Dict[str, Any], technologies: List[Dict[str, str]], signals: List[Dict[str, Any]]) -> None:
    tx.run(
        """
        MERGE (c:Company {merge_key: $merge_key})
        ON CREATE SET c.created_at = datetime()
        SET c += $props, c.updated_at = datetime()
        """,
        merge_key=merge_key,
        props=props,
    )

    for tech in technologies:
        tx.run(
            """
            MATCH (c:Company {merge_key: $merge_key})
            MERGE (t:Technology {slug: $slug})
            ON CREATE SET t.name = $name, t.created_at = datetime()
            SET t.name = coalesce($name, t.name), t.updated_at = datetime()
            MERGE (c)-[:USES_TECH]->(t)
            """,
            merge_key=merge_key,
            slug=tech["slug"],
            name=tech["name"],
        )

    for sig in signals:
        tx.run(
            """
            MATCH (c:Company {merge_key: $merge_key})
            MERGE (s:Signal {slug: $slug})
            ON CREATE SET s.name = $name, s.kind = $kind, s.created_at = datetime()
            SET s.name = coalesce($name, s.name),
                s.kind = coalesce($kind, s.kind),
                s.updated_at = datetime()
            MERGE (c)-[r:HAS_SIGNAL]->(s)
            ON CREATE SET r.detected_at = datetime()
            SET r.confidence = $confidence, r.updated_at = datetime()
            """,
            merge_key=merge_key,
            slug=sig["slug"],
            name=sig["name"],
            kind=sig["kind"],
            confidence=float(sig.get("confidence", 0.75)),
        )


def sync_lead_to_graph(driver: Any, lead_data: Dict[str, Any]) -> bool:
    """
    MERGE Company + Technology + Signal in una singola transazione Neo4j.
    Ritorna False se il lead non ha chiavi sufficienti per il merge.
    """
    if not driver or not isinstance(lead_data, dict):
        return False

    merge_key = _company_merge_key(lead_data)
    if not merge_key:
        return False

    props = _company_props(lead_data, merge_key)
    technologies = _extract_technologies(lead_data)
    signals = _extract_signals(lead_data)
    database = get_neo4j_database()

    def _tx(tx: Any) -> None:
        _write_lead_tx(tx, merge_key, props, technologies, signals)

    try:
        with driver.session(database=database) as session:
            session.execute_write(_tx)
    except Exception as exc:
        logger.warning("neo4j sync failed merge_key=%s database=%s: %s", merge_key, database, exc)
        raise
    return True


def sync_leads_to_graph(leads: List[Any], driver: Optional[Any] = None) -> Dict[str, int]:
    """Batch sync — riusa lo stesso driver; errori per-lead non bloccano il batch."""
    stats = {"synced": 0, "skipped": 0, "errors": 0}
    if not is_neo4j_enabled() or not leads:
        return stats

    drv = driver
    if drv is None:
        try:
            drv = get_neo4j_driver()
        except Exception as exc:
            logger.warning(
                "neo4j driver init failed (database=%s): %s",
                get_neo4j_database(),
                exc,
            )
            stats["errors"] = len(leads)
            return stats

    for item in leads:
        if not isinstance(item, dict):
            stats["skipped"] += 1
            continue
        try:
            if sync_lead_to_graph(drv, item):
                stats["synced"] += 1
            else:
                stats["skipped"] += 1
        except Exception as exc:
            stats["errors"] += 1
            logger.warning(
                "neo4j sync lead failed merge_key=%s: %s",
                _company_merge_key(item),
                exc,
            )
    return stats


def _semantic_id(kind: str, *values: Any) -> str:
    normalized = "|".join(str(value or "").strip().casefold() for value in values)
    return f"{kind}:{hashlib.sha256(normalized.encode('utf-8')).hexdigest()[:32]}"


def build_semantic_graph_records(leads: List[Any], *, search_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Build deterministic graph records only from grounded semantic payloads."""
    records: List[Dict[str, Any]] = []
    observed = datetime.now(timezone.utc).isoformat()
    for lead in leads:
        if not isinstance(lead, dict):
            continue
        grounding = lead.get("semantic_grounding")
        if not isinstance(grounding, dict) or grounding.get("accepted") is not True:
            continue
        company_name = _pick_str(lead, ("azienda", "name", "legal_name", "company"))
        domain = extract_website_domain(lead) if extract_website_domain else None
        domain = domain or _host_from_lead(lead)
        if not company_name or not domain:
            continue
        company_id = f"company:{str(domain).lower().removeprefix('www.')}"
        city = _pick_str(lead, ("citta", "city", "location"))
        grounded_items = grounding.get("grounded_evidence") or ()
        for item in grounded_items:
            if not isinstance(item, dict):
                continue
            interpretation = item.get("interpretation") if isinstance(item.get("interpretation"), dict) else {}
            verdict = item.get("verdict") if isinstance(item.get("verdict"), dict) else {}
            if verdict.get("accepted") is not True:
                continue
            source_url = str(verdict.get("source_url") or "").strip()
            excerpt = str(verdict.get("evidence_excerpt") or interpretation.get("evidence_excerpt") or "").strip()
            predicate = str(interpretation.get("predicate") or interpretation.get("open_predicate") or "").strip()
            event_date = str(interpretation.get("event_date") or "").strip() or None
            try:
                confidence = float(interpretation.get("confidence") or 0.0)
            except (TypeError, ValueError):
                confidence = 0.0
            if not source_url or not excerpt or not predicate or confidence < 0.70:
                continue
            event_id = _semantic_id("event", company_id, predicate, event_date, source_url, excerpt)
            evidence_id = _semantic_id("evidence", source_url, excerpt)
            source_id = _semantic_id("source", source_url)
            relationships = tuple(str(value) for value in interpretation.get("satisfied_relationships") or () if str(value))
            records.append({
                "company": {"canonical_id": company_id, "name": company_name, "domain": domain},
                "event": {
                    "canonical_id": event_id, "event_type": interpretation.get("event_type"),
                    "predicate": predicate, "event_date": event_date,
                    "target_role": interpretation.get("target_entity_role"),
                },
                "evidence": {"canonical_id": evidence_id, "excerpt": excerpt},
                "source": {
                    "canonical_id": source_id, "url": source_url,
                    "publisher": verdict.get("source_publisher") or interpretation.get("publisher"),
                },
                "signals": tuple({"canonical_id": f"signal:{value}", "name": value} for value in relationships),
                "location": ({"canonical_id": _semantic_id("location", city), "name": city} if city else None),
                "technology": (
                    {"canonical_id": _semantic_id("technology", interpretation.get("technology")), "name": interpretation.get("technology")}
                    if interpretation.get("technology") else None
                ),
                "search": ({"canonical_id": f"search:{search_id}", "search_id": search_id} if search_id else None),
                "observed_at": observed,
                "source_url": source_url,
                "confidence": confidence,
                "valid_from": event_date or observed,
                "valid_to": None,
                "provenance": {
                    "interpreter_schema": interpretation.get("schema_version"),
                    "grounding_schema": verdict.get("schema_version"),
                    "contract_hash": grounding.get("contract_hash"),
                },
            })
    return records


def _host_from_lead(lead: Dict[str, Any]) -> Optional[str]:
    raw = _pick_str(lead, ("sito", "website", "url", "employer_official_domain"))
    if not raw:
        return None
    from urllib.parse import urlparse
    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    return (parsed.hostname or "").lower().removeprefix("www.") or None


def sync_semantic_leads_to_graph(
    leads: List[Any], *, search_id: Optional[str] = None, driver: Optional[Any] = None,
) -> Dict[str, int]:
    """Idempotent semantic sidecar. Postgres remains authoritative/non-blocking."""
    stats = {"nodes": 0, "relationships": 0, "errors": 0}
    records = build_semantic_graph_records(leads, search_id=search_id)
    if not records or not is_neo4j_enabled():
        return stats
    try:
        drv = driver or get_neo4j_driver()
        database = get_neo4j_database()
        with drv.session(database=database) as session:
            for row in records:
                session.run(
                    """
                    MERGE (c:Company {canonical_id: $company.canonical_id}) SET c += $company, c.observed_at=$observed_at
                    MERGE (e:Event {canonical_id: $event.canonical_id}) SET e += $event, e.observed_at=$observed_at,
                      e.source_url=$source_url, e.confidence=$confidence, e.provenance=$provenance,
                      e.valid_from=$valid_from, e.valid_to=$valid_to
                    MERGE (v:Evidence {canonical_id: $evidence.canonical_id}) SET v += $evidence,
                      v.observed_at=$observed_at, v.source_url=$source_url, v.confidence=$confidence,
                      v.provenance=$provenance, v.valid_from=$valid_from, v.valid_to=$valid_to
                    MERGE (s:Source {canonical_id: $source.canonical_id}) SET s += $source, s.observed_at=$observed_at
                    MERGE (c)-[:COMPANY_HAS_EVENT]->(e)
                    MERGE (e)-[:EVENT_INVOLVES_COMPANY {role: $event.target_role}]->(c)
                    MERGE (e)-[:EVENT_HAS_EVIDENCE]->(v)
                    MERGE (v)-[:EVIDENCE_FROM_SOURCE]->(s)
                    """,
                    **{**row, "provenance": json.dumps(row["provenance"], sort_keys=True)},
                ).consume()
                stats["nodes"] += 4
                stats["relationships"] += 4
                for signal in row["signals"]:
                    session.run(
                        "MATCH (e:Event {canonical_id:$event_id}) MERGE (s:Signal {canonical_id:$signal.canonical_id}) "
                        "SET s += $signal MERGE (e)-[:EVENT_RELATES_TO_SIGNAL]->(s)",
                        event_id=row["event"]["canonical_id"], signal=signal,
                    ).consume()
                    stats["nodes"] += 1
                    stats["relationships"] += 1
                for key, label, relation in (
                    ("location", "Location", "COMPANY_LOCATED_IN"),
                    ("technology", "Technology", "COMPANY_USES_TECHNOLOGY"),
                    ("search", "Search", "SEARCH_RETURNED_COMPANY"),
                ):
                    node = row.get(key)
                    if not node:
                        continue
                    session.run(
                        f"MERGE (n:{label} {{canonical_id:$node.canonical_id}}) SET n += $node "
                        f"WITH n MATCH (c:Company {{canonical_id:$company_id}}) MERGE (c)-[:{relation}]->(n)"
                        if key != "search" else
                        f"MERGE (n:{label} {{canonical_id:$node.canonical_id}}) SET n += $node "
                        f"WITH n MATCH (c:Company {{canonical_id:$company_id}}) MERGE (n)-[:{relation}]->(c)",
                        node=node, company_id=row["company"]["canonical_id"],
                    ).consume()
                    stats["nodes"] += 1
                    stats["relationships"] += 1
            now = datetime.now(timezone.utc).isoformat()
            session.run(
                "MERGE (h:MiraxGraphHealth {id:'main'}) SET h.last_successful_write=$now, h.last_error=null",
                now=now,
            ).consume()
        return stats
    except Exception as exc:
        stats["errors"] += 1
        logger.warning("semantic graph mirror failed: %s", exc)
        return stats


_UNIVERSE_LABELS = {
    "company": "Company",
    "website": "Website",
    "technology": "Technology",
    "job": "Job",
    "tender": "Tender",
    "location": "Location",
    "person": "Person",
    "document": "Document",
    "product": "Product",
    "investor": "Investor",
    "event": "Event",
}

_UNIVERSE_RELATIONSHIPS = {
    "owns", "uses", "hires", "has", "receives", "buys", "competes_with", "located_in",
    "related_to", "mentioned_in", "supplies", "supplied_by", "sells_to", "buys_from",
    "partner_of", "invested_in", "received_investment_from", "awarded_to", "awarded_by",
    "customer_of", "has_customer", "competed_for",
}

# Relationships below this threshold remain available in the authoritative
# store for audit/reprocessing, but are not exposed through the serving graph.
MIN_UNIVERSE_RELATIONSHIP_CONFIDENCE = 0.65


def _primitive_props(entity: Dict[str, Any]) -> Dict[str, Any]:
    props = {
        "canonical_id": entity.get("canonical_id"),
        "name": entity.get("name"),
        "city": entity.get("city"),
        "country": entity.get("country"),
        "confidence": entity.get("confidence"),
        "first_seen_at": entity.get("first_seen_at"),
        "last_seen_at": entity.get("last_seen_at"),
        "metadata_json": json.dumps(entity.get("metadata") or {}, ensure_ascii=False, sort_keys=True),
    }
    return {key: value for key, value in props.items() if value is not None}


def _universe_company_merge_key(entity: Dict[str, Any]) -> str:
    canonical = str(entity.get("canonical_id") or "").strip().lower()
    if "." in canonical and " " not in canonical:
        return f"web:{canonical.removeprefix('www.')}"
    digits = re.sub(r"\D+", "", canonical)
    if len(digits) == 11:
        return f"piva:{digits}"
    name_slug = _slugify_company_name(str(entity.get("name") or canonical)) or canonical or str(entity["id"])
    city_slug = _slugify_company_name(str(entity.get("city") or ""))
    return f"name:{name_slug}:{city_slug}" if city_slug else f"name:{name_slug}"


def _fetch_all_rows(supabase: Any, table: str, select: str = "*") -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    page_size = 1000
    for start in range(0, 100_000, page_size):
        response = supabase.table(table).select(select).range(start, start + page_size - 1).execute()
        page = response.data or []
        rows.extend(row for row in page if isinstance(row, dict))
        if len(page) < page_size:
            break
    return rows


def _fetch_rows_by_ids(supabase: Any, table: str, column: str, ids: List[str]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for start in range(0, len(ids), 150):
        chunk = ids[start : start + 150]
        if not chunk:
            continue
        response = supabase.table(table).select("*").in_(column, chunk).execute()
        rows.extend(row for row in (response.data or []) if isinstance(row, dict))
    return rows


def sync_universe_graph_to_neo4j(
    supabase: Any,
    root_entity_ids: Optional[List[str]] = None,
    driver: Optional[Any] = None,
) -> Dict[str, int]:
    """Mirror the authoritative Universe subgraph (or full graph) into Neo4j."""
    stats = {"nodes": 0, "relationships": 0, "errors": 0}
    if not is_neo4j_enabled() or supabase is None:
        return stats
    try:
        if root_entity_ids:
            roots = sorted({str(value) for value in root_entity_ids if value})
            outgoing = _fetch_rows_by_ids(supabase, "universe_relationships", "source_entity_id", roots)
            incoming = _fetch_rows_by_ids(supabase, "universe_relationships", "target_entity_id", roots)
            rel_map = {str(row.get("id")): row for row in [*outgoing, *incoming] if row.get("id")}
            relationships = list(rel_map.values())
            entity_ids = sorted(
                {
                    *roots,
                    *(str(row.get("source_entity_id")) for row in relationships if row.get("source_entity_id")),
                    *(str(row.get("target_entity_id")) for row in relationships if row.get("target_entity_id")),
                }
            )
            entities = _fetch_rows_by_ids(supabase, "universe_entities", "id", entity_ids)
        else:
            entities = _fetch_all_rows(supabase, "universe_entities")
            relationships = _fetch_all_rows(supabase, "universe_relationships")

        relationships = [
            relationship
            for relationship in relationships
            if float(relationship.get("confidence") or 0.0)
            >= MIN_UNIVERSE_RELATIONSHIP_CONFIDENCE
        ]

        drv = driver or get_neo4j_driver()
        database = get_neo4j_database()
        full_reconciliation = not root_entity_ids
        grouped_entities: Dict[str, List[Dict[str, Any]]] = {}
        for entity in entities:
            label = _UNIVERSE_LABELS.get(str(entity.get("entity_type") or "").lower())
            if not label or not entity.get("id"):
                continue
            row = {
                "id": str(entity["id"]),
                "merge_key": _universe_company_merge_key(entity) if label == "Company" else None,
                "slug": str(entity.get("canonical_id") or entity["id"]) if label == "Technology" else None,
                "props": _primitive_props(entity),
            }
            grouped_entities.setdefault(label, []).append(row)

        with drv.session(database=database) as session:
            if full_reconciliation:
                # Full backfills are authoritative: remove graph artifacts whose
                # source rows were deleted or fell below the serving threshold.
                session.run(
                    "MATCH (n:UniverseEntity) "
                    "WHERE NOT n.universe_id IN $ids DETACH DELETE n",
                    ids=[str(entity["id"]) for entity in entities if entity.get("id")],
                ).consume()
                session.run(
                    "MATCH ()-[r]->() WHERE r.universe_rel_id IS NOT NULL "
                    "AND NOT r.universe_rel_id IN $ids DELETE r",
                    ids=[str(rel["id"]) for rel in relationships if rel.get("id")],
                ).consume()
            for label, rows in grouped_entities.items():
                for start in range(0, len(rows), 500):
                    batch = rows[start : start + 500]
                    if label == "Company":
                        query = (
                            "UNWIND $rows AS row MERGE (n:Company {merge_key: row.merge_key}) "
                            "SET n:UniverseEntity, n.universe_id=row.id, n += row.props"
                        )
                    elif label == "Technology":
                        query = (
                            "UNWIND $rows AS row MERGE (n:Technology {slug: row.slug}) "
                            "SET n:UniverseEntity, n.universe_id=row.id, n += row.props"
                        )
                    else:
                        query = (
                            f"UNWIND $rows AS row MERGE (n:{label}:UniverseEntity {{universe_id: row.id}}) "
                            "SET n += row.props"
                        )
                    session.run(query, rows=batch).consume()
                    stats["nodes"] += len(batch)

            grouped_relationships: Dict[str, List[Dict[str, Any]]] = {}
            for relationship in relationships:
                rel_type = str(relationship.get("relationship_type") or "").lower()
                if rel_type not in _UNIVERSE_RELATIONSHIPS:
                    continue
                grouped_relationships.setdefault(rel_type.upper(), []).append(
                    {
                        "id": str(relationship.get("id") or ""),
                        "source": str(relationship.get("source_entity_id") or ""),
                        "target": str(relationship.get("target_entity_id") or ""),
                        "confidence": float(relationship.get("confidence") or 0.0),
                        "source_name": str(relationship.get("source") or ""),
                        "observed_at": str(relationship.get("observed_at") or ""),
                        "metadata_json": json.dumps(
                            relationship.get("metadata") or {}, ensure_ascii=False, sort_keys=True
                        ),
                    }
                )
            for rel_type, rows in grouped_relationships.items():
                for start in range(0, len(rows), 500):
                    batch = rows[start : start + 500]
                    query = (
                        "UNWIND $rows AS row "
                        "MATCH (s:UniverseEntity {universe_id: row.source}) "
                        "MATCH (t:UniverseEntity {universe_id: row.target}) "
                        f"MERGE (s)-[r:{rel_type} {{universe_rel_id: row.id}}]->(t) "
                        "SET r.confidence=row.confidence, r.source=row.source_name, "
                        "r.observed_at=row.observed_at, r.metadata_json=row.metadata_json"
                    )
                    session.run(query, rows=batch).consume()
                    stats["relationships"] += len(batch)
        return stats
    except Exception as exc:
        stats["errors"] += 1
        logger.warning("universe -> neo4j graph mirror failed: %s", exc)
        return stats


if __name__ == "__main__":
    sample = {
        "azienda": "Acme Srl",
        "sito": "https://www.acme-example.it",
        "citta": "Milano",
        "meta_pixel": True,
        "tech_stack": ["WordPress"],
        "business_hiring_jobs": [{"title": "Commerciale"}],
        "business_signals": [{"type": "hiring", "label": "Assunzione commerciale"}],
    }
    key = _company_merge_key(sample)
    assert key == "web:acme-example.it"
    assert len(_extract_technologies(sample)) >= 2
    assert len(_extract_signals(sample)) >= 1
    print("universe_neo4j_sync self-check OK")
