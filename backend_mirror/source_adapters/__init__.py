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
from .procurement import ProcurementAdapter, ProcurementProviderResult

__all__ = [
    "AdapterDiscoveryRequest",
    "AdapterExecutionResult",
    "CapabilityCoverage",
    "ContactRecord",
    "DiscoveryCursor",
    "DigitalAuditAdapter",
    "EvidenceRecord",
    "OpportunityCandidate",
    "ProcurementAdapter",
    "ProcurementProviderResult",
    "QualifiedLead",
    "SourceAdapter",
    "SourceCapability",
    "SourceCapabilityRegistry",
    "SourceExhaustion",
    "normalize_opportunity_candidate",
]
