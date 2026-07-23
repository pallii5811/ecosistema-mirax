"""Resume must drain free pending pages before paid SERP burns residual budget."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List

from cost_governor import ResearchBudgetExceeded
from source_adapters.catalog import SourceCapabilityRegistry
from source_adapters.contracts import (
    AdapterDiscoveryRequest,
    AdapterExecutionResult,
    DiscoveryCursor,
    SourceCapability,
    SourceExhaustion,
)
from source_adapters.generic_web_budget import (
    GenericWebDiscoveryState,
    decode_generic_web_v2_payload,
    encode_generic_web_cursor,
)
from source_adapters.orchestrator import UniversalSourceOrchestrator, _pending_urls_from_resume_cursor
from source_adapters.shadow_runtime import reopen_generic_web_resume_cursors


def _capability(adapter_id: str, cost: float = 0.005) -> SourceCapability:
    return SourceCapability(
        adapter_id=adapter_id,
        adapter_version="1.0.0",
        supported_intents=("commercial_search",),
        supported_signals=("new_location",),
        source_classes=("official_company_website",),
        geographic_coverage=("global",),
        freshness_max_age_days=365,
        discovery_mode="discovery_first",
        supports_pagination=True,
        supports_cursor_resume=True,
        max_results_per_page=20,
        max_results_per_run=None,
        estimated_cost_eur_per_operation=cost,
        authentication_requirements=(),
        rate_limit_per_minute=60,
        provenance_guarantees=(),
        evidence_guarantees=(),
        exhaustion_semantics="best_effort",
        coverage_status="supported",
    )


@dataclass
class _BudgetPeer:
    capability: SourceCapability
    raise_budget: bool = False
    calls: List[str] = field(default_factory=list)

    async def discover(self, request: AdapterDiscoveryRequest) -> AdapterExecutionResult:
        self.calls.append(self.capability.adapter_id)
        if self.raise_budget:
            raise ResearchBudgetExceeded("web_search would exceed hard budget")
        now = datetime.now(timezone.utc).isoformat()
        return AdapterExecutionResult(
            adapter_id=self.capability.adapter_id,
            adapter_version="1.0.0",
            candidates=(),
            exhaustion=SourceExhaustion(True, "source", "fixture_done", True, request.cursor),
            operations=0,
            cost_eur=0.0,
            started_at=now,
            completed_at=now,
            telemetry={"acquisition": {"pending_urls": []}},
        )


def test_pending_urls_decoded_from_generic_web_cursor() -> None:
    state = GenericWebDiscoveryState(
        pending_urls=("https://www.tironi.com/news/nuovo-stabilimento",),
        candidate_source_urls=("https://www.tironi.com/news/nuovo-stabilimento",),
    )
    cursor = encode_generic_web_cursor(state)
    assert _pending_urls_from_resume_cursor(cursor) == (
        "https://www.tironi.com/news/nuovo-stabilimento",
    )


def test_orchestrator_drains_pending_adapter_before_budget_raising_peer() -> None:
    growth = _BudgetPeer(_capability("official_growth_signals_v1"), raise_budget=True)
    generic = _BudgetPeer(_capability("generic_web_research_v1"))
    cursor = encode_generic_web_cursor(
        GenericWebDiscoveryState(
            pending_urls=(
                "https://www.tironi.com/news/elettromeccanica-tironi-inaugura-il-nuovo-stabilimento-logistico-a-modena/",
            ),
            candidate_source_urls=(
                "https://www.tironi.com/news/elettromeccanica-tironi-inaugura-il-nuovo-stabilimento-logistico-a-modena/",
            ),
        )
    )
    result = asyncio.run(
        UniversalSourceOrchestrator(
            SourceCapabilityRegistry((growth, generic)),
            max_rounds=4,
            max_seconds=30.0,
        ).run(
            AdapterDiscoveryRequest(
                intent="commercial_search",
                signal_ids=("new_location",),
                signal_match_mode="any",
                geographies=("Nord Italia",),
                freshness_max_age_days=365,
                requested_count=1,
                budget_eur=0.01,
                query="ampliamento stabilimento",
            ),
            mandatory_adapter_ids=("official_growth_signals_v1", "generic_web_research_v1"),
            resume_cursors={"generic_web_research_v1": cursor},
        )
    )
    assert generic.calls, "generic_web with pending must run despite growth budget raise"
    assert generic.calls[0] == "generic_web_research_v1"
    assert result.status != "failed_terminal"


def test_reopen_cursors_when_two_of_three_already_published() -> None:
    """Remaining gap requested_count=1 must still reopen Tironi after 2 published domains."""
    stranded = (
        "https://www.tironi.com/news/elettromeccanica-tironi-inaugura-il-nuovo-stabilimento-logistico-a-modena/"
    )
    already = "https://www.tecnoeka.com/news/news-aziendali/inaugurazione-nuovo-polo-produttivo/"
    cursor = encode_generic_web_cursor(
        GenericWebDiscoveryState(
            pending_urls=(),
            salvaged_urls=(stranded, already),
            candidate_source_urls=(stranded, already),
            processed_terminal_urls=(stranded, already),
            pages_fetched=45,
        )
    )
    processed = ("domain:latterievicentine.it", "domain:tecnoeka.com")
    # Bug reproduction: remaining gap alone would skip reopen (2 < 1 is false).
    remaining_gap = 1
    total_target = 3
    assert not (len(processed) < remaining_gap)
    assert len(processed) < total_target

    reopened = reopen_generic_web_resume_cursors(
        {"generic_web_research_v1": cursor},
        processed_employer_keys=processed,
    )
    payload = decode_generic_web_v2_payload(reopened["generic_web_research_v1"].value)
    assert payload is not None
    pending = [str(u).rstrip("/") for u in (payload.get("pending_urls") or ())]
    assert any("tironi.com" in u for u in pending)
    assert not any("tecnoeka.com" in u for u in pending)
    assert list(payload.get("salvaged_urls") or ()) == []
    terminal = [str(u).rstrip("/") for u in (payload.get("processed_terminal_urls") or ())]
    assert not any("tironi.com" in u for u in terminal)


def test_resume_provider_hits_fetch_before_news_shells() -> None:
    from source_adapters.generic_web import _serp_fetch_priority

    resume_hit = {
        "url": "https://www.tironi.com/news/nuovo-stabilimento",
        "title": "",
        "snippet": "",
        "provider": "resume",
    }
    news_hit = {
        "url": "https://www.bresciatoday.it/economia/cembre-lavoro-fatturato.html",
        "title": "Cembre",
        "snippet": "fatturato",
        "provider": "serper",
    }
    assert _serp_fetch_priority(resume_hit) < _serp_fetch_priority(news_hit)
