/**
 * Fase 6 — Hydrate legacy lead rows from Universe graph (read sidecar).
 * JSONB cache resta source of truth per il write path; il grafo arricchisce in lettura.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeDomain } from './canonical.ts'
import { getEntityByCanonicalId, getEntityByAlias, getEntityById } from './entity-repository.ts'
import { getLatestObservation } from './observation-repository.ts'

const HYDRATE_ATTRS = [
  'meta_pixel',
  'google_tag_manager',
  'google_analytics',
  'ssl',
  'mobile_friendly',
  'seo_disaster',
  'rating',
  'reviews_count',
  'employees',
  'revenue',
  'category',
  'phone',
  'email',
] as const

const LEAD_FIELD_MAP: Record<string, string[]> = {
  meta_pixel: ['meta_pixel'],
  google_tag_manager: ['google_tag_manager'],
  google_analytics: ['google_analytics'],
  ssl: ['ssl'],
  mobile_friendly: ['mobile_friendly'],
  seo_disaster: ['seo_disaster'],
  rating: ['rating', 'google_rating'],
  reviews_count: ['reviews_count', 'google_reviews_count'],
  employees: ['dipendenti', 'employees'],
  revenue: ['fatturato', 'revenue'],
  category: ['categoria', 'category'],
  phone: ['telefono', 'phone'],
  email: ['email'],
}

export function isUniverseReadEnabled(): boolean {
  return process.env.UNIVERSE_READ_ENABLED === '1' || process.env.UNIVERSE_ENABLED === '1'
}

function leadDomain(lead: Record<string, unknown>): string | null {
  const raw = String(lead.sito ?? lead.website ?? lead.url ?? '').trim()
  if (!raw || /^n\/d$/i.test(raw)) return null
  return normalizeDomain(raw.startsWith('http') ? raw : `https://${raw}`)
}

function applyAttr(lead: Record<string, unknown>, attr: string, value: unknown): boolean {
  const keys = LEAD_FIELD_MAP[attr] ?? [attr]
  let changed = false
  for (const key of keys) {
    if (lead[key] === undefined || lead[key] === null || lead[key] === '') {
      lead[key] = value
      changed = true
    }
  }
  return changed
}

/** Merge grafo → lead legacy (non distruttivo). */
export async function hydrateLeadFromUniverse(
  sb: SupabaseClient,
  lead: Record<string, unknown>,
): Promise<{ lead: Record<string, unknown>; hydrated: boolean; fields: string[] }> {
  const domain = leadDomain(lead)

  let entity = null
  if (typeof lead.universe_entity_id === 'string') {
    entity = await getEntityById(sb, lead.universe_entity_id)
  }
  if (!entity && domain) {
    entity = await getEntityByCanonicalId(sb, domain, 'company')
    if (!entity) entity = await getEntityByAlias(sb, 'domain', domain)
  }
  if (!entity) return { lead, hydrated: false, fields: [] }

  const out = { ...lead }
  const fields: string[] = []
  out.universe_entity_id = entity.id

  for (const attr of HYDRATE_ATTRS) {
    const obs = await getLatestObservation(sb, entity.id, attr)
    if (!obs || obs.value === undefined) continue
    if (applyAttr(out, attr, obs.value)) fields.push(attr)
  }

  if (entity.city && !out.citta && !out.city) {
    out.citta = entity.city
    fields.push('citta')
  }
  if (entity.name && (!out.azienda && !out.nome)) {
    out.azienda = entity.name
    out.nome = entity.name
    fields.push('name')
  }

  if (fields.length > 0) {
    out.universe_hydrated_at = new Date().toISOString()
    out.universe_hydrated_fields = fields
  }

  return { lead: out, hydrated: fields.length > 0, fields }
}

export async function hydrateLeadsFromUniverse(
  sb: SupabaseClient,
  leads: Record<string, unknown>[],
  opts?: { max?: number },
): Promise<{ leads: Record<string, unknown>[]; hydrated_count: number }> {
  const cap = Math.min(leads.length, opts?.max ?? 100)
  const out: Record<string, unknown>[] = []
  let hydrated_count = 0

  for (let i = 0; i < leads.length; i++) {
    const raw = leads[i]
    if (!raw || typeof raw !== 'object' || i >= cap) {
      out.push(raw as Record<string, unknown>)
      continue
    }
    const { lead, hydrated } = await hydrateLeadFromUniverse(sb, raw as Record<string, unknown>)
    if (hydrated) hydrated_count++
    out.push(lead)
  }

  return { leads: out, hydrated_count }
}
