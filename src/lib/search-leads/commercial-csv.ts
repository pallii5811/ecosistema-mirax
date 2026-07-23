/**
 * CSV commerciale a parità con DB/API/UI.
 * Nessun campo inventato: stringhe vuote se assenti.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readFirstString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function domainOf(obj: Record<string, unknown>): string {
  const direct = readFirstString(obj, ['official_domain', 'website_domain', 'canonical_domain'])
  if (direct) return direct.replace(/^www\./i, '').toLowerCase()
  const site = readFirstString(obj, ['sito', 'website'])
  if (!site) return ''
  return site
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase()
}

function readMarketScope(obj: Record<string, unknown>): string {
  const direct = readFirstString(obj, ['market_scope_status', 'market_scope_state', 'market_scope'])
  if (direct) return direct
  const acceptance = asRecord(obj._lead_acceptance)
  return acceptance ? readFirstString(acceptance, ['market_scope_status', 'market_scope_state']) : ''
}

function readWhyFit(obj: Record<string, unknown>): string {
  const direct = readFirstString(obj, ['why_fit', 'motivo'])
  if (direct) return direct
  const acceptance = asRecord(obj._lead_acceptance)
  return acceptance ? readFirstString(acceptance, ['why_fit']) : ''
}

function readWhyNow(obj: Record<string, unknown>): string {
  const direct = readFirstString(obj, ['why_now'])
  if (direct) return direct
  const acceptance = asRecord(obj._lead_acceptance)
  return acceptance ? readFirstString(acceptance, ['why_now']) : ''
}

function readEvidence(obj: Record<string, unknown>): {
  source_url: string
  evidence_excerpt: string
  event_date: string
  source_published_at: string
  observed_at: string
  claim_type: string
  source_publisher: string
} {
  const grounding = asRecord(obj.semantic_grounding)
  const list = Array.isArray(grounding?.grounded_evidence) ? grounding!.grounded_evidence : []
  const first = asRecord(list[0])
  const verdict = asRecord(first?.verdict) || asRecord(first?.interpretation) || {}
  // Keep event_date / source_published_at / observed_at strictly separate — no cross-fallback.
  return {
    source_url:
      readFirstString(obj, ['source_url']) ||
      readFirstString(verdict, ['source_url']) ||
      '',
    evidence_excerpt:
      readFirstString(obj, ['evidence_excerpt']) ||
      readFirstString(verdict, ['evidence_excerpt', 'excerpt']) ||
      '',
    event_date:
      readFirstString(obj, ['event_date']) ||
      readFirstString(verdict, ['event_date']) ||
      '',
    source_published_at:
      readFirstString(obj, ['source_published_at']) ||
      readFirstString(verdict, ['source_published_at']) ||
      '',
    observed_at: readFirstString(obj, ['observed_at']),
    claim_type:
      readFirstString(obj, ['claim_type', 'evidence_claim_type', 'intent_strength']) ||
      readFirstString(verdict, ['evidence_claim_type', 'claim_type']) ||
      (() => {
        const acceptance = asRecord(obj._lead_acceptance)
        const strength = acceptance ? readFirstString(acceptance, ['intent_strength']) : ''
        if (strength === 'direct') return 'direct'
        if (strength === 'inferred') return 'inferred'
        return strength
      })(),
    source_publisher:
      readFirstString(obj, ['source_publisher']) ||
      readFirstString(verdict, ['source_publisher', 'publisher']) ||
      '',
  }
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

export const COMMERCIAL_CSV_HEADERS_BASE = [
  'canonical_lead_id',
  'azienda',
  'dominio',
  'telefono',
  'email',
  'sito',
  'source_url',
  'evidence_excerpt',
  'why_fit',
  'why_now',
  'event_date',
  'source_published_at',
  'claim_type',
  'market_scope',
  'source_publisher',
  'citta',
] as const

/** Always-present columns; observed_at appended only when present on ≥1 result. */
export const COMMERCIAL_CSV_HEADERS = COMMERCIAL_CSV_HEADERS_BASE

export type CommercialCsvRow = Record<string, string>

export function commercialLeadToCsvRow(lead: Record<string, unknown>): CommercialCsvRow {
  const evidence = readEvidence(lead)
  const row: CommercialCsvRow = {
    canonical_lead_id: readFirstString(lead, [
      'canonical_lead_id',
      'search_candidate_id',
      'candidate_id',
      'id',
    ]),
    azienda: readFirstString(lead, ['azienda', 'nome', 'name', 'company_name']),
    dominio: domainOf(lead),
    telefono: readFirstString(lead, ['telefono', 'phone']),
    email: readFirstString(lead, ['email']),
    sito: readFirstString(lead, ['sito', 'website']),
    source_url: evidence.source_url,
    evidence_excerpt: evidence.evidence_excerpt,
    why_fit: readWhyFit(lead),
    why_now: readWhyNow(lead),
    event_date: evidence.event_date,
    source_published_at: evidence.source_published_at,
    claim_type: evidence.claim_type,
    market_scope: readMarketScope(lead),
    source_publisher: evidence.source_publisher,
    citta: readFirstString(lead, ['citta', 'city', 'matched_geography']),
  }
  if (evidence.observed_at) row.observed_at = evidence.observed_at
  return row
}

export function commercialCsvHeadersFor(results: Record<string, unknown>[]): string[] {
  const hasObserved = results.some((lead) => Boolean(readEvidence(lead).observed_at))
  return hasObserved
    ? [...COMMERCIAL_CSV_HEADERS_BASE, 'observed_at']
    : [...COMMERCIAL_CSV_HEADERS_BASE]
}

/** Export CSV commerciale (UTF-8 BOM per Excel). */
export function commercialResultsToCsv(results: Record<string, unknown>[]): string {
  const headers = commercialCsvHeadersFor(results)
  const rows = results.map((lead) => {
    const row = commercialLeadToCsvRow(lead)
    return headers.map((h) => csvCell(row[h] ?? '')).join(',')
  })
  return `\uFEFF${headers.join(',')}\n${rows.join('\n')}`
}
