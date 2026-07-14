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
    QualificationDecision,
    SearchProgress,
    UniversalSourceOrchestrator,
    default_candidate_qualifier,
    request_from_plan,
)
from .opportunity_scoring import OpportunityScore, ScoreComponent, rank_opportunities, score_opportunity
from .procurement import ProcurementAdapter, ProcurementProviderResult

__all__ = [
    "AdapterDiscoveryRequest",
    "AdapterExecutionResult",
    "CapabilityCoverage",
    "ContactRecord",
    "DiscoveryCursor",
    "DigitalAuditAdapter",
    "EvidenceRecord",
    "HiringAdapter",
    "HiringProviderResult",
    "GrowthProviderResult",
    "GrowthSignalsAdapter",
    "GenericWebProviderResult",
    "GenericWebResearchAdapter",
    "AdapterProgress",
    "OrchestrationResult",
    "QualificationDecision",
    "SearchProgress",
    "UniversalSourceOrchestrator",
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
]
