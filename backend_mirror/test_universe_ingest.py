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
        self.observations = {}
        self.relationships = {}
        self.events = {}
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
        inserted = 0
        for o in observations:
            row = o.to_dict()
            if row["dedup_key"] not in self.observations:
                self.observations[row["dedup_key"]] = row
                inserted += 1
        return inserted

    def create_relationships(self, relationships):
        inserted = 0
        for r in relationships:
            row = r.to_dict()
            key = (row["source_entity_id"], row["target_entity_id"], row["relationship_type"])
            if key not in self.relationships:
                self.relationships[key] = row
                inserted += 1
        return inserted

    def append_events(self, events):
        inserted = 0
        for e in events:
            row = e.to_dict()
            if row["dedup_key"] not in self.events:
                self.events[row["dedup_key"]] = row
                inserted += 1
        return inserted


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

    def test_reingest_does_not_duplicate_observations_and_events(self):
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
        r1 = ingest_mirax_lead(repo, lead, "test")
        r2 = ingest_mirax_lead(repo, lead, "test")
        self.assertGreater(r1.observations_created, 0)
        self.assertGreater(r1.events_created, 0)
        self.assertEqual(r2.observations_created, 0)
        self.assertEqual(r2.events_created, 0)
        self.assertEqual(len(repo.observations), r1.observations_created)
        self.assertEqual(len(repo.events), r1.events_created)

    def test_google_ads_started_maps_to_ads_started(self):
        repo = MockUniverseRepository()
        lead = {
            "azienda": "Ads Startup Srl",
            "sito": "https://ads-startup.it",
            "business_signals": [
                {
                    "type": "google_ads_started",
                    "title": "Google Ads campaign started",
                    "source": "signals",
                    "detected_at": "2026-07-06T10:00:00+00:00",
                }
            ],
        }
        ingest_mirax_lead(repo, lead, "test")
        events = list(repo.events.values())
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["event_type"], "ads_started")
        self.assertEqual(events[0]["payload"]["signal_type"], "google_ads_started")

    def test_business_signal_relations(self):
        repo = MockUniverseRepository()
        lead = {
            "azienda": "Growth Tech Spa",
            "sito": "https://growth-tech.it",
            "citta": "Milano",
            "business_signals": [
                {
                    "type": "tender_won",
                    "title": "Appalto software PA",
                    "cig": "ABC1234567",
                    "authority": "Comune di Milano",
                    "amount": 150000,
                    "date": "2026-06-01",
                    "source": "anac",
                },
                {
                    "type": "funding_received",
                    "title": "Round seed",
                    "investor": "VC Italiano",
                    "amount": 2000000,
                    "round": "seed",
                    "date": "2026-05-15",
                    "source": "news",
                },
                {
                    "type": "partnership",
                    "title": "Partnership con PartnerCo",
                    "partner_name": "PartnerCo Srl",
                    "partner_domain": "partnerco.it",
                    "date": "2026-04-20",
                    "source": "news",
                },
                {
                    "type": "executive_change",
                    "title": "Nuovo CTO",
                    "executive_name": "Mario Rossi",
                    "role": "CTO",
                    "date": "2026-03-10",
                    "source": "registry",
                },
            ],
        }
        result = ingest_mirax_lead(repo, lead, "test")
        rels = list(repo.relationships.values())

        # Tender
        self.assertTrue(any(r["relationship_type"] == "awarded_to" for r in rels))
        self.assertTrue(any(r["relationship_type"] == "awarded_by" for r in rels))

        # Funding
        self.assertTrue(any(r["relationship_type"] == "received_investment_from" for r in rels))

        # Partnership (bidirectional)
        self.assertEqual(sum(1 for r in rels if r["relationship_type"] == "partner_of"), 2)

        # Executive
        self.assertTrue(any(r["relationship_type"] == "has" for r in rels))

        # Entities created
        entity_types = {e.entity_type for e in repo.entities.values()}
        self.assertIn("tender", entity_types)
        self.assertIn("investor", entity_types)
        self.assertIn("person", entity_types)
        self.assertGreaterEqual(result.relationships_created, 6)


if __name__ == "__main__":
    unittest.main()
