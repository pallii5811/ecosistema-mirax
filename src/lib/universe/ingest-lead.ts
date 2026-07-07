/**
 * Universe Lead Ingest.
 *
 * Converts a MIRAX lead (Maps + audit + enrichment) into Universe entities,
 * observations, relationships, and events.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AliasType, IngestResult, RelationshipType, UniverseEventType, UniverseObservation } from './types.ts'
import {
  normalizeDomain,
  normalizePhone,
  normalizeEmail,
  normalizeVat,
  slugifyTechnology,
  slugifyLocation,
  slugifyName,
} from './canonical.ts'
import { upsertEntity } from './entity-repository.ts'
import { createObservations } from './observation-repository.ts'
import { createRelationships } from './relationship-repository.ts'
import { appendEvents } from './event-repository.ts'
import { UniverseError } from './errors.ts'

export interface MiraxLeadInput {
  // Identity
  azienda?: string
  nome?: string
  companyName?: string
  name?: string
  sito?: string
  website?: string
  url?: string
  telefono?: string
  phone?: string
  email?: string
  citta?: string
  city?: string
  localita?: string
  categoria?: string
  category?: string
  indirizzo?: string
  address?: string
  region?: string
  country?: string

  // Audit
  meta_pixel?: boolean
  google_tag_manager?: boolean
  google_analytics?: boolean
  ssl?: boolean
  mobile_friendly?: boolean
  seo_disaster?: boolean
  load_speed_seconds?: number | null
  load_speed_s?: number | null
  has_spf?: boolean
  has_dmarc?: boolean
  has_chatbot?: boolean
  has_booking_system?: boolean
  has_ecommerce?: boolean
  html_errors?: number | string[]
  tech_stack?: string[]
  technical_report?: Record<string, unknown>

  // Maps
  rating?: number | null
  reviews_count?: number
  is_claimed?: boolean | null
  google_rating?: number | null
  google_reviews_count?: number
  google_reviews?: Array<{ text?: string; stars?: number }>
  local_competitors?: Array<{ name?: string; website?: string; city?: string; category?: string }>

  // Social
  instagram?: string | null
  facebook?: string | null
  linkedin?: string | null

  // OpenAPI / Registry
  partitaIva?: string | null
  piva?: string | null
  vatNumber?: string | null
  ragioneSociale?: string | null
  formaGiuridica?: string | null
  fatturato?: string | number | null
  dipendenti?: string | number | null
  sedeLegale?: string | null
  openapi_enriched?: Record<string, unknown>

  // Signals
  business_signals?: Array<{
    signalType?: string
    type?: string
    title?: string
    severity?: string
    confidence?: number
    source?: string
    detected_at?: string
    evidence?: unknown[]
    [key: string]: unknown
  }>
  business_hiring_jobs?: Array<{
    title?: string
    url?: string
    source?: string
    location?: string
    role?: string
    seniority?: string
    department?: string
    salary?: string | number
    contract_type?: string
    [key: string]: unknown
  }>

  // Enrichment metadata
  last_audited_at?: string
  opportunity_score?: number
  freshness_score?: number
}

function resolveName(lead: MiraxLeadInput): string {
  return (
    lead.azienda ??
    lead.nome ??
    lead.companyName ??
    lead.name ??
    lead.ragioneSociale ??
    'Unknown Entity'
  )
}

function resolveDomain(lead: MiraxLeadInput): string | null {
  return normalizeDomain(lead.sito ?? lead.website ?? lead.url)
}

function resolveCity(lead: MiraxLeadInput): string | null {
  return lead.citta ?? lead.city ?? lead.localita ?? null
}

function resolveCategory(lead: MiraxLeadInput): string | null {
  return lead.categoria ?? lead.category ?? null
}

function resolvePhone(lead: MiraxLeadInput): string | null {
  return normalizePhone(lead.telefono ?? lead.phone)
}

function resolveEmail(lead: MiraxLeadInput): string | null {
  return normalizeEmail(lead.email)
}

function resolveVat(lead: MiraxLeadInput): string | null {
  const raw = lead.partitaIva ?? lead.piva ?? lead.vatNumber
  return normalizeVat(raw)
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'string' ? Number(value.replace(/\D/g, '')) : value
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function ingestMiraxLead(
  sb: SupabaseClient,
  lead: MiraxLeadInput,
  source: string,
  _userId?: string | null
): Promise<IngestResult> {
  const now = new Date().toISOString()
  const name = resolveName(lead)
  const domain = resolveDomain(lead)
  const city = resolveCity(lead)
  const vat = resolveVat(lead)
  const phone = resolvePhone(lead)
  const canonicalId = domain ?? vat ?? phone ?? slugifyName(name)

  if (!canonicalId) {
    throw new UniverseError('CANONICAL_ID_MISSING', 'Impossibile determinare canonical_id per il lead')
  }

  const aliases: Array<{ alias_type: AliasType; alias_value: string; confidence?: number }> = []
  if (domain) aliases.push({ alias_type: 'domain', alias_value: domain, confidence: 1.0 })
  if (vat) aliases.push({ alias_type: 'vat', alias_value: vat, confidence: 0.95 })
  if (phone) aliases.push({ alias_type: 'phone', alias_value: phone, confidence: 0.9 })
  const email = resolveEmail(lead)
  if (email) aliases.push({ alias_type: 'email', alias_value: email, confidence: 0.9 })
  if (lead.linkedin) aliases.push({ alias_type: 'linkedin', alias_value: lead.linkedin, confidence: 0.85 })
  if (lead.facebook) aliases.push({ alias_type: 'facebook', alias_value: lead.facebook, confidence: 0.85 })
  if (lead.instagram) aliases.push({ alias_type: 'instagram', alias_value: lead.instagram, confidence: 0.85 })

  const { entity: company, is_new } = await upsertEntity(sb, {
    canonical_id: canonicalId,
    entity_type: 'company',
    name,
    slug: slugifyName(name),
    country: lead.country ?? 'IT',
    city,
    region: lead.region ?? null,
    metadata: {
      category: resolveCategory(lead),
      address: lead.indirizzo ?? lead.address ?? null,
      ...(lead.openapi_enriched ?? {}),
    },
    confidence: 1.0,
    aliases,
  })

  const observations: Omit<UniverseObservation, 'id' | 'created_at'>[] = []
  const relationships: Array<{
    source_entity_id: string
    target_entity_id: string
    relationship_type: RelationshipType
    observed_at: string
    source: string
    confidence?: number
    metadata?: Record<string, unknown>
  }> = []
  const events: Array<{
    entity_id?: string | null
    event_type: UniverseEventType
    payload: Record<string, unknown>
    occurred_at: string
    source: string
  }> = []

  // Website entity + owns relationship
  if (domain) {
    const { entity: website } = await upsertEntity(sb, {
      canonical_id: domain,
      entity_type: 'website',
      name: domain,
      slug: slugifyName(domain),
      country: lead.country ?? 'IT',
      city,
      metadata: {
        url: lead.sito ?? lead.website ?? lead.url,
      },
      confidence: 1.0,
    })

    relationships.push({
      source_entity_id: company.id,
      target_entity_id: website.id,
      relationship_type: 'owns',
      observed_at: now,
      source,
      confidence: 1.0,
    })

    // Audit observations on website (and company for discoverability)
    const auditAttributes: Array<[string, unknown]> = [
      ['meta_pixel', lead.meta_pixel === true],
      ['google_tag_manager', lead.google_tag_manager === true],
      ['google_analytics', lead.google_analytics === true],
      ['ssl', lead.ssl === true],
      ['mobile_friendly', lead.mobile_friendly === true],
      ['seo_disaster', lead.seo_disaster === true],
      ['load_speed_seconds', lead.load_speed_seconds ?? lead.load_speed_s ?? null],
      ['has_spf', lead.has_spf === true],
      ['has_dmarc', lead.has_dmarc === true],
      ['has_chatbot', lead.has_chatbot === true],
      ['has_booking_system', lead.has_booking_system === true],
      ['has_ecommerce', lead.has_ecommerce === true],
    ]

    for (const [attr, value] of auditAttributes) {
      if (value === null || value === undefined) continue
      observations.push({
        entity_id: website.id,
        attribute: attr,
        value,
        observed_at: lead.last_audited_at ?? now,
        source,
        confidence: 1.0,
        metadata: { source_entity: 'website' },
      })
      // Mirror on company for simpler graph queries
      observations.push({
        entity_id: company.id,
        attribute: attr,
        value,
        observed_at: lead.last_audited_at ?? now,
        source,
        confidence: 0.95,
        metadata: { mirrored_from: website.id },
      })
    }
  }

  // Technologies
  const techStack = Array.isArray(lead.tech_stack) ? lead.tech_stack : []
  for (const tech of techStack) {
    const techSlug = slugifyTechnology(tech)
    if (!techSlug) continue
    const { entity: techEntity } = await upsertEntity(sb, {
      canonical_id: techSlug,
      entity_type: 'technology',
      name: tech,
      slug: techSlug,
      confidence: 1.0,
    })
    relationships.push({
      source_entity_id: company.id,
      target_entity_id: techEntity.id,
      relationship_type: 'uses',
      observed_at: now,
      source,
      confidence: 1.0,
    })
  }

  // Maps observations
  const rating = lead.rating ?? lead.google_rating ?? null
  if (rating !== null && rating !== undefined) {
    observations.push({
      entity_id: company.id,
      attribute: 'rating',
      value: rating,
      observed_at: now,
      source,
      confidence: 1.0,
    })
  }

  const reviewsCount = lead.reviews_count ?? lead.google_reviews_count ?? null
  if (reviewsCount !== null && reviewsCount !== undefined) {
    observations.push({
      entity_id: company.id,
      attribute: 'reviews_count',
      value: reviewsCount,
      observed_at: now,
      source,
      confidence: 1.0,
    })
  }

  if (lead.is_claimed !== null && lead.is_claimed !== undefined) {
    observations.push({
      entity_id: company.id,
      attribute: 'is_claimed',
      value: lead.is_claimed,
      observed_at: now,
      source,
      confidence: 1.0,
    })
  }

  if (Array.isArray(lead.google_reviews) && lead.google_reviews.length > 0) {
    const stars = lead.google_reviews.map((r) => r.stars).filter((s): s is number => typeof s === 'number')
    const avgStars = stars.length > 0 ? stars.reduce((a, b) => a + b, 0) / stars.length : null
    observations.push({
      entity_id: company.id,
      attribute: 'google_reviews',
      value: {
        count: lead.google_reviews.length,
        avg_stars: avgStars,
        snippets: lead.google_reviews.map((r) => (r.text ?? '').slice(0, 300)).filter(Boolean),
      },
      observed_at: now,
      source,
      confidence: 0.8,
    })
  }

  // Registry observations
  const employees = toNumber(lead.dipendenti)
  if (employees !== null) {
    observations.push({
      entity_id: company.id,
      attribute: 'employees',
      value: employees,
      observed_at: now,
      source: lead.openapi_enriched ? 'openapi' : source,
      confidence: lead.openapi_enriched ? 0.95 : 0.6,
    })
  }

  const revenue = toNumber(lead.fatturato)
  const registrySource = lead.openapi_enriched ? 'openapi' : source
  if (revenue !== null) {
    observations.push({
      entity_id: company.id,
      attribute: 'revenue',
      value: revenue,
      observed_at: now,
      source: registrySource,
      confidence: lead.openapi_enriched ? 0.95 : 0.6,
    })
    events.push({
      entity_id: company.id,
      event_type: 'revenue_changed',
      payload: { value: revenue, unit: 'EUR', source: registrySource },
      occurred_at: now,
      source: registrySource,
    })
  }

  if (employees !== null) {
    events.push({
      entity_id: company.id,
      event_type: 'employees_changed',
      payload: { value: employees, source: registrySource },
      occurred_at: now,
      source: registrySource,
    })
  }

  if (lead.formaGiuridica) {
    observations.push({
      entity_id: company.id,
      attribute: 'legal_form',
      value: lead.formaGiuridica,
      observed_at: now,
      source,
      confidence: 0.9,
    })
  }

  // Location entity
  if (city) {
    const locationSlug = slugifyLocation(city, lead.country ?? 'IT')
    if (locationSlug) {
      const { entity: locationEntity } = await upsertEntity(sb, {
        canonical_id: locationSlug,
        entity_type: 'location',
        name: city,
        slug: locationSlug,
        country: lead.country ?? 'IT',
        city,
        confidence: 1.0,
      })
      relationships.push({
        source_entity_id: company.id,
        target_entity_id: locationEntity.id,
        relationship_type: 'located_in',
        observed_at: now,
        source,
        confidence: 1.0,
      })
    }
  }

  // Business signals → events + observations
  const signals = Array.isArray(lead.business_signals) ? lead.business_signals : []
  for (const signal of signals) {
    const signalType = signal.signalType ?? signal.type ?? 'unknown'
    const eventType = mapSignalTypeToEventType(signalType)
    if (eventType) {
      events.push({
        entity_id: company.id,
        event_type: eventType,
        payload: buildEventPayload(signal, eventType),
        occurred_at: signal.detected_at ?? now,
        source: signal.source ?? source,
      })
    }
  }

  // Local competitors → competes_with relationships
  const localCompetitors = Array.isArray(lead.local_competitors) ? lead.local_competitors : []
  for (const competitor of localCompetitors) {
    const compName = (competitor.name ?? '').trim()
    const compWebsite = (competitor.website ?? '').trim()
    if (!compName && !compWebsite) continue
    const compCanonical = (compWebsite ? normalizeDomain(compWebsite) : null) ?? slugifyName(compName || compWebsite)
    if (!compCanonical) continue
    const { entity: compEntity } = await upsertEntity(sb, {
      canonical_id: compCanonical,
      entity_type: 'company',
      name: compName || compCanonical,
      slug: slugifyName(compName || compCanonical),
      city: competitor.city ?? city ?? null,
      country: lead.country ?? 'IT',
      metadata: { category: competitor.category ?? null, website: compWebsite || null },
      confidence: 0.75,
    })
    relationships.push({
      source_entity_id: company.id,
      target_entity_id: compEntity.id,
      relationship_type: 'competes_with',
      observed_at: now,
      source,
      confidence: 0.75,
      metadata: { local: true },
    })
  }

  // Hiring jobs → job entities + hires relationships
  const jobs = Array.isArray(lead.business_hiring_jobs) ? lead.business_hiring_jobs : []
  for (const job of jobs) {
    if (!job.title) continue
    const jobCanonical = job.url ? normalizeDomain(job.url) ?? slugifyName(job.title) : slugifyName(job.title)
    if (!jobCanonical) continue
    const { entity: jobEntity } = await upsertEntity(sb, {
      canonical_id: jobCanonical,
      entity_type: 'job',
      name: job.title,
      slug: slugifyName(job.title),
      city: job.location ?? city ?? null,
      metadata: {
        url: job.url ?? null,
        location: job.location ?? null,
        role: job.role ?? null,
        seniority: job.seniority ?? null,
        department: job.department ?? null,
        salary: job.salary ?? null,
        contract_type: job.contract_type ?? null,
      },
      confidence: 0.85,
    })
    relationships.push({
      source_entity_id: company.id,
      target_entity_id: jobEntity.id,
      relationship_type: 'hires',
      observed_at: now,
      source: job.source ?? source,
      confidence: 0.85,
    })
    events.push({
      entity_id: company.id,
      event_type: 'new_hiring',
      payload: {
        job_title: job.title,
        job_url: job.url ?? null,
        job_location: job.location ?? null,
        role: job.role ?? null,
        seniority: job.seniority ?? null,
        department: job.department ?? null,
        salary: job.salary ?? null,
        contract_type: job.contract_type ?? null,
      },
      occurred_at: now,
      source: job.source ?? source,
    })
  }

  // Persist everything
  const createdObservations = await createObservations(sb, observations as UniverseObservation[])
  const createdRelationships = await createRelationships(sb, relationships)
  const createdEvents = events.length > 0 ? await appendEvents(sb, events) : []

  return {
    entity_id: company.id,
    entity_type: 'company',
    observations_created: createdObservations.length,
    relationships_created: createdRelationships.length,
    events_created: createdEvents.length,
    aliases_created: aliases.length,
    is_new,
  }
}

function mapSignalTypeToEventType(signalType: string): UniverseEventType | null {
  const map: Record<string, UniverseEventType> = {
    hiring: 'new_hiring',
    new_hiring: 'new_hiring',
    registry_change: 'registry_change',
    funding_news: 'funding_received',
    funding_received: 'funding_received',
    site_stale: 'website_changed',
    website_changed: 'website_changed',
    meta_ads_started: 'pixel_installed',
    google_ads_started: 'ads_started',
    ads_started: 'ads_started',
    crm_detected: 'crm_installed',
    crm_installed: 'crm_installed',
    tender_won: 'tender_won',
    sector_investment: 'sector_investment',
    revenue_changed: 'revenue_changed',
    employees_changed: 'employees_changed',
    new_location: 'registry_change',
    expansion: 'registry_change',
    partnership: 'registry_change',
    acquisition: 'registry_change',
    price_change: 'registry_change',
    executive_change: 'new_director',
  }
  return map[signalType.toLowerCase()] ?? null
}

function buildEventPayload(
  signal: Record<string, unknown> & {
    signalType?: string
    type?: string
    title?: string
    severity?: string
    evidence?: unknown[]
    amount?: number
    currency?: string
    round?: string
    lead_investor?: string
    valuation?: number
    value?: number
    new_value?: number
    previous_value?: number
    unit?: string
    executive_name?: string
    name?: string
    role?: string
  },
  eventType: UniverseEventType,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    signal_type: signal.signalType ?? signal.type,
    title: signal.title ?? null,
    severity: signal.severity ?? null,
    evidence: signal.evidence ?? [],
  }
  if (eventType === 'funding_received') {
    base.amount = signal.amount ?? null
    base.currency = signal.currency ?? 'EUR'
    base.round = signal.round ?? null
    base.lead_investor = signal.lead_investor ?? null
    base.valuation = signal.valuation ?? null
  }
  if (eventType === 'revenue_changed' || eventType === 'employees_changed') {
    base.value = signal.value ?? signal.new_value ?? null
    base.previous_value = signal.previous_value ?? null
    base.unit = signal.unit ?? null
  }
  if (eventType === 'new_director') {
    base.executive_name = signal.executive_name ?? signal.name ?? null
    base.role = signal.role ?? null
  }
  return base
}
