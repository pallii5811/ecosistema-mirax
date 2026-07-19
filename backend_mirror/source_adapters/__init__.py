"""Canonical source-adapter boundary for MIRAX v5."""

from .catalog import CapabilityCoverage, SourceCapabilityRegistry
from .contracts import (
    AdapterDiscoveryRequest,
    AdapterExecutionResult,
    ContactRecord,
    DiscoveryCursor,
    EvidenceRecord,
    OpportunityCandidate,
    QualifiedLead,
    SourceAdapter,
    SourceCapability,
    SourceExhaustion,
    normalize_opportunity_candidate,
)
from .digital_audit import DigitalAuditAdapter
from .hiring import HiringAdapter, HiringProviderResult
from .growth import GrowthProviderResult, GrowthSignalsAdapter
from .generic_web import GenericWebProviderResult, GenericWebResearchAdapter
from .orchestrator import (
    AdapterProgress,
    OrchestrationResult,
    ProgressCallback,
    QualificationDecision,
    SearchProgress,
    UniversalSourceOrchestrator,
    default_candidate_qualifier,
    request_from_plan,
)
from .opportunity_scoring import OpportunityScore, ScoreComponent, rank_opportunities, score_opportunity
from .procurement import DomainResolutionResult, ProcurementAdapter, ProcurementProviderResult
from .shadow_runtime import (
    ShadowRuntimeDecision,
    candidate_to_lifecycle_shadow_payload,
    execute_source_adapter_shadow,
    serialize_shadow_qualified_leads,
    source_adapter_orchestrator_requested,
    source_adapter_shadow_decision,
)
from .universal_query_spec import UniversalQuerySpec, compile_universal_query_spec, CANARY_QUERY_SPECS
from .signal_strategy_planner import DiscoveryStrategy, plan_strategies
from .universal_signal_discovery_engine import UniversalEngineResult, UniversalSignalDiscoveryEngine
from .cheap_discovery_prefilter import DiscoveryHit, cheap_rank_hits, prefilter_discovery_hit
from .universal_evidence import ExtractedEvidence, extract_evidence_from_text

__all__ = [
    "AdapterDiscoveryRequest",
    "AdapterExecutionResult",
    "CapabilityCoverage",
    "ContactRecord",
    "DiscoveryCursor",
    "DigitalAuditAdapter",
    "DomainResolutionResult",
    "EvidenceRecord",
    "HiringAdapter",
    "HiringProviderResult",
    "GrowthProviderResult",
    "GrowthSignalsAdapter",
    "GenericWebProviderResult",
    "GenericWebResearchAdapter",
    "AdapterProgress",
    "OrchestrationResult",
    "ProgressCallback",
    "QualificationDecision",
    "SearchProgress",
    "ShadowRuntimeDecision",
    "UniversalSourceOrchestrator",
    "UniversalSignalDiscoveryEngine",
    "UniversalEngineResult",
    "UniversalQuerySpec",
    "DiscoveryStrategy",
    "DiscoveryHit",
    "ExtractedEvidence",
    "CANARY_QUERY_SPECS",
    "compile_universal_query_spec",
    "plan_strategies",
    "cheap_rank_hits",
    "prefilter_discovery_hit",
    "extract_evidence_from_text",
    "default_candidate_qualifier",
    "request_from_plan",
    "OpportunityCandidate",
    "OpportunityScore",
    "ProcurementAdapter",
    "ProcurementProviderResult",
    "QualifiedLead",
    "ScoreComponent",
    "SourceAdapter",
    "SourceCapability",
    "SourceCapabilityRegistry",
    "SourceExhaustion",
    "normalize_opportunity_candidate",
    "rank_opportunities",
    "score_opportunity",
    "candidate_to_lifecycle_shadow_payload",
    "execute_source_adapter_shadow",
    "serialize_shadow_qualified_leads",
    "source_adapter_orchestrator_requested",
    "source_adapter_shadow_decision",
]
