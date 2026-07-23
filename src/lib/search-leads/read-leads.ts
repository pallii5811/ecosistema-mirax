/**
 * Phase 1.4 — Lettura lead da search_leads (Strangler Fig).
 * Merge payload JSONB + colonne hot → contratto UI legacy (searches.results[i]).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseSearchResults } from '@/lib/reaudit'

export type SearchLeadRow = {
  id: string
  search_id: string
  user_id: string | null
  position: number
  azienda: string | null
  telefono: string | null
  email: string | null
  sito: string | null
  citta: string | null
  categoria: string | null
  rating: number | null
  website_domain: string | null
  partita_iva: string | null
  has_pixel: boolean | null
  query_score: number | null
  query_tier: string | null
  payload: Record<string, unknown> | null
  audit_status?: string | null
  enrich_status?: string | null
}

const PAGE_SIZE = 500

const SEARCH_LEAD_COLUMNS =
  'id, search_id, user_id, position, azienda, telefono, email, sito, citta, categoria, rating, website_domain, partita_iva, has_pixel, query_score, query_tier, payload, audit_status, enrich_status'

/** Spread payload e sovrascrivi con colonne hot (zero regressioni UI). */
export function mergeSearchLeadRow(row: SearchLeadRow): Record<string, unknown> {
  const base =
    row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? { ...(row.payload as Record<string, unknown>) }
      : {}

  const hot: Record<string, unknown> = {}

  if (row.azienda != null && row.azienda !== '') {
    hot.azienda = row.azienda
    hot.nome = row.azienda
  }
  if (row.telefono != null && row.telefono !== '') hot.telefono = row.telefono
  if (row.email != null && row.email !== '') hot.email = row.email
  if (row.sito != null && row.sito !== '') {
    hot.sito = row.sito
    hot.website = row.sito
  }
  if (row.citta != null && row.citta !== '') hot.citta = row.citta
  if (row.categoria != null && row.categoria !== '') hot.categoria = row.categoria
  if (row.rating != null) hot.rating = row.rating
  if (row.website_domain != null && row.website_domain !== '') {
    hot.website_domain = row.website_domain
  }
  if (row.partita_iva != null && row.partita_iva !== '') hot.partita_iva = row.partita_iva
  if (row.has_pixel !== null && row.has_pixel !== undefined) {
    hot.has_pixel = row.has_pixel
    hot.meta_pixel = row.has_pixel
  }
  if (row.query_score != null) hot.query_score = row.query_score
  if (row.query_tier != null && row.query_tier !== '') hot.query_tier = row.query_tier

  return { ...base, ...hot }
}

export function parseLegacySearchResults(raw: unknown): Record<string, unknown>[] {
  return parseSearchResults(raw)
}

/** SELECT search_leads paginato (chunk 500). */
export async function fetchSearchLeadRows(
  supabase: SupabaseClient,
  searchId: string,
): Promise<SearchLeadRow[]> {
  const rows: SearchLeadRow[] = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('search_leads')
      .select(SEARCH_LEAD_COLUMNS)
      .eq('search_id', searchId)
      .order('position', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error
    const chunk = (data ?? []) as SearchLeadRow[]
    rows.push(...chunk)
    if (chunk.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return rows
}

export type FetchMergedLeadsOptions = {
  /** Fallback legacy se search_leads vuota o errore query. */
  legacyResults?: unknown
}

function normalizeDomainKey(raw: unknown): string {
  const text = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
  return text.split('/')[0] || ''
}

function leadDomainKey(lead: Record<string, unknown>): string {
  return (
    normalizeDomainKey(lead.official_domain) ||
    normalizeDomainKey(lead.website_domain) ||
    normalizeDomainKey(lead.canonical_domain) ||
    normalizeDomainKey(lead.sito || lead.website)
  )
}

/**
 * Attacca search_candidates.id come canonical_lead_id (match per dominio).
 * Nessun ID inventato: solo lookup DB.
 */
export async function attachCanonicalLeadIds(
  supabase: SupabaseClient,
  searchId: string,
  leads: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  if (!leads.length) return leads
  try {
    const { data, error } = await supabase
      .from('search_candidates')
      .select('id, canonical_domain, entity_name, stage')
      .eq('search_id', searchId)
    if (error || !data?.length) return leads
    const byDomain = new Map<string, string>()
    for (const row of data) {
      const domain = normalizeDomainKey(row.canonical_domain)
      if (domain && row.id) byDomain.set(domain, String(row.id))
    }
    return leads.map((lead) => {
      const existing = String(
        lead.canonical_lead_id || lead.search_candidate_id || lead.candidate_id || '',
      ).trim()
      if (existing) {
        return {
          ...lead,
          canonical_lead_id: existing,
          search_candidate_id: existing,
        }
      }
      const domain = leadDomainKey(lead)
      const id = domain ? byDomain.get(domain) : undefined
      if (!id) return lead
      return {
        ...lead,
        canonical_lead_id: id,
        search_candidate_id: id,
      }
    })
  } catch (e) {
    console.warn('[search-leads] attachCanonicalLeadIds failed search_id=%s', searchId, e)
    return leads
  }
}

/**
 * Lead merged per un job: preferisce search_leads, fallback searches.results.
 */
export async function fetchMergedLeadsForSearch(
  supabase: SupabaseClient,
  searchId: string,
  options: FetchMergedLeadsOptions = {},
): Promise<Record<string, unknown>[]> {
  const legacy =
    options.legacyResults !== undefined
      ? parseLegacySearchResults(options.legacyResults)
      : []

  let fromTable: Record<string, unknown>[] = []
  try {
    const rows = await fetchSearchLeadRows(supabase, searchId)
    if (rows.length > 0) {
      fromTable = rows.map(mergeSearchLeadRow)
    }
  } catch (e) {
    console.warn('[search-leads] fetch failed search_id=%s, using legacy', searchId, e)
  }

  let merged: Record<string, unknown>[] = []

  if (fromTable.length > 0 && legacy.length > 0) {
    const seen = new Map<string, Record<string, unknown>>()
    const keyOf = (lead: Record<string, unknown>) => {
      const d = String(lead.dedupe_key || '').trim()
      if (d) return d
      const site = leadDomainKey(lead)
      if (site) return `web:${site}`
      const phone = String(lead.telefono || lead.phone || '').replace(/\D/g, '').slice(-9)
      if (phone.length >= 8) return `tel:${phone}`
      const name = String(lead.azienda || lead.nome || '').toLowerCase().trim()
      return name ? `name:${name}` : `idx:${seen.size}`
    }
    for (const lead of [...legacy, ...fromTable]) {
      const k = keyOf(lead)
      const prev = seen.get(k)
      seen.set(k, prev ? { ...prev, ...lead } : lead)
    }
    merged = Array.from(seen.values())
  } else if (fromTable.length > 0) {
    merged = fromTable
  } else if (legacy.length > 0) {
    merged = legacy
  } else {
    // Fallback: searches.results via RLS (search_leads può essere vuota lato client)
    try {
      const { data, error } = await supabase
        .from('searches')
        .select('results')
        .eq('id', searchId)
        .single()
      if (!error && data?.results) {
        merged = parseLegacySearchResults(data.results)
      }
    } catch (e) {
      console.warn('[search-leads] searches.results fallback failed search_id=%s', searchId, e)
    }
  }

  return attachCanonicalLeadIds(supabase, searchId, merged)
}

export type SearchLeadsQueryFilters = {
  searchIds?: string[]
  userId?: string
  noPixel?: boolean
  minQueryScore?: number
  limit?: number
}

/** Query multi-search (es. v1/leads, market-map). Fallback legacyRows se nessuna riga. */
export async function fetchMergedLeadsFiltered(
  supabase: SupabaseClient,
  filters: SearchLeadsQueryFilters,
  legacyRows?: { searchId: string; results: unknown }[],
): Promise<Record<string, unknown>[]> {
  const { searchIds, userId, noPixel, minQueryScore, limit } = filters

  try {
    let query = supabase.from('search_leads').select(SEARCH_LEAD_COLUMNS)

    if (searchIds?.length) {
      query = query.in('search_id', searchIds)
    } else if (userId) {
      query = query.eq('user_id', userId)
    } else {
      return flattenLegacyRows(legacyRows)
    }

    if (noPixel) {
      query = query.or('has_pixel.is.null,has_pixel.eq.false')
    }
    if (minQueryScore != null && minQueryScore > 0) {
      query = query.gte('query_score', minQueryScore)
    }

    query = query.order('position', { ascending: true })
    if (limit != null && limit > 0) {
      query = query.limit(limit)
    }

    const { data, error } = await query
    if (error) throw error

    const rows = (data ?? []) as SearchLeadRow[]
    if (rows.length > 0) {
      return rows.map(mergeSearchLeadRow)
    }
  } catch (e) {
    console.warn('[search-leads] filtered fetch failed, using legacy', e)
  }

  return flattenLegacyRows(legacyRows)
}

function flattenLegacyRows(
  legacyRows?: { searchId: string; results: unknown }[],
): Record<string, unknown>[] {
  if (!legacyRows?.length) return []
  const out: Record<string, unknown>[] = []
  for (const row of legacyRows) {
    for (const lead of parseLegacySearchResults(row.results)) {
      out.push({ ...lead, __ckb_search_id: row.searchId })
    }
  }
  return out
}
