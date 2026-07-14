export type SourceCoverageStatus = 'supported' | 'unsupported' | 'generic_fallback_partial'
export type SignalMatchMode = 'any' | 'all'
export type SourceDiscoveryMode =
  | 'discovery_first'
  | 'candidate_first'
  | 'verification_only'
  | 'generic_fallback'

export interface DiscoveryCursor {
  value: string
  partition?: string | null
  exhausted: boolean
}

export interface SourceCapability {
  adapter_id: string
  adapter_version: string
  supported_intents: string[]
  supported_signals: string[]
  source_classes: string[]
  geographic_coverage: string[]
  freshness_max_age_days: number | null
  discovery_mode: SourceDiscoveryMode
  supports_pagination: boolean
  supports_cursor_resume: boolean
  max_results_per_page: number
  max_results_per_run: number | null
  estimated_cost_eur_per_operation: number
  authentication_requirements: string[]
  rate_limit_per_minute: number
  provenance_guarantees: string[]
  evidence_guarantees: string[]
  exhaustion_semantics: 'authoritative' | 'partition' | 'best_effort' | 'unknown'
  coverage_status: SourceCoverageStatus
}

export interface AdapterDiscoveryRequest {
  intent: string
  signal_ids: string[]
  signal_match_mode: SignalMatchMode
  geographies: string[]
  freshness_max_age_days: number | null
  requested_count: number
  budget_eur: number
  query: string
  sectors: string[]
  technical_filters: Record<string, unknown>
  cursor?: DiscoveryCursor | null
}

export interface EvidenceRecord {
  signal_id: string
  source_url: string
  source_publisher: string
  source_class: string
  excerpt: string
  observed_at: string
  published_at: string | null
  extraction_method: string
  confidence: number
  provenance: Record<string, unknown>
}

export interface ContactRecord {
  kind: 'email' | 'phone' | 'social' | 'person' | 'other'
  value: string
  source_url: string | null
  verified: boolean
}

export interface OpportunityCandidate {
  canonical_company_name: string
  company_identifiers: Record<string, string>
  official_domain: string | null
  entity_class: string | null
  geographies: string[]
  buyer_fit: number | null
  signal_id: string
  signal_date: string | null
  evidence: EvidenceRecord[]
  why_now: string | null
  contacts: ContactRecord[]
  confidence: number
  contradiction_flags: string[]
  provenance: Record<string, unknown>
  adapter_id: string
  adapter_version: string
}

export interface QualifiedLead {
  candidate: OpportunityCandidate
  qualification_reasons: string[]
  opportunity_value_score: number
  qualified_at: string
}

export interface SourceExhaustion {
  exhausted: boolean
  scope: 'page' | 'partition' | 'source' | 'market' | 'budget' | 'time'
  reason: string
  authoritative: boolean
  next_cursor: DiscoveryCursor | null
}

export interface AdapterExecutionResult {
  adapter_id: string
  adapter_version: string
  candidates: OpportunityCandidate[]
  exhaustion: SourceExhaustion
  operations: number
  cost_eur: number
  started_at: string
  completed_at: string
  warnings: string[]
}

export interface SourceAdapter {
  readonly capability: SourceCapability
  discover(request: AdapterDiscoveryRequest): Promise<AdapterExecutionResult>
}

function text(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function officialDomain(value: unknown): string | null {
  const normalized = text(value)
  if (!normalized) return null
  try {
    const url = new URL(normalized.includes('://') ? normalized : `https://${normalized}`)
    return url.hostname.toLowerCase().replace(/^www\./, '') || null
  } catch {
    return null
  }
}

/** The only legacy-to-canonical candidate normalizer. */
export function normalizeOpportunityCandidate(
  payload: Record<string, unknown>,
  adapter: Pick<SourceCapability, 'adapter_id' | 'adapter_version'>,
): OpportunityCandidate {
  const technical = typeof payload.technical_report === 'object' && payload.technical_report
    ? payload.technical_report as Record<string, unknown>
    : {}
  const verification = typeof technical.domain_verification === 'object' && technical.domain_verification
    ? technical.domain_verification as Record<string, unknown>
    : {}
  const rawEvidence = Array.isArray(payload.evidence)
    ? payload.evidence
    : Array.isArray(payload.evidence_records)
      ? payload.evidence_records
      : payload.evidence && typeof payload.evidence === 'object'
        ? [payload.evidence]
        : []
  const signalId = text(payload.signal_id) || ''
  const evidence: EvidenceRecord[] = rawEvidence.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    const sourceUrl = text(item.source_url ?? item.url)
    const publisher = text(item.source_publisher ?? item.publisher)
    const sourceClass = text(item.source_class ?? item.type)
    const excerpt = text(item.excerpt ?? item.evidence_excerpt ?? item.text)
    const itemSignal = text(item.signal_id) || signalId
    if (!sourceUrl || !publisher || !sourceClass || !excerpt || !itemSignal) return []
    return [{
      signal_id: itemSignal,
      source_url: sourceUrl,
      source_publisher: publisher,
      source_class: sourceClass,
      excerpt,
      observed_at: text(item.observed_at) || new Date().toISOString(),
      published_at: text(item.published_at ?? item.date),
      extraction_method: text(item.extraction_method) || 'unknown',
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
      provenance: item.provenance && typeof item.provenance === 'object'
        ? item.provenance as Record<string, unknown>
        : {},
    }]
  })
  const contacts: ContactRecord[] = Array.isArray(payload.contacts)
    ? payload.contacts.flatMap((raw) => {
        if (!raw || typeof raw !== 'object') return []
        const item = raw as Record<string, unknown>
        const value = text(item.value)
        if (!value) return []
        const rawKind = text(item.kind)
        const kind: ContactRecord['kind'] = rawKind && ['email', 'phone', 'social', 'person'].includes(rawKind)
          ? rawKind as ContactRecord['kind']
          : 'other'
        return [{ kind, value, source_url: text(item.source_url), verified: item.verified === true }]
      })
    : []
  return {
    canonical_company_name: text(payload.canonical_company_name ?? payload.entity_name ?? payload.company_name ?? payload.name) || '',
    company_identifiers: payload.company_identifiers && typeof payload.company_identifiers === 'object'
      ? Object.fromEntries(Object.entries(payload.company_identifiers as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
      : {},
    official_domain: officialDomain(
      payload.official_domain ?? payload.canonical_domain ?? verification.official_domain ?? verification.canonical_domain,
    ),
    entity_class: text(payload.entity_class),
    geographies: (Array.isArray(payload.geographies) ? payload.geographies : [payload.geography ?? payload.location])
      .map(text)
      .filter((value): value is string => Boolean(value)),
    buyer_fit: payload.buyer_fit == null ? null : Number(payload.buyer_fit),
    signal_id: signalId,
    signal_date: text(payload.signal_date ?? payload.published_at) || evidence.find((item) => item.published_at)?.published_at || null,
    evidence,
    why_now: text(payload.why_now),
    contacts,
    confidence: Math.max(0, Math.min(1, Number(payload.confidence) || 0)),
    contradiction_flags: Array.isArray(payload.contradiction_flags) ? payload.contradiction_flags.map(String) : [],
    provenance: payload.provenance && typeof payload.provenance === 'object'
      ? payload.provenance as Record<string, unknown>
      : {},
    adapter_id: adapter.adapter_id,
    adapter_version: adapter.adapter_version,
  }
}
