/**
 * Agentic Search UI — copy, formatters, esempi (Fase 5).
 */

import type { MiraxSignalRequirement, SignalIntentSpec } from '@/lib/signal-intent/types'
import type { CommercialIntent } from '@/lib/signal-intent/commercial-intent'
import type { UniverseQuery } from './query-builder.ts'
import type { GraphRankFactors } from './graph-ranking.ts'
import { labelObservation, labelRelationship } from './labels.ts'

export const AGENTIC_EXAMPLE_QUERIES = [
  'Aziende edili a Roma senza Meta Pixel',
  'Software house a Milano che assumono programmatori',
  'Impiantisti fotovoltaico con fatturato sopra 1 milione',
  'Studi dentistici a Torino con SEO debole o sito non mobile',
  'Aziende B2B a Bologna senza Google Tag Manager',
  'Costruttori edili in assunzione',
] as const

export const SIGNAL_REQUIREMENT_LABELS: Record<MiraxSignalRequirement, string> = {
  hiring: 'In assunzione',
  hiring_operational: 'Assunzioni operative',
  hiring_technology: 'Assunzioni tech',
  hiring_sales: 'Assunzioni sales',
  hiring_marketing: 'Assunzioni marketing',
  registry_change: 'Variazione registro',
  sector_investment: 'Investimento settoriale',
  tender_won: 'Gara vinta',
  funding_received: 'Finanziamento ricevuto',
  crm_detected: 'CRM rilevato',
  crm_installed: 'CRM installato',
  crm_change: 'Cambio CRM',
  site_stale: 'Sito non aggiornato',
  no_pixel: 'Pixel pubblicitario assente',
  no_gtm: 'Tag manager assente',
  meta_ads_started: 'Meta Ads attivi',
  google_ads_started: 'Google Ads attivi',
  investing_marketing: 'Investe in marketing',
  seeking_supplier: 'Cerca fornitore',
  expansion: 'Espansione',
  fleet_expansion: 'Espansione flotta',
  production_expansion: 'Espansione produttiva',
  new_location: 'Nuova sede',
  executive_change: 'Cambio dirigenza',
  investing_expansion: 'Investe in espansione',
  new_product: 'Nuovo prodotto',
  market_entry: 'Nuovo mercato',
  new_company: 'Nuova impresa',
  tech_migration: 'Migrazione tech',
  manual_processes: 'Processi manuali',
  cybersecurity_exposure: 'Esposizione cyber',
  regulatory_change: 'Cambio normativo',
}

export const PARSE_SOURCE_LABELS: Record<string, string> = {
  heuristic: 'Interpretazione rapida',
  semantic_ai: 'Interpretazione AI',
  semantic_graph: 'Grafo semantico',
  merged: 'Interpretazione ibrida',
  llm: 'Interpretazione AI avanzata',
  fallback: 'Fallback generico',
}

export type AgenticLoadingPhase = 'idle' | 'parsing' | 'querying' | 'enriching'

export const AGENTIC_LOADING_COPY: Record<Exclude<AgenticLoadingPhase, 'idle'>, string> = {
  parsing: 'Interpretazione della query in linguaggio naturale…',
  querying: 'Interrogazione del Knowledge Graph…',
  enriching: 'Arricchimento risultati con osservazioni…',
}

export function labelParseSource(source: string | undefined | null): string {
  if (!source) return 'Interpretazione'
  return PARSE_SOURCE_LABELS[source] ?? source
}

export function labelSignalRequirement(req: MiraxSignalRequirement): string {
  return SIGNAL_REQUIREMENT_LABELS[req] ?? req.replace(/_/g, ' ')
}

export function formatTechnicalFilterChip(key: string, value: unknown): string | null {
  if (value === null || value === undefined) return null
  const labels: Record<string, { true: string; false: string }> = {
    has_meta_pixel: { true: 'Con Meta Pixel', false: 'Senza Meta Pixel' },
    has_gtm: { true: 'Con GTM', false: 'Senza GTM' },
    has_google_analytics: { true: 'Con Analytics', false: 'Senza Analytics' },
    has_ssl: { true: 'Con SSL', false: 'Senza SSL' },
    errors_seo: { true: 'SEO critico', false: 'SEO ok' },
    mobile_friendly: { true: 'Mobile friendly', false: 'Non mobile friendly' },
    has_chatbot: { true: 'Con chatbot', false: 'Senza chatbot' },
    has_booking: { true: 'Con booking', false: 'Senza booking' },
  }
  const spec = labels[key]
  if (spec && typeof value === 'boolean') return spec[String(value) as 'true' | 'false']
  if (key === 'site_speed' && typeof value === 'string') {
    return value === 'slow' ? 'Sito lento' : value === 'fast' ? 'Sito veloce' : null
  }
  return `${key}: ${String(value)}`
}

export function collectIntentChips(intent: SignalIntentSpec): string[] {
  const chips: string[] = []
  if (intent.category) chips.push(intent.category)
  if (intent.location) chips.push(intent.location)
  for (const s of intent.required_signals ?? []) chips.push(labelSignalRequirement(s))
  for (const r of intent.hiring_roles ?? []) if (r.trim()) chips.push(`Ruolo: ${r}`)
  for (const k of intent.sector_keywords ?? []) if (k.trim()) chips.push(`Settore: ${k}`)
  for (const k of intent.crm_keywords ?? []) if (k.trim()) chips.push(`CRM: ${k}`)

  const tf = intent.technical_filters ?? {}
  for (const [key, val] of Object.entries(tf)) {
    const chip = formatTechnicalFilterChip(key, val)
    if (chip) chips.push(chip)
  }

  const bf = intent.business_filters ?? {}
  if (bf.revenue_min != null) chips.push(`Fatturato ≥ ${formatEuro(bf.revenue_min)}`)
  if (bf.employees_min != null) chips.push(`Dipendenti ≥ ${bf.employees_min}`)
  if (bf.revenue_max != null) chips.push(`Fatturato ≤ ${formatEuro(bf.revenue_max)}`)
  if (bf.employees_max != null) chips.push(`Dipendenti ≤ ${bf.employees_max}`)

  return chips
}

export function collectCommercialIntentChips(intent: CommercialIntent): string[] {
  const chips: string[] = []
  const tp = intent.target_profile

  if (intent.user_service_description) chips.push(`Vendo: ${intent.user_service_description}`)
  for (const t of tp.entity_types ?? []) chips.push(`Tipo: ${t}`)
  for (const i of tp.industries ?? []) if (i.trim()) chips.push(`Settore: ${i}`)
  for (const l of tp.locations ?? []) if (l.trim()) chips.push(`Zona: ${l}`)
  for (const r of tp.roles ?? []) if (r.trim()) chips.push(`Ruolo: ${r}`)

  const size = tp.company_size
  if (size) {
    if (size.min_employees != null) chips.push(`Dipendenti ≥ ${size.min_employees}`)
    if (size.max_employees != null) chips.push(`Dipendenti ≤ ${size.max_employees}`)
    if (size.revenue_min != null) chips.push(`Fatturato ≥ ${formatEuro(size.revenue_min)}`)
    if (size.revenue_max != null) chips.push(`Fatturato ≤ ${formatEuro(size.revenue_max)}`)
  }

  for (const s of intent.signals) chips.push(`Segnale: ${s.type}`)

  const tech = intent.tech_profile
  for (const t of tech.has ?? []) chips.push(`Ha ${t}`)
  for (const t of tech.missing ?? []) chips.push(`Manca ${t}`)

  for (const c of intent.graph_constraints) {
    chips.push(`Relazione: ${c.relationship_type} (${c.direction})`)
  }

  if (intent.ranking_hint && intent.ranking_hint !== 'default') {
    chips.push(`Ordina: ${intent.ranking_hint}`)
  }

  return chips
}

function formatEuro(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M€`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k€`
  return `${n}€`
}

export type QueryPlanStep = {
  icon: 'filter' | 'observation' | 'relationship' | 'limit'
  label: string
  detail?: string
}

/** Piano query human-readable per trasparenza UX. */
export function buildUniverseQueryPlan(query: UniverseQuery): QueryPlanStep[] {
  const steps: QueryPlanStep[] = [
    {
      icon: 'filter',
      label: `Entità di tipo «${query.entity_type}»`,
      detail: [
        query.filters?.city ? `Città: ${query.filters.city}` : null,
        query.filters?.country ? `Paese: ${query.filters.country}` : null,
        query.filters?.name_contains
          ? `Parola chiave nel nome: «${query.filters.name_contains}»`
          : null,
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
    },
  ]

  for (const obs of query.filters?.observations ?? []) {
    steps.push({
      icon: 'observation',
      label: `${labelObservation(obs.attribute)} ${operatorLabel(obs.operator)} ${formatObsValue(obs.value)}`,
    })
  }

  for (const rel of query.relationships ?? []) {
    const role = rel.target_filters?.name_contains
    steps.push({
      icon: 'relationship',
      label: `${labelRelationship(rel.relationship_type)}${rel.target_entity_type ? ` → ${rel.target_entity_type}` : ''}`,
      detail: role ? `Ruolo: ${role}` : undefined,
    })
  }

  steps.push({
    icon: 'limit',
    label: `Massimo ${query.limit ?? 50} risultati`,
  })

  return steps
}

function operatorLabel(op: string): string {
  const map: Record<string, string> = {
    eq: '=',
    neq: '≠',
    gt: '>',
    gte: '≥',
    lt: '<',
    lte: '≤',
    in: 'in',
    is_null: 'assente',
    not_null: 'presente',
    contains: 'contiene',
  }
  return map[op] ?? op
}

function formatObsValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'sì' : 'no'
  if (v == null) return '—'
  return String(v)
}

export const GRAPH_RANK_TOOLTIP =
  'Graph Rank (0–100): rilevanza nel grafo basata su freschezza, match intent, eventi recenti, relazioni e osservazioni.'

export function graphRankScoreClass(score: number): string {
  if (score >= 61) return 'bg-rose-100 text-rose-800'
  if (score >= 31) return 'bg-amber-100 text-amber-800'
  return 'bg-slate-100 text-slate-600'
}

/**
 * Fase 10+ — Evidence umane per riga risultato Agentic.
 * Traduce i graph_rank_factors (già calcolati dal motore) in motivazioni leggibili,
 * così l'utente capisce PERCHÉ un'entità è in cima al ranking.
 */
export function buildGraphRankEvidence(
  factors: Partial<GraphRankFactors> | null | undefined,
): string[] {
  if (!factors || typeof factors !== 'object') return []
  const out: string[] = []

  const fresh = Number(factors.freshness ?? 0)
  if (fresh >= 12) out.push('Vista negli ultimi 7 giorni')
  else if (fresh >= 8) out.push('Vista negli ultimi 30 giorni')
  else if (fresh >= 4) out.push('Vista negli ultimi 90 giorni')

  if (Number(factors.intent_location ?? 0) > 0) out.push('Località corrisponde alla ricerca')
  if (Number(factors.intent_category ?? 0) > 0) out.push('Settore/nome corrisponde alla ricerca')

  const ev = Number(factors.recent_events ?? 0)
  if (ev > 0) out.push(`${ev} ${ev === 1 ? 'evento recente' : 'eventi recenti'} (30g)`)

  const rel = Number(factors.relationships ?? 0)
  if (rel > 0) out.push(`${rel} ${rel === 1 ? 'relazione' : 'relazioni'} nel grafo`)

  const obs = Number(factors.observations ?? 0)
  if (obs > 0) out.push(`${obs} ${obs === 1 ? 'osservazione' : 'osservazioni'} indicizzate`)

  if (Number(factors.confidence ?? 0) >= 4) out.push('Affidabilità entità alta')

  return out
}

/** Estrae i fattori di ranking da una riga lead (shape unknown da API). */
export function readGraphRankFactors(
  lead: Record<string, unknown>,
): Partial<GraphRankFactors> | null {
  const raw = lead.graph_rank_factors
  if (raw && typeof raw === 'object') return raw as Partial<GraphRankFactors>
  return null
}

export function readLeadString(lead: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = lead[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/** Export CSV risultati agentic (UTF-8 BOM per Excel). */
export function agenticResultsToCsv(results: Record<string, unknown>[]): string {
  const headers = ['azienda', 'citta', 'categoria', 'sito', 'telefono', 'email', 'graph_score', 'entity_id']
  const rows = results.map((lead) => {
    const score =
      typeof lead.graph_score === 'number'
        ? lead.graph_score
        : typeof lead._score === 'number'
          ? lead._score
          : ''
    return [
      readLeadString(lead, ['azienda', 'nome']),
      readLeadString(lead, ['citta', 'city']),
      readLeadString(lead, ['categoria', 'category']),
      readLeadString(lead, ['sito', 'website']),
      readLeadString(lead, ['telefono', 'phone']),
      readLeadString(lead, ['email']),
      String(score),
      String(lead.entity_id ?? lead.universe_entity_id ?? ''),
    ]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(',')
  })
  return `\uFEFF${headers.join(',')}\n${rows.join('\n')}`
}
