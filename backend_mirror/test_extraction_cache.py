"""Offline cost-control tests for extraction cache and deterministic prefilter."""
from __future__ import annotations

import os
import tempfile

from agents.data_extractor import DataExtractor, page_has_required_signal
from agents.extraction_cache import ExtractionCache


def test_cache_roundtrip_including_empty_result() -> None:
    handle, path = tempfile.mkstemp(suffix=".db")
    os.close(handle)
    os.unlink(path)
    try:
        cache = ExtractionCache(path=path, ttl_days=1)
        plan = {"sector": "software", "required_signals": ["hiring"]}
        key = cache.key(plan, "https://example.it/jobs", "Acme assume developer")
        assert cache.get(key) is None
        cache.set(key, [])
        assert cache.get(key) == []
        cache.set(key, [{"name": "Acme Srl", "website": "https://acme.it"}])
        assert cache.get(key) == [{"name": "Acme Srl", "website": "https://acme.it"}]
    finally:
        for suffix in ("", "-wal", "-shm"):
            candidate = path + suffix
            if os.path.exists(candidate):
                os.unlink(candidate)


def test_cache_key_is_intent_aware() -> None:
    one = ExtractionCache.key(
        {"sector": "software", "required_signals": ["hiring"]},
        "https://example.it",
        "same content",
    )
    two = ExtractionCache.key(
        {"sector": "software", "required_signals": ["funding_received"]},
        "https://example.it",
        "same content",
    )
    assert one != two


def test_signal_prefilter_is_conservative() -> None:
    assert page_has_required_signal("Acme sta assumendo commerciali", {"required_signals": ["hiring"]})
    assert not page_has_required_signal("Ricetta della torta di mele", {"required_signals": ["hiring"]})
    assert page_has_required_signal("Testo long tail", {"required_signals": ["rare_unknown_signal"]})
    assert page_has_required_signal("Qualsiasi testo", {"required_signals": []})


def test_token_cost_telemetry_uses_configured_rates() -> None:
    old_input = os.environ.get("MIRAX_LLM_INPUT_USD_PER_M")
    old_output = os.environ.get("MIRAX_LLM_OUTPUT_USD_PER_M")
    try:
        os.environ["MIRAX_LLM_INPUT_USD_PER_M"] = "1"
        os.environ["MIRAX_LLM_OUTPUT_USD_PER_M"] = "2"
        extractor = DataExtractor({}, [])
        extractor.telemetry["input_tokens"] = 1_000_000
        extractor.telemetry["output_tokens"] = 500_000
        snapshot = extractor.telemetry_snapshot()
        assert snapshot["estimated_llm_cost_usd"] == 2.0
        assert snapshot["cost_rates_configured"] is True
    finally:
        if old_input is None:
            os.environ.pop("MIRAX_LLM_INPUT_USD_PER_M", None)
        else:
            os.environ["MIRAX_LLM_INPUT_USD_PER_M"] = old_input
        if old_output is None:
            os.environ.pop("MIRAX_LLM_OUTPUT_USD_PER_M", None)
        else:
            os.environ["MIRAX_LLM_OUTPUT_USD_PER_M"] = old_output


if __name__ == "__main__":
    test_cache_roundtrip_including_empty_result()
    test_cache_key_is_intent_aware()
    test_signal_prefilter_is_conservative()
    test_token_cost_telemetry_uses_configured_rates()
    print("test_extraction_cache: 4/4 OK")
