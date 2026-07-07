/**
 * Commercial Signals Engine — Fase 3/4 Knowledge Graph.
 *
 * Transforms raw KG facts (observations, events, relationships) into
 * interpretable commercial signals:
 *   growth, buying, digital_transformation, budget, urgency, pain, intent_fit.
 *
 * Each signal carries a score (0-100), confidence (0-1) and evidence list,
 * so the Reasoning Engine can explain WHY a lead is an opportunity.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CommercialIntent,
  CommercialTechProfile,
} from '@/lib/signal-intent/commercial-intent'
import type {
  EntityType,
  RelatedEntity,
  UniverseEntity,
  UniverseEvent,
  UniverseObservation,
  UniverseRelationship,
} from './types.ts'
import { getRelatedEntities } from './relationship-repository.ts'

export type CommercialSignalType =
  | 'growth'
  | 'buying'
  | 'digital_transformation'
  | 'budget'
  | 'urgency'
  | 'pain'
  | 'intent_fit'

export type CommercialSignalEvidence = {
  /** Human-readable claim */
  claim: string
  /** Where the claim comes from */
  source_type: 'observation' | 'event' | 'relationship'
  /** Source identifier (observation attribute, event type, relationship type) */
  source_key: string
  /** Original source system */
  source: string
  /** When the evidence was observed */
  observed_at: string
  /** Confidence 0-1 */
  confidence: number
  /** Raw value / snippet */
  value?: unknown
  /** Optional deep-link */
  url?: string
}

export type CommercialSignal = {
  type: CommercialSignalType
  /** 0-100 commercial strength */
  score: number
  /** 0-1 confidence in the signal */
  confidence: number
  /** Evidence supporting the signal */
  evidence: CommercialSignalEvidence[]
  /** ISO timestamp of inference */
  inferred_at: string
}

export type EntitySignalBundle = {
  entity_id: string
  signals: CommercialSignal[]
  summary: string
}

const NOW = () => new Date().toISOString()

const SCORE_WEIGHTS: Record<CommercialSignalType, number> = {
  growth: 1.0,
  buying: 1.25,
  digital_transformation: 1.1,
  budget: 1.0,
  urgency: 0.9,
  pain: 0.85,
  intent_fit: 1.15,
}

const RECENT_DAYS = 180
const RECENT_MS = RECENT_DAYS * 24 * 60 * 60 * 1000

function isRecent(iso: string | null | undefined): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && Date.now() - t <= RECENT_MS
}

function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return (Date.now() - t) / 86_400_000
}

function toBool(value: unknown): boolean | null {
  if (value === true) return true
  if (value === false) return false
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase()
    if (s === 'true' || s === 'yes' || s === 'si' || s === '1') return true
    if (s === 'false' || s === 'no' || s === '0') return false
  }
  return null
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const n = Number(value.replace(/\./g, '').replace(/,/g, '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function addEvidence(
  evidence: CommercialSignalEvidence[],
  claim: string,
  source_type: CommercialSignalEvidence['source_type'],
  source_key: string,
  source: string,
  observed_at: string,
  confidence: number,
  value?: unknown,
  url?: string,
) {
  evidence.push({
    claim,
    source_type,
    source_key,
    source,
    observed_at: observed_at || NOW(),
    confidence,
    value,
    url,
  })
}

// ------------------------------------------------------------------
// Detectors
// ------------------------------------------------------------------

function detectGrowth(
  entity: UniverseEntity,
  observations: UniverseObservation[],
  events: UniverseEvent[],
  relationships: RelatedEntity[],
): CommercialSignal | null {
  const evidence: CommercialSignalEvidence[] = []

  // Hiring events
  const hirings = events.filter((e) => e.event_type === 'new_hiring' && isRecent(e.occurred_at))
  for (const e of hirings.slice(0, 3)) {
    const title = (e.payload?.job_title as string) || 'Nuova posizione'
    addEvidence(evidence, `Assume: ${title}`, 'event', 'new_hiring', e.source, e.occurred_at, 0.85, e.payload)
  }

  // Revenue / employees growth
  const revenueObs = observations.filter((o) => o.attribute === 'revenue' && isRecent(o.observed_at))
  const employeesObs = observations.filter((o) => o.attribute === 'employees' && isRecent(o.observed_at))

  if (revenueObs.length >= 2) {
    const latest = toNumber(revenueObs[0].value)
    const prev = toNumber(revenueObs[1].value)
    if (latest != null && prev != null && prev > 0) {
      const growth = (latest - prev) / prev
      if (growth > 0.05) {
        addEvidence(
          evidence,
          `Fatturato cresciuto del ${Math.round(growth * 100)}%`,
          'observation',
          'revenue',
          revenueObs[0].source,
          revenueObs[0].observed_at,
          0.8,
          { from: prev, to: latest },
        )
      }
    }
  }

  if (employeesObs.length >= 2) {
    const latest = toNumber(employeesObs[0].value)
    const prev = toNumber(employeesObs[1].value)
    if (latest != null && prev != null && prev > 0) {
      const growth = (latest - prev) / prev
      if (growth > 0.05) {
        addEvidence(
          evidence,
          `Dipendenti cresciuti del ${Math.round(growth * 100)}%`,
          'observation',
          'employees',
          employeesObs[0].source,
          employeesObs[0].observed_at,
          0.8,
          { from: prev, to: latest },
        )
      }
    }
  }

  // Expansion events / relationships
  const expansionEvents = events.filter(
    (e) => (e.event_type === 'expansion_started' || e.event_type === 'market_entered') && isRecent(e.occurred_at),
  )
  for (const e of expansionEvents) {
    addEvidence(evidence, 'Segnale di espansione geografica/mercato', 'event', e.event_type, e.source, e.occurred_at, 0.8, e.payload)
  }

  const newLocations = relationships.filter(
    (r) => r.relationship_type === 'located_in' && isRecent(r.observed_at),
  )
  if (newLocations.length) {
    addEvidence(
      evidence,
      `Presenza in ${newLocations.length} località`,
      'relationship',
      'located_in',
      'universe',
      newLocations[0].observed_at,
      0.7,
    )
  }

  if (evidence.length === 0) return null

  // Score: +25 per hiring, +30 per revenue growth, +25 per employees growth, +20 per expansion
  let score = Math.min(25 * Math.min(hirings.length, 3), 45)
  if (revenueObs.length >= 2) score += 25
  if (employeesObs.length >= 2) score += 25
  if (expansionEvents.length || newLocations.length > 1) score += 20
  score = Math.min(100, score)

  return {
    type: 'growth',
    score,
    confidence: Math.min(0.95, 0.6 + evidence.length * 0.08),
    evidence,
    inferred_at: NOW(),
  }
}

function detectBuying(
  entity: UniverseEntity,
  observations: UniverseObservation[],
  events: UniverseEvent[],
  relationships: RelatedEntity[],
): CommercialSignal | null {
  const evidence: CommercialSignalEvidence[] = []

  const tenders = events.filter((e) => e.event_type === 'tender_won' && isRecent(e.occurred_at))
  for (const e of tenders.slice(0, 3)) {
    const title = (e.payload?.title as string) || 'Gara vinta'
    const amount = toNumber(e.payload?.amount)
    addEvidence(
      evidence,
      amount ? `Gara vinta per ${amount.toLocaleString('it-IT')} EUR` : title,
      'event',
      'tender_won',
      e.source,
      e.occurred_at,
      0.9,
      e.payload,
    )
  }

  const supplierSought = events.filter((e) => e.event_type === 'supplier_sought' && isRecent(e.occurred_at))
  for (const e of supplierSought.slice(0, 2)) {
    addEvidence(evidence, 'Cerca fornitori attivamente', 'event', 'supplier_sought', e.source, e.occurred_at, 0.85, e.payload)
  }

  const newLocations = events.filter((e) => e.event_type === 'registry_change' && isRecent(e.occurred_at))
  for (const e of newLocations.slice(0, 2)) {
    if (e.payload && typeof e.payload === 'object' && 'new_location' in e.payload) {
      addEvidence(evidence, 'Nuova sede aperta', 'event', 'registry_change', e.source, e.occurred_at, 0.8, e.payload)
    }
  }

  const awardedTo = relationships.filter(
    (r) => r.relationship_type === 'awarded_to' && isRecent(r.observed_at),
  )
  for (const r of awardedTo.slice(0, 2)) {
    addEvidence(evidence, `Aggiudicataria di gara pubblica`, 'relationship', 'awarded_to', 'universe', r.observed_at, 0.85, {
      related_entity: r.related_entity_name,
    })
  }

  if (evidence.length === 0) return null

  let score = Math.min(40 * Math.min(tenders.length + supplierSought.length + awardedTo.length, 3), 95)
  return {
    type: 'buying',
    score,
    confidence: Math.min(0.95, 0.65 + evidence.length * 0.07),
    evidence,
    inferred_at: NOW(),
  }
}

function detectDigitalTransformation(
  entity: UniverseEntity,
  observations: UniverseObservation[],
  events: UniverseEvent[],
  relationships: RelatedEntity[],
): CommercialSignal | null {
  const evidence: CommercialSignalEvidence[] = []

  const techMap: Record<string, string> = {
    google_tag_manager: 'Google Tag Manager',
    meta_pixel: 'Meta Pixel',
    google_analytics: 'Google Analytics',
    chatbot: 'Chatbot',
    booking: 'Booking online',
    has_chatbot: 'Chatbot',
    has_booking: 'Booking online',
    has_ecommerce: 'E-commerce',
  }

  const recentTech = observations.filter((o) => {
    const key = o.attribute.toLowerCase()
    return (key in techMap || o.attribute === 'crm_stack') && isRecent(o.observed_at)
  })

  for (const o of recentTech) {
    const val = toBool(o.value)
    const label = techMap[o.attribute.toLowerCase()] || o.attribute
    if (val === true) {
      addEvidence(evidence, `Ha attivato ${label}`, 'observation', o.attribute, o.source, o.observed_at, 0.8, o.value)
    }
  }

  const crmEvents = events.filter(
    (e) => (e.event_type === 'crm_installed' || e.event_type === 'crm_change') && isRecent(e.occurred_at),
  )
  for (const e of crmEvents) {
    addEvidence(evidence, 'Ha implementato/cambiato CRM', 'event', e.event_type, e.source, e.occurred_at, 0.85, e.payload)
  }

  const websiteChanged = events.filter(
    (e) => e.event_type === 'website_changed' && isRecent(e.occurred_at),
  )
  for (const e of websiteChanged.slice(0, 2)) {
    addEvidence(evidence, 'Sito web rinnovato', 'event', 'website_changed', e.source, e.occurred_at, 0.75, e.payload)
  }

  const marketingHires = events.filter(
    (e) =>
      e.event_type === 'new_hiring' &&
      isRecent(e.occurred_at) &&
      /marketing|digital|growth|cmo|web/i.test(String(e.payload?.job_title || '')),
  )
  for (const e of marketingHires.slice(0, 2)) {
    addEvidence(evidence, `Assume in marketing/digital: ${e.payload?.job_title}`, 'event', 'new_hiring', e.source, e.occurred_at, 0.85, e.payload)
  }

  if (evidence.length === 0) return null

  const score = Math.min(100, 20 + evidence.length * 18)
  return {
    type: 'digital_transformation',
    score,
    confidence: Math.min(0.95, 0.65 + evidence.length * 0.06),
    evidence,
    inferred_at: NOW(),
  }
}

function detectBudget(
  entity: UniverseEntity,
  observations: UniverseObservation[],
  events: UniverseEvent[],
): CommercialSignal | null {
  const evidence: CommercialSignalEvidence[] = []

  const funding = events.filter((e) => e.event_type === 'funding_received' && isRecent(e.occurred_at))
  for (const e of funding.slice(0, 2)) {
    const amount = toNumber(e.payload?.amount)
    addEvidence(
      evidence,
      amount ? `Ha ricevuto finanziamento da ${amount.toLocaleString('it-IT')} EUR` : 'Ha ricevuto finanziamento',
      'event',
      'funding_received',
      e.source,
      e.occurred_at,
      0.9,
      e.payload,
    )
  }

  const ads = events.filter(
    (e) => (e.event_type === 'ads_started' || e.event_type === 'pixel_installed') && isRecent(e.occurred_at),
  )
  for (const e of ads.slice(0, 2)) {
    addEvidence(evidence, 'Ha avviato investimenti pubblicitari', 'event', e.event_type, e.source, e.occurred_at, 0.8, e.payload)
  }

  const marketingInvest = observations.filter(
    (o) => o.attribute === 'investing_marketing' && toBool(o.value) === true && isRecent(o.observed_at),
  )
  for (const o of marketingInvest) {
    addEvidence(evidence, 'Sta investendo in marketing', 'observation', o.attribute, o.source, o.observed_at, 0.8, o.value)
  }

  if (evidence.length === 0) return null

  const score = Math.min(100, 25 + evidence.length * 25)
  return {
    type: 'budget',
    score,
    confidence: Math.min(0.95, 0.65 + evidence.length * 0.08),
    evidence,
    inferred_at: NOW(),
  }
}

function detectUrgency(
  entity: UniverseEntity,
  observations: UniverseObservation[],
  events: UniverseEvent[],
): CommercialSignal | null {
  const evidence: CommercialSignalEvidence[] = []

  const stale = observations.filter(
    (o) => o.attribute === 'last_audited_at' && isRecent(o.observed_at),
  )
  for (const o of stale) {
    const days = daysAgo(String(o.value))
    if (days != null && days > 180) {
      addEvidence(evidence, `Sito non auditato da ${Math.round(days)} giorni`, 'observation', o.attribute, o.source, o.observed_at, 0.7, o.value)
    }
  }

  const execChange = events.filter(
    (e) => (e.event_type === 'new_director' || e.event_type === 'executive_change') && isRecent(e.occurred_at),
  )
  for (const e of execChange.slice(0, 2)) {
    const name = (e.payload?.executive_name || e.payload?.name || 'nuovo dirigente') as string
    addEvidence(evidence, `Cambio dirigenza: ${name}`, 'event', e.event_type, e.source, e.occurred_at, 0.8, e.payload)
  }

  const negativeReviews = observations.filter(
    (o) => o.attribute === 'rating' && isRecent(o.observed_at),
  )
  for (const o of negativeReviews) {
    const rating = toNumber(o.value)
    if (rating != null && rating < 4) {
      addEvidence(evidence, `Rating basso (${rating}/5)`, 'observation', o.attribute, o.source, o.observed_at, 0.75, o.value)
    }
  }

  if (evidence.length === 0) return null

  const score = Math.min(100, 20 + evidence.length * 25)
  return {
    type: 'urgency',
    score,
    confidence: Math.min(0.9, 0.6 + evidence.length * 0.08),
    evidence,
    inferred_at: NOW(),
  }
}

function detectPain(
  entity: UniverseEntity,
  observations: UniverseObservation[],
  events: UniverseEvent[],
): CommercialSignal | null {
  const evidence: CommercialSignalEvidence[] = []

  const painChecks: { attribute: string; label: string; threshold?: number }[] = [
    { attribute: 'ssl', label: 'Senza certificato SSL' },
    { attribute: 'mobile_friendly', label: 'Sito non mobile-friendly' },
    { attribute: 'has_chatbot', label: 'Senza chatbot' },
    { attribute: 'has_booking', label: 'Senza booking online' },
    { attribute: 'meta_pixel', label: 'Senza Meta Pixel' },
    { attribute: 'google_tag_manager', label: 'Senza Google Tag Manager' },
  ]

  for (const check of painChecks) {
    const obs = observations.find((o) => o.attribute.toLowerCase() === check.attribute && isRecent(o.observed_at))
    if (obs && toBool(obs.value) === false) {
      addEvidence(evidence, check.label, 'observation', obs.attribute, obs.source, obs.observed_at, 0.75, obs.value)
    }
  }

  const loadSpeed = observations.find(
    (o) => o.attribute === 'load_speed_seconds' && isRecent(o.observed_at),
  )
  if (loadSpeed) {
    const seconds = toNumber(loadSpeed.value)
    if (seconds != null && seconds > 3) {
      addEvidence(evidence, `Sito lento (${seconds}s)`, 'observation', loadSpeed.attribute, loadSpeed.source, loadSpeed.observed_at, 0.8, loadSpeed.value)
    }
  }

  const seoDisaster = observations.find(
    (o) => o.attribute === 'seo_disaster' && isRecent(o.observed_at),
  )
  if (seoDisaster && toBool(seoDisaster.value) === true) {
    addEvidence(evidence, 'Problemi SEO critici rilevati', 'observation', seoDisaster.attribute, seoDisaster.source, seoDisaster.observed_at, 0.8, seoDisaster.value)
  }

  if (evidence.length === 0) return null

  const score = Math.min(100, 20 + evidence.length * 16)
  return {
    type: 'pain',
    score,
    confidence: Math.min(0.9, 0.6 + evidence.length * 0.06),
    evidence,
    inferred_at: NOW(),
  }
}

function detectIntentFit(
  entity: UniverseEntity,
  observations: UniverseObservation[],
  intent?: CommercialIntent,
): CommercialSignal | null {
  if (!intent) return null
  const evidence: CommercialSignalEvidence[] = []

  // Location fit
  const targetLocations = intent.target_profile.locations || []
  if (targetLocations.length) {
    const city = (entity.city || '').toLowerCase()
    const region = (entity.region || '').toLowerCase()
    const matched = targetLocations.some((loc) => city.includes(loc.toLowerCase()) || region.includes(loc.toLowerCase()))
    if (matched) {
      addEvidence(
        evidence,
        `Località match: ${entity.city || entity.region}`,
        'observation',
        'city',
        'universe',
        entity.last_seen_at || NOW(),
        0.85,
        entity.city,
      )
    }
  }

  // Industry fit
  const industries = intent.target_profile.industries || []
  if (industries.length) {
    const categoryObs = observations.find((o) => o.attribute === 'category')
    const metaCategory = String((entity.metadata?.category as string) || '').toLowerCase()
    const obsCategory = String(categoryObs?.value || '').toLowerCase()
    const matched = industries.some((ind) => metaCategory.includes(ind.toLowerCase()) || obsCategory.includes(ind.toLowerCase()))
    if (matched) {
      addEvidence(
        evidence,
        `Settore match: ${obsCategory || metaCategory}`,
        'observation',
        'category',
        categoryObs?.source || 'universe',
        categoryObs?.observed_at || entity.last_seen_at || NOW(),
        0.8,
        obsCategory || metaCategory,
      )
    }
  }

  // Tech fit (missing/has)
  const tech = intent.tech_profile
  if (tech) {
    for (const wanted of tech.has || []) {
      const attr = wanted.toLowerCase()
      const obs = observations.find((o) => o.attribute.toLowerCase() === attr && isRecent(o.observed_at))
      if (obs && toBool(obs.value) === true) {
        addEvidence(evidence, `Ha ${wanted}`, 'observation', obs.attribute, obs.source, obs.observed_at, 0.8, obs.value)
      }
    }
    for (const missing of tech.missing || []) {
      const attr = missing.toLowerCase()
      const obs = observations.find((o) => o.attribute.toLowerCase() === attr && isRecent(o.observed_at))
      if (obs && toBool(obs.value) === false) {
        addEvidence(evidence, `Manca ${missing}`, 'observation', obs.attribute, obs.source, obs.observed_at, 0.8, obs.value)
      }
    }
  }

  if (evidence.length === 0) return null

  const score = Math.min(100, 30 + evidence.length * 18)
  return {
    type: 'intent_fit',
    score,
    confidence: Math.min(0.95, 0.65 + evidence.length * 0.07),
    evidence,
    inferred_at: NOW(),
  }
}

// ------------------------------------------------------------------
// Batch data loading
// ------------------------------------------------------------------

export type EntityFacts = {
  entity: UniverseEntity
  observations: UniverseObservation[]
  events: UniverseEvent[]
  relationships: RelatedEntity[]
}

export async function loadEntityFacts(
  sb: SupabaseClient,
  entities: UniverseEntity[],
): Promise<Map<string, EntityFacts>> {
  const out = new Map<string, EntityFacts>()
  if (entities.length === 0) return out

  const entityIds = entities.map((e) => e.id)
  for (const e of entities) {
    out.set(e.id, { entity: e, observations: [], events: [], relationships: [] })
  }

  const [obsRes, evRes, relRes] = await Promise.all([
    sb.from('universe_observations').select('*').in('entity_id', entityIds),
    sb.from('universe_events').select('*').in('entity_id', entityIds).gte('occurred_at', new Date(Date.now() - 365 * 86400 * 1000).toISOString()),
    Promise.all(entityIds.map((id) => getRelatedEntities(sb, id))),
  ])

  if (obsRes.error) throw obsRes.error
  if (evRes.error) throw evRes.error

  for (const o of (obsRes.data as UniverseObservation[]) || []) {
    const f = out.get(o.entity_id)
    if (f) f.observations.push(o)
  }

  for (const e of (evRes.data as UniverseEvent[]) || []) {
    const f = out.get(e.entity_id ?? '')
    if (f && e.entity_id) f.events.push(e)
  }

  entityIds.forEach((id, idx) => {
    const f = out.get(id)
    if (f) f.relationships = relRes[idx] || []
  })

  return out
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

export function detectCommercialSignalsForEntity(
  facts: EntityFacts,
  intent?: CommercialIntent,
): EntitySignalBundle {
  const { entity, observations, events, relationships } = facts

  const signals: CommercialSignal[] = [
    detectGrowth(entity, observations, events, relationships),
    detectBuying(entity, observations, events, relationships),
    detectDigitalTransformation(entity, observations, events, relationships),
    detectBudget(entity, observations, events),
    detectUrgency(entity, observations, events),
    detectPain(entity, observations, events),
    detectIntentFit(entity, observations, intent),
  ].filter((s): s is CommercialSignal => s != null)

  const summary = signals.length
    ? signals.map((s) => `${s.type}=${s.score}`).join(' · ')
    : 'Nessun segnale commerciale rilevato'

  return { entity_id: entity.id, signals, summary }
}

export async function detectCommercialSignals(
  sb: SupabaseClient,
  entities: UniverseEntity[],
  intent?: CommercialIntent,
): Promise<Map<string, EntitySignalBundle>> {
  const facts = await loadEntityFacts(sb, entities)
  const out = new Map<string, EntitySignalBundle>()
  for (const [id, f] of facts) {
    out.set(id, detectCommercialSignalsForEntity(f, intent))
  }
  return out
}

export function computeCommercialSignalStrength(signals: CommercialSignal[]): number {
  if (!signals.length) return 0
  let weighted = 0
  let weightSum = 0
  for (const s of signals) {
    const w = SCORE_WEIGHTS[s.type] * s.confidence
    weighted += s.score * w
    weightSum += w
  }
  return weightSum > 0 ? Math.round(weighted / weightSum) : 0
}
