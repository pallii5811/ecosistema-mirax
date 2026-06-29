"""Phase 3 — Universe sidecar unit tests (no Supabase)."""

import os
import unittest
from unittest.mock import MagicMock, patch

from universe.sidecar import ingest_leads_batch, ingest_single_lead, is_universe_enabled


class TestUniverseSidecar(unittest.TestCase):
    def test_disabled_by_default(self):
        with patch.dict(os.environ, {"UNIVERSE_ENABLED": "0"}, clear=False):
            self.assertFalse(is_universe_enabled())
            stats = ingest_leads_batch(MagicMock(), [{"azienda": "Test"}], "maps_scrape")
            self.assertEqual(stats, {"ingested": 0, "errors": 0})

    def test_enabled_no_supabase(self):
        with patch.dict(os.environ, {"UNIVERSE_ENABLED": "1"}, clear=False):
            stats = ingest_leads_batch(None, [{"azienda": "Test"}], "maps_scrape")
            self.assertEqual(stats, {"ingested": 0, "errors": 0})

    def test_enabled_ingests_leads(self):
        leads = [{"azienda": "Edil Roma", "sito": "https://edilroma.it"}]
        sb = MagicMock()
        with patch.dict(os.environ, {"UNIVERSE_ENABLED": "1"}, clear=False):
            with patch("universe.UniverseRepository") as mock_repo_cls, patch(
                "universe.ingest_mirax_lead"
            ) as mock_ingest:
                mock_repo_cls.return_value = MagicMock()
                mock_ingest.return_value = MagicMock()
                stats = ingest_leads_batch(sb, leads, "maps_scrape", user_id="user-1")
        self.assertEqual(stats["ingested"], 1)
        self.assertEqual(stats["errors"], 0)
        mock_ingest.assert_called_once()

    def test_ingest_error_counted(self):
        sb = MagicMock()
        with patch.dict(os.environ, {"UNIVERSE_ENABLED": "1"}, clear=False):
            with patch("universe.UniverseRepository") as mock_repo_cls, patch(
                "universe.ingest_mirax_lead", side_effect=RuntimeError("boom")
            ):
                mock_repo_cls.return_value = MagicMock()
                stats = ingest_leads_batch(sb, [{"azienda": "X", "sito": "x.it"}], "maps_scrape")
        self.assertEqual(stats["ingested"], 0)
        self.assertEqual(stats["errors"], 1)

    def test_single_lead(self):
        with patch.dict(os.environ, {"UNIVERSE_ENABLED": "1"}, clear=False):
            with patch("universe.UniverseRepository") as mock_repo_cls, patch(
                "universe.ingest_mirax_lead"
            ) as mock_ingest:
                mock_repo_cls.return_value = MagicMock()
                mock_ingest.return_value = MagicMock()
                ok = ingest_single_lead(MagicMock(), {"azienda": "Y", "sito": "y.it"}, "test")
        self.assertTrue(ok)


if __name__ == "__main__":
    unittest.main()
