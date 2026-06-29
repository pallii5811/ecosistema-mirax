"""Universe repository — Python sidecar to Supabase."""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from postgrest.exceptions import APIError

from .models import (
    IngestResult,
    UniverseEntity,
    UniverseEntityAlias,
    UniverseEvent,
    UniverseObservation,
    UniverseRelationship,
)

logger = logging.getLogger(__name__)


class UniverseError(Exception):
    def __init__(self, code: str, message: str, cause: Optional[Exception] = None):
        super().__init__(message)
        self.code = code
        self.cause = cause


class UniverseRepository:
    def __init__(self, supabase_client):
        self.sb = supabase_client

    # ------------------------------------------------------------------
    # Entities
    # ------------------------------------------------------------------
    def upsert_entity(
        self, entity: UniverseEntity, aliases: Optional[List[UniverseEntityAlias]] = None
    ) -> tuple[UniverseEntity, bool]:
        now = datetime.now(timezone.utc).isoformat()
        existing = self.get_entity_by_canonical_id(entity.canonical_id, entity.entity_type)

        if existing:
            update_payload = {
                "name": entity.name,
                "slug": entity.slug or existing.slug,
                "country": entity.country or existing.country,
                "city": entity.city if entity.city is not None else existing.city,
                "region": entity.region if entity.region is not None else existing.region,
                "metadata": {**(existing.metadata or {}), **(entity.metadata or {})},
                "confidence": entity.confidence or existing.confidence,
                "last_seen_at": now,
            }
            resp = self.sb.table("universe_entities").update(update_payload).eq("id", existing.id).execute()
            updated = resp.data[0] if resp.data else None
            if not updated:
                raise UniverseError("DATABASE_ERROR", "upsert_entity update returned no data")
            if aliases:
                self._upsert_aliases(existing.id, aliases)
            return self._dict_to_entity(updated), False

        insert_payload = entity.to_dict()
        insert_payload["first_seen_at"] = now
        insert_payload["last_seen_at"] = now
        resp = self.sb.table("universe_entities").insert(insert_payload).execute()
        created = resp.data[0] if resp.data else None
        if not created:
            raise UniverseError("DATABASE_ERROR", "upsert_entity insert returned no data")
        if aliases:
            self._upsert_aliases(created["id"], aliases)
        return self._dict_to_entity(created), True

    def get_entity_by_id(self, entity_id: str) -> Optional[UniverseEntity]:
        resp = self.sb.table("universe_entities").select("*").eq("id", entity_id).maybe_single().execute()
        data = resp.data if resp else None
        return self._dict_to_entity(data) if data else None

    def get_entity_by_canonical_id(
        self, canonical_id: str, entity_type: str
    ) -> Optional[UniverseEntity]:
        resp = (
            self.sb.table("universe_entities")
            .select("*")
            .eq("canonical_id", canonical_id)
            .eq("entity_type", entity_type)
            .is_("merged_into_id", "null")
            .maybe_single()
            .execute()
        )
        data = resp.data if resp else None
        return self._dict_to_entity(data) if data else None

    def get_entity_by_alias(
        self, alias_type: str, alias_value: str, entity_type: Optional[str] = None
    ) -> Optional[UniverseEntity]:
        resp = self.sb.rpc(
            "universe_resolve_entity_by_alias",
            {
                "p_alias_type": alias_type,
                "p_alias_value": alias_value,
                "p_entity_type": entity_type,
            },
        ).execute()
        entity_id = resp.data if resp and resp.data else None
        if not entity_id:
            return None
        return self.get_entity_by_id(entity_id)

    def _upsert_aliases(self, entity_id: str, aliases: List[UniverseEntityAlias]) -> None:
        rows = [
            {
                "entity_id": entity_id,
                "alias_type": a.alias_type,
                "alias_value": a.alias_value,
                "confidence": a.confidence,
            }
            for a in aliases
        ]
        self.sb.table("universe_entity_aliases").upsert(rows).execute()

    def _dict_to_entity(self, data: Dict[str, Any]) -> UniverseEntity:
        return UniverseEntity(
            id=data.get("id"),
            canonical_id=data["canonical_id"],
            entity_type=data["entity_type"],
            name=data["name"],
            slug=data.get("slug"),
            country=data.get("country"),
            city=data.get("city"),
            region=data.get("region"),
            metadata=data.get("metadata") or {},
            merged_into_id=data.get("merged_into_id"),
            confidence=data.get("confidence", 1.0),
            first_seen_at=data.get("first_seen_at"),
            last_seen_at=data.get("last_seen_at"),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
        )

    # ------------------------------------------------------------------
    # Observations
    # ------------------------------------------------------------------
    def create_observations(self, observations: List[UniverseObservation]) -> int:
        if not observations:
            return 0
        rows = [o.to_dict() for o in observations]
        try:
            resp = self.sb.table("universe_observations").insert(rows).execute()
            return len(resp.data) if resp.data else 0
        except APIError as e:
            logger.warning("create_observations APIError: %s", e)
            return 0

    # ------------------------------------------------------------------
    # Relationships
    # ------------------------------------------------------------------
    def create_relationships(self, relationships: List[UniverseRelationship]) -> int:
        if not relationships:
            return 0
        rows = [r.to_dict() for r in relationships]
        try:
            resp = self.sb.table("universe_relationships").upsert(rows).execute()
            return len(resp.data) if resp.data else 0
        except APIError as e:
            logger.warning("create_relationships APIError: %s", e)
            return 0

    # ------------------------------------------------------------------
    # Events
    # ------------------------------------------------------------------
    def append_events(self, events: List[UniverseEvent]) -> int:
        if not events:
            return 0
        rows = [e.to_dict() for e in events]
        try:
            resp = self.sb.table("universe_events").insert(rows).execute()
            return len(resp.data) if resp.data else 0
        except APIError as e:
            logger.warning("append_events APIError: %s", e)
            return 0
