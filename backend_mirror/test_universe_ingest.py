"""Unit tests for Universe Python SDK (canonical + ingest with mock repo)."""

import unittest
from unittest.mock import MagicMock

from universe.canonical import (
    normalize_domain,
    normalize_phone,
    normalize_email,
    normalize_vat,
    slugify_technology,
    slugify_location,
    slugify_name,
)
from universe.ingest import ingest_mirax_lead
from universe.models import UniverseEntity
from universe.repository import UniverseRepository


class TestCanonical(unittest.TestCase):
    def test_normalize_domain(self):
        self.assertEqual(normalize_domain("https://www.MiraxGroup.IT/"), "miraxgroup.it")
        self.assertEqual(normalize_domain("foo.it"), "foo.it")
        self.assertIsNone(normalize_domain(None))

    def test_normalize_phone(self):
        self.assertEqual(normalize_phone("+39 333 123 4567"), "393331234567")
        self.assertEqual(normalize_phone("3331234567"), "393331234567")
        self.assertIsNone(normalize_phone("123"))

    def test_normalize_email(self):
        self.assertEqual(normalize_email(" Test@EXAMPLE.com "), "test@example.com")
        self.assertIsNone(normalize_email("invalid"))

    def test_normalize_vat(self):
        self.assertEqual(normalize_vat("12345678901"), "IT12345678901")
        self.assertEqual(normalize_vat("IT 123.4567.8901"), "IT12345678901")
        self.assertIsNone(normalize_vat("123"))

    def test_slugify(self):
        self.assertEqual(slugify_technology("Meta Pixel"), "meta_pixel")
        self.assertEqual(slugify_location("Roma"), "it:roma")
        self.assertEqual(slugify_name("Edil Costruzioni Srl"), "edil-costruzioni-srl")


class MockUniverseRepository:
    """In-memory repository for testing ingest logic."""

    def __init__(self):
        self.entities = {}
        self.observations = []
        self.relationships = []
        self.events = []
        self._counter = 0

    def _next_id(self):
        self._counter += 1
        return f"ent-{self._counter}"

    def upsert_entity(self, entity, aliases=None):
        key = (entity.canonical_id, entity.entity_type)
        if key in self.entities:
            existing = self.entities[key]
            existing.name = entity.name
            return existing, False
        entity.id = self._next_id()
        self.entities[key] = entity
        return entity, True

    def get_entity_by_canonical_id(self, canonical_id, entity_type):
        return self.entities.get((canonical_id, entity_type))

    def create_observations(self, observations):
        self.observations.extend(observations)
        return len(observations)

    def create_relationships(self, relationships):
        self.relationships.extend(relationships)
        return len(relationships)

    def append_events(self, events):
        self.events.extend(events)
        return len(events)


class TestIngest(unittest.TestCase):
    def test_ingest_basic(self):
        repo = MockUniverseRepository()
        lead = {
            "azienda": "Test Python Srl",
            "sito": "https://www.test-python.it",
            "telefono": "+39 333 999 8888",
            "citta": "Milano",
            "categoria": "Software House",
            "meta_pixel": False,
            "ssl": True,
            "tech_stack": ["wordpress"],
            "business_hiring_jobs": [{"title": "Python Dev", "url": "https://test-python.it/jobs/python"}],
        }
        result = ingest_mirax_lead(repo, lead, "test")
        self.assertTrue(result.is_new)
        self.assertGreaterEqual(result.observations_created, 4)
        self.assertGreaterEqual(result.relationships_created, 3)
        self.assertGreaterEqual(result.events_created, 1)

    def test_ingest_idempotent(self):
        repo = MockUniverseRepository()
        lead = {
            "azienda": "Test Python Srl",
            "sito": "https://www.test-python.it",
            "citta": "Milano",
            "meta_pixel": False,
        }
        r1 = ingest_mirax_lead(repo, lead, "test")
        r2 = ingest_mirax_lead(repo, lead, "test")
        self.assertTrue(r1.is_new)
        self.assertFalse(r2.is_new)


if __name__ == "__main__":
    unittest.main()
