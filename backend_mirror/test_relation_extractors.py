"""Unit tests for Universe relation extractors."""

import unittest
from unittest.mock import patch

from universe.models import UniverseEntity
from universe.relation_extractors import (
    extract_job_relations,
    extract_news_relations,
    extract_tender_relations,
    extract_web_relations,
)


class MockUniverseRepository:
    """In-memory repository for testing relation extractors."""

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


class TestWebRelations(unittest.TestCase):
    def test_does_not_treat_editorial_articles_as_partner_pages(self):
        from universe.relation_extractors import web_relations as wr

        self.assertIsNone(
            wr._page_type_from_href(
                "/acqua-santanna-cuneo-volley-partnership-2026-27/"
            )
        )
        self.assertEqual(wr._page_type_from_href("/partner/certificati/"), "partner")
        homepage = """
        <a href="/acqua-santanna-cuneo-volley-partnership-2026-27/">
          Acqua Sant'Anna: partnership 2026-27
        </a>
        <a href="https://external.example/partner/">Partner esterno</a>
        """
        with patch.object(wr, "_fetch_url", return_value=None):
            self.assertEqual(
                wr._discover_special_pages("https://publisher.example", homepage),
                {},
            )

    def test_rejects_sentence_fragments_as_company_names(self):
        from universe.relation_extractors.web_relations import _extract_company_names

        html = """
        <p>Il processo di rebranding di Piazzolla è entrato nel vivo. Fin dalla sua fondazione.</p>
        <p>navigare tra elementi radio e caselle utilizzando i tasti e compilarli con la barra SpA</p>
        <p>Tutto scorre nel nuovo sito web di Prandelli SpA</p>
        <p>Cliente Alfa S.r.l.</p>
        <p>Partner Beta S.p.A.</p>
        """
        self.assertEqual(
            _extract_company_names(html),
            ["Prandelli SpA", "Cliente Alfa Srl", "Partner Beta SpA"],
        )

    def test_extracts_customers_and_partners_from_html(self):
        repo = MockUniverseRepository()
        company = repo.upsert_entity(
            UniverseEntity(
                canonical_id="example.it",
                entity_type="company",
                name="Example Srl",
                slug="example-srl",
            )
        )[0]

        homepage_html = """
        <html><body>
          <a href="/clienti/">I nostri clienti</a>
          <a href="/partner/">Partner</a>
        </body></html>
        """

        # The extractor discovers /clienti/ and /partner/ links and fetches them.
        # We pass the same HTML for all pages to keep the test self-contained.
        page_html = """
        <html><body>
          <h2>Clienti e Partner</h2>
          <p>Cliente Alfa S.r.l. utilizza i nostri servizi.</p>
          <p>Partner Beta S.p.A. collabora con noi.</p>
        </body></html>
        """

        obs, rels = extract_web_relations(
            repo,
            company.id,
            "example.it",
            "test_web",
            "2026-07-01T00:00:00+00:00",
            homepage_html=homepage_html,
            max_pages=2,
        )
        # Because we passed only homepage_html, special pages will be fetched
        # via httpx.  To avoid network we patch _fetch_url to return page_html.
        # Instead, let's test the core name extraction by providing the special
        # page HTML directly through the public API.  The public API does not
        # accept per-page HTML, so we exercise _extract_company_names indirectly.
        # We therefore monkey-patch the fetch helper for this test.
        from universe.relation_extractors import web_relations as wr

        original_fetch = wr._fetch_url
        wr._fetch_url = lambda *args, **kwargs: page_html
        try:
            obs, rels = extract_web_relations(
                repo,
                company.id,
                "example.it",
                "test_web",
                "2026-07-01T00:00:00+00:00",
                homepage_html=homepage_html,
                max_pages=2,
            )
        finally:
            wr._fetch_url = original_fetch

        rel_types = {r.relationship_type for r in rels}
        self.assertIn("has_customer", rel_types)
        self.assertIn("customer_of", rel_types)
        self.assertIn("partner_of", rel_types)

        target_names = {repo.entities[(t, "company")].name for t in ("cliente-alfa-srl", "partner-beta-spa")}
        self.assertIn("Cliente Alfa Srl", target_names)
        self.assertIn("Partner Beta SpA", target_names)


class TestJobRelations(unittest.TestCase):
    def test_extracts_hires_and_technology(self):
        repo = MockUniverseRepository()
        company = repo.upsert_entity(
            UniverseEntity(
                canonical_id="growth-tech.it",
                entity_type="company",
                name="Growth Tech Spa",
                slug="growth-tech-spa",
            )
        )[0]

        jobs = [
            {
                "title": "Senior Python Backend Engineer",
                "url": "https://growth-tech.it/jobs/python",
                "role": "Backend Engineer",
                "location": "Milano",
                "skills": ["Python", "PostgreSQL", "Docker"],
            },
            {
                "title": "Sales Manager",
                "role": "Sales",
                "location": "Roma",
            },
        ]

        obs, rels, events = extract_job_relations(
            repo, company.id, jobs, "test_jobs", "2026-07-01T00:00:00+00:00"
        )

        rel_types = {r.relationship_type for r in rels}
        self.assertIn("hires", rel_types)
        self.assertIn("uses", rel_types)

        # Python technology entity created.
        tech_entities = [e for e in repo.entities.values() if e.entity_type == "technology"]
        self.assertGreaterEqual(len(tech_entities), 3)

        # New hiring events.
        self.assertEqual(len(events), 2)
        self.assertEqual({e.event_type for e in events}, {"new_hiring"})

        # Role observation.
        self.assertTrue(any(o.attribute == "role" for o in obs))

    def test_idempotent_events(self):
        repo = MockUniverseRepository()
        company = repo.upsert_entity(
            UniverseEntity(
                canonical_id="growth-tech.it",
                entity_type="company",
                name="Growth Tech Spa",
                slug="growth-tech-spa",
            )
        )[0]
        jobs = [{"title": "DevOps Engineer", "skills": ["Kubernetes"]}]

        _, _, events1 = extract_job_relations(repo, company.id, jobs, "test", "2026-07-01T10:00:00+00:00")
        _, _, events2 = extract_job_relations(repo, company.id, jobs, "test", "2026-07-01T11:00:00+00:00")
        self.assertEqual(len(events1), 1)
        self.assertEqual(len(events2), 1)
        # The same job on the same day produces the same repository dedup key.
        self.assertEqual(events1[0].dedup_key, events2[0].dedup_key)


class TestTenderRelations(unittest.TestCase):
    @patch("universe.relation_extractors.tender_relations.search_anac_tenders_sync")
    def test_extracts_tender_relations(self, mock_search):
        repo = MockUniverseRepository()
        company = repo.upsert_entity(
            UniverseEntity(
                canonical_id="pa-tech.it",
                entity_type="company",
                name="PA Tech Srl",
                slug="pa-tech-srl",
            )
        )[0]

        mock_search.return_value = [
            {
                "type": "tender_won",
                "title": "Fornitura software gestionale",
                "cig": "CIG1234567",
                "object": "Fornitura software gestionale",
                "amount": 250000,
                "date": "2026-05-10",
                "authority": "Comune di Torino",
                "province": "Torino",
                "region": "Piemonte",
                "source": "anac_opendata",
            }
        ]

        obs, rels = extract_tender_relations(
            repo, company.id, "PA Tech Srl", "test_anac", "2026-07-01T00:00:00+00:00"
        )

        rel_types = {r.relationship_type for r in rels}
        self.assertIn("awarded_to", rel_types)
        self.assertIn("awarded_by", rel_types)

        tender_entities = [e for e in repo.entities.values() if e.entity_type == "tender"]
        self.assertEqual(len(tender_entities), 1)
        self.assertEqual(tender_entities[0].metadata.get("cig"), "CIG1234567")

        # Amount observation on tender.
        self.assertTrue(any(o.attribute == "amount" for o in obs))


class TestNewsRelations(unittest.TestCase):
    def test_extracts_partnership_investment_and_supply(self):
        repo = MockUniverseRepository()
        company = repo.upsert_entity(
            UniverseEntity(
                canonical_id="newsco.it",
                entity_type="company",
                name="NewsCo Srl",
                slug="newsco-srl",
            )
        )[0]

        texts = [
            "NewsCo Srl ha siglato una partnership con Media Partner S.p.A. per l'espansione internazionale.",
            "La startup ha ricevuto un investimento da VC Italiano S.r.l. per 2 milioni di euro.",
            "NewsCo Srl fornisce servizi di consulenza a Grande Cliente S.p.A. dal 2025.",
            "NewsCo Srl è cliente di Fornitore Chiave S.r.l. per i componenti hardware.",
        ]

        obs, rels = extract_news_relations(
            repo, company.id, texts, "test_news", "2026-07-01T00:00:00+00:00"
        )

        rel_types = {r.relationship_type for r in rels}
        self.assertIn("partner_of", rel_types)
        self.assertIn("received_investment_from", rel_types)
        self.assertIn("invested_in", rel_types)
        self.assertIn("has_customer", rel_types)
        self.assertIn("customer_of", rel_types)

        # Investor entity created.
        self.assertTrue(any(e.entity_type == "investor" for e in repo.entities.values()))


if __name__ == "__main__":
    unittest.main()
