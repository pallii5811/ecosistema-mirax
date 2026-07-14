import { SOURCE_BY_ID } from '@/lib/source-intelligence/registry'

export type CostLedgerRow = {
  operation_type?: string | null
  source_class?: string | null
  actual_cost_eur?: number | string | null
  estimated_cost_eur?: number | string | null
  status?: string | null
  metadata?: Record<string, unknown> | null
}

export type QueryYieldStats = {
  pages?: number
  leads?: number
  source_lane?: string
  source_types?: string[]
  expected_signals?: string[]
  source_urls?: string[]
  source_observations?: Array<{ url?: string; observed_at?: string | null }>
  query_status?: string
  urls_discovered?: number
}

export type EvaluationSourceEvent = {
  evaluation_run_id: string
  canary_run_id: string
  search_id: string
  vertical: string
  source_id: string
  source_url?: string | null
  publisher?: string | null
  event_type: 'queried'
  observation_date?: string | null
  extraction_method: string
  cost_eur: number
  selection_reason: string
  metadata: Record<string, unknown>
}

export function canonicalDomain(value: unknown): string {
  try { return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' }
}

export function normalizeObservationDate(value: unknown): string | null {
  const raw = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(raw)) return null
  return Number.isNaN(Date.parse(raw)) ? null : raw
}

export function leadEvidenceUrl(row: Record<string, unknown>): string {
  const direct = String(row.source_url || row.evidence_url || row.agentic_source_url || '').trim()
  if (/^https?:\/\//.test(direct)) return direct
  const report = row.technical_report && typeof row.technical_report === 'object'
    ? row.technical_report as Record<string, unknown> : {}
  const reportUrl = String(report.agentic_source_url || '').trim()
  if (/^https?:\/\//.test(reportUrl)) return reportUrl
  const evidence = Array.isArray(row.agentic_evidence_records) ? row.agentic_evidence_records : []
  const evidenceRecord = evidence.find((item) => item && typeof item === 'object' &&
    /^https?:\/\//.test(String((item as Record<string, unknown>).source_url || '')))
  if (evidenceRecord) return String((evidenceRecord as Record<string, unknown>).source_url)
  const jobs = Array.isArray(row.business_hiring_jobs) ? row.business_hiring_jobs : []
  const job = jobs.find((item) => item && typeof item === 'object' &&
    /^https?:\/\//.test(String((item as Record<string, unknown>).url || '')))
  return job ? String((job as Record<string, unknown>).url) : ''
}

export function sourceFromEvidence(value: string, fallback: string): string {
  if (/indeed|infojobs|linkedin\.com\/jobs|career|lavora con noi/i.test(value)) return 'job_board'
  if (/anac|ted\.europa|appalt|gara|procurement/i.test(value)) return 'public_procurement_portal'
  if (/registro imprese|camera di commercio|bilanc|societar/i.test(value)) return 'official_registry'
  if (/news|notizie|comunicato|stampa/i.test(value)) return 'recognized_local_news'
  if (/meta ads|facebook ads|google ads|ad library/i.test(value)) return 'ad_transparency_library'
  if (/linkedin|instagram|facebook/i.test(value)) return 'official_social_profile'
  return fallback
}

export function sourceIdFromMetadata(
  sourceTypes: unknown,
  sourceLane: unknown,
  evidence: string,
  fallback: string,
): string {
  const declared = Array.isArray(sourceTypes) ? sourceTypes.map(String) : []
  const registered = declared.find((source) => SOURCE_BY_ID.has(source))
  if (registered) return registered
  const lane = String(sourceLane || '')
  const laneMap: Record<string, string> = {
    job_market: 'job_board',
    public_procurement: 'public_procurement_portal',
    public_registry: 'official_registry',
    news: 'recognized_local_news',
    social: 'official_social_profile',
    company_web: 'official_company_website',
    web_evidence: 'official_company_website',
  }
  return laneMap[lane] || sourceFromEvidence(evidence, fallback)
}

export function ledgerActualCost(row: CostLedgerRow): number {
  if (!['settled', 'failed'].includes(String(row.status || ''))) return 0
  const raw = row.actual_cost_eur ?? row.estimated_cost_eur ?? 0
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : 0
}

type BuildInput = {
  runId: string
  canaryId: string
  searchId: string
  vertical: string
  fallbackSource: string
  queryYield: Record<string, QueryYieldStats>
  ledger: CostLedgerRow[]
}

type QueryUnit = {
  query: string
  stats: QueryYieldStats
  sourceUrl: string | null
  observedAt: string | null
  sourceId: string
  publisher: string | null
  costEur: number
}

function finiteCost(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function buildQueriedSourceEvents(input: BuildInput): {
  events: EvaluationSourceEvent[]
  actualCostEur: number
  attributedCostEur: number
} {
  const queryGroups = Object.entries(input.queryYield)
  const units: QueryUnit[] = []
  for (const [query, stats] of queryGroups) {
    const observedByUrl = new Map(
      (stats.source_observations || [])
        .filter((row) => String(row?.url || '').startsWith('http'))
        .map((row) => [String(row.url), row.observed_at ? String(row.observed_at) : null]),
    )
    const urls = [...new Set([
      ...observedByUrl.keys(),
      ...(stats.source_urls || []).filter((url) => String(url).startsWith('http')).map(String),
    ])]
    const sourceId = sourceIdFromMetadata(stats.source_types, stats.source_lane, query, input.fallbackSource)
    for (const sourceUrl of urls.length ? urls : [null]) {
      units.push({
        query,
        stats,
        sourceUrl,
        observedAt: sourceUrl ? normalizeObservationDate(observedByUrl.get(sourceUrl)) : null,
        sourceId,
        publisher: sourceUrl ? canonicalDomain(sourceUrl) || null : null,
        costEur: 0,
      })
    }
  }

  const charged = input.ledger.map((row) => ({ row, cost: ledgerActualCost(row) })).filter(({ cost }) => cost > 0)
  const actualCostEur = charged.reduce((sum, item) => sum + item.cost, 0)
  const extraction = charged.filter(({ row }) => row.operation_type === 'llm_extract')
  const crawlCost = charged.filter(({ row }) => row.operation_type === 'open_page').reduce((sum, item) => sum + item.cost, 0)
  const sharedCost = charged.filter(({ row }) => row.operation_type !== 'llm_extract' && row.operation_type !== 'open_page')
    .reduce((sum, item) => sum + item.cost, 0)

  if (!units.length && actualCostEur > 0) {
    units.push({
      query: 'run_overhead_without_executed_source_query', stats: {}, sourceUrl: null,
      observedAt: null, sourceId: input.fallbackSource, publisher: null, costEur: 0,
    })
  }

  const queryNames = [...new Set(units.map((unit) => unit.query))]
  for (const query of queryNames) {
    const queryUnits = units.filter((unit) => unit.query === query)
    const share = queryNames.length ? sharedCost / queryNames.length / queryUnits.length : 0
    queryUnits.forEach((unit) => { unit.costEur += share })
  }
  const urlUnits = units.filter((unit) => unit.sourceUrl)
  if (urlUnits.length) urlUnits.forEach((unit) => { unit.costEur += crawlCost / urlUnits.length })
  else if (units.length) units.forEach((unit) => { unit.costEur += crawlCost / units.length })

  for (const { row, cost } of extraction) {
    const sourceUrl = String(row.metadata?.source_url || '')
    let targets = sourceUrl ? units.filter((unit) => unit.sourceUrl === sourceUrl) : []
    if (!targets.length) {
      const sourceId = sourceIdFromMetadata(
        row.source_class ? [row.source_class] : [],
        row.source_class,
        sourceUrl,
        input.fallbackSource,
      )
      const unit: QueryUnit = {
        query: String(row.metadata?.query || 'llm_extraction_source'), stats: {},
        sourceUrl: sourceUrl.startsWith('http') ? sourceUrl : null,
        observedAt: normalizeObservationDate(row.metadata?.observed_at),
        sourceId, publisher: canonicalDomain(sourceUrl) || null, costEur: 0,
      }
      units.push(unit)
      targets = [unit]
    }
    targets.forEach((unit) => { unit.costEur += cost / targets.length })
  }

  const attributedCostEur = units.reduce((sum, unit) => sum + finiteCost(unit.costEur), 0)
  const events = units.map((unit) => ({
    evaluation_run_id: input.runId,
    canary_run_id: input.canaryId,
    search_id: input.searchId,
    vertical: input.vertical,
    source_id: unit.sourceId,
    source_url: unit.sourceUrl,
    publisher: unit.publisher,
    event_type: 'queried' as const,
    observation_date: unit.observedAt,
    extraction_method: SOURCE_BY_ID.get(unit.sourceId)?.extraction_method || 'search_and_http',
    cost_eur: finiteCost(unit.costEur),
    selection_reason: 'Executed query emitted by canonical source planner',
    metadata: {
      query: unit.query,
      pages: Number(unit.stats.pages || 0),
      candidates_produced: Number(unit.stats.leads || 0),
      expected_signals: unit.stats.expected_signals || [],
      source_lane: unit.stats.source_lane || null,
      source_types: unit.stats.source_types || [],
      query_status: unit.stats.query_status || null,
      urls_discovered: Number(unit.stats.urls_discovered || 0),
    },
  }))
  return { events, actualCostEur, attributedCostEur }
}

export function sourceMetadataFromLead(
  row: Record<string, unknown>,
  sourceUrl: string,
  fallback: string,
) {
  const query = String(row.query_source || '')
  const sourceId = sourceIdFromMetadata(row.source_types, row.source_lane, `${query} ${sourceUrl}`, fallback)
  return {
    sourceId,
    publisher: String(row.source_publisher || canonicalDomain(sourceUrl) || '') || null,
    observationDate: normalizeObservationDate(row.evidence_date) ||
      normalizeObservationDate(row.source_observation_date) || normalizeObservationDate(row.observed_at),
    extractionMethod: String(row.source_lane || SOURCE_BY_ID.get(sourceId)?.extraction_method || 'worker_evidence_pipeline'),
    query: query || null,
  }
}
