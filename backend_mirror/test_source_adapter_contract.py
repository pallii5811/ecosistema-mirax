from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import pytest

from backend_mirror.source_adapters import (
    AdapterDiscoveryRequest,
    AdapterExecutionResult,
    DiscoveryCursor,
    SourceCapability,
    SourceCapabilityRegistry,
    SourceExhaustion,
    normalize_opportunity_candidate,
)


@dataclass
class StubAdapter:
    capability: SourceCapability

    def discover(self, request: AdapterDiscoveryRequest) -> AdapterExecutionResult:
        now = datetime.now(timezone.utc).isoformat()
        return AdapterExecutionResult(
            adapter_id=self.capability.adapter_id,
            adapter_version=self.capability.adapter_version,
            candidates=(),
            exhaustion=SourceExhaustion(True, "source", "fixture", True),
            operations=0,
            cost_eur=0,
            started_at=now,
            completed_at=now,
        )


def capability(
    adapter_id: str,
    signals: tuple[str, ...],
    *,
    geography: tuple[str, ...] = ("italy",),
    freshness: int | None = 7,
    pagination: bool = True,
    max_results: int | None = None,
    fallback: bool = False,
) -> SourceCapability:
    return SourceCapability(
        adapter_id=adapter_id,
        adapter_version="1.0.0",
        supported_intents=("commercial_search",),
        supported_signals=signals,
        source_classes=(adapter_id.replace("_adapter", "_source"),),
        geographic_coverage=geography,
        freshness_max_age_days=freshness,
        discovery_mode="generic_fallback" if fallback else "discovery_first",
        supports_pagination=pagination,
        supports_cursor_resume=pagination,
        max_results_per_page=20,
        max_results_per_run=max_results,
        estimated_cost_eur_per_operation=0.001,
        authentication_requirements=(),
        rate_limit_per_minute=30,
        provenance_guarantees=("source_url", "publisher"),
        evidence_guarantees=("signal_id", "excerpt"),
        exhaustion_semantics="best_effort" if fallback else "authoritative",
        coverage_status="generic_fallback_partial" if fallback else "supported",
    )


def request(
    signals: tuple[str, ...],
    *,
    mode: str = "all",
    geography: tuple[str, ...] = ("italy",),
    freshness: int | None = 14,
    requested_count: int = 100,
) -> AdapterDiscoveryRequest:
    return AdapterDiscoveryRequest(
        intent="commercial_search",
        signal_ids=signals,
        signal_match_mode=mode,  # type: ignore[arg-type]
        geographies=geography,
        freshness_max_age_days=freshness,
        requested_count=requested_count,
        budget_eur=0.125,
        cursor=DiscoveryCursor("fixture", exhausted=False),
    )


def test_missing_adapter_is_unsupported_without_fallback() -> None:
    coverage = SourceCapabilityRegistry().resolve(request(("tender_won",)), allow_generic_fallback=False)
    assert coverage.status == "unsupported"
    assert coverage.missing_signals == ("tender_won",)


def test_partial_adapter_is_explicit_generic_fallback() -> None:
    fallback = StubAdapter(capability("generic_web_adapter", ("*",), fallback=True))
    coverage = SourceCapabilityRegistry((fallback,)).resolve(request(("tender_won",)))
    assert coverage.status == "generic_fallback_partial"
    assert coverage.adapter_ids == ("generic_web_adapter",)
    assert "structured_adapter_coverage_incomplete" in coverage.reasons


def test_multi_adapter_composition_honors_all_and_any() -> None:
    procurement = StubAdapter(capability("procurement_adapter", ("tender_won",)))
    hiring = StubAdapter(capability("hiring_adapter", ("hiring_operational",)))
    registry = SourceCapabilityRegistry((procurement, hiring))

    all_coverage = registry.resolve(request(("tender_won", "hiring_operational"), mode="all"))
    assert all_coverage.status == "supported"
    assert set(all_coverage.adapter_ids) == {"procurement_adapter", "hiring_adapter"}
    assert all_coverage.missing_signals == ()

    any_coverage = SourceCapabilityRegistry((procurement,)).resolve(
        request(("tender_won", "hiring_operational"), mode="any"),
        allow_generic_fallback=False,
    )
    assert any_coverage.status == "supported"
    assert any_coverage.covered_signals == ("tender_won",)
    assert any_coverage.missing_signals == ("hiring_operational",)


@pytest.mark.parametrize(
    ("kwargs", "reason"),
    [
        ({"geography": ("france",)}, "geography"),
        ({"freshness": 3}, "freshness"),
        ({"requested_count": 101}, "requested_count"),
    ],
)
def test_geography_freshness_and_requested_count_are_enforced(kwargs: dict, reason: str) -> None:
    adapter = StubAdapter(capability(
        "bounded_adapter",
        ("hiring",),
        pagination=False,
        max_results=100,
    ))
    coverage = SourceCapabilityRegistry((adapter,)).resolve(
        request(("hiring",), **kwargs),
        allow_generic_fallback=False,
    )
    assert coverage.status == "unsupported"
    assert any(item.endswith(f":{reason}") for item in coverage.reasons)


def test_boundary_normalizer_promotes_verified_domain_and_canonical_evidence() -> None:
    candidate = normalize_opportunity_candidate({
        "entity_name": "Acme S.r.l.",
        "signal_id": "tender_won",
        "technical_report": {
            "domain_verification": {"official_domain": "https://www.acme.example/path"},
        },
        "evidence": [{
            "signal_id": "tender_won",
            "url": "https://publisher.example/award/1",
            "publisher": "ANAC",
            "type": "public_procurement_portal",
            "text": "Acme S.r.l. e aggiudicataria del contratto.",
            "date": "2026-07-10",
            "observed_at": "2026-07-14",
            "confidence": 0.98,
        }],
        "confidence": 0.9,
    }, adapter_id="procurement_adapter", adapter_version="1.0.0")

    assert candidate.canonical_company_name == "Acme S.r.l."
    assert candidate.official_domain == "acme.example"
    assert candidate.signal_date == "2026-07-10"
    assert candidate.evidence[0].source_publisher == "ANAC"
    assert candidate.evidence[0].published_at == "2026-07-10"
    assert candidate.adapter_id == "procurement_adapter"


def test_generic_fallback_cannot_claim_full_support() -> None:
    with pytest.raises(ValueError, match="generic fallback"):
        SourceCapability(
            **{
                **capability("invalid", ("*",), fallback=True).__dict__,
                "coverage_status": "supported",
            }
        )
