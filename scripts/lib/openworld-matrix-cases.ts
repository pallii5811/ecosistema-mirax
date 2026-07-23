/**
 * Open-world matrix case specs + review formatters.
 * Cases intentionally carry ONLY user-facing inputs (raw_query, requested_count,
 * optional explicit filters written in the query text). No seller/target/signals.
 */

export type MatrixCaseId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export type MatrixCaseSpec = {
  label: string
  raw_query: string
  requested_count: number
  /** Optional filters only if literally written by the user in the query text — never invented. */
  user_filters?: Record<string, string>
}

const ALLOWED_CASE_KEYS = new Set(['label', 'raw_query', 'requested_count', 'user_filters'])

export const OPENWORLD_MATRIX_CASES: Record<MatrixCaseId, MatrixCaseSpec> = {
  A: {
    label: 'Seller-driven inferred need — predictive maintenance',
    requested_count: 3,
    raw_query:
      'Vendiamo manutenzione predittiva alle PMI industriali. Trovami aziende ' +
      'italiane non enormi che hanno ampliato fabbriche, automatizzato linee o ' +
      'installato nuovi macchinari recentemente, con un contatto pubblico.',
  },
  B: {
    label: 'Explicit demand CRM',
    requested_count: 3,
    raw_query:
      'Vendiamo CRM alle PMI. Trovami aziende italiane che stanno valutando, ' +
      'selezionando o cercando un CRM adesso. Escludi vendor CRM e aziende che ' +
      'hanno già concluso l’implementazione.',
  },
  C: {
    label: 'Direct employer hiring',
    requested_count: 3,
    raw_query:
      'Trovami aziende italiane non enormi che stanno assumendo direttamente ' +
      'software engineer o ingegneri informatici, con vacancy attiva e contatto ' +
      'pubblico. Escludi recruiter e portali di lavoro.',
  },
  D: {
    label: 'Startup funding recipient',
    requested_count: 3,
    raw_query:
      'Trovami startup italiane che hanno raccolto fondi recentemente, con ' +
      'dominio ufficiale e contatto pubblico. La startup deve essere il recipient, ' +
      'non il fondo o la banca.',
  },
  E: {
    label: 'Digital audit',
    requested_count: 3,
    raw_query:
      'Faccio siti e marketing. Trovami piccole aziende italiane con dominio ' +
      'ufficiale, contatto pubblico e criticità digitali verificabili sul loro sito.',
  },
  F: {
    label: 'Local service — industrial laundry Trento',
    requested_count: 3,
    raw_query:
      'Cerco potenziali clienti per una lavanderia industriale a Trento e ' +
      'dintorni: hotel, ristoranti e strutture ricettive operative con contatto pubblico.',
  },
}

export function assertCaseIsProductionInputOnly(spec: MatrixCaseSpec): void {
  for (const key of Object.keys(spec)) {
    if (!ALLOWED_CASE_KEYS.has(key)) {
      throw new Error(`case must not carry production-bypass field: ${key}`)
    }
  }
  const forbidden = [
    'seller',
    'target',
    'required_signals',
    'signals',
    'preferred_adapters',
    'adapters',
    'required_attributes',
    'excluded_roles',
    'canonical_plan',
    'hypotheses',
  ]
  for (const key of forbidden) {
    if (key in (spec as object)) {
      throw new Error(`case illegally sets ${key}`)
    }
  }
  if (!spec.raw_query?.trim()) throw new Error('raw_query required')
  if (!Number.isFinite(spec.requested_count) || spec.requested_count < 1) {
    throw new Error('requested_count must be >= 1')
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readStr(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function readEvidence(lead: Record<string, unknown>) {
  const grounding = asRecord(lead.semantic_grounding)
  const list = Array.isArray(grounding?.grounded_evidence) ? grounding!.grounded_evidence : []
  const first = asRecord(list[0])
  const verdict = asRecord(first?.verdict) || asRecord(first?.interpretation) || {}
  const audit = asRecord(lead.technical_report) || asRecord(lead.digital_audit) || {}
  return {
    source_url: readStr(lead, ['source_url']) || readStr(verdict, ['source_url']),
    evidence_excerpt:
      readStr(lead, ['evidence_excerpt']) ||
      readStr(verdict, ['evidence_excerpt', 'excerpt']) ||
      readStr(audit, ['observation', 'summary', 'seo_summary']),
    // Strict separation — no cross-fallback between date fields.
    event_date: readStr(lead, ['event_date']) || readStr(verdict, ['event_date']),
    source_published_at:
      readStr(lead, ['source_published_at']) || readStr(verdict, ['source_published_at']),
  }
}

export function extractLeadReviewFields(lead: Record<string, unknown>) {
  const acceptance = asRecord(lead._lead_acceptance) || {}
  const evidence = readEvidence(lead)
  const domain =
    readStr(lead, ['official_domain', 'website_domain', 'canonical_domain']) ||
    readStr(lead, ['sito', 'website'])
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0]
  const contact =
    readStr(lead, ['email']) ||
    readStr(lead, ['telefono', 'phone']) ||
    ''
  return {
    canonical_lead_id: readStr(lead, [
      'canonical_lead_id',
      'search_candidate_id',
      'candidate_id',
      'id',
    ]),
    company_name: readStr(lead, ['azienda', 'nome', 'name', 'company_name']),
    entity_type: readStr(lead, ['entity_type', 'entity_class']) || null,
    official_domain: domain || null,
    public_contact: contact || null,
    query_mode:
      readStr(asRecord(lead.commercial_intent_spec) || {}, ['request_mode']) ||
      readStr(lead, ['query_mode', 'request_mode', 'search_strategy']) ||
      null,
    event_opportunity_state:
      readStr(lead, ['opportunity_state']) ||
      readStr(acceptance, ['opportunity_state']) ||
      null,
    claim_type:
      readStr(lead, ['claim_type', 'evidence_claim_type']) ||
      readStr(acceptance, ['intent_strength']) ||
      null,
    source_url: evidence.source_url || null,
    literal_evidence_excerpt: evidence.evidence_excerpt || null,
    event_date: evidence.event_date,
    source_published_at: evidence.source_published_at,
    why_fit: readStr(lead, ['why_fit', 'motivo']) || readStr(acceptance, ['why_fit']) || '',
    why_now: readStr(lead, ['why_now']) || readStr(acceptance, ['why_now']) || '',
    market_scope:
      readStr(lead, ['market_scope_status', 'market_scope_state', 'market_scope']) ||
      readStr(acceptance, ['market_scope_status']) ||
      null,
    lifecycle_state:
      readStr(lead, ['lifecycle_state', 'stage']) ||
      (acceptance.accepted === true ? 'accepted' : null) ||
      null,
  }
}

export function formatLeadReview(lead: Record<string, unknown>, index: number) {
  return { index, ...extractLeadReviewFields(lead) }
}

export function formatFunnel(
  progress: Record<string, unknown>,
  publishedCount: number,
  candidateCount: number,
) {
  const acquisition = asRecord(progress.acquisition) || {}
  const prefilter =
    asRecord(progress.universal_prefilter_telemetry) ||
    asRecord(acquisition.universal_prefilter_telemetry) ||
    {}
  const shadow = asRecord(progress.shadow_resume) || {}
  return {
    serp_raw:
      Number(progress.cumulative_raw_unique ?? acquisition.cumulative_raw_unique ?? shadow.cumulative_raw_unique ?? 0) ||
      null,
    prefilter_accepted: Number(prefilter.prefilter_accepted ?? 0) || null,
    prefilter_rejected: Number(prefilter.prefilter_rejected ?? 0) || null,
    fetched: Number(acquisition.pages_fetched ?? progress.pages_fetched ?? 0) || null,
    provider_queries: Number(acquisition.provider_queries ?? progress.provider_queries ?? 0) || null,
    candidates: candidateCount,
    domain_resolved:
      Number(progress.domain_resolved ?? acquisition.domain_resolved ?? candidateCount) || null,
    contacts:
      Number(progress.contacts ?? progress.contactable ?? acquisition.contacts ?? publishedCount) ||
      null,
    accepted: Number(progress.qualified ?? progress.accepted ?? publishedCount) || null,
    lifecycle_published: publishedCount,
  }
}
