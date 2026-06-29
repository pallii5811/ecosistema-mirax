"""Dataclasses for Universe entities, observations, relationships, and events."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


@dataclass
class UniverseEntity:
    canonical_id: str
    entity_type: str
    name: str
    id: Optional[str] = None
    slug: Optional[str] = None
    country: Optional[str] = "IT"
    city: Optional[str] = None
    region: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    merged_into_id: Optional[str] = None
    confidence: float = 1.0
    first_seen_at: Optional[str] = None
    last_seen_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "canonical_id": self.canonical_id,
            "entity_type": self.entity_type,
            "name": self.name,
            "slug": self.slug,
            "country": self.country,
            "city": self.city,
            "region": self.region,
            "metadata": self.metadata,
            "merged_into_id": self.merged_into_id,
            "confidence": self.confidence,
            "first_seen_at": self.first_seen_at,
            "last_seen_at": self.last_seen_at,
        }


@dataclass
class UniverseEntityAlias:
    entity_id: str
    alias_type: str
    alias_value: str
    confidence: float = 1.0


@dataclass
class UniverseObservation:
    entity_id: str
    attribute: str
    value: Any
    source: str
    observed_at: Optional[str] = None
    confidence: float = 1.0
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entity_id": self.entity_id,
            "attribute": self.attribute,
            "value": self.value,
            "observed_at": self.observed_at or datetime.now(timezone.utc).isoformat(),
            "source": self.source,
            "confidence": self.confidence,
            "metadata": self.metadata,
        }


@dataclass
class UniverseRelationship:
    source_entity_id: str
    target_entity_id: str
    relationship_type: str
    source: str
    observed_at: Optional[str] = None
    confidence: float = 1.0
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_entity_id": self.source_entity_id,
            "target_entity_id": self.target_entity_id,
            "relationship_type": self.relationship_type,
            "observed_at": self.observed_at or datetime.now(timezone.utc).isoformat(),
            "source": self.source,
            "confidence": self.confidence,
            "metadata": self.metadata,
        }


@dataclass
class UniverseEvent:
    event_type: str
    payload: Dict[str, Any]
    source: str
    entity_id: Optional[str] = None
    occurred_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entity_id": self.entity_id,
            "event_type": self.event_type,
            "payload": self.payload,
            "occurred_at": self.occurred_at or datetime.now(timezone.utc).isoformat(),
            "source": self.source,
            "processed": False,
            "error_count": 0,
        }


@dataclass
class IngestResult:
    entity_id: str
    entity_type: str
    observations_created: int = 0
    relationships_created: int = 0
    events_created: int = 0
    aliases_created: int = 0
    is_new: bool = False
