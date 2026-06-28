/**
 * Cache ricerche per categoria+città (comportamento Mirax prod).
 * Un pool di lead persistito in `searches.results`, merge tra job, scrape incrementale.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildPendingSearchInsert,
  encodeMaxLeadsZone,
  MAX_LEADS_PER_SEARCH,
} from './search-job-payload.ts'
import { hasLeadContact } from './search-contact-quality.ts'

export type SearchCacheRow = {
  id: string
  category: string
  location: string
  status: string
  results: unknown
  created_at?: string
  zone?: string | null
}

export type MergedSearchCache = {
  leads: Record<string, unknown>[]
  rows: SearchCacheRow[]
  canonicalJobId: string | null
  rawTotal: number
  withContact: number
}

export function normalizeSearchKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

/** Canonical display form stored on new jobs (consistent matching). */
export function formatCanonicalLabel(value: string): string {
  const n = normalizeSearchKey(value)
  if (!n) return ''
  return n.replace(/\b\w/g, (c) => c.toUpperCase())
}

export function parseSearchResults(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed)
        ? (parsed.filter((x) => x && typeof x === 'object') as Record<string, unknown>[])
        : parsed && typeof parsed === 'object'
          ? [parsed as Record<string, unknown>]
          : []
    } catch {
      return []
    }
  }
  if (raw && typeof raw === 'object') return [raw as Record<string, unknown>]
  return []
}

function leadDedupeKey(lead: Record<string, unknown>): string {
  const site = String(lead.sito ?? lead.website ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
  if (site && site !== 'n/d' && site !== 'n/a') return `site:${site}`
  const phone = String(lead.telefono ?? lead.phone ?? '').replace(/\D+/g, '')
  if (phone.length >= 8) return `phone:${phone}`
  const email = String(lead.email ?? '').trim().toLowerCase()
  if (email.includes('@')) return `email:${email}`
  const name = String(lead.nome ?? lead.azienda ?? lead.company ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 40)
  return name ? `name:${name}` : `idx:${Math.random()}`
}

export function dedupeSearchLeads(leads: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>()
  const out: Record<string, unknown>[] = []
  for (const lead of leads) {
    const key = leadDedupeKey(lead)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(lead)
  }
  return out
}

export function attachSearchRowMeta(
  leads: Record<string, unknown>[],
  row: Pick<SearchCacheRow, 'id' | 'location' | 'category'>,
): Record<string, unknown>[] {
  return leads.map((lead) => ({
    __ckb_search_id: row.id,
    __ckb_fallback_location: row.location,
    __ckb_fallback_category: row.category,
    ...lead,
  }))
}

export function buildCategoryOrFilter(variants: string[]): string {
  const uniq = [...new Set(variants.map(normalizeSearchKey).filter(Boolean))]
  return uniq.map((v) => `category.ilike.%${v.replace(/,/g, '%2C')}%`).join(',')
}

/** Load & merge all completed (and optionally in-flight) jobs for category+city. */
export async function loadMergedSearchCache(
  supabase: SupabaseClient,
  opts: {
    category: string
    location: string
    categoryVariants?: string[]
    includeInFlight?: boolean
  },
): Promise<MergedSearchCache> {
  const city = normalizeSearchKey(opts.location)
  const catVariants = [opts.category, ...(opts.categoryVariants ?? [])]
    .map(normalizeSearchKey)
    .filter(Boolean)

  const statuses = opts.includeInFlight
    ? ['completed', 'processing', 'pending', 'pending_user']
    : ['completed']

  let query = supabase
    .from('searches')
    .select('id, category, location, status, results, created_at, zone')
    .in('status', statuses)
    .order('created_at', { ascending: false })
    .limit(100)

  if (city) query = query.ilike('location', `%${city}%`)
  if (catVariants.length > 0) query = query.or(buildCategoryOrFilter(catVariants))

  const { data: rows, error } = await query
  if (error || !rows?.length) {
    return { leads: [], rows: [], canonicalJobId: null, rawTotal: 0, withContact: 0 }
  }

  const typedRows = rows as SearchCacheRow[]
  let merged: Record<string, unknown>[] = []

  for (const row of typedRows) {
    const parsed = parseSearchResults(row.results)
    if (parsed.length === 0) continue
    merged = dedupeSearchLeads([...merged, ...attachSearchRowMeta(parsed, row)])
  }

  let canonicalJobId: string | null = null
  let bestScore = -1
  for (const row of typedRows) {
    const count = parseSearchResults(row.results).length
    const score = count * 10 + (row.status === 'completed' ? 5 : row.status === 'processing' ? 3 : 1)
    if (score > bestScore) {
      bestScore = score
      canonicalJobId = row.id
    }
  }

  const withContact = merged.filter(hasLeadContact).length

  return {
    leads: merged,
    rows: typedRows,
    canonicalJobId,
    rawTotal: merged.length,
    withContact,
  }
}

export type IncrementalScrapeResult = {
  jobId: string
  reused: boolean
  existingRaw: number
  existingWithContact: number
}

/**
 * Reuse canonical job (preserve results) or create one — worker appends on requeue.
 * NON resetta job già in processing (evita 29→6 e loop infiniti).
 */
export async function requestIncrementalScrape(
  supabase: SupabaseClient,
  opts: {
    category: string
    location: string
    maxLeads: number
    userId?: string | null
    categoryVariants?: string[]
  },
): Promise<IncrementalScrapeResult> {
  const category = formatCanonicalLabel(opts.category)
  const location = formatCanonicalLabel(opts.location)
  const maxLeads = Math.min(MAX_LEADS_PER_SEARCH, Math.max(10, Math.round(opts.maxLeads || 10)))

  const cache = await loadMergedSearchCache(supabase, {
    category,
    location,
    categoryVariants: opts.categoryVariants,
    includeInFlight: true,
  })

  const zone = encodeMaxLeadsZone(maxLeads)

  if (cache.canonicalJobId) {
    const canonical = cache.rows.find((r) => r.id === cache.canonicalJobId)
    const status = String(canonical?.status ?? '').toLowerCase()
    const isActive = status === 'processing' || status === 'pending' || status === 'pending_user'

    if (isActive) {
      if (zone) {
        await supabase.from('searches').update({ zone }).eq('id', cache.canonicalJobId)
      }
      return {
        jobId: cache.canonicalJobId,
        reused: true,
        existingRaw: cache.rawTotal,
        existingWithContact: cache.withContact,
      }
    }

    const updatePayload: Record<string, unknown> = {
      status: 'pending',
      category,
      location,
    }
    if (zone) updatePayload.zone = zone

    await supabase.from('searches').update(updatePayload).eq('id', cache.canonicalJobId)

    return {
      jobId: cache.canonicalJobId,
      reused: true,
      existingRaw: cache.rawTotal,
      existingWithContact: cache.withContact,
    }
  }

  const { data: insertData, error: insertError } = await supabase
    .from('searches')
    .insert(
      buildPendingSearchInsert({
        userId: opts.userId,
        category,
        location,
        maxLeads,
      }),
    )
    .select('id')
    .single()

  if (!insertError && insertData?.id) {
    return {
      jobId: insertData.id as string,
      reused: false,
      existingRaw: 0,
      existingWithContact: 0,
    }
  }

  if (String((insertError as { code?: string })?.code) === '23505') {
    const { data: dupRow } = await supabase
      .from('searches')
      .select('id, results, status')
      .ilike('location', location)
      .ilike('category', category)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (dupRow?.id) {
      const dupStatus = String(dupRow.status ?? '').toLowerCase()
      const dupActive = dupStatus === 'processing' || dupStatus === 'pending' || dupStatus === 'pending_user'
      if (!dupActive) {
        await supabase
          .from('searches')
          .update({
            status: 'pending',
            ...(zone ? { zone } : {}),
          })
          .eq('id', dupRow.id)
      } else if (zone) {
        await supabase.from('searches').update({ zone }).eq('id', dupRow.id)
      }

      const parsed = parseSearchResults(dupRow.results)
      return {
        jobId: dupRow.id as string,
        reused: true,
        existingRaw: parsed.length,
        existingWithContact: parsed.filter(hasLeadContact).length,
      }
    }
  }

  throw new Error(insertError?.message || 'Impossibile avviare scrape')
}
