"""Fail-closed capability matching for MIRAX source adapters."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Sequence, Tuple

from .contracts import AdapterDiscoveryRequest, CoverageStatus, SourceAdapter, SourceCapability


def _normalized(values: Iterable[str]) -> set[str]:
    return {str(value).strip().lower() for value in values if str(value).strip()}


@dataclass(frozen=True)
class CapabilityCoverage:
    status: CoverageStatus
    adapter_ids: Tuple[str, ...]
    covered_signals: Tuple[str, ...]
    missing_signals: Tuple[str, ...]
    reasons: Tuple[str, ...]


class SourceCapabilityRegistry:
    """Registry of executable adapters; declarations without instances do not count."""

    def __init__(self, adapters: Sequence[SourceAdapter] = ()) -> None:
        self._adapters: Dict[str, SourceAdapter] = {}
        for adapter in adapters:
            self.register(adapter)

    def register(self, adapter: SourceAdapter) -> None:
        capability = adapter.capability
        if capability.adapter_id in self._adapters:
            raise ValueError(f"duplicate source adapter: {capability.adapter_id}")
        self._adapters[capability.adapter_id] = adapter

    def capabilities(self) -> Tuple[SourceCapability, ...]:
        return tuple(adapter.capability for adapter in self._adapters.values())

    def resolve(
        self,
        request: AdapterDiscoveryRequest,
        *,
        required_source_classes: Sequence[str] = (),
        allow_generic_fallback: bool = True,
    ) -> CapabilityCoverage:
        required_signals = _normalized(request.signal_ids)
        requested_sources = _normalized(required_source_classes)
        geography = _normalized(request.geographies)
        eligible: List[SourceCapability] = []
        generic: List[SourceCapability] = []
        rejection_reasons: List[str] = []

        for capability in self.capabilities():
            if capability.discovery_mode == "generic_fallback":
                generic.append(capability)
                continue
            if capability.coverage_status != "supported":
                continue
            intents = _normalized(capability.supported_intents)
            if "*" not in intents and request.intent.lower() not in intents:
                continue
            source_classes = _normalized(capability.source_classes)
            if requested_sources and not requested_sources.intersection(source_classes):
                continue
            supported_geo = _normalized(capability.geographic_coverage)
            if geography and "global" not in supported_geo and not geography.intersection(supported_geo):
                rejection_reasons.append(f"{capability.adapter_id}:geography")
                continue
            if (
                request.freshness_max_age_days is not None
                and capability.freshness_max_age_days is not None
                and capability.freshness_max_age_days > request.freshness_max_age_days
            ):
                rejection_reasons.append(f"{capability.adapter_id}:freshness")
                continue
            if (
                capability.max_results_per_run is not None
                and request.requested_count > capability.max_results_per_run
                and not capability.supports_pagination
            ):
                rejection_reasons.append(f"{capability.adapter_id}:requested_count")
                continue
            eligible.append(capability)

        covered: set[str] = set()
        selected: List[str] = []
        for capability in eligible:
            signals = _normalized(capability.supported_signals)
            matched = required_signals if "*" in signals else required_signals.intersection(signals)
            if matched:
                covered.update(matched)
                selected.append(capability.adapter_id)

        missing = required_signals - covered
        enough = bool(covered) if request.signal_match_mode == "any" else not missing
        if enough and selected:
            return CapabilityCoverage("supported", tuple(selected), tuple(sorted(covered)), tuple(sorted(missing)), tuple(rejection_reasons))

        if allow_generic_fallback and generic:
            fallback_ids = tuple(cap.adapter_id for cap in generic if cap.coverage_status == "generic_fallback_partial")
            if fallback_ids:
                reasons = [*rejection_reasons, "structured_adapter_coverage_incomplete"]
                return CapabilityCoverage("generic_fallback_partial", fallback_ids, tuple(sorted(covered)), tuple(sorted(missing or required_signals)), tuple(reasons))

        reasons = [*rejection_reasons, "no_executable_adapter"]
        return CapabilityCoverage("unsupported", tuple(selected), tuple(sorted(covered)), tuple(sorted(missing or required_signals)), tuple(reasons))


def default_source_capability_registry() -> SourceCapabilityRegistry:
    from .digital_audit import DigitalAuditAdapter
    from .procurement import ProcurementAdapter

    return SourceCapabilityRegistry((DigitalAuditAdapter(), ProcurementAdapter()))
