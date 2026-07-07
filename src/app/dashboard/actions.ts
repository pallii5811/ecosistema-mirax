'use server'



import { createClient } from '@/utils/supabase/server'

import type { RicercaRow } from '@/types/ricerche'
import { countPendingAudits } from '@/lib/lead-audit-status'
import { buildPendingSearchInsert, clampSearchMaxLeads } from '@/lib/search-job-payload'
import { hasLeadContact } from '@/lib/search-contact-quality'
import {
  loadMergedSearchCache,
  requestIncrementalScrape,
  formatCanonicalLabel,
} from '@/lib/search-cache'
import {
  coerceSignalIntent,
  intentTechnicalToLegacy,
  mergeSignalIntent,
  parseSignalIntent,
  parseSignalIntentHeuristic,
  parseSignalIntentOffline,
  type SignalIntentSpec,
} from '@/lib/signal-intent'
import { inferMapsCategoryFromIntent, inferSearchKeywordsFromIntent, queryNamesExplicitCategory } from '@/lib/signal-intent/infer-maps-category'
import { filterLeadsWithAI } from '@/lib/lead-relevance'



type TextToFilterSpec = {

  citta?: string | null

  categoria?: string | null

  rating_min?: number | null

  rating_max?: number | null

  page_speed_min?: number | null

  page_speed_max?: number | null

  include_tech?: string[] | null

  exclude_tech?: string[] | null

  include_errors?: string[] | null

  exclude_errors?: string[] | null

  keyword?: string | null

  limit?: number | null

}



const openaiSearchNlpParams = async (

  userQuery: string,

  ctx: { available_categories: string[]; available_locations: string[] }

): Promise<SearchNlpParams> => {

  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {

    throw new Error('MISSING_OPENAI_KEY')

  }



  const payload = {

    model: 'gpt-4o-mini',

    temperature: 0,

    response_format: { type: 'json_object' },

    messages: [

      { role: 'system', content: buildSearchNlpSystemPromptWithContext(ctx) },

      { role: 'user', content: userQuery },

    ],

  }



  const controller = new AbortController()

  const timeoutId = setTimeout(() => controller.abort(), 25000)



  const res = await fetch('https://api.openai.com/v1/chat/completions', {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      Authorization: `Bearer ${apiKey}`,

    },

    body: JSON.stringify(payload),

    signal: controller.signal,

  }).finally(() => clearTimeout(timeoutId))



  if (!res.ok) {

    const bodyText = await res.text().catch(() => '')

    throw new Error(`OPENAI_HTTP_${res.status}: ${bodyText || res.statusText}`)

  }



  const json = (await res.json()) as any

  const content = json?.choices?.[0]?.message?.content

  if (typeof content !== 'string' || !content.trim()) {

    throw new Error('OPENAI_EMPTY_CONTENT')

  }



  const rawParsed = JSON.parse(content)

  const coerced = coerceSearchNlpParams(rawParsed)

  console.log('LLM EXTRACTION:', { raw: rawParsed, coerced, source: 'llm' })

  return coerced

}



type SearchResult = {

  results: unknown[]

  filters?: LegacyAiFilters

  ai_debug?: unknown

  status?: 'pending' | 'completed'

  jobId?: string

}



type TextToFilterSearchResponse = {

  results: SearchResult['results']

  status?: 'pending' | 'completed'

  jobId?: string

  searchId?: string

  filters?: Record<string, unknown>

  ai_debug?: unknown

  cache_meta?: {
    source: 'db_merged' | 'cached_completed' | 'fresh_scrape'
    db_raw: number
    db_with_contact: number
    jobs_merged: number
    needs_more_scrape?: boolean
    canonical_job_id?: string | null
  }

}

export type SearchActionOptions = {
  maxLeads?: number
}



const withTimeout = async <T,>(promise: Promise<T>, ms: number) => {

  let timeoutId: any

  const timeout = new Promise<T>((_, reject) => {

    timeoutId = setTimeout(() => reject(new Error('timeout')), ms)

  })

  try {

    return await Promise.race([promise, timeout])

  } finally {

    clearTimeout(timeoutId)

  }

}



export async function textToFilterSearchActionExpanded(userQuery: string): Promise<TextToFilterSearchResponse> {

  const supabase = await createClient()



  try {

    const query = (userQuery || '').trim()

    const existingJobMaxAgeMs = 10 * 60 * 1000

    const available = await fetchAvailableSearchOptions(supabase)

    let nlp = await openaiSearchNlpParams(query, available)

    const heur = heuristicSearchNlpParams(query)



    const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : '')

    try {

      const qNorm = query.trim().toLowerCase().replace(/\s+/g, ' ')

      const _stopLoc = new Set(['a','ad','in','su','da','di','per','con','tra','fra','al','del','nel','dal','sul'])

      const findBestMatch = (candidates: string[]) => {

        let best: string | null = null

        for (const raw of candidates) {

          if (typeof raw !== 'string') continue

          const cand = raw.trim()

          if (!cand || _stopLoc.has(cand.toLowerCase())) continue

          const candNorm = cand.toLowerCase()

          const re = new RegExp(`\\b${candNorm.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i')

          if (re.test(qNorm)) {

            if (!best || cand.length > best.length) best = cand

          }
        }

        return best

      }



      const cityFromQuery = findBestMatch(Array.isArray(available.available_locations) ? available.available_locations : [])

      if (cityFromQuery) {

        const llmCity = norm((nlp as any)?.city)

        const picked = cityFromQuery.trim()

        if (!llmCity || llmCity !== norm(picked)) {

          nlp = { ...nlp, city: picked }

        }

      }



      const categoryFromQuery = findBestMatch(Array.isArray(available.available_categories) ? available.available_categories : [])

      if (categoryFromQuery) {

        const llmCat2 = norm((nlp as any)?.category)

        const picked = categoryFromQuery.trim()

        if (!llmCat2 || llmCat2 !== norm(picked)) {

          nlp = { ...nlp, category: picked }

        }

      }

    } catch (e) {

      console.log('[hybrid-expanded] deterministic match failed:', e)

    }



    const heurCity = norm((heur as any)?.city)

    const llmCity = norm((nlp as any)?.city)

    const knownLocs = (Array.isArray(available?.available_locations) ? available.available_locations : []).map(l => l.toLowerCase())
    const heurCityKnown = heurCity && knownLocs.some(loc => loc.includes(heurCity) || heurCity.includes(loc))
    if (heurCity && !llmCity && heurCityKnown) {

      nlp = { ...nlp, city: (heur as any).city }

    }



    const heurCat = norm(heur.category)

    const llmCat = norm(nlp.category)

    const disallowedUmbrella = new Set(['agenzie'])

    const allowHeurOverride = heurCat && !disallowedUmbrella.has(heurCat)

    if (allowHeurOverride && heurCat !== llmCat) {

      nlp = { ...nlp, category: heur.category }

    }



    const semanticIntent = await parseSignalIntent(query)

    const inferredMapsCategory = inferMapsCategoryFromIntent(query, semanticIntent)
    let resolvedCategory =
      typeof nlp.category === 'string' && nlp.category.trim()
        ? nlp.category.trim()
        : semanticIntent.category ?? null
    if (inferredMapsCategory && !queryNamesExplicitCategory(query)) {
      const generic = !resolvedCategory || /^(agenzie|aziende)$/i.test(resolvedCategory)
      const wrongVertical =
        Boolean(resolvedCategory) &&
        semanticIntent.required_signals.includes('hiring') &&
        /viagg|ristorant|hotel|parrucchier|notai|fiorai/i.test(resolvedCategory || '')
      if (generic || wrongVertical) resolvedCategory = inferredMapsCategory
    }
    if (!resolvedCategory && inferredMapsCategory) resolvedCategory = inferredMapsCategory

    const intentKeywords = inferSearchKeywordsFromIntent(query, semanticIntent)
    const mergedKeywords = [
      ...new Set([
        ...(Array.isArray((nlp as SearchNlpParams).keywords) ? (nlp as SearchNlpParams).keywords! : []),
        ...intentKeywords,
      ]),
    ].filter((k) => typeof k === 'string' && k.trim())

    nlp = {

      ...nlp,

      city: typeof nlp.city === 'string' && nlp.city.trim() ? nlp.city : semanticIntent.location ?? nlp.city,

      category: resolvedCategory ?? nlp.category,

      keywords: mergedKeywords.length ? mergedKeywords : (nlp as SearchNlpParams).keywords,

      technical_filters: {

        ...nlp.technical_filters,

        ...intentTechnicalToLegacy(semanticIntent.technical_filters),

        no_website: nlp.technical_filters.no_website === true || heur.technical_filters.no_website === true,

        no_instagram: nlp.technical_filters.no_instagram === true || heur.technical_filters.no_instagram === true,

        no_facebook: nlp.technical_filters.no_facebook === true || heur.technical_filters.no_facebook === true,

        no_tiktok: nlp.technical_filters.no_tiktok === true || heur.technical_filters.no_tiktok === true,

        no_pixel: nlp.technical_filters.no_pixel === true || heur.technical_filters.no_pixel === true || semanticIntent.technical_filters?.has_meta_pixel === false,

        no_gtm: nlp.technical_filters.no_gtm === true || heur.technical_filters.no_gtm === true || semanticIntent.technical_filters?.has_gtm === false,

        no_ga4: nlp.technical_filters.no_ga4 === true || heur.technical_filters.no_ga4 === true || semanticIntent.technical_filters?.has_google_analytics === false,

        no_google_ads: nlp.technical_filters.no_google_ads === true || heur.technical_filters.no_google_ads === true,

        seo_errors: nlp.technical_filters.seo_errors === true || heur.technical_filters.seo_errors === true || semanticIntent.technical_filters?.errors_seo === true,

        no_ssl: nlp.technical_filters.no_ssl === true || heur.technical_filters.no_ssl === true || semanticIntent.technical_filters?.has_ssl === false,

        no_mobile: nlp.technical_filters.no_mobile === true || heur.technical_filters.no_mobile === true || semanticIntent.technical_filters?.mobile_friendly === false,

        spam_risk: nlp.technical_filters.spam_risk === true || heur.technical_filters.spam_risk === true,

        slow_speed: nlp.technical_filters.slow_speed === true || heur.technical_filters.slow_speed === true || semanticIntent.technical_filters?.site_speed === 'slow',

      },

      signal_intent: mergeSignalIntent(
        semanticIntent,
        mergeSignalIntent(
          coerceSignalIntent(heur.signal_intent),
          coerceSignalIntent((nlp as SearchNlpParams).signal_intent),
        ),
      ),

    }



    const normalizeText = (v: string) => v.trim().replace(/\s+/g, ' ')

    const aiDebug = {

      ...nlp,

      city: typeof nlp.city === 'string' ? normalizeText(nlp.city) : null,

      category: typeof nlp.category === 'string' ? normalizeText(nlp.category) : null,

      available_categories_count: available.available_categories.length,

      available_locations_count: available.available_locations.length,

    }

    const det: DeterministicSearchFilters = {

      citta: aiDebug.city,

      categoria: aiDebug.category,

      overall_logic: null,

      filter_no_website: nlp.technical_filters.no_website,

      filter_no_instagram: nlp.technical_filters.no_instagram,

      filter_no_pixel: nlp.technical_filters.no_pixel,

      filter_no_gtm: nlp.technical_filters.no_gtm,

      filter_seo_disaster: nlp.technical_filters.seo_errors,

    }

    let filtri: LegacyAiFilters = {

      citta: det.citta ?? null,

      categoria: det.categoria ?? null,

      needs_html_errors: det.filter_seo_disaster ?? null,

      overall_logic: det.overall_logic ?? null,

      tech_mancanti: [],

      tech_logic: null,

      has_website: null,

    }

    if (det.filter_no_pixel) filtri.tech_mancanti = [...(filtri.tech_mancanti || []), 'pixel']

    if (det.filter_no_gtm) filtri.tech_mancanti = [...(filtri.tech_mancanti || []), 'gtm']

    if (nlp.technical_filters.no_ssl) filtri.tech_mancanti = [...(filtri.tech_mancanti || []), 'ssl']

    const needsNoWebsite = det.filter_no_website === true

    if (needsNoWebsite) filtri.has_website = false



    const _prepBlock = new Set(['a','ad','in','su','da','di','per','con','tra','fra','al','del','nel','dal','sul'])

    let cityBase = (filtri.citta || '').trim()

    if (_prepBlock.has(cityBase.toLowerCase())) cityBase = ''

    const categoryBase = (filtri.categoria || '').trim()

    const extractedKeywords = Array.isArray((nlp as any)?.keywords)
      ? (nlp as any).keywords.filter((v: any) => typeof v === 'string').map((s: string) => s.trim()).filter(Boolean)
      : []

    const extractedExcluded = Array.isArray((nlp as any)?.excluded_keywords)
      ? (nlp as any).excluded_keywords.filter((v: any) => typeof v === 'string').map((s: string) => s.trim()).filter(Boolean)
      : []

    const normalizeForTokens = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ')

    const buildStrictCategoryVariants = (rawCategory: string): string[] => {

      const c = normalizeForTokens(rawCategory)

      if (!c) return []

      const out: string[] = []

      const add = (v: string) => {

        const vv = normalizeForTokens(v)

        if (!vv) return

        if (!out.includes(vv)) out.push(vv)

      }

      add(c)

      // Generic rule: "agenzie X" → also "agenzie di X" and singular/plural forms
      const agenzieMatch = c.match(/^(agenzie|agenzia)\s+(?!di\b)(.+)$/i)
      if (agenzieMatch) {
        const tipo = agenzieMatch[2]
        add(`agenzie ${tipo}`)
        add(`agenzia ${tipo}`)
        add(`agenzie di ${tipo}`)
        add(`agenzia di ${tipo}`)
        // Handle common singular/plural: viaggi→viaggio, immobiliari→immobiliare
        if (tipo.endsWith('i')) {
          const sing = tipo.endsWith('ii') ? tipo.slice(0, -1) + 'o' : tipo.slice(0, -1) + (tipo.endsWith('ri') ? 'e' : 'o')
          if (sing !== tipo) {
            add(`agenzie di ${sing}`)
            add(`agenzia di ${sing}`)
          }
        }
      }
      // Also handle input WITH "di": "agenzie di X" → "agenzie X"
      const agenzieDiMatch = c.match(/^(agenzie|agenzia)\s+di\s+(.+)$/i)
      if (agenzieDiMatch) {
        const tipo = agenzieDiMatch[2]
        add(`agenzie ${tipo}`)
        add(`agenzia ${tipo}`)
      }

      if (c.includes('marketing')) {

        add('agenzie di marketing')

        add('agenzie marketing')

        add('marketing agency')

        add('web marketing')

        add('agenzie di web marketing')

      }

      if (c.includes('comunicazione') || c.includes('pr') || c.includes('pubblicit')) {

        add('agenzie di comunicazione')

        add('agenzie comunicazione')

        add('agenzie pr')

        add('uffici stampa')

        add('ufficio stampa')

        add('agenzie pubblicitarie')

      }



      if (c === 'studi di registrazione' || c === 'studio di registrazione') {

        add('studi di registrazione')

        add('studio di registrazione')

      }

      if (c.includes('social media') || c.includes('smm')) {

        add('social media manager')

        add('social media agency')

        add('agenzia social media')

        add('agenzie social media')

        add('social media marketing')

        add('agenzia di social media marketing')

        add('agenzie di social media marketing')

      }

      if (c.includes('informatica') || c.includes('tecnologia') || c.includes('tech') || c.includes('software')) {

        add('informatica')

        add('tecnologia')

        add('software house')

        add('sviluppatori software')

        add('sviluppatore software')

        add('it')

        add('developer')

      }

      return out

    }

    const categoryVariants = categoryBase ? buildStrictCategoryVariants(categoryBase) : []

    const keywordVariants = extractedKeywords
      .map((k: string) => normalizeForTokens(k))
      .filter(Boolean)
      .slice(0, 3)

    for (const kv of keywordVariants) {
      // Skip keywords that are substrings of existing category variants (too generic, e.g. "agenzie" when category is "agenzie stampa")
      const isSubstringOfExisting = categoryVariants.some((cv) => cv.includes(kv))
      if (!isSubstringOfExisting && !categoryVariants.includes(kv)) categoryVariants.push(kv)
    }

    const escapeForSupabaseOrValue = (v: string) => v.replace(/,/g, '%2C')
    const buildCategoryOr = (variants: string[]) =>
      variants
        .map((v) => `category.ilike.${escapeForSupabaseOrValue(`%${v}%`)}`)
        .join(',')

    let usedFallbackCityOnly = false

    let queryDb = supabase.from('searches').select('*').eq('status', 'completed').limit(500)

    if (cityBase) queryDb = queryDb.ilike('location', `%${cityBase}%`)

    if (categoryVariants.length > 0) queryDb = queryDb.or(buildCategoryOr(categoryVariants))
    else if (categoryBase || keywordVariants.length > 0) {
      const terms = [categoryBase ? normalizeForTokens(categoryBase) : '', ...keywordVariants].filter(Boolean)
      if (terms.length > 0) queryDb = queryDb.or(buildCategoryOr(terms))
    }

    let { data: rows, error } = await queryDb

    if (!error && (!rows || rows.length === 0) && cityBase && !categoryBase) {

      usedFallbackCityOnly = true

      let fallbackQuery = supabase.from('searches').select('*').eq('status', 'completed').limit(500)

      fallbackQuery = fallbackQuery.ilike('location', `%${cityBase}%`)

      const fallbackRes = await fallbackQuery

      rows = fallbackRes.data as any

      error = fallbackRes.error as any

    }

    if (error) throw error

    if (!rows || rows.length === 0) {

      try {

        const {

          data: { user },

        } = await supabase.auth.getUser()

        // Check for recently completed job first — reuse results instead of re-scraping
        const completedMaxAgeMs = 60 * 60 * 1000 // 1 hour
        const canonicalCat = formatCanonicalLabel(categoryBase)
        const { data: completedJob } = await supabase
          .from('searches')
          .select('id, status, results, created_at, category')
          .ilike('location', cityBase)
          .eq('category', canonicalCat)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (completedJob?.id && completedJob.results) {
          const cAt = typeof completedJob.created_at === 'string' ? completedJob.created_at : null
          const cMs = cAt ? Date.parse(cAt) : NaN
          if (Number.isFinite(cMs) && Date.now() - cMs <= completedMaxAgeMs) {
            let cached = Array.isArray(completedJob.results) ? completedJob.results : (() => { try { return JSON.parse(completedJob.results as any) } catch { return [] } })()
            // Apply has_website filter to cached results (e.g. "senza sito")
            if (filtri.has_website === false) {
              cached = cached.filter((lead: any) => {
                const s = (typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : '').trim()
                return !s || s === 'N/D' || s === 'N/A' || s === 'N.D.'
              })
            } else if (filtri.has_website === true) {
              cached = cached.filter((lead: any) => {
                const s = (typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : '').trim()
                return s && s !== 'N/D' && s !== 'N/A' && s !== 'N.D.'
              })
            }
            if (cached.length > 0) {
              const pendingAudits = countPendingAudits(cached)
              const jobId = completedJob.id as string
              console.log('[hybrid] reusing completed job:', jobId, cached.length, 'results', 'pending_audits:', pendingAudits)
              return {
                results: cached,
                filters: filtri,
                jobId,
                searchId: jobId,
                status: 'completed',
                ai_debug: { ...aiDebug, source: 'cached_completed', pending_audits: pendingAudits },
              }
            }
          }
        }

        const canonicalCatPending = formatCanonicalLabel(categoryBase)
        const { data: existingJob } = await supabase
          .from('searches')
          .select('id, status, created_at')
          .ilike('location', cityBase)
          .eq('category', canonicalCatPending)
          .in('status', ['pending', 'pending_user', 'processing'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (existingJob?.id) {

          const createdAt = typeof (existingJob as any)?.created_at === 'string' ? (existingJob as any).created_at : null

          const createdAtMs = createdAt ? Date.parse(createdAt) : NaN

          const isRecent = Number.isFinite(createdAtMs) && Date.now() - createdAtMs <= existingJobMaxAgeMs

          if (isRecent) {

            return { results: [], status: 'pending', jobId: existingJob.id, searchId: existingJob.id }

          }

        }

        const { data: insertData, error: insertError } = await supabase

          .from('searches')

          .insert(
            buildPendingSearchInsert({
              userId: user?.id,
              category: formatCanonicalLabel(categoryBase),
              location: cityBase,
            }),
          )

          .select()

        if (!insertError) {

          return { results: [], status: 'pending', jobId: insertData?.[0]?.id, searchId: insertData?.[0]?.id }

        }

        // Handle duplicate key: find existing record and re-queue it
        if (String((insertError as any)?.code) === '23505') {
          try {
            const { data: dupRow } = await supabase
              .from('searches')
              .select('id, status, created_at')
              .ilike('location', cityBase)
              .eq('category', canonicalCatPending)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            if (dupRow?.id) {
              try {
                await supabase.from('searches').update({ status: 'pending', created_at: new Date().toISOString() }).eq('id', dupRow.id)
              } catch { /* ignore */ }
              console.log('[expanded] requeued existing job (unique):', dupRow.id)
              return { results: [], status: 'pending', jobId: dupRow.id, searchId: dupRow.id }
            }
          } catch { /* ignore */ }
        }

        return { results: [], filters: filtri, ai_debug: { ...aiDebug, category_variants: categoryVariants, fallback_city_only: usedFallbackCityOnly } }

      } catch {

        return { results: [], filters: filtri, ai_debug: { ...aiDebug, category_variants: categoryVariants, fallback_city_only: usedFallbackCityOnly } }

      }

    }

    let allResults: any[] = []

    let skippedResultsFormat = 0

    rows.forEach((row: any) => {

      const fallbackMeta = {

        __ckb_search_id: typeof row?.id === 'string' ? row.id : 'searches',

        __ckb_fallback_location: typeof row?.location === 'string' ? row.location : '',

        __ckb_fallback_category: typeof row?.category === 'string' ? row.category : '',

      }

      if (typeof row?.results === 'string') {

        try {

          const parsed = JSON.parse(row.results)

          if (Array.isArray(parsed)) {

            allResults = allResults.concat(parsed.map((it: any) => ({ ...fallbackMeta, ...(it && typeof it === 'object' ? it : {}) })))

          } else if (parsed && typeof parsed === 'object') {

            allResults = allResults.concat([{ ...fallbackMeta, ...(parsed as any) }])

          } else skippedResultsFormat++

        } catch {

          skippedResultsFormat++

        }

      } else if (Array.isArray(row?.results)) {

        allResults = allResults.concat(row.results.map((it: any) => ({ ...fallbackMeta, ...(it && typeof it === 'object' ? it : {}) })))

      } else if (row?.results && typeof row.results === 'object') {

        allResults = allResults.concat([{ ...fallbackMeta, ...(row.results as any) }])

      } else {

        skippedResultsFormat++

      }

    })

    const filteredResults = allResults

    const coercedLeads: RicercaRow[] = []

    for (let i = 0; i < filteredResults.length; i++) {

      const it: any = filteredResults[i]

      const lead = coerceLead(it, {

        category: typeof it?.categoria === 'string' ? it.categoria : typeof it?.category === 'string' ? it.category : typeof it?.__ckb_fallback_category === 'string' ? it.__ckb_fallback_category : '',

        location: typeof it?.citta === 'string' ? it.citta : typeof it?.city === 'string' ? it.city : typeof it?.location === 'string' ? it.location : typeof it?.__ckb_fallback_location === 'string' ? it.__ckb_fallback_location : '',

        searchId: typeof it?.__ckb_search_id === 'string' ? it.__ckb_search_id : 'searches',

        idx: i,

      })

      if (lead) coercedLeads.push(lead)

    }

    let validLeads = coercedLeads.filter((lead) => typeof lead.nome === 'string' && lead.nome.trim() !== '')

    const CATEGORY_SYNONYMS: Record<string, { include: string[]; exclude: string[] }> = {
      viaggio: {
        include: [
          'viaggio',
          'viaggi',
          'travel',
          'turismo',
          'tour',
          'vacanze',
          'crociere',
          'voli',
          'hotel',
          'booking',
          'agenzia viaggi',
          'tour operator',
          'incoming',
          'outgoing',
        ],
        exclude: ['immobiliare', 'casa', 'affitti', 'vendita immobili', 'mutuo'],
      },
      comunicazione: {
        include: [
          'comunicazione',
          'marketing',
          'advertising',
          'pubblicità',
          'pr',
          'relazioni pubbliche',
          'brand',
          'copywriter',
          'contenuti',
          'social media',
          'digital',
          'campagne',
          'agenzia creativa',
        ],
        exclude: ['immobiliare', 'pulizie', 'idraulico', 'edilizia'],
      },
      marketing: {
        include: [
          'marketing',
          'comunicazione',
          'advertising',
          'pubblicità',
          'seo',
          'sem',
          'social media',
          'digital',
          'brand',
          'growth',
          'lead generation',
          'inbound',
          'copywriter',
          'contenuti',
        ],
        exclude: ['immobiliare', 'pulizie', 'idraulico', 'catering'],
      },
      sviluppatori: {
        include: [
          'sviluppatori',
          'sviluppo',
          'software',
          'web',
          'app',
          'programmatori',
          'informatica',
          'tech',
          'digital',
          'coding',
          'developer',
          'fullstack',
          'frontend',
          'backend',
          'mobile',
          'devops',
          'cloud',
          'saas',
          'startup',
        ],
        exclude: [
          'immobiliare',
          'pulizie',
          'catering',
          'ristorante',
          'copywriter',
          'parrucchiere',
          'estetista',
          'idraulico',
          'elettricista',
        ],
      },
      web: {
        include: [
          'web',
          'sito',
          'website',
          'digitale',
          'online',
          'internet',
          'sviluppo',
          'software',
          'app',
          'ecommerce',
          'programmazione',
          'informatica',
          'tech',
          'digital agency',
        ],
        exclude: ['immobiliare', 'catering', 'pulizie', 'ristorante', 'parrucchiere'],
      },
      software: {
        include: ['software', 'sviluppo', 'programmazione', 'informatica', 'tech', 'app', 'web', 'digital', 'saas', 'cloud', 'developer', 'coding'],
        exclude: ['immobiliare', 'catering', 'pulizie', 'ristorante'],
      },
      immobiliare: {
        include: [
          'immobiliare',
          'immobili',
          'case',
          'appartamenti',
          'affitti',
          'vendita casa',
          'agenzia immobiliare',
          'real estate',
          'mutuo',
          'locazioni',
          'compravendita',
        ],
        exclude: ['viaggi', 'software', 'marketing', 'ristorante'],
      },
      ingegneri: {
        include: [
          'ingegneri',
          'ingegneria',
          'studio tecnico',
          'progettazione',
          'edilizia',
          'costruzioni',
          'architetti',
          'geometri',
          'consulenza tecnica',
          'impiantistica',
          'strutturale',
          'civile',
          'industriale',
        ],
        exclude: ['ristorante', 'catering', 'parrucchiere', 'estetista', 'immobiliare'],
      },
      edilizia: {
        include: ['edilizia', 'costruzioni', 'ristrutturazioni', 'impresa edile', 'ingegneria', 'architettura', 'geometri', 'cantiere', 'muratura'],
        exclude: ['ristorante', 'viaggi', 'marketing', 'software'],
      },
      avvocati: {
        include: ['avvocati', 'avvocato', 'studio legale', 'legale', 'diritto', 'consulenza legale', 'notaio', 'procura', 'arbitrato'],
        exclude: ['ristorante', 'pulizie', 'immobiliare', 'catering'],
      },
      commercialisti: {
        include: [
          'commercialisti',
          'commercialista',
          'contabilità',
          'fiscale',
          'tributario',
          'revisori',
          'consulenza fiscale',
          'caf',
          'patronato',
          'ragioniere',
          'partite iva',
        ],
        exclude: ['ristorante', 'pulizie', 'edilizia'],
      },
      contabili: {
        include: ['contabili', 'contabilità', 'commercialista', 'fiscale', 'tributario', 'revisori', 'consulenza fiscale'],
        exclude: ['ristorante', 'pulizie', 'edilizia'],
      },
      stampa: {
        include: [
          'stampa',
          'tipografia',
          'grafica',
          'print',
          'editoria',
          'pubblicazioni',
          'cartotecnica',
          'offset',
          'digitale stampa',
          'comunicazione visiva',
          'packaging',
        ],
        exclude: ['immobiliare', 'ristorante', 'pulizie', 'catering', 'viaggi'],
      },
      ristoranti: {
        include: ['ristoranti', 'ristorante', 'trattoria', 'osteria', 'pizzeria', 'bar', 'caffe', 'bistrot', 'cucina', 'food', 'gastronomia'],
        exclude: ['immobiliare', 'software', 'marketing', 'viaggi'],
      },
      formazione: {
        include: ['formazione', 'corsi', 'scuola', 'accademia', 'training', 'coaching', 'consulenza hr', 'risorse umane', 'education'],
        exclude: ['immobiliare', 'catering', 'edilizia'],
      },
      vendite: {
        include: ['vendite', 'sales', 'commerciale', 'agenti', 'rappresentanti', 'distributori', 'grossisti', 'retail', 'negozio'],
        exclude: [],
      },
      default: {
        include: [],
        exclude: ['immobiliare', 'pompe funebri', 'onoranze funebri'],
      },
    }

    function getSynonyms(query: string): { include: string[]; exclude: string[] } {
      const q = String(query || '').toLowerCase()

      for (const [key, synonyms] of Object.entries(CATEGORY_SYNONYMS)) {
        if (q.includes(key)) return synonyms
      }

      return CATEGORY_SYNONYMS.default
    }

    function isRelevantLead(
      lead: any,
      keywords: string[],
      excludedKeywords: string[],
      originalQuery: string
    ): boolean {
      const searchableText = [lead?.nome || '', lead?.categoria || '', lead?.sito || ''].join(' ').toLowerCase()

      const synonyms = getSynonyms(originalQuery)
      const allExcluded = [...excludedKeywords, ...synonyms.exclude]
      const allIncluded = [...keywords, ...synonyms.include]

      for (const exc of allExcluded) {
        const ex = String(exc || '').toLowerCase().trim()
        if (!ex) continue
        if (searchableText.includes(ex)) return false
      }

      for (const inc of allIncluded) {
        const k = String(inc || '').toLowerCase().trim()
        if (!k) continue
        if (searchableText.includes(k)) return true
      }

      const stopWords = new Set([
        'milano',
        'roma',
        'torino',
        'napoli',
        'bologna',
        'firenze',
        'venezia',
        'genova',
        'palermo',
        'bari',
        'catania',
        'senza',
        'con',
        'gli',
        'una',
        'dei',
        'per',
        'che',
        'non',
        'del',
        'della',
        'dello',
        'degli',
        'alle',
        'agli',
        'addetto',
        'consulente',
        'consulenti',
        'agenzie',
        'agenzia',
      ])

      const queryWords = String(originalQuery || '')
        .toLowerCase()
        .split(' ')
        .map((w) => w.trim())
        .filter((w) => w.length > 3)
        .filter((w) => !stopWords.has(w))

      for (const word of queryWords) {
        if (searchableText.includes(word)) return true
      }

      return false
    }



    const citta = cityBase.toLowerCase()

    if (citta) validLeads = validLeads.filter((lead) => (lead.citta || '').toLowerCase().includes(citta))

    if (categoryBase) {

      const wanted = normalizeForTokens(categoryBase)

      const wantedVariants = categoryVariants.length > 0 ? categoryVariants : wanted ? [wanted] : []

      const matchesStrictCategory = (leadCategoryRaw: string): boolean => {

        const cat = normalizeForTokens(leadCategoryRaw || '')

        if (!cat) return false

        return wantedVariants.some((v) => {

          const phrase = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

          const re = new RegExp(`(^|\\b)${phrase}(\\b|$)`, 'i')

          return re.test(cat)

        })

      }

      validLeads = validLeads.filter((lead) => matchesStrictCategory(lead.categoria || ''))

    }

    {
      const before = validLeads.length
      validLeads = (await filterLeadsWithAI(validLeads as any[], query)) as typeof validLeads
      console.log('RELEVANCE FILTER:', {
        before,
        after: validLeads.length,
        keywords: extractedKeywords.slice(0, 10),
        excluded_keywords: extractedExcluded.slice(0, 10),
      })
    }

    // Apply has_website filter (e.g. "senza sito" / "senza website")
    if (filtri.has_website === false) {
      validLeads = validLeads.filter((lead) => {
        const s = (typeof lead.sito === 'string' ? lead.sito : '').trim()
        return !s || s === 'N/D' || s === 'N/A' || s === 'N.D.'
      })
    } else if (filtri.has_website === true) {
      validLeads = validLeads.filter((lead) => {
        const s = (typeof lead.sito === 'string' ? lead.sito : '').trim()
        return s && s !== 'N/D' && s !== 'N/A' && s !== 'N.D.'
      })
    }

    // Dedup: strip phone/email that appear in 3+ leads (directory/aggregator contacts)
    {
      const phoneCounts: Record<string, number> = {}
      const emailCounts: Record<string, number> = {}
      for (const lead of validLeads) {
        const p = (lead.telefono || '').replace(/\s+/g, '').trim()
        const e = (lead.email || '').trim().toLowerCase()
        if (p && p !== 'N/D' && p !== 'N/A') phoneCounts[p] = (phoneCounts[p] || 0) + 1
        if (e && e !== 'n/d' && e !== 'n/a') emailCounts[e] = (emailCounts[e] || 0) + 1
      }
      for (const lead of validLeads) {
        const p = (lead.telefono || '').replace(/\s+/g, '').trim()
        const e = (lead.email || '').trim().toLowerCase()
        if (p && phoneCounts[p] >= 3) lead.telefono = ''
        if (e && emailCounts[e] >= 3) lead.email = ''
      }
    }

    const finalResults = validLeads

    if (finalResults.length === 0) {

      try {

        const {

          data: { user },

        } = await supabase.auth.getUser()

        const { data: insertData, error: insertError } = await supabase

          .from('searches')

          .insert(
            buildPendingSearchInsert({
              category: formatCanonicalLabel(categoryBase),
              location: cityBase,
              userId: user?.id,
            }),
          )

          .select()

          .single()

        if (insertError) {
          // Handle duplicate key: find existing record and re-queue it
          if (String((insertError as any)?.code) === '23505') {
            try {
              const { data: dupRow } = await supabase
                .from('searches')
                .select('id, status, created_at')
                .ilike('location', cityBase)
                .eq('category', formatCanonicalLabel(categoryBase))
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()
              if (dupRow?.id) {
                try {
                  await supabase.from('searches').update({ status: 'pending', created_at: new Date().toISOString() }).eq('id', dupRow.id)
                } catch { /* ignore */ }
                console.log('[textToFilter] requeued existing job (unique):', dupRow.id)
                return { results: [], status: 'pending', jobId: dupRow.id, searchId: dupRow.id }
              }
            } catch { /* ignore */ }
          }
          return { results: [] }
        }

        return { results: [], status: 'pending', jobId: (insertData as any).id, searchId: (insertData as any).id }

      } catch {

        return { results: [] }

      }

    }

    const resumeJobId = (() => {
      try {
        const counts = new Map<string, number>()
        for (const it of finalResults as any[]) {
          const id = typeof it?.__ckb_search_id === 'string' ? String(it.__ckb_search_id) : ''
          if (!id || id === 'searches') continue
          counts.set(id, (counts.get(id) || 0) + 1)
        }
        let bestId = ''
        let bestCount = 0
        for (const [id, c] of counts.entries()) {
          if (c > bestCount) {
            bestCount = c
            bestId = id
          }
        }
        if (bestId) return bestId
        const sorted = Array.isArray(rows)
          ? [...rows].sort(
              (a, b) => Date.parse(String(b?.created_at || '')) - Date.parse(String(a?.created_at || ''))
            )
          : []
        const firstId = typeof sorted[0]?.id === 'string' ? sorted[0].id : ''
        return firstId || undefined
      } catch {
        return undefined
      }
    })()

    return {
      results: finalResults,
      filters: filtri,
      jobId: resumeJobId,
      searchId: resumeJobId,
      ai_debug: { ...aiDebug, category_variants: categoryVariants, fallback_city_only: usedFallbackCityOnly },
    }

  } catch {

    return { results: [], filters: {}, ai_debug: null }

  }

}



const classicTextSearchAction = async (userQuery: string): Promise<SearchResult> => {

  const supabase = await createClient()

  const q = (userQuery || '').trim().toLowerCase()

  const tokens = q

    .split(/\s+/)

    .map((t) => t.trim())

    .filter((t) => t.length >= 3)



  const heur = heuristicSearchNlpParams(userQuery)

  const cityBase = typeof heur.city === 'string' ? heur.city.trim() : ''

  const categoryBase = typeof heur.category === 'string' ? heur.category.trim() : ''



  const normalizeForTokens = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ')

  const buildStrictCategoryVariants = (rawCategory: string): string[] => {

    const c = normalizeForTokens(rawCategory)

    if (!c) return []

    const out: string[] = []

    const add = (v: string) => {

      const vv = normalizeForTokens(v)

      if (!vv) return

      if (!out.includes(vv)) out.push(vv)

    }

    add(c)

    // Generic rule: "agenzie X" → also "agenzie di X" and singular/plural forms
    const _agMatch = c.match(/^(agenzie|agenzia)\s+(?!di\b)(.+)$/i)
    if (_agMatch) {
      const _tipo = _agMatch[2]
      add(`agenzie ${_tipo}`)
      add(`agenzia ${_tipo}`)
      add(`agenzie di ${_tipo}`)
      add(`agenzia di ${_tipo}`)
      if (_tipo.endsWith('i')) {
        const _sing = _tipo.endsWith('ii') ? _tipo.slice(0, -1) + 'o' : _tipo.slice(0, -1) + (_tipo.endsWith('ri') ? 'e' : 'o')
        if (_sing !== _tipo) {
          add(`agenzie di ${_sing}`)
          add(`agenzia di ${_sing}`)
        }
      }
    }
    const _agDiMatch = c.match(/^(agenzie|agenzia)\s+di\s+(.+)$/i)
    if (_agDiMatch) {
      const _tipo = _agDiMatch[2]
      add(`agenzie ${_tipo}`)
      add(`agenzia ${_tipo}`)
    }

    if (c === 'agenzie immobiliari' || c === 'agenzia immobiliare') {

      add('agenzie immobiliari')

      add('agenzia immobiliare')

    }

    return out

  }

  const categoryVariants = categoryBase ? buildStrictCategoryVariants(categoryBase) : []

  const matchesStrictCategory = (leadCategoryRaw: string): boolean => {

    if (!categoryVariants.length) return true

    const cat = normalizeForTokens(leadCategoryRaw || '')

    if (!cat) return false

    return categoryVariants.some((v) => {

      const phrase = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

      const re = new RegExp(`(^|\\b)${phrase}(\\b|$)`, 'i')

      return re.test(cat)

    })

  }



  const { data: rows, error } = await supabase.from('searches').select('*').eq('status', 'completed').limit(500)

  if (error || !Array.isArray(rows)) {

    return { results: [], filters: {}, ai_debug: { mode: 'classic', error: error ? (error as any).message ?? String(error) : null } }

  }



  let allResults: any[] = []

  for (const row of rows as any[]) {

    const fallbackMeta = {

      __ckb_search_id: typeof row?.id === 'string' ? row.id : 'searches',

      __ckb_fallback_location: typeof row?.location === 'string' ? row.location : '',

      __ckb_fallback_category: typeof row?.category === 'string' ? row.category : '',

    }

    if (typeof row?.results === 'string') {

      try {

        const parsed = JSON.parse(row.results)

        if (Array.isArray(parsed)) {

          allResults = allResults.concat(parsed.map((it: any) => ({ ...fallbackMeta, ...(it && typeof it === 'object' ? it : {}) })))

        } else if (parsed && typeof parsed === 'object') {

          allResults = allResults.concat([{ ...fallbackMeta, ...(parsed as any) }])

        }

      } catch {

        // ignore

      }

    } else if (Array.isArray(row?.results)) {

      allResults = allResults.concat(row.results.map((it: any) => ({ ...fallbackMeta, ...(it && typeof it === 'object' ? it : {}) })))

    } else if (row?.results && typeof row.results === 'object') {

      allResults = allResults.concat([{ ...fallbackMeta, ...(row.results as any) }])

    }

  }



  const matched = allResults.filter((item: any) => {

    if (tokens.length === 0) return true

    const nome = typeof item?.nome === 'string' ? item.nome : typeof item?.azienda === 'string' ? item.azienda : typeof item?.name === 'string' ? item.name : ''

    const categoria = typeof item?.categoria === 'string' ? item.categoria : typeof item?.category === 'string' ? item.category : ''

    const blob = `${nome} ${categoria}`.toLowerCase()

    return tokens.some((t) => blob.includes(t))

  })



  const baseAndFiltered = matched.filter((item: any) => {

    const leadCity = typeof item?.citta === 'string' ? item.citta : typeof item?.city === 'string' ? item.city : ''

    const leadCategory = typeof item?.categoria === 'string' ? item.categoria : typeof item?.category === 'string' ? item.category : typeof item?.__ckb_fallback_category === 'string' ? item.__ckb_fallback_category : ''



    if (cityBase) {

      const okCity = normalizeForTokens(leadCity).includes(normalizeForTokens(cityBase))

      if (!okCity) return false

    }



    if (categoryBase) {

      if (!matchesStrictCategory(leadCategory)) return false

    }



    // Negative filters must be respected in classic mode too.

    if (heur.technical_filters.no_instagram === true) {

      const ig = typeof item?.instagram === 'string' ? item.instagram.trim() : ''

      const igMissing = typeof item?.instagram_missing === 'boolean' ? item.instagram_missing : null

      if (igMissing === false) return false

      if (ig) return false

    }



    if (heur.technical_filters.no_pixel === true) {

      const stack = item?.tech_stack

      const stackStr = Array.isArray(stack) ? stack.filter((v: any) => typeof v === 'string').join(' ').toLowerCase() : ''

      const metaPixel = item?.meta_pixel

      const missingPixel = metaPixel !== true || stackStr.includes('missing fb pixel') || stackStr.includes('no pixel')

      if (!missingPixel) return false

    }



    return true

  })



  const coercedLeads: RicercaRow[] = []

  for (let i = 0; i < baseAndFiltered.length; i++) {

    const it: any = baseAndFiltered[i]

    const lead = coerceLead(it, {

      category: typeof it?.__ckb_fallback_category === 'string' ? it.__ckb_fallback_category : '',

      location: typeof it?.__ckb_fallback_location === 'string' ? it.__ckb_fallback_location : '',

      searchId: typeof it?.__ckb_search_id === 'string' ? it.__ckb_search_id : 'searches',

      idx: i,

    })

    if (lead) coercedLeads.push(lead)

  }

  // Dedup: strip phone/email that appear in 3+ leads (directory/aggregator contacts)
  {
    const phoneCounts: Record<string, number> = {}
    const emailCounts: Record<string, number> = {}
    for (const lead of coercedLeads) {
      const p = (lead.telefono || '').replace(/\s+/g, '').trim()
      const e = (lead.email || '').trim().toLowerCase()
      if (p && p !== 'N/D' && p !== 'N/A') phoneCounts[p] = (phoneCounts[p] || 0) + 1
      if (e && e !== 'n/d' && e !== 'n/a') emailCounts[e] = (emailCounts[e] || 0) + 1
    }
    for (const lead of coercedLeads) {
      const p = (lead.telefono || '').replace(/\s+/g, '').trim()
      const e = (lead.email || '').trim().toLowerCase()
      if (p && phoneCounts[p] >= 3) lead.telefono = ''
      if (e && emailCounts[e] >= 3) lead.email = ''
    }
  }

  return {

    results: coercedLeads,

    filters: {},

    ai_debug: {

      mode: 'classic',

      tokens,

      city: cityBase || null,

      category: categoryBase || null,

      technical_filters: { no_instagram: heur.technical_filters.no_instagram === true, no_pixel: heur.technical_filters.no_pixel === true },

      category_variants: categoryVariants,

    },

  }

}



export async function processSemanticSearchAction(
  userQuery: string,
  options?: SearchActionOptions,
): Promise<TextToFilterSearchResponse> {

  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {

    return {

      results: [],

      filters: {},

      ai_debug: {

        mode: 'semantic_error',

        error: 'MISSING_OPENAI_KEY',

      },

    }

  }



  try {

    const result = await withTimeout(textToFilterSearchAction(userQuery, options), 60000)

    return { ...result, ai_debug: { ...(result.ai_debug as any), semantic_mode: 'ai' } }

  } catch (err) {

    const errorText = err instanceof Error ? err.message : String(err)

    console.log('SEMANTIC SEARCH ERROR (NO FALLBACK):', errorText)

    return {

      results: [],

      filters: {},

      ai_debug: {

        mode: 'semantic_error',

        error: errorText,

      },

    }

  }

}



type NliFilterSpec = {

  location?: string | null

  category?: string | null

  has_website?: boolean | null

  missing_tech?: string[] | null

}



type LegacyAiFilters = {

  citta?: string | null

  categoria?: string | null

  has_website?: boolean | null

  needs_html_errors?: boolean | null

  overall_logic?: 'and' | 'or' | null

  tech_logic?: 'and' | 'or' | null

  tech_mancanti?: string[] | null

}



type DeterministicSearchFilters = {

  citta?: string | null

  categoria?: string | null

  overall_logic?: 'and' | 'or' | null

  filter_no_website?: boolean | null

  filter_no_instagram?: boolean | null

  filter_no_pixel?: boolean | null

  filter_no_gtm?: boolean | null

  filter_seo_disaster?: boolean | null

}



type SearchNlpParams = {

  city: string | null

  category: string | null

  keywords?: string[]

  excluded_keywords?: string[]

  technical_filters: {

    no_website: boolean

    no_pixel: boolean

    no_gtm: boolean

    no_ga4: boolean

    no_google_ads: boolean

    seo_errors: boolean

    no_ssl: boolean

    no_instagram: boolean

    no_facebook: boolean

    no_tiktok: boolean

    no_mobile: boolean

    spam_risk: boolean

    unclaimed_maps: boolean

    code_errors: boolean

    slow_speed: boolean

    tech_terms: string[]

  }

  signal_intent?: SignalIntentSpec

}



const coerceSearchNlpParams = (value: unknown): SearchNlpParams => {

  const empty: SearchNlpParams = {

    city: null,

    category: null,

    keywords: [],

    excluded_keywords: [],

    technical_filters: {

      no_website: false,

      no_pixel: false,

      no_gtm: false,

      no_ga4: false,

      no_google_ads: false,

      seo_errors: false,

      no_ssl: false,

      no_instagram: false,

      no_facebook: false,

      no_tiktok: false,

      no_mobile: false,

      spam_risk: false,

      unclaimed_maps: false,

      code_errors: false,

      slow_speed: false,

      tech_terms: [],

    },

  }



  const normalizeText = (v: string) => v.trim().replace(/\s+/g, ' ')



  if (!value || typeof value !== 'object') return empty

  const obj = value as Record<string, unknown>



  const city = typeof obj.city === 'string' ? normalizeText(obj.city) : null

  const category = typeof obj.category === 'string' ? normalizeText(obj.category) : null

  const asStringArrayTop = (v: unknown) =>
    Array.isArray(v)
      ? v
          .filter((x) => typeof x === 'string')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 20)
      : []

  const keywords = asStringArrayTop((obj as any).keywords)

  const excluded_keywords = asStringArrayTop((obj as any).excluded_keywords)



  const tfRaw = obj.technical_filters

  const tfObj = tfRaw && typeof tfRaw === 'object' ? (tfRaw as Record<string, unknown>) : {}

  const asBool = (v: unknown) => (typeof v === 'boolean' ? v : false)

  const asStringArray = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : [])



  return {

    city: city && city.length > 0 ? city : null,

    category: category && category.length > 0 ? category : null,

    keywords,

    excluded_keywords,

    technical_filters: {

      no_website: asBool(tfObj.no_website),

      no_pixel: asBool(tfObj.no_pixel),

      no_gtm: asBool(tfObj.no_gtm),

      no_ga4: asBool((tfObj as any).no_ga4),

      no_google_ads: asBool(tfObj.no_google_ads),

      seo_errors: asBool(tfObj.seo_errors),

      no_ssl: asBool(tfObj.no_ssl),

      no_instagram: asBool(tfObj.no_instagram),

      no_facebook: asBool(tfObj.no_facebook),

      no_tiktok: asBool(tfObj.no_tiktok),

      no_mobile: asBool(tfObj.no_mobile),

      spam_risk: asBool(tfObj.spam_risk),

      unclaimed_maps: asBool(tfObj.unclaimed_maps),

      code_errors: asBool(tfObj.code_errors),

      slow_speed: asBool(tfObj.slow_speed),

      tech_terms: asStringArray(tfObj.tech_terms ?? tfObj.tech_stack ?? tfObj.tech_stack_terms),

    },

    signal_intent: coerceSignalIntent(obj.signal_intent),

  }

}



const heuristicSearchNlpParams = (userQuery: string): SearchNlpParams => {

  const q = (userQuery || '').trim().toLowerCase()



  const technical_filters = {

    no_website: /\b(senza\s+sito|senza\s+website|no\s+web|no\s+website|manca\s+(il\s+)?sito|privo\s+di\s+sito)\b/i.test(userQuery),

    no_pixel: /\b(senza\s+(meta\s+)?pixel|senza\s+facebook\s+pixel|no\s+pixel)\b/i.test(userQuery),

    no_gtm: /\b(senza\s+gtm|senza\s+tag\s+manager|no\s+gtm|no\s+tag\s+manager)\b/i.test(userQuery),

    no_ga4: /\b(senza\s+ga4|senza\s+google\s+analytics|no\s+ga4|no\s+google\s+analytics|senza\s+analytics|no\s+analytics)\b/i.test(userQuery),

    no_google_ads: /\b(senza\s+google\s+ads|no\s+google\s+ads|senza\s+ads|no\s+ads)\b/i.test(userQuery),

    seo_errors: /\b(errori\s+(di\s+)?seo|disastro\s+seo|errori\s+html|seo\s+errors?|html\s+errors?)\b/i.test(userQuery),

    no_ssl: /\b(senza\s+ssl|no\s+ssl|ssl\s+error|certificato\s+non\s+valido)\b/i.test(userQuery),

    no_instagram: /\b(senza\s+instagram|no\s+instagram|privo\s+di\s+instagram)\b/i.test(userQuery),

    no_facebook: /\b(senza\s+facebook|no\s+facebook|privo\s+di\s+facebook)\b/i.test(userQuery),

    no_tiktok: /\b(senza\s+tiktok|no\s+tiktok|privo\s+di\s+tiktok)\b/i.test(userQuery),

    no_mobile: /\b(non\s+responsive|non\s+mobile|no\s+mobile|no\s+responsive|manca\s+mobile)\b/i.test(userQuery),

    spam_risk: /\b(spam|rischio\s+spam|dmarc|spf)\b/i.test(userQuery) && /\b(senza|no|manca)\b/i.test(userQuery),

    unclaimed_maps: /\b(non\s+rivendicat|non\s+claim|scheda\s+non\s+rivendicat|profilo\s+non\s+rivendicat)\b/i.test(userQuery),

    code_errors: /\b(errori\s+html|html\s+errors?|code\s+errors?|errori\s+codice)\b/i.test(userQuery),

    slow_speed: /\b(sito\s+lento|lento|caricamento\s+lento|load\s+speed)\b/i.test(userQuery),

  }



  const tech_terms: string[] = []

  const addTech = (t: string) => {

    if (!t) return

    if (!tech_terms.includes(t)) tech_terms.push(t)

  }

  if (q.includes('wordpress')) addTech('WORDPRESS')

  if (q.includes('shopify')) addTech('SHOPIFY')

  if (q.includes('prestashop') || q.includes('presta')) addTech('PRESTASHOP')

  if (q.includes('wix')) addTech('WIX')

  if (q.includes('woocommerce') || q.includes('woo commerce')) addTech('WOOCOMMERCE')



  let city: string | null = null

  // Find ALL preposition+word matches, pick the LAST one (closest to end = most likely city).
  // Regex captures only ONE word (no \s) so each preposition is a separate match.
  const cityRe = /\b(?:a|ad|in|su|da|di)\s+([A-Za-zÀ-ÖØ-öø-ÿ'\-]{2,40})/gi
  const cityStopWords = new Set(['senza','no','con','per','che','non','privo','manca','dove','come','sito','website','pixel','gtm','seo','ga4','ads','instagram','facebook','tiktok','google','errori','analytics','ambito','tipo','modo','base'])
  const prepWords = new Set(['a','ad','in','su','da','di','del','della','dei','delle','al','nel','dal','sul','per','con','tra','fra'])
  let bestCityMatch: string | null = null
  let bestCityIndex = -1
  for (const m of userQuery.matchAll(cityRe)) {
    if (m[1] && typeof m.index === 'number' && m.index > bestCityIndex) {
      bestCityIndex = m.index
      const firstWord = m[1].trim()
      // Look ahead for compound city names (e.g. "San Marino", "Reggio Emilia")
      const afterPos = (m.index || 0) + m[0].length
      const afterText = userQuery.slice(afterPos).trim()
      const nextTokens = afterText.split(/\s+/)
      const cityTokens: string[] = [firstWord]
      for (const t of nextTokens) {
        const tLow = t.toLowerCase().replace(/[^a-zà-öø-ÿ'\-]/g, '')
        if (!tLow || cityStopWords.has(tLow) || prepWords.has(tLow)) break
        if (!/^[A-Za-zÀ-ÖØ-öø-ÿ'\-]+$/.test(t)) break
        cityTokens.push(t)
        if (cityTokens.length >= 3) break
      }
      const candidate = cityTokens.join(' ').trim()
      if (candidate.length >= 2) bestCityMatch = candidate
    }
  }
  if (bestCityMatch) city = bestCityMatch

  if (!city) {

    try {

      const tokens = (userQuery || '')

        .trim()

        .split(/\s+/)

        .map((t) => t.trim())

        .filter(Boolean)

      const last = (tokens[tokens.length - 1] || '').replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'\-]/g, '').trim()

      const lastNorm = last.toLowerCase()

      const stop = new Set([

        'senza',

        'no',

        'con',

        'per',

        'di',

        'del',

        'della',

        'dei',

        'delle',

        'a',

        'ad',

        'in',

        'su',

        'da',

        'gtm',

        'seo',

        'ga4',

        'ads',

      ])

      const looksLikePlace = last.length >= 3 && /^[A-Za-zÀ-ÖØ-öø-ÿ'\-]+$/.test(last) && !stop.has(lastNorm)

      if (looksLikePlace) {

        city = last.charAt(0).toUpperCase() + last.slice(1)

      }

    } catch {

      // ignore

    }

  }



  let category: string | null = null

  const setCategory = (v: string) => {

    if (!category) category = v

  }

  if (/\bspettacol/i.test(q) && /\bagenzi(a|e)\b/i.test(q)) category = 'Agenzie Spettacolo'

  if (!category && /\bagenzi(a|e)\b/i.test(q) && /\bmarketing\b/i.test(q)) category = 'Agenzie di marketing'

  if (/\bimmobiliar/i.test(q)) category = 'Agenzie Immobiliari'

  if (/\b(palestr|fitness|gym)\b/i.test(q)) category = 'Palestre'

  if (/\bavvocat/i.test(q)) {

    if (q.includes('penalist')) category = 'Avvocati Penalisti'

    else if (q.includes('civilist')) category = 'Avvocati Civilisti'

    else category = 'Avvocati'

  }

  setCategory(/\bcommercialist/i.test(q) ? 'Commercialisti' : '')

  if (category === '') category = null

  if (!category && /\bdentist/i.test(q)) category = 'Dentisti'

  if (!category && /\bagenzi(a|e)\b/i.test(q)) category = 'Agenzie'

  if (!category && /\b(ristorant|pizzer)\b/i.test(q)) category = 'Ristoranti'

  if (!category && /\bstartup\b/i.test(q)) category = 'Startup'

  if (!category && /\b(programmator\w*|developer\w*|sviluppat\w*|software|python)\b/i.test(q) && /\b(assum|hiring|offerte?\s+(di\s+)?lavoro)\b/i.test(q)) {
    category = 'Servizi informatici'
  }



  return { city, category, keywords: [], excluded_keywords: [], technical_filters: { ...technical_filters, tech_terms }, signal_intent: parseSignalIntentOffline(userQuery) }

}



const buildSearchNlpSystemPrompt = () => {

  return buildSearchNlpSystemPromptWithContext({ available_categories: [], available_locations: [] })

}



const buildSearchNlpSystemPromptWithContext = (ctx: { available_categories: string[]; available_locations: string[] }) => {

  void ctx

  return (

    "Sei un assistente per un software B2B di Lead Generation. " +

    "Il tuo compito è tradurre QUALSIASI richiesta dell'utente in parametri di ricerca JSON.\n\n" +

    "MIRAX è ONNIVORO: non solo marketing. Interpreta assunzioni, gare d'appalto, investimenti settoriali (fotovoltaico, edilizia…), cambi CRM, crescita registro.\n\n" +

    

    "REGOLA ASSOLUTA: 'city' deve contenere SOLO una città o regione geografica italiana reale. " +

    "MAI inserire settori o categorie nel campo city.\n\n" +

    

    "REGOLA CATEGORIA: Usa sempre il nome canonico completo. " +

    "Esempi: 'Agenzie di marketing', 'Ristoranti', 'Officine', 'Agenzie di viaggio'.\n\n" +

    

    "REGOLA FILTRI TECNICI - Traduci sempre il linguaggio naturale nei filtri giusti:\n" +

    "- 'senza pubblicità google' / 'senza ads' / 'non fa google ads' → no_google_ads: true\n" +

    "- 'senza pixel' / 'senza facebook pixel' → no_pixel: true\n" +

    "- 'senza tag manager' / 'senza gtm' → no_gtm: true\n" +

    "- 'senza sito' / 'senza website' → no_website: true\n" +

    "- 'seo fatta male' / 'errori seo' / 'seo scarsa' → seo_errors: true\n" +

    "- 'senza instagram' → no_instagram: true\n" +

    "- 'senza facebook' → no_facebook: true\n" +

    "- 'senza social' / 'senza social media' → no_instagram: true, no_facebook: true, no_tiktok: true\n" +

    "- 'senza tiktok' → no_tiktok: true\n" +

    "- 'lead piu caldi' / 'piu problemi tecnici' / 'potenziali clienti per marketing' → no_pixel: true, no_gtm: true, no_google_ads: true\n" +

    "- 'sito lento' / 'velocita bassa' → slow_speed: true\n" +

    "- 'senza ssl' / 'sito non sicuro' → no_ssl: true\n\n" +

    

    "REGOLA D'ORO: Se l'utente descrive il proprio lavoro (es. 'Sono un SMM', 'Faccio siti web', " +

    "'Sono un consulente marketing'), sta cercando CLIENTI. " +

    "Deduci i filtri tecnici che può risolvere. category deve essere null " +

    "a meno che non specifichi il settore dei clienti.\n\n" +

    

    "Esempi:\n" +

    "Utente: 'ristoranti a milano che non fanno pubblicita su google'\n" +

    'Risposta: { "city": "Milano", "category": "Ristoranti", "technical_filters": { "no_google_ads": true } }\n\n' +

    "Utente: 'aziende che assumono programmatori Python a Milano'\n" +

    'Risposta: { "city": "Milano", "category": "Software house", "keywords": ["software","sviluppo","informatica"], "excluded_keywords": ["viaggi","ristorante"], "signal_intent": { "required_signals": ["hiring"], "hiring_roles": ["programmatore"] } }\n\n' +

    "Utente: 'imprese edili che assumono muratori in Veneto'\n" +

    'Risposta: { "city": "Veneto", "category": "Imprese edili", "signal_intent": { "required_signals": ["hiring"], "hiring_roles": ["tecnico"] } }\n\n' +

    

    "Utente: 'agenzie di marketing con seo fatta male'\n" +

    'Risposta: { "city": null, "category": "Agenzie di marketing", "technical_filters": { "seo_errors": true } }\n\n' +

    

    "Utente: 'officine senza social a Roma'\n" +

    'Risposta: { "city": "Roma", "category": "Officine", "technical_filters": { "no_instagram": true, "no_facebook": true, "no_tiktok": true } }\n\n' +

    

    "Utente: 'agenzie di viaggio senza tag manager e senza pixel a Torino'\n" +

    'Risposta: { "city": "Torino", "category": "Agenzie di viaggio", "technical_filters": { "no_gtm": true, "no_pixel": true } }\n\n' +

    

    "Utente: 'trovami potenziali clienti interessati a servizi di marketing a Milano'\n" +

    'Risposta: { "city": "Milano", "category": null, "technical_filters": { "no_pixel": true, "no_gtm": true, "no_google_ads": true } }\n\n' +

    

    "Utente: 'dammi i lead piu caldi per il mio servizio da social media manager a Napoli'\n" +

    'Risposta: { "city": "Napoli", "category": null, "technical_filters": { "no_pixel": true, "no_instagram": true, "no_facebook": true, "no_gtm": true } }\n\n' +

    

    "Utente: 'Sono uno sviluppatore web, cerco clienti a Roma'\n" +

    'Risposta: { "city": "Roma", "category": null, "technical_filters": { "no_website": true } }\n\n' +

    

    "Utente: 'agenzie marketing milano'\n" +

    'Risposta: { "city": "Milano", "category": "Agenzie di marketing", "technical_filters": {} }\n\n' +

    

    "Utente: 'comunicazione milano'\n" +

    'Risposta: { "city": "Milano", "category": "Agenzie di comunicazione", "technical_filters": {} }\n\n' +

    

    "Utente: 'ristoranti napoli'\n" +

    'Risposta: { "city": "Napoli", "category": "Ristoranti", "technical_filters": {} }\n\n' +

    

    "Utente: 'Cerco agenzie immobiliari a Milano messe male con la SEO'\n" +

    'Risposta: { "city": "Milano", "category": "Agenzie Immobiliari", "technical_filters": { "seo_errors": true } }\n\n' +

    

    "Utente: 'Faccio Facebook Ads, trovami palestre a Napoli'\n" +

    'Risposta: { "city": "Napoli", "category": "Palestre", "technical_filters": { "no_pixel": true, "no_facebook": true } }' +

    

    "\n\nOltre a city e category, estrai anche:\n" +
    '- "keywords": array di 5-10 parole chiave sinonimi/correlate alla categoria cercata\n' +
    '- "excluded_keywords": array di categorie/parole da ESCLUDERE\n' +
    '- "signal_intent": oggetto con:\n' +
    '  - "required_signals": array tra [hiring, registry_change, sector_investment, tender_won, crm_detected, crm_change, site_stale, meta_ads_started, google_ads_started, investing_marketing]\n' +
    '  - "hiring_roles": array ruoli (es. programmatore, commerciale)\n' +
    '  - "sector_keywords": array temi (es. fotovoltaico, edilizia)\n' +
    '  - "crm_keywords": array (hubspot, salesforce…)\n' +
    '  - "require_crm_change": boolean\n' +
    '  - "time_window_days": number|null (30, 90, 365)\n' +
    '  - "intent_summary": string breve in italiano\n\n' +
    "Esempi signal_intent:\n" +
    'Utente: "aziende che assumono commerciali a Bologna" → required_signals:["hiring"], hiring_roles:["commerciale"]\n' +
    'Utente: "imprese edili che hanno vinto una gara nell ultimo anno" → required_signals:["tender_won"], time_window_days:365, category:"Imprese edili"\n' +
    'Utente: "PMI che investono nel fotovoltaico in Veneto" → required_signals:["sector_investment"], sector_keywords:["fotovoltaico"]\n' +
    'Utente: "aziende che hanno cambiato CRM negli ultimi 30 giorni" → required_signals:["crm_change"], require_crm_change:true, time_window_days:30\n\n' +
    "Rispondi SEMPRE e SOLO con JSON valido nel formato:\n" +
    '{ "city": "...", "category": "...", "keywords": ["..."], "excluded_keywords": ["..."], "technical_filters": { ... }, "signal_intent": { ... } }'

  )

}



const fetchAvailableSearchOptions = async (supabase: any) => {

  const { data, error, count } = await supabase

    .from('searches')

    .select('category, location', { count: 'exact' })

    .eq('status', 'completed')

    .limit(5000)



  console.log('AVAILABLE OPTIONS (ROWS):', {

    count,

    returned: Array.isArray(data) ? data.length : 0,

    error: error ? (error as any).message ?? String(error) : null,

  })



  if (error || !Array.isArray(data)) {

    return { available_categories: [] as string[], available_locations: [] as string[] }

  }



  const catSet = new Set<string>()

  const locSet = new Set<string>()



  for (const row of data as any[]) {

    const cat = typeof row?.category === 'string' ? row.category.trim().replace(/\s+/g, ' ') : ''

    const loc = typeof row?.location === 'string' ? row.location.trim().replace(/\s+/g, ' ') : ''

    if (cat) catSet.add(cat)

    if (loc) locSet.add(loc)

  }



  return {

    available_categories: Array.from(catSet).slice(0, 500),

    available_locations: Array.from(locSet).slice(0, 500),

  }

}



const coerceDeterministicSearchFilters = (value: unknown): DeterministicSearchFilters => {

  if (!value || typeof value !== 'object') return {}

  const obj = value as Record<string, unknown>



  const overallLogicRaw = obj.overall_logic

  const overall_logic = overallLogicRaw === 'and' || overallLogicRaw === 'or' ? overallLogicRaw : null



  const asBoolOrNull = (v: unknown) => (typeof v === 'boolean' ? v : null)



  return {

    citta: typeof obj.citta === 'string' ? obj.citta : null,

    categoria: typeof obj.categoria === 'string' ? obj.categoria : null,

    overall_logic,

    filter_no_website: asBoolOrNull(obj.filter_no_website),

    filter_no_instagram: asBoolOrNull(obj.filter_no_instagram),

    filter_no_pixel: asBoolOrNull(obj.filter_no_pixel),

    filter_no_gtm: asBoolOrNull(obj.filter_no_gtm),

    filter_seo_disaster: asBoolOrNull(obj.filter_seo_disaster),

  }

}



const buildDeterministicSearchSystemPrompt = () => {

  return [

    'Sei un analista. Devi trasformare la richiesta dell\'utente in un oggetto JSON di filtri DETERMINISTICI.',

    'Regola assoluta: NON scrivere SQL, NON scrivere query Supabase, NON inventare nomi di colonne. Restituisci SOLO JSON valido.',

    '',

    'Chiavi consentite (tutte opzionali):',

    '{',

    '  "citta": string|null,',

    '  "categoria": string|null,',

    '  "overall_logic": "and"|"or",',

    '  "filter_no_website": boolean,',

    '  "filter_no_instagram": boolean,',

    '  "filter_no_pixel": boolean,',

    '  "filter_no_gtm": boolean,',

    '  "filter_seo_disaster": boolean',

    '}',

    '',

    'Mapping:',

    '- Estrai SEMPRE la professione come "categoria" quando presente (es: "avvocati penalisti" => categoria="avvocati penalisti"; "commercialisti" => categoria="commercialisti").',

    '- Se la categoria include una specializzazione, mantienila (es: "avvocati penalisti", "avvocati civilisti", "dentisti pediatrici").',

    '- "senza sito" / "senza website" / "no website" => filter_no_website=true',

    '- "senza instagram" / "no instagram" => filter_no_instagram=true',

    '- "senza pixel" / "senza meta pixel" / "senza facebook pixel" => filter_no_pixel=true',

    '- "senza gtm" / "senza tag manager" => filter_no_gtm=true',

    '- "errori seo" / "errori html" / "disastro seo" => filter_seo_disaster=true',

    '',

    'Congiunzioni:',

    '- Se l\'utente usa "o"/"oppure" tra criteri => overall_logic="or"',

    '- Se l\'utente usa "e" tra criteri => overall_logic="and"',

  ].join('\n')

}



export type PitchInput = {

  nome: string

  sito: string

  citta: string

  categoria: string

  email: string

  rating: number | null

  tech_stack: string[]

  html_errors: string[]

  page_speed: number | null

}



type PitchResult = {

  subject: string

  body: string

}



const SEARCHES_SELECT_COLUMNS = 'id, user_id, category, location, status, results'



const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))



const coerceStringArray = (value: unknown): string[] => {

  if (!Array.isArray(value)) return []

  return value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)

}



const coerceFilterSpec = (value: unknown): TextToFilterSpec => {

  if (!value || typeof value !== 'object') return {}

  const obj = value as Record<string, unknown>



  const toNumberOrNull = (v: unknown) => {

    if (typeof v === 'number') return Number.isFinite(v) ? v : null

    if (typeof v === 'string') {

      const n = Number(v)

      return Number.isFinite(n) ? n : null

    }

    return null

  }



  const spec: TextToFilterSpec = {

    citta: typeof obj.citta === 'string' ? obj.citta : null,

    categoria: typeof obj.categoria === 'string' ? obj.categoria : null,

    rating_min: toNumberOrNull(obj.rating_min),

    rating_max: toNumberOrNull(obj.rating_max),

    page_speed_min: toNumberOrNull(obj.page_speed_min),

    page_speed_max: toNumberOrNull(obj.page_speed_max),

    include_tech: coerceStringArray(obj.include_tech),

    exclude_tech: coerceStringArray(obj.exclude_tech),

    include_errors: coerceStringArray(obj.include_errors),

    exclude_errors: coerceStringArray(obj.exclude_errors),

    keyword: typeof obj.keyword === 'string' ? obj.keyword : null,

    limit: toNumberOrNull(obj.limit),

  }



  return spec

}



const coerceLegacyAiFilters = (value: unknown): LegacyAiFilters => {

  if (!value || typeof value !== 'object') return {}

  const obj = value as Record<string, unknown>



  const techRaw = obj.tech_mancanti

  const tech_mancanti = Array.isArray(techRaw) ? techRaw.filter((v) => typeof v === 'string').map((s) => s.trim()).filter(Boolean) : []



  const hasWebsiteRaw = obj.has_website

  const has_website = typeof hasWebsiteRaw === 'boolean' ? hasWebsiteRaw : null



  const needsHtmlErrorsRaw = obj.needs_html_errors

  const needs_html_errors = typeof needsHtmlErrorsRaw === 'boolean' ? needsHtmlErrorsRaw : null



  const overallLogicRaw = obj.overall_logic

  const overall_logic = overallLogicRaw === 'and' || overallLogicRaw === 'or' ? overallLogicRaw : null



  const techLogicRaw = obj.tech_logic

  const tech_logic = techLogicRaw === 'and' || techLogicRaw === 'or' ? techLogicRaw : null



  const spec: LegacyAiFilters = {

    citta: typeof obj.citta === 'string' ? obj.citta : null,

    categoria: typeof obj.categoria === 'string' ? obj.categoria : null,

    has_website,

    needs_html_errors,

    overall_logic,

    tech_logic,

    tech_mancanti,

  }



  return spec

}



const buildLegacyAiSystemPrompt = () => {

  return [

    'Sei un analista dati. Converti la richiesta dell\'utente in un oggetto JSON di filtri per interrogare un database Supabase.',

    'Devi rispondere SOLO con JSON valido (nessun testo extra).',

    'NON inventare nomi di colonne: usa ESATTAMENTE lo schema sotto.',

    '',

    'Schema (lead) - Campi Base:',

    '- azienda (String)',

    '- citta (String)',

    '- email (String) (ignora se è "", "N/A" o "N/D")',

    '- telefono (String)',

    '- rating (Float)',

    '- reviews_count (Int)',

    '- decision_maker (String)',

    '',

    'Schema (lead) - Campi Boolean (filtri diretti True/False):',

    '- meta_pixel (Boolean) => se l\'utente chiede "senza pixel facebook/meta", significa meta_pixel = false',

    '- google_tag_manager (Boolean) => se l\'utente chiede "senza gtm", significa google_tag_manager = false',

    '- is_claimed (Boolean)',

    '',

    'Schema (lead) - Oggetto JSON (technical_report):',

    '- technical_report->has_ga4 (Boolean)',

    '- technical_report->has_google_ads (Boolean)',

    '- technical_report->has_ecommerce (Boolean)',

    '- technical_report->has_booking_system (Boolean)',

    '- technical_report->has_chatbot (Boolean)',

    '- technical_report->has_spf (Boolean)',

    '- technical_report->has_dmarc (Boolean) => "email in spam" / "senza dmarc" => false',

    '- technical_report->seo_disaster (Boolean) => "errori seo" / "disastro seo" => true',

    '- technical_report->load_speed_s (Float) => "sito lento" => > 3.0',

    '',

    'Schema (lead) - Vettore Array:',

    '- tech_stack (Array di Stringhe) include tag come WORDPRESS, NO WEBSITE, MOBILE, SSL',

    '- "senza sito" => cerca NO WEBSITE',

    '',

    'Schema (lead) - Social (String/URL):',

    '- facebook, instagram, meta_ads_library',

    '- "senza instagram" => instagram IS NULL',

    '',

    'Output richiesto (JSON) - chiavi ammesse:',

    '{',

    '  "citta": string|null,',

    '  "categoria": string|null,',

    '  "has_website": boolean|null,',

    '  "needs_html_errors": boolean|null,',

    '  "overall_logic": "and"|"or",',

    '  "tech_logic": "and"|"or",',

    '  "tech_mancanti": string[]',

    '}',

    '',

    'Regole mapping verso tech_mancanti:',

    '- Se l\'utente chiede meta_pixel=false => aggiungi "pixel"',

    '- Se l\'utente chiede google_tag_manager=false => aggiungi "gtm"',

    '- Se l\'utente chiede technical_report->has_ga4=false => aggiungi "analytics"',

    '- Se l\'utente chiede technical_report->has_google_ads=false => aggiungi "ads"',

    '- Se l\'utente chiede technical_report->has_booking_system=false => aggiungi "booking"',

    '- Se l\'utente chiede technical_report->has_chatbot=false => aggiungi "chatbot"',

    '- Se l\'utente chiede technical_report->has_dmarc=false => aggiungi "dmarc"',

    '- Se l\'utente chiede tech_stack contiene NO WEBSITE => has_website=false',

    '',

    'Congiunzioni:',

    '- Usa overall_logic="or" se la frase contiene "o"/"oppure" tra criteri.',

    '- Usa overall_logic="and" se la frase contiene "e" tra criteri.',

    '- Per tech_mancanti: se l\'utente dice "senza X e senza Y" => tech_logic="and"; se dice "senza X o senza Y" => tech_logic="or".',

  ].join('\n')

}



const coerceNliFilterSpec = (value: unknown): NliFilterSpec => {

  if (!value || typeof value !== 'object') return {}

  const obj = value as Record<string, unknown>



  const missingRaw = obj.missing_tech

  const missing_tech = Array.isArray(missingRaw) ? missingRaw.filter((v) => typeof v === 'string').map((s) => s.trim()).filter(Boolean) : []



  const hasWebsiteRaw = obj.has_website

  const has_website = typeof hasWebsiteRaw === 'boolean' ? hasWebsiteRaw : null



  const spec: NliFilterSpec = {

    location: typeof obj.location === 'string' ? obj.location : null,

    category: typeof obj.category === 'string' ? obj.category : null,

    has_website,

    missing_tech,

  }



  return spec

}



const buildNliSystemPrompt = () => {

  return [

    'Sei un analista dati. Converti la richiesta dell’utente in un oggetto JSON per filtrare un database.',

    'Devi rispondere SOLO con JSON valido (nessun testo extra).',

    '',

    'Il database ha i campi:',

    '- location: string (città/area, es: "Napoli")',

    '- category: string (tipo di business, es: "ristoranti")',

    '- has_website: boolean (true se il lead ha un sito, false se NON ha un sito)',

    '- missing_tech: string[] (tecnologie richieste che devono risultare ASSENTI nel lead; esempi: "Facebook Pixel", "Google Tag Manager")',

    '',

    'Schema output JSON (tutte le chiavi opzionali):',

    '{',

    '  "location": string|null,',

    '  "category": string|null,',

    '  "has_website": boolean|null,',

    '  "missing_tech": string[]|null',

    '}',

    '',

    'Regole:',

    '- Se l’utente dice "senza sito" => has_website=false.',

    '- Se l’utente dice "con sito" => has_website=true.',

    '- Se l’utente dice "senza pixel" => missing_tech include "Facebook Pixel".',

    '- Se l’utente dice "niente tag manager" => missing_tech include "Google Tag Manager".',

  ].join('\n')

}



const buildSystemPrompt = () => {

  return [

    'Sei un assistente che trasforma richieste in italiano in filtri strutturati per una tabella Supabase chiamata "searches".',

    'Devi rispondere SOLO con JSON valido (nessun testo extra).',

    '',

    'Schema tabella searches:',

    '- id: uuid',

    '- user_id: uuid',

    '- category: text (es: "Pizzeria", "Agenzia")',

    '- location: text (es: "Roma", "Milano")',

    '- status: text',

    '- results: jsonb (ARRAY di oggetti lead con campi come nome/email/telefono/rating/tech_stack/html_errors/page_speed)',

    '',

    'Output JSON schema (tutte le chiavi opzionali):',

    '{',

    '  "citta": string|null,',

    '  "categoria": string|null,',

    '  "rating_min": number|null,',

    '  "rating_max": number|null,',

    '  "page_speed_min": number|null,',

    '  "page_speed_max": number|null,',

    '  "include_tech": string[]|null,',

    '  "exclude_tech": string[]|null,',

    '  "include_errors": string[]|null,',

    '  "exclude_errors": string[]|null,',

    '  "keyword": string|null,',

    '  "limit": number|null',

    '}',

    '',

    'Regole:',

    '- Se l’utente chiede "senza X" allora metti X in exclude_tech (se è un tech) oppure exclude_errors (se è un errore).',

    '- Se l’utente chiede "con X" allora metti X in include_tech/include_errors.',

    '- "sito lento" => page_speed_max ~ 40 (o page_speed_max=40).',

    '- "sito veloce" => page_speed_min ~ 70.',

    '- "rating alto" => rating_min ~ 4.0.',

    '- "rating basso" => rating_max ~ 3.5.',

    '- Se non sei sicuro di un valore, lascialo null o ometti la chiave.',

    '- Non inventare colonne non presenti nello schema.',

  ].join('\n')

}



const buildPitchSystemPrompt = () => {

  return [
    'Sei un senior sales consultant B2B specializzato in digital marketing, web performance, SEO tecnico e lead generation.',
    'Il tuo compito è scrivere una cold email ALTAMENTE personalizzata e strutturata in Italiano (OGGETTO + CORPO) basata sui dati tecnici reali del lead.',
    '',
    'STRUTTURA OBBLIGATORIA del corpo email:',
    '',
    '1. **Apertura personalizzata** (1-2 righe): Saluto con nome azienda, riferimento specifico alla loro attività/settore/città.',
    '',
    '2. **Analisi tecnica dettagliata** (il cuore del pitch):',
    '   Per OGNI problema trovato nei dati, scrivi un paragrafo breve ma incisivo che includa:',
    '   - Il problema specifico identificato (es. "manca il Facebook Pixel", "Google Tag Manager assente", "velocità pagina X secondi")',
    '   - L\'IMPATTO CONCRETO sul business con dati/statistiche reali:',
    '     • Pixel assente → "State perdendo il 70% del potenziale di retargeting. Senza Pixel, ogni visitatore che esce dal sito è perso per sempre — niente audience lookalike, niente remarketing, niente conversion tracking per ottimizzare le campagne."',
    '     • GTM assente → "Senza Google Tag Manager non potete tracciare eventi, form, click sui CTA. È come guidare bendati — zero dati sulle conversioni."',
    '     • SSL assente → "Google penalizza i siti senza HTTPS nel ranking. Inoltre i browser mostrano \'Non sicuro\' — il 85% degli utenti abbandona."',
    '     • Velocità bassa → "Con un page speed di X secondi, state perdendo circa il Y% dei visitatori (Google: ogni secondo in più = -7% conversioni)."',
    '     • Errori SEO/HTML → "Ho rilevato errori come [specifici]. Questi impattano direttamente il posizionamento su Google: H1 mancante = -20% visibilità, meta description assente = CTR dimezzato."',
    '     • No Instagram → "Nel vostro settore, il 78% dei potenziali clienti cerca su Instagram prima di contattare. Assenza = opportunità perse."',
    '     • Google Ads assente → "I vostri competitor stanno acquisendo clienti con Google Ads mentre voi dipendete solo dal passaparola."',
    '',
    '3. **Proposta di valore** (2-3 righe): Cosa potete fare concretamente per risolvere i problemi, con risultati attesi realistici.',
    '',
    '4. **CTA forte**: Proponi una call gratuita di 15 minuti. Usa urgenza naturale: "Preferite oggi pomeriggio o domani mattina?"',
    '',
    '5. **Firma**: Solo "Un saluto," seguito da "[Nome Agenzia]"',
    '',
    'REGOLE FERREE:',
    '- NON citare "OpenAI", "AI", "LLM", "prompt", "intelligenza artificiale" o "analisi automatica".',
    '- NON inventare dati non presenti nel contesto. Usa solo i dati forniti.',
    '- Scrivi come se avessi analizzato personalmente il sito.',
    '- Tono: consulente esperto e diretto, non venditore aggressivo. Professionale ma umano.',
    '- L\'oggetto deve essere specifico e incuriosire (es. "3 problemi tecnici che stanno frenando [Nome Azienda]").',
    '- Il corpo deve essere 150-250 parole — abbastanza lungo da dimostrare competenza, abbastanza corto da essere letto.',
    '- Ogni affermazione tecnica deve avere un impatto business collegato.',
    '',
    'Output: rispondi SOLO con JSON valido nel formato:',
    '{ "subject": string, "body": string }',
  ].join('\n')

}



const openaiPitch = async (input: PitchInput): Promise<PitchResult> => {

  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {

    throw new Error('Missing OPENAI_API_KEY in environment')

  }



  const payload = {

    model: 'gpt-4o-mini',

    temperature: 0.5,

    max_tokens: 1200,

    messages: [

      { role: 'system', content: buildPitchSystemPrompt() },

      {

        role: 'user',

        content: JSON.stringify(

          {

            lead: {

              nome: input.nome,

              sito: input.sito,

              citta: input.citta,

              categoria: input.categoria,

              rating: input.rating,

              page_speed: input.page_speed,

              tech_stack: input.tech_stack,

              html_errors: input.html_errors,

            },

          },

          null,

          2

        ),

      },

    ],

    response_format: { type: 'json_object' },

  }



  const res = await fetch('https://api.openai.com/v1/chat/completions', {

    method: 'POST',

    headers: {

      Authorization: `Bearer ${apiKey}`,

      'Content-Type': 'application/json',

    },

    body: JSON.stringify(payload),

  })



  if (!res.ok) {

    const text = await res.text().catch(() => '')

    throw new Error(`OpenAI error (${res.status}): ${text || res.statusText}`)

  }



  const json = (await res.json()) as any

  const content = json?.choices?.[0]?.message?.content

  if (typeof content !== 'string' || !content.trim()) {

    throw new Error('OpenAI returned empty pitch')

  }



  try {

    const parsed = JSON.parse(content) as any

    const subject = typeof parsed?.subject === 'string' ? parsed.subject.trim() : ''

    const body = typeof parsed?.body === 'string' ? parsed.body.trim() : ''



    if (!subject || !body) {

      throw new Error('Invalid pitch JSON')

    }



    return { subject, body }

  } catch {

    throw new Error('Unable to parse pitch JSON')

  }

}



const openaiDeterministicSearchFilters = async (userQuery: string): Promise<DeterministicSearchFilters> => {

  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {

    throw new Error('Missing OPENAI_API_KEY in environment')

  }



  const payload = {

    model: 'gpt-4o-mini',

    temperature: 0,

    response_format: { type: 'json_object' },

    messages: [

      { role: 'system', content: buildDeterministicSearchSystemPrompt() },

      { role: 'user', content: userQuery },

    ],

  }



  const res = await fetch('https://api.openai.com/v1/chat/completions', {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      Authorization: `Bearer ${apiKey}`,

    },

    body: JSON.stringify(payload),

  })



  if (!res.ok) {

    const text = await res.text().catch(() => '')

    throw new Error(`OpenAI error (${res.status}): ${text || res.statusText}`)

  }



  const json = (await res.json()) as any

  const content = json?.choices?.[0]?.message?.content

  if (typeof content !== 'string' || !content.trim()) return {}



  try {

    return coerceDeterministicSearchFilters(JSON.parse(content))

  } catch {

    return {}

  }

}



const openaiLegacyAiFilters = async (userQuery: string): Promise<LegacyAiFilters> => {

  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {

    throw new Error('Missing OPENAI_API_KEY in environment')

  }



  const payload = {

    model: 'gpt-4o-mini',

    response_format: { type: 'json_object' },

    messages: [

      { role: 'system', content: buildLegacyAiSystemPrompt() },

      { role: 'user', content: userQuery },

    ],

  }



  const res = await fetch('https://api.openai.com/v1/chat/completions', {

    method: 'POST',

    headers: {

      'Content-Type': 'application/json',

      Authorization: `Bearer ${apiKey}`,

    },

    body: JSON.stringify(payload),

  })



  if (!res.ok) {

    const text = await res.text().catch(() => '')

    throw new Error(`OpenAI error (${res.status}): ${text || res.statusText}`)

  }



  const json = (await res.json()) as any

  const content = json?.choices?.[0]?.message?.content

  if (typeof content !== 'string' || !content.trim()) return {}



  try {

    return coerceLegacyAiFilters(JSON.parse(content))

  } catch {

    return {}

  }

}



const openaiNliJson = async (userQuery: string): Promise<NliFilterSpec> => {

  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {

    throw new Error('Missing OPENAI_API_KEY in environment')

  }



  const payload = {

    model: 'gpt-4o-mini',

    temperature: 0,

    messages: [

      { role: 'system', content: buildNliSystemPrompt() },

      { role: 'user', content: userQuery },

    ],

    response_format: { type: 'json_object' },

  }



  const res = await fetch('https://api.openai.com/v1/chat/completions', {

    method: 'POST',

    headers: {

      Authorization: `Bearer ${apiKey}`,

      'Content-Type': 'application/json',

    },

    body: JSON.stringify(payload),

  })



  if (!res.ok) {

    const text = await res.text().catch(() => '')

    throw new Error(`OpenAI error (${res.status}): ${text || res.statusText}`)

  }



  const json = (await res.json()) as any

  const content = json?.choices?.[0]?.message?.content



  if (typeof content !== 'string' || !content.trim()) {

    return {}

  }



  try {

    return coerceNliFilterSpec(JSON.parse(content))

  } catch {

    return {}

  }

}



const openaiJson = async (userQuery: string): Promise<TextToFilterSpec> => {

  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {

    throw new Error('Missing OPENAI_API_KEY in environment')

  }



  const payload = {

    model: 'gpt-4o-mini',

    temperature: 0,

    messages: [

      { role: 'system', content: buildSystemPrompt() },

      { role: 'user', content: userQuery },

    ],

    response_format: { type: 'json_object' },

  }



  const res = await fetch('https://api.openai.com/v1/chat/completions', {

    method: 'POST',

    headers: {

      Authorization: `Bearer ${apiKey}`,

      'Content-Type': 'application/json',

    },

    body: JSON.stringify(payload),

  })



  if (!res.ok) {

    const text = await res.text().catch(() => '')

    throw new Error(`OpenAI error (${res.status}): ${text || res.statusText}`)

  }



  const json = (await res.json()) as any

  const content = json?.choices?.[0]?.message?.content



  if (typeof content !== 'string' || !content.trim()) {

    return {}

  }



  try {

    return coerceFilterSpec(JSON.parse(content))

  } catch {

    return {}

  }

}



type SearchesRow = {

  id: string

  user_id: string

  category: string

  location: string

  status: string

  results: unknown

}



const toNumOrNull = (v: unknown): number | null => {

  if (typeof v === 'number') return Number.isFinite(v) ? v : null

  if (typeof v === 'string') {

    const n = Number(v)

    return Number.isFinite(n) ? n : null

  }

  return null

}



const coerceLead = (value: unknown, fallback: { category: string; location: string; searchId: string; idx: number }): RicercaRow | null => {

  if (!value || typeof value !== 'object') return null

  const obj = value as Record<string, unknown>



  const techStackRaw = obj.tech_stack ?? obj.techStack

  const tech_stack = Array.isArray(techStackRaw) ? techStackRaw.filter((v) => typeof v === 'string') : []



  const htmlErrorsRaw = obj.html_errors ?? obj.htmlErrors

  const html_errors = Array.isArray(htmlErrorsRaw) ? htmlErrorsRaw.filter((v) => typeof v === 'string') : []



  const nomeRaw = obj.nome ?? obj.azienda ?? obj.company ?? obj.name

  const sitoRaw = obj.sito ?? obj.website ?? obj.url

  const emailRaw = obj.email ?? obj.mail

  const telefonoRaw = obj.telefono ?? obj.phone

  const cittaRaw = obj.citta ?? obj.city ?? fallback.location

  const categoriaRaw = obj.categoria ?? obj.category ?? fallback.category



  const row: RicercaRow = {

    id: typeof obj.id === 'string' ? obj.id : `${fallback.searchId}-${fallback.idx}`,

    created_at: typeof obj.created_at === 'string' ? obj.created_at : '',

    nome: typeof nomeRaw === 'string' ? nomeRaw : '',

    sito: typeof sitoRaw === 'string' ? sitoRaw : '',

    citta: typeof cittaRaw === 'string' ? cittaRaw : '',

    categoria: typeof categoriaRaw === 'string' ? categoriaRaw : '',

    email: typeof emailRaw === 'string' ? emailRaw : '',

    telefono: typeof telefonoRaw === 'string' ? telefonoRaw : '',

    rating: toNumOrNull(obj.rating ?? obj.google_rating ?? obj.reputation_rating),

    tech_stack,

    html_errors,

    page_speed: toNumOrNull(obj.page_speed ?? obj.pageSpeed ?? obj.pagespeed),

  }



  ;(row as any).instagram = obj.instagram

  ;(row as any).meta_pixel = obj.meta_pixel

  ;(row as any).google_tag_manager = obj.google_tag_manager

  ;(row as any).technical_report = obj.technical_report



  return row

}



const containsAll = (haystack: string[], needles: string[]) => {

  if (needles.length === 0) return true

  const set = new Set(haystack.map((s) => s.toLowerCase()))

  return needles.every((n) => set.has(n.toLowerCase()))

}



const containsAny = (haystack: string[], needles: string[]) => {

  if (needles.length === 0) return false

  const set = new Set(haystack.map((s) => s.toLowerCase()))

  return needles.some((n) => set.has(n.toLowerCase()))

}



const postFilterLead = (lead: RicercaRow, filters: TextToFilterSpec) => {

  if (typeof filters.rating_min === 'number' && (typeof lead.rating !== 'number' || lead.rating < filters.rating_min)) return false

  if (typeof filters.rating_max === 'number' && (typeof lead.rating !== 'number' || lead.rating > filters.rating_max)) return false



  if (typeof filters.page_speed_min === 'number' && (typeof lead.page_speed !== 'number' || lead.page_speed < filters.page_speed_min)) return false

  if (typeof filters.page_speed_max === 'number' && (typeof lead.page_speed !== 'number' || lead.page_speed > filters.page_speed_max)) return false



  const includeTech = (filters.include_tech || []).filter(Boolean)

  if (!containsAll(lead.tech_stack || [], includeTech)) return false



  const includeErrors = (filters.include_errors || []).filter(Boolean)

  if (!containsAll(lead.html_errors || [], includeErrors)) return false



  const excludeTech = (filters.exclude_tech || []).filter(Boolean)

  if (containsAny(lead.tech_stack || [], excludeTech)) return false



  const excludeErrors = (filters.exclude_errors || []).filter(Boolean)

  if (containsAny(lead.html_errors || [], excludeErrors)) return false



  const keyword = filters.keyword?.trim()

  if (keyword) {

    const k = keyword.toLowerCase()

    const blob = `${lead.nome} ${lead.sito} ${lead.email} ${lead.telefono} ${lead.citta} ${lead.categoria}`.toLowerCase()

    if (!blob.includes(k)) return false

  }



  return true

}



const postFilter = (rows: RicercaRow[], filters: TextToFilterSpec): RicercaRow[] => {

  const excludeTech = (filters.exclude_tech || []).map((s) => s.toLowerCase())

  const excludeErrors = (filters.exclude_errors || []).map((s) => s.toLowerCase())



  if (excludeTech.length === 0 && excludeErrors.length === 0) return rows



  return rows.filter((r) => {

    const tech = (r.tech_stack || []).map((s) => s.toLowerCase())

    const errs = (r.html_errors || []).map((s) => s.toLowerCase())



    const hasExcludedTech = excludeTech.some((x) => tech.includes(x))

    if (hasExcludedTech) return false



    const hasExcludedErr = excludeErrors.some((x) => errs.includes(x))

    if (hasExcludedErr) return false



    return true

  })

}



export async function textToFilterSearchAction(
  userQuery: string,
  options?: SearchActionOptions,
): Promise<TextToFilterSearchResponse> {

  const supabase = await createClient()
  const requestedMaxLeads = clampSearchMaxLeads(options?.maxLeads ?? 10)



  try {

    const query = (userQuery || '').trim()

    const existingJobMaxAgeMs = 10 * 60 * 1000

    // FAST PATH: simple city+category queries skip slow LLM calls.
    const heur = heuristicSearchNlpParams(query)
    const offlineIntent = parseSignalIntentOffline(query)
    const inferredCategory = inferMapsCategoryFromIntent(query, offlineIntent)
    const fastCity = heur.city
    const fastCategory = heur.category || inferredCategory
    const canFastPath = Boolean(fastCity && fastCategory && offlineIntent.required_signals.length === 0)

    let available: { available_categories: string[]; available_locations: string[] } = { available_categories: [], available_locations: [] }
    let nlp: SearchNlpParams

    if (canFastPath) {
      nlp = {
        ...heur,
        category: fastCategory,
        keywords: heur.keywords ?? [],
        excluded_keywords: heur.excluded_keywords ?? [],
        technical_filters: heur.technical_filters,
        signal_intent: offlineIntent,
      }
    } else {
      available = await fetchAvailableSearchOptions(supabase)
      nlp = await openaiSearchNlpParams(query, available)
    }

    // Hard-enforce negative intents from raw query so they are never ignored.

    // (Example: "senza Instagram" must always behave as instagram_missing=true)

    if (!canFastPath) {

      // If the raw query clearly contains a strong category signal, prefer heuristic category

      // over a hallucinated LLM category.

      const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : '')

      try {

        const qNorm = query.trim().toLowerCase().replace(/\s+/g, ' ')

        const _stopLoc2 = new Set(['a','ad','in','su','da','di','per','con','tra','fra','al','del','nel','dal','sul'])

        const findBestMatch = (candidates: string[]) => {

          let best: string | null = null

          for (const raw of candidates) {

            if (typeof raw !== 'string') continue

            const cand = raw.trim()

            if (!cand || _stopLoc2.has(cand.toLowerCase())) continue

            const candNorm = cand.toLowerCase()

            const re = new RegExp(`\\b${candNorm.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i')

            if (re.test(qNorm)) {

              if (!best || cand.length > best.length) best = cand

            }

          }

          return best

        }



        const cityFromQuery = findBestMatch(Array.isArray(available.available_locations) ? available.available_locations : [])

        if (cityFromQuery) {

          const llmCity = norm((nlp as any)?.city)

          const picked = cityFromQuery.trim()

          if (!llmCity || llmCity !== norm(picked)) {

            nlp = { ...nlp, city: picked }

          }

        }



        const categoryFromQuery = findBestMatch(Array.isArray(available.available_categories) ? available.available_categories : [])

        if (categoryFromQuery) {

          const llmCat2 = norm((nlp as any)?.category)

          const picked = categoryFromQuery.trim()

          if (!llmCat2 || llmCat2 !== norm(picked)) {

            nlp = { ...nlp, category: picked }

          }

        }

      } catch (e) {

        console.log('[hybrid] deterministic match failed:', e)

      }

      const heurCity = norm((heur as any)?.city)

      const llmCity = norm((nlp as any)?.city)

      // Only use heuristic city as fallback when LLM didn't find one,

      // AND the heuristic city looks like a real location (not a category word)

      const knownLocations = (Array.isArray(available?.available_locations) ? available.available_locations : []).map(l => l.toLowerCase())

      const heurCityIsKnown = heurCity && knownLocations.some(loc => loc.includes(heurCity) || heurCity.includes(loc))

      if (heurCity && !llmCity && heurCityIsKnown) {

        nlp = { ...nlp, city: (heur as any).city }

      }

      const heurCat = norm(heur.category)

      const llmCat = norm(nlp.category)

      if (heurCat && !llmCat) {

        nlp = { ...nlp, category: heur.category }

      }

    }



    const semanticIntent = canFastPath ? offlineIntent : await parseSignalIntent(query)

    const inferredMapsCategory = inferMapsCategoryFromIntent(query, semanticIntent)
    let resolvedCategory =
      typeof nlp.category === 'string' && nlp.category.trim()
        ? nlp.category.trim()
        : semanticIntent.category ?? null
    if (inferredMapsCategory && !queryNamesExplicitCategory(query)) {
      const generic = !resolvedCategory || /^(agenzie|aziende)$/i.test(resolvedCategory)
      const wrongVertical =
        Boolean(resolvedCategory) &&
        semanticIntent.required_signals.includes('hiring') &&
        /viagg|ristorant|hotel|parrucchier|notai|fiorai/i.test(resolvedCategory || '')
      if (generic || wrongVertical) resolvedCategory = inferredMapsCategory
    }
    if (!resolvedCategory && inferredMapsCategory) resolvedCategory = inferredMapsCategory

    const intentKeywords = inferSearchKeywordsFromIntent(query, semanticIntent)
    const mergedKeywords = [
      ...new Set([
        ...(Array.isArray((nlp as SearchNlpParams).keywords) ? (nlp as SearchNlpParams).keywords! : []),
        ...intentKeywords,
      ]),
    ].filter((k) => typeof k === 'string' && k.trim())

    nlp = {

      ...nlp,

      city: typeof nlp.city === 'string' && nlp.city.trim() ? nlp.city : semanticIntent.location ?? nlp.city,

      category: resolvedCategory ?? nlp.category,

      keywords: mergedKeywords.length ? mergedKeywords : (nlp as SearchNlpParams).keywords,

      technical_filters: {

        ...nlp.technical_filters,

        ...intentTechnicalToLegacy(semanticIntent.technical_filters),

        no_website: nlp.technical_filters.no_website === true || heur.technical_filters.no_website === true,

        no_instagram: nlp.technical_filters.no_instagram === true || heur.technical_filters.no_instagram === true,

        no_facebook: nlp.technical_filters.no_facebook === true || heur.technical_filters.no_facebook === true,

        no_tiktok: nlp.technical_filters.no_tiktok === true || heur.technical_filters.no_tiktok === true,

        no_pixel: nlp.technical_filters.no_pixel === true || heur.technical_filters.no_pixel === true || semanticIntent.technical_filters?.has_meta_pixel === false,

        no_gtm: nlp.technical_filters.no_gtm === true || heur.technical_filters.no_gtm === true || semanticIntent.technical_filters?.has_gtm === false,

        no_ga4: nlp.technical_filters.no_ga4 === true || heur.technical_filters.no_ga4 === true || semanticIntent.technical_filters?.has_google_analytics === false,

        no_google_ads: nlp.technical_filters.no_google_ads === true || heur.technical_filters.no_google_ads === true,

        seo_errors: nlp.technical_filters.seo_errors === true || heur.technical_filters.seo_errors === true || semanticIntent.technical_filters?.errors_seo === true,

        no_ssl: nlp.technical_filters.no_ssl === true || heur.technical_filters.no_ssl === true || semanticIntent.technical_filters?.has_ssl === false,

        no_mobile: nlp.technical_filters.no_mobile === true || heur.technical_filters.no_mobile === true || semanticIntent.technical_filters?.mobile_friendly === false,

        spam_risk: nlp.technical_filters.spam_risk === true || heur.technical_filters.spam_risk === true,

        slow_speed: nlp.technical_filters.slow_speed === true || heur.technical_filters.slow_speed === true || semanticIntent.technical_filters?.site_speed === 'slow',

      },

      signal_intent: mergeSignalIntent(
        semanticIntent,
        mergeSignalIntent(
          coerceSignalIntent(heur.signal_intent),
          coerceSignalIntent((nlp as SearchNlpParams).signal_intent),
        ),
      ),

    }

    console.log('AI NLP (BLINDATO):', nlp)



    const normalizeText = (v: string) => v.trim().replace(/\s+/g, ' ')

    const aiDebug = {

      ...nlp,

      city: typeof nlp.city === 'string' ? normalizeText(nlp.city) : null,

      category: typeof nlp.category === 'string' ? normalizeText(nlp.category) : null,

      available_categories_count: available.available_categories.length,

      available_locations_count: available.available_locations.length,

    }



    const det: DeterministicSearchFilters = {

      citta: aiDebug.city,

      categoria: aiDebug.category,

      overall_logic: null,

      filter_no_website: nlp.technical_filters.no_website,

      filter_no_instagram: nlp.technical_filters.no_instagram,

      filter_no_pixel: nlp.technical_filters.no_pixel,

      filter_no_gtm: nlp.technical_filters.no_gtm,

      filter_seo_disaster: nlp.technical_filters.seo_errors,

    }



    // Fallback deterministico: se l'LLM non valorizza la categoria ma la query contiene una professione,

    // estraggo una categoria coerente per non perdere il vincolo base.

    if (!det.categoria) {

      const q = query.toLowerCase()

      const extractCategory = (): string | null => {

        const hasLawyer = /\bavvocat/i.test(q)

        const hasAccountant = /\bcommercialist/i.test(q)

        const hasDentist = /\bdentist/i.test(q)



        if (hasLawyer) {

          if (q.includes('penalist')) return 'avvocati penalisti'

          if (q.includes('civilist')) return 'avvocati civilisti'

          if (q.includes('divorz')) return 'avvocati divorzisti'

          return 'avvocati'

        }

        if (hasAccountant) return 'commercialisti'

        if (hasDentist) return 'dentisti'

        return null

      }



      const fallbackCat = extractCategory()

      if (fallbackCat) {

        det.categoria = fallbackCat

        console.log('CATEGORIA FALLBACK (DETERMINISTICA):', fallbackCat)

      }

    }



    // Back-compat: mappo i filtri deterministici nel formato filters esposto al frontend

    let filtri: LegacyAiFilters = {

      citta: det.citta ?? null,

      categoria: det.categoria ?? null,

      needs_html_errors: det.filter_seo_disaster ?? null,

      overall_logic: det.overall_logic ?? null,

      tech_mancanti: [],

      tech_logic: null,

      has_website: null,

    }



    if (det.filter_no_pixel) filtri.tech_mancanti = [...(filtri.tech_mancanti || []), 'pixel']

    if (det.filter_no_gtm) filtri.tech_mancanti = [...(filtri.tech_mancanti || []), 'gtm']

    if (nlp.technical_filters.no_ssl) filtri.tech_mancanti = [...(filtri.tech_mancanti || []), 'ssl']



    const needsNoWebsite = det.filter_no_website === true

    const needsNoInstagram = false



    if (needsNoWebsite) filtri.has_website = false



    console.log('AI FILTRI (LEGACY):', filtri)



    // fallback robusto per intent SEO/HTML (copre anche "errori di seo")

    if (filtri.needs_html_errors == null) {

      if (/errori\s+(di\s+)?(seo|html)/i.test(query) || /seo\s+errors?/i.test(query) || /html\s+errors?/i.test(query)) {

        filtri = { ...filtri, needs_html_errors: true }

      }

    }



    const _prepBlock2 = new Set(['a','ad','in','su','da','di','per','con','tra','fra','al','del','nel','dal','sul'])

    let cityBase = (filtri.citta || '').trim()

    if (_prepBlock2.has(cityBase.toLowerCase())) cityBase = ''

    const categoryBase = (filtri.categoria || '').trim()

    console.log('BASE MATCH (RICHIESTO):', { citta: cityBase || null, categoria: categoryBase || null })



    // 1. FETCH CASE-INSENSITIVE DAL DB (RISOLVE I 0 RISULTATI)

    // Usiamo .ilike() per ignorare le differenze tra maiuscole e minuscole

    const normalizeForTokens = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ')



    // Category must be strict: if the user specifies a category, we only accept that

    // category (or very tight variants) both in DB fetch and in-memory filtering.

    const buildStrictCategoryVariants = (rawCategory: string): string[] => {

      const c = normalizeForTokens(rawCategory)

      if (!c) return []



      const out: string[] = []

      const add = (v: string) => {

        const vv = normalizeForTokens(v)

        if (!vv) return

        if (!out.includes(vv)) out.push(vv)

      }



      add(c)

      // Generic rule: "agenzie X" → also "agenzie di X" and singular/plural forms
      const _agMatch3 = c.match(/^(agenzie|agenzia)\s+(?!di\b)(.+)$/i)
      if (_agMatch3) {
        const _tipo3 = _agMatch3[2]
        add(`agenzie ${_tipo3}`)
        add(`agenzia ${_tipo3}`)
        add(`agenzie di ${_tipo3}`)
        add(`agenzia di ${_tipo3}`)
        if (_tipo3.endsWith('i')) {
          const _sing3 = _tipo3.endsWith('ii') ? _tipo3.slice(0, -1) + 'o' : _tipo3.slice(0, -1) + (_tipo3.endsWith('ri') ? 'e' : 'o')
          if (_sing3 !== _tipo3) {
            add(`agenzie di ${_sing3}`)
            add(`agenzia di ${_sing3}`)
          }
        }
      }
      const _agDiMatch3 = c.match(/^(agenzie|agenzia)\s+di\s+(.+)$/i)
      if (_agDiMatch3) {
        const _tipo3 = _agDiMatch3[2]
        add(`agenzie ${_tipo3}`)
        add(`agenzia ${_tipo3}`)
      }

      // Very tight, domain-specific variants.

      // NOTE: keep variants minimal to avoid false positives.

      if (c === 'agenzie immobiliari' || c === 'agenzia immobiliare') {

        add('agenzie immobiliari')

        add('agenzia immobiliare')

      }



      if (c === 'uffici stampa' || c === 'ufficio stampa') {

        add('uffici stampa')

        add('ufficio stampa')

      }



      if (c === 'studi di registrazione' || c === 'studio di registrazione') {

        add('studi di registrazione')

        add('studio di registrazione')

      }



      if (c.includes('marketing')) {

        add('agenzie di marketing')

        add('agenzie marketing')

        add('marketing agency')

        add('web marketing')

        add('agenzie di web marketing')

      }



      if (c.includes('comunicazione')) {

        add('agenzie di comunicazione')

        add('agenzie comunicazione')

        add('comunicazione')

        add('agenzie pr')

        add('agenzie pubblicitarie')

      }



      if (c.includes('social media') || c.includes('smm')) {

        add('social media manager')

        add('social media marketing')

        add('social media agency')

        add('agenzia social media')

        add('agenzie social media')

      }



      if (c.includes('informatica') || c.includes('tecnologia') || c.includes('tech') || c.includes('software')) {

        add('informatica')

        add('tecnologia')

        add('software house')

        add('sviluppatori software')

        add('sviluppatore software')

        add('it')

        add('developer')

      }



      return out

    }



    const categoryVariants = categoryBase ? buildStrictCategoryVariants(categoryBase) : []

    const escapeForSupabaseOrValue = (v: string) => v.replace(/,/g, '%2C')
    const buildCategoryOr = (variants: string[]) =>
      variants
        .map((v) => `category.ilike.${escapeForSupabaseOrValue(`%${v}%`)}`)
        .join(',')



    let usedFallbackCityOnly = false

    const mergedCache = await loadMergedSearchCache(supabase, {
      category: categoryBase,
      location: cityBase,
      categoryVariants,
      includeInFlight: true,
    })

    let rows: any[] | null = mergedCache.rows.length > 0 ? (mergedCache.rows as any[]) : null

    console.log('SEARCH CACHE (merged):', {
      city: cityBase,
      category: categoryBase,
      jobs: mergedCache.rows.length,
      raw: mergedCache.rawTotal,
      with_contact: mergedCache.withContact,
      canonical: mergedCache.canonicalJobId,
    })

    if (!rows?.length && cityBase && !categoryBase) {
      usedFallbackCityOnly = true
      const fallbackCache = await loadMergedSearchCache(supabase, {
        category: '',
        location: cityBase,
        includeInFlight: false,
      })
      rows = fallbackCache.rows.length > 0 ? (fallbackCache.rows as any[]) : null
    }



    if (!rows || rows.length === 0) {

      try {

        const {

          data: { user },

        } = await supabase.auth.getUser()

        if (!cityBase || !categoryBase) {
          return {
            results: [],
            filters: filtri,
            ai_debug: { ...aiDebug, category_variants: categoryVariants, fallback_city_only: usedFallbackCityOnly },
          }
        }

        const scrape = await requestIncrementalScrape(supabase, {
          category: formatCanonicalLabel(categoryBase),
          location: formatCanonicalLabel(cityBase),
          maxLeads: requestedMaxLeads,
          userId: user?.id,
          categoryVariants,
          originalQuery: query,
        })

        console.log('[hybrid] incremental scrape (empty cache):', scrape)

        return {
          results: [],
          status: 'pending',
          jobId: scrape.jobId,
          searchId: scrape.jobId,
          filters: filtri,
          cache_meta: {
            source: scrape.reused ? 'db_merged' : 'fresh_scrape',
            db_raw: scrape.existingRaw,
            db_with_contact: scrape.existingWithContact,
            jobs_merged: scrape.reused ? 1 : 0,
            needs_more_scrape: true,
            canonical_job_id: scrape.jobId,
          },
          ai_debug: {
            ...aiDebug,
            source: scrape.reused ? 'requeued_canonical' : 'new_scrape',
            category_variants: categoryVariants,
          },
        }

      } catch (insertErr) {

        console.error('[hybrid] scrape request failed:', insertErr)

        return {
          results: [],
          filters: filtri,
          ai_debug: { ...aiDebug, category_variants: categoryVariants, fallback_city_only: usedFallbackCityOnly },
        }

      }

    }



    // 2. PARSING SICURO DI TUTTI I JOB TROVATI

    console.log('SEARCHES ROWS (COUNT):', Array.isArray(rows) ? rows.length : 0)

    let allResults: any[] = []

    let skippedResultsFormat = 0

    rows.forEach((row: any) => {

      const fallbackMeta = {

        __ckb_search_id: typeof row?.id === 'string' ? row.id : 'searches',

        __ckb_fallback_location: typeof row?.location === 'string' ? row.location : '',

        __ckb_fallback_category: typeof row?.category === 'string' ? row.category : '',

      }

      if (typeof row?.results === 'string') {

        try {

          const parsed = JSON.parse(row.results)

          if (Array.isArray(parsed)) {

            allResults = allResults.concat(parsed.map((it: any) => ({ ...fallbackMeta, ...(it && typeof it === 'object' ? it : {}) })))

          } else if (parsed && typeof parsed === 'object') {

            allResults = allResults.concat([{ ...fallbackMeta, ...(parsed as any) }])

          }

          else skippedResultsFormat++

        } catch {

          skippedResultsFormat++

        }

      } else if (Array.isArray(row?.results)) {

        allResults = allResults.concat(

          row.results.map((it: any) => ({ ...fallbackMeta, ...(it && typeof it === 'object' ? it : {}) }))

        )

      } else if (row?.results && typeof row.results === 'object') {

        allResults = allResults.concat([{ ...fallbackMeta, ...(row.results as any) }])

      } else {

        skippedResultsFormat++

      }

    })



    console.log('LEAD FLAT (COUNT):', allResults.length)

    console.log('RESULTS SKIPPED (FORMAT):', skippedResultsFormat)



    // 3. LOGICA DI BUSINESS PERFETTA SUI PROBLEMI TECNICI (OR inclusivo)

    const filters = {

      requires_no_website: nlp.technical_filters.no_website === true,

      requires_no_pixel: nlp.technical_filters.no_pixel === true,

      requires_no_gtm: nlp.technical_filters.no_gtm === true,

      requires_no_ga4: nlp.technical_filters.no_ga4 === true,

      requires_no_google_ads: nlp.technical_filters.no_google_ads === true,

      requires_seo_errors: nlp.technical_filters.seo_errors === true,

      requires_no_ssl: nlp.technical_filters.no_ssl === true,

      requires_no_mobile: nlp.technical_filters.no_mobile === true,

      requires_spam_risk: nlp.technical_filters.spam_risk === true,

      requires_unclaimed_maps: nlp.technical_filters.unclaimed_maps === true,

      requires_code_errors: nlp.technical_filters.code_errors === true,

      requires_slow_speed: nlp.technical_filters.slow_speed === true,

      tech_terms: Array.isArray(nlp.technical_filters.tech_terms) ? nlp.technical_filters.tech_terms : [],

    }



    const filteredResults = allResults.filter((item: any) => {

      // A. Mappiamo lo stato REALE dell'azienda (true se ha il problema, false se è ok)

      const sitoRaw = typeof item?.sito === 'string' ? item.sito : typeof item?.website === 'string' ? item.website : typeof item?.url === 'string' ? item.url : ''

      const sitoNorm = typeof sitoRaw === 'string' ? sitoRaw.trim() : ''



      const hasNoWebsite =

        !sitoNorm ||

        sitoNorm === 'N/D' ||

        sitoNorm === 'N/A' ||

        sitoNorm === 'N.D.' ||

        (item?.tech_stack && Array.isArray(item.tech_stack) && item.tech_stack.includes('NO WEBSITE'))



      const hasWebsite = !hasNoWebsite



      const hasNoPixel =

        item?.meta_pixel !== true ||

        (item?.tech_stack && Array.isArray(item.tech_stack) && item.tech_stack.includes('MISSING FB PIXEL'))



      const hasNoGtm =

        item?.google_tag_manager !== true ||

        (item?.tech_stack && Array.isArray(item.tech_stack) && item.tech_stack.includes('MISSING GTM'))



      const htmlErrRaw = item?.technical_report?.html_errors
      const hasSeoErrors =

        item?.technical_report?.seo_disaster === true ||

        (typeof htmlErrRaw === 'number' && htmlErrRaw > 0) ||

        htmlErrRaw === true ||

        (item?.tech_stack && Array.isArray(item.tech_stack) && item.tech_stack.includes('DISASTRO SEO (NO H1/TITLE)'))



      const hasNoGoogleAds =

        item?.technical_report?.has_google_ads === false ||

        (item?.tech_stack &&

          Array.isArray(item.tech_stack) &&

          (item.tech_stack.includes('MISSING GOOGLE ADS') || item.tech_stack.includes('NO GOOGLE ADS') || item.tech_stack.includes('NO ADS')))



      const hasNoGa4 =

        item?.technical_report?.has_ga4 === false ||

        (item?.tech_stack &&

          Array.isArray(item.tech_stack) &&

          (item.tech_stack.includes('MISSING GA4') || item.tech_stack.includes('NO GA4') || item.tech_stack.includes('MISSING ANALYTICS') || item.tech_stack.includes('NO ANALYTICS')))



      const hasNoSsl =

        item?.ssl === false ||

        (typeof sitoNorm === 'string' && sitoNorm.toLowerCase().startsWith('http://')) ||

        (item?.tech_stack &&

          Array.isArray(item.tech_stack) &&

          (item.tech_stack.includes('NO SSL') || item.tech_stack.includes('MISSING SSL') || item.tech_stack.includes('SSL ERROR')))



      const hasNoMobile =

        item?.mobile_friendly === false ||

        item?.is_mobile_friendly === false ||

        (item?.tech_stack &&

          Array.isArray(item.tech_stack) &&

          (item.tech_stack.includes('MISSING MOBILE') || item.tech_stack.includes('NO MOBILE') || item.tech_stack.includes('NOT MOBILE FRIENDLY')))



      const htmlErrorsRaw = item?.html_errors ?? item?.htmlErrors

      const hasCodeErrors = Array.isArray(htmlErrorsRaw) && htmlErrorsRaw.length > 0



      const loadSpeedRaw =

        item?.technical_report?.load_speed_s ??

        item?.technical_report?.load_speed_seconds ??

        item?.load_speed_s ??

        item?.load_speed_seconds

      const loadSpeedSeconds = typeof loadSpeedRaw === 'number' ? loadSpeedRaw : typeof loadSpeedRaw === 'string' ? Number(loadSpeedRaw) : null

      const isSlowSpeed = typeof loadSpeedSeconds === 'number' && Number.isFinite(loadSpeedSeconds) ? loadSpeedSeconds > 3 : false



      const hasSpamRisk =

        item?.technical_report?.has_spf === false ||

        item?.technical_report?.has_dmarc === false ||

        (item?.tech_stack &&

          Array.isArray(item.tech_stack) &&

          (item.tech_stack.includes('MISSING DMARC') || item.tech_stack.includes('NO DMARC') || item.tech_stack.includes('MISSING SPF') || item.tech_stack.includes('NO SPF')))



      const isUnclaimedMaps = item?.is_claimed === false



      const stackLower =

        item?.tech_stack && Array.isArray(item.tech_stack)

          ? item.tech_stack.filter((v: any) => typeof v === 'string').map((s: string) => s.toLowerCase())

          : []

      const techTerms = filters.tech_terms

      const matchesTechTerms =

        Array.isArray(techTerms) && techTerms.length > 0

          ? techTerms.some((t) => {

              const term = String(t || '').trim().toLowerCase()

              if (!term) return false

              return stackLower.some((s: string) => s.includes(term))

            })

          : true



      // PREREQUISITO: se stai cercando difetti tecnici web, il lead deve avere un sito

      const webTechRequested =

        nlp.technical_filters.no_pixel === true ||

        nlp.technical_filters.no_gtm === true ||

        nlp.technical_filters.no_ga4 === true ||

        nlp.technical_filters.no_google_ads === true ||

        nlp.technical_filters.seo_errors === true ||

        nlp.technical_filters.no_ssl === true ||

        nlp.technical_filters.no_mobile === true ||

        nlp.technical_filters.code_errors === true ||

        nlp.technical_filters.slow_speed === true



      if (webTechRequested && nlp.technical_filters.no_website !== true && !hasWebsite) {

        return false

      }



      if (!matchesTechTerms) {

        return false

      }



      // Filtri social

      if (nlp.technical_filters.no_instagram === true) {

        const ig = typeof item?.instagram === 'string' ? item.instagram.trim() : ''

        const igMissing = typeof item?.instagram_missing === 'boolean' ? item.instagram_missing : null

        if (igMissing === false) return false

        if (ig) return false

      }

      if (nlp.technical_filters.no_facebook === true) {

        const fb = typeof item?.facebook === 'string' ? item.facebook.trim() : ''

        if (fb) return false

      }

      if (nlp.technical_filters.no_tiktok === true) {

        const tt = typeof item?.tiktok === 'string' ? item.tiktok.trim() : ''

        if (tt) return false

      }



      // B. Raccogliamo in un array i check richiesti SPECIFICAMENTE dall'utente tramite LLM

      const requestedProblems: boolean[] = []

      if (filters.requires_no_website) requestedProblems.push(hasNoWebsite)

      if (filters.requires_no_pixel) requestedProblems.push(hasNoPixel)

      if (filters.requires_no_gtm) requestedProblems.push(hasNoGtm)

      if (filters.requires_no_ga4) requestedProblems.push(hasNoGa4)

      if (filters.requires_no_google_ads) requestedProblems.push(hasNoGoogleAds)

      if (filters.requires_seo_errors) requestedProblems.push(hasSeoErrors)

      if (filters.requires_no_ssl) requestedProblems.push(hasNoSsl)

      if (filters.requires_no_mobile) requestedProblems.push(hasNoMobile)

      if (filters.requires_spam_risk) requestedProblems.push(hasSpamRisk)

      if (filters.requires_unclaimed_maps) requestedProblems.push(isUnclaimedMaps)

      if (filters.requires_code_errors) requestedProblems.push(hasCodeErrors)

      if (filters.requires_slow_speed) requestedProblems.push(isSlowSpeed)



      // C. VALUTAZIONE FINALE

      // Se l'utente non ha chiesto filtri tecnici (es. vuole solo "Avvocati a Torino"), mostrali tutti

      if (requestedProblems.length === 0) return true



      // Se ha chiesto filtri tecnici, l'azienda DEVE AVERE ALMENO UNO dei problemi (Logica OR pura)

      return requestedProblems.some((problem) => problem === true)

    })



    console.log('LEAD FILTRATI (TECNICI OR) (COUNT):', filteredResults.length)



    const coercedLeads: RicercaRow[] = []

    for (let i = 0; i < filteredResults.length; i++) {

      const it: any = filteredResults[i]

      const lead = coerceLead(it, {

        category: typeof it?.__ckb_fallback_category === 'string' ? it.__ckb_fallback_category : '',

        location: typeof it?.__ckb_fallback_location === 'string' ? it.__ckb_fallback_location : '',

        searchId: typeof it?.__ckb_search_id === 'string' ? it.__ckb_search_id : 'searches',

        idx: i,

      })

      if (lead) coercedLeads.push(lead)

    }



    // 3. PULIZIA DATI FANTASMA (Rimuove gli N/D)

    let validLeads = coercedLeads.filter((lead) => typeof lead.nome === 'string' && lead.nome.trim() !== '')



    // 4. FILTRAGGIO BASE (AND): città + categoria devono matchare sempre se richiesti

    const citta = cityBase.toLowerCase()

    if (citta) {

      const before = validLeads.length

      validLeads = validLeads.filter((lead) => (lead.citta || '').toLowerCase().includes(citta))

      console.log('BASE FILTER CITY:', { before, after: validLeads.length, citta: cityBase })

    }



    if (categoryBase) {

      const wanted = normalizeForTokens(categoryBase)

      const wantedVariants = categoryVariants.length > 0 ? categoryVariants : wanted ? [wanted] : []



      const matchesStrictCategory = (leadCategoryRaw: string): boolean => {

        const cat = normalizeForTokens(leadCategoryRaw || '')

        if (!cat) return false

        return wantedVariants.some((v) => {

          // Phrase match: require the full phrase as a contiguous sequence.

          const phrase = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

          const re = new RegExp(`(^|\\b)${phrase}(\\b|$)`, 'i')

          return re.test(cat)

        })

      }



      const before = validLeads.length

      const rejectedSamples: Array<{ nome: string; citta: string; categoria: string }> = []

      validLeads = validLeads.filter((lead) => {

        const ok = matchesStrictCategory(lead.categoria || '')

        if (!ok && rejectedSamples.length < 5) {

          rejectedSamples.push({ nome: lead.nome || '', citta: lead.citta || '', categoria: lead.categoria || '' })

        }

        return ok

      })

      console.log('BASE FILTER CATEGORY:', {

        before,

        after: validLeads.length,

        categoria: categoryBase,

        wanted_variants: wantedVariants,

        rejectedSamples,

      })

    }



    if (filtri.has_website === false) {

      validLeads = validLeads.filter((lead) => {

        const hasWebsiteUrl = typeof lead.sito === 'string' && !!lead.sito.trim()

        const stack = Array.isArray(lead.tech_stack) ? lead.tech_stack.join(' ').toLowerCase() : ''

        const taggedNoWebsite = stack.includes('no website')

        return !hasWebsiteUrl || taggedNoWebsite

      })

    }

    if (filtri.has_website === true) {

      validLeads = validLeads.filter((lead) => {

        const hasWebsiteUrl = typeof lead.sito === 'string' && !!lead.sito.trim()

        const stack = Array.isArray(lead.tech_stack) ? lead.tech_stack.join(' ').toLowerCase() : ''

        const taggedNoWebsite = stack.includes('no website')

        return hasWebsiteUrl && !taggedNoWebsite

      })

    }



    console.log('LEAD FILTRATI (COUNT):', validLeads.length)

    validLeads = (await filterLeadsWithAI(validLeads as any[], query)) as typeof validLeads

    console.log('LEAD FILTRATI AI (COUNT):', validLeads.length)

    // Dedup: strip phone/email that appear in 3+ leads (directory/aggregator contacts)
    {
      const phoneCounts: Record<string, number> = {}
      const emailCounts: Record<string, number> = {}
      for (const lead of validLeads) {
        const p = (lead.telefono || '').replace(/\s+/g, '').trim()
        const e = (lead.email || '').trim().toLowerCase()
        if (p && p !== 'N/D' && p !== 'N/A') phoneCounts[p] = (phoneCounts[p] || 0) + 1
        if (e && e !== 'n/d' && e !== 'n/a') emailCounts[e] = (emailCounts[e] || 0) + 1
      }
      for (const lead of validLeads) {
        const p = (lead.telefono || '').replace(/\s+/g, '').trim()
        const e = (lead.email || '').trim().toLowerCase()
        if (p && phoneCounts[p] >= 3) lead.telefono = ''
        if (e && emailCounts[e] >= 3) lead.email = ''
      }
    }

    const finalResults = validLeads

    if (finalResults.length === 0) {

      // HYBRID: no results found, trigger realtime scraping

      try {

        const {

          data: { user },

        } = await supabase.auth.getUser()



        // Always create a fresh job (ignore old pending jobs)

        const { data: insertData, error: insertError } = await supabase

          .from('searches')

          .insert(
            buildPendingSearchInsert({
              category: categoryBase,
              location: cityBase,
              userId: user?.id,
            }),
          )

          .select()

          .single()



        if (insertError) {

          console.error('[hybrid] INSERT FAILED:', insertError.message)

          if (String((insertError as any)?.code) === '23505') {

            try {

              const { data: dupRow } = await supabase

                .from('searches')

                .select('id, status, created_at')

                .ilike('location', cityBase)

                .eq('category', formatCanonicalLabel(categoryBase))

                .order('created_at', { ascending: false })

                .limit(1)

                .maybeSingle()

              if (dupRow?.id) {

                try {

                  await supabase

                    .from('searches')

                    .update({ status: 'pending', created_at: new Date().toISOString() })

                    .eq('id', dupRow.id)

                } catch {

                  // ignore

                }

                return { results: [], status: 'pending', jobId: dupRow.id, searchId: dupRow.id }

              }

            } catch {

              // ignore

            }

          }

          return { results: [], status: 'pending' }

        }



        console.log('[hybrid] NEW JOB CREATED:', (insertData as any).id)

        return { results: [], status: 'pending', jobId: (insertData as any).id }

      } catch (e) {

        console.error('[hybrid] exception:', e)

        return { results: [] }

      }

    }



    const derivedSearchId = (() => {

        try {

          const counts = new Map<string, number>()

          for (const it of Array.isArray(finalResults) ? (finalResults as any[]) : []) {

            const id = typeof (it as any)?.__ckb_search_id === 'string' ? String((it as any).__ckb_search_id) : ''

            if (!id) continue

            counts.set(id, (counts.get(id) || 0) + 1)

          }

          let bestId = ''

          let bestCount = 0

          for (const [id, c] of counts.entries()) {

            if (c > bestCount) {

              bestCount = c

              bestId = id

            }

          }

          if (bestId) return bestId

          const firstRowId = typeof (rows as any)?.[0]?.id === 'string' ? String((rows as any)[0].id) : ''

          return firstRowId || undefined

        } catch {

          return undefined

        }

      })()

    const withContactCount = (finalResults as any[]).filter(hasLeadContact).length
    let derivedSearchIdFinal = derivedSearchId
    let cacheMeta: TextToFilterSearchResponse['cache_meta'] = {
      source: 'db_merged',
      db_raw: mergedCache.rawTotal,
      db_with_contact: mergedCache.withContact,
      jobs_merged: mergedCache.rows.length,
      canonical_job_id: mergedCache.canonicalJobId,
      needs_more_scrape: withContactCount < requestedMaxLeads,
    }

    if (cityBase && categoryBase && withContactCount < requestedMaxLeads) {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        const scrape = await requestIncrementalScrape(supabase, {
          category: formatCanonicalLabel(categoryBase),
          location: formatCanonicalLabel(cityBase),
          maxLeads: requestedMaxLeads,
          userId: user?.id,
          categoryVariants,
          originalQuery: query,
        })
        derivedSearchIdFinal = scrape.jobId
        cacheMeta = {
          ...cacheMeta,
          needs_more_scrape: true,
          canonical_job_id: scrape.jobId,
          db_raw: Math.max(cacheMeta?.db_raw ?? 0, scrape.existingRaw),
          db_with_contact: Math.max(cacheMeta?.db_with_contact ?? 0, scrape.existingWithContact),
        }
      } catch (e) {
        console.log('[hybrid] incremental scrape (partial cache):', e)
      }
    }

    return {

      status: 'completed',

      jobId: derivedSearchIdFinal,

      searchId: derivedSearchIdFinal,

      results: finalResults,

      filters: filtri,

      cache_meta: cacheMeta,

      ai_debug: { ...aiDebug, category_variants: categoryVariants, fallback_city_only: usedFallbackCityOnly },

    }

  } catch (err) {

    console.error('Errore Action:', err)

    return { results: [], filters: {}, ai_debug: null }

  }

}



export type OutreachMode = 'sell_service' | 'mirax_promo'

type WhatsAppPitchInput = {
  nome?: string
  citta?: string
  categoria?: string
  sito?: string
  problems?: string[]
  mode?: OutreachMode
}

// Builds a short, human, channel-appropriate WhatsApp opening message.
// Deterministic — used as a fallback and always safe (never throws).
function buildWhatsAppFallback(input: WhatsAppPitchInput): string {
  const nome = (input.nome || '').trim() || 'la vostra azienda'
  const problems = Array.isArray(input.problems) ? input.problems.filter((p) => typeof p === 'string' && p.trim()) : []
  const hook = problems[0]
    ? `ho notato un dettaglio migliorabile (${problems[0].toLowerCase()})`
    : 'ho dato un\'occhiata alla vostra presenza online'

  if (input.mode === 'mirax_promo') {
    return [
      `Buongiorno, mi rivolgo a ${nome}.`,
      `Aiutiamo aziende come la vostra a trovare nuovi clienti con MIRAX: dati di contatto verificati e analisi delle opportunità.`,
      `Le va di provarlo? Registrandosi su miraxgroup.it riceve 10 lead gratis, senza impegno.`,
    ].join(' ')
  }

  return [
    `Buongiorno, le scrivo riguardo a ${nome}.`,
    `${hook.charAt(0).toUpperCase()}${hook.slice(1)} e credo di poter aiutare a portare più clienti.`,
    `Posso mostrarle in 2 minuti come funziona? Quando ha un momento per sentirci?`,
  ].join(' ')
}

function buildOutreachSystemPrompt(mode: OutreachMode): string {
  const common =
    'Scrivi UN SOLO messaggio di apertura, breve (max 3 frasi, ~400 caratteri), in italiano, tono cortese e diretto, dando del "lei". ' +
    'NIENTE emoji eccessive (al massimo una), NIENTE oggetto email. ' +
    'Aggiungi anche "rationale": UNA frase (max 140 caratteri) che spiega in modo trasparente PERCHÉ hai scelto questo aggancio/approccio. ' +
    'Rispondi SOLO JSON valido: { "message": "...", "rationale": "..." }'
  if (mode === 'mirax_promo') {
    return (
      'Sei un venditore di MIRAX, una piattaforma italiana di lead generation B2B. ' +
      'Contatti aziende per invitarle a provare MIRAX. Aggancia un problema concreto della loro presenza online (se presente), ' +
      'poi invita a registrarsi su miraxgroup.it per ricevere 10 lead gratis senza impegno. ' +
      common
    )
  }
  return (
    'Sei un venditore B2B italiano esperto di cold outreach su WhatsApp. ' +
    'Aggancia un problema concreto rilevato (se presente), poi proponi una breve call. NIENTE link. ' +
    common
  )
}

// Deterministic explanation of the chosen angle — always safe, used as fallback.
function buildOutreachRationale(input: WhatsAppPitchInput, mode: OutreachMode): string {
  const problems = Array.isArray(input.problems) ? input.problems.filter((p) => typeof p === 'string' && p.trim()) : []
  const base = problems[0]
    ? `Aggancio sul problema rilevato: ${problems[0].toLowerCase()}.`
    : 'Nessun problema specifico rilevato: apertura cortese e generica.'
  return mode === 'mirax_promo'
    ? `${base} CTA: registrazione MIRAX con 10 lead gratis.`
    : `${base} CTA: proposta di una breve call.`
}

export async function generateWhatsAppPitchAction(
  input: WhatsAppPitchInput
): Promise<{ message: string; rationale: string }> {
  const mode: OutreachMode = input.mode === 'mirax_promo' ? 'mirax_promo' : 'sell_service'
  const fallback = buildWhatsAppFallback({ ...input, mode })
  const fallbackRationale = buildOutreachRationale(input, mode)
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { message: fallback, rationale: fallbackRationale }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.6,
        max_tokens: 280,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildOutreachSystemPrompt(mode) },
          {
            role: 'user',
            content: JSON.stringify({
              nome: input.nome || '',
              citta: input.citta || '',
              categoria: input.categoria || '',
              sito: input.sito || '',
              problemi_rilevati: Array.isArray(input.problems) ? input.problems.slice(0, 5) : [],
            }),
          },
        ],
      }),
    })
    if (!res.ok) return { message: fallback, rationale: fallbackRationale }
    const json = (await res.json()) as any
    const content = json?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) return { message: fallback, rationale: fallbackRationale }
    const parsed = JSON.parse(content) as any
    const message = typeof parsed?.message === 'string' ? parsed.message.trim() : ''
    const rationale = typeof parsed?.rationale === 'string' ? parsed.rationale.trim() : ''
    return { message: message || fallback, rationale: rationale || fallbackRationale }
  } catch {
    return { message: fallback, rationale: fallbackRationale }
  }
}

export async function generatePitchAction(input: PitchInput): Promise<PitchResult> {

  const safeInput: PitchInput = {

    nome: typeof input?.nome === 'string' ? input.nome : '',

    sito: typeof input?.sito === 'string' ? input.sito : '',

    citta: typeof input?.citta === 'string' ? input.citta : '',

    categoria: typeof input?.categoria === 'string' ? input.categoria : '',

    email: typeof input?.email === 'string' ? input.email : '',

    rating: typeof input?.rating === 'number' ? input.rating : input?.rating == null ? null : Number(input.rating),

    tech_stack: Array.isArray(input?.tech_stack) ? input.tech_stack.filter((v) => typeof v === 'string') : [],

    html_errors: Array.isArray(input?.html_errors) ? input.html_errors.filter((v) => typeof v === 'string') : [],

    page_speed:

      typeof input?.page_speed === 'number' ? input.page_speed : input?.page_speed == null ? null : Number(input.page_speed),

  }



  return openaiPitch(safeInput)

}



export async function expandAndSearch(query: string): Promise<{ subcategories: string[]; results: any[] }> {
  try {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return { subcategories: [], results: [] }
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `Sei un esperto di categorie business italiane. Data una query, estrai la città e genera 8-12 sottocategorie STRETTAMENTE correlate allo STESSO identico settore della query. REGOLA FONDAMENTALE: ogni sottocategoria DEVE essere dello stesso settore/industria della query originale. Se la query è "imprese edili", genera SOLO categorie del settore edilizio/costruzioni. Se la query è "ristoranti", genera SOLO categorie della ristorazione. MAI mischiare settori diversi. Esempi: "comunicazione Milano" → ["agenzie di comunicazione","agenzie PR","uffici stampa","social media agency","agenzie pubblicitarie","studi grafici","copywriter freelance","agenzie digital marketing"]. "imprese edili Milano" → ["imprese edili","imprese di costruzioni","ristrutturazioni edili","imprese di demolizioni","lavori in cartongesso","impermeabilizzazioni","pavimentazioni","lavori stradali","edilizia residenziale","edilizia commerciale"]. "ristoranti Roma" → ["ristoranti","pizzerie","trattorie","osterie","ristoranti di pesce","sushi bar","ristoranti vegetariani","steakhouse"]. "informatica Milano" → ["software house","web agency","assistenza informatica","sviluppo app","consulenza IT","cybersecurity","sistemisti","riparazione computer"]. Restituisci SOLO JSON valido: { "city": "...", "subcategories": ["..."] }` },
          { role: 'user', content: String(query || '') }
        ]
      })
    })
    if (!res.ok) return { subcategories: [], results: [] }
    const json = await res.json() as any
    const parsed = JSON.parse((json?.choices?.[0]?.message?.content ?? '{}').replace(/```json|```/g, '').trim())
    const city = typeof parsed?.city === 'string' ? parsed.city.trim() : ''
    const rawSubs: string[] = Array.isArray(parsed?.subcategories)
      ? parsed.subcategories
          .filter((v: any) => typeof v === 'string')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : []

    if (!city || rawSubs.length === 0) return { subcategories: [], results: [] }

    const qNorm = String(query || '').toLowerCase()
    const isItQuery = /\b(informatic|tecnolog|tech\b|it\b|software|developer|svilupp|programmat|cyber|cloud|saas|web\s+app|app\s+svilupp|assistenza\s+informatica)\b/i.test(qNorm)

    const normalizeSub = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
    const GENERIC_SUB_RE = /^(aziende|attività|negozi|servizi|professionisti|soluzioni|fornitori|commerciali|shop|store)$/i
    const IT_SUB_RE = /\b(informatic|tecnolog|tech\b|it\b|software|developer|svilupp|programmat|web\s+agency|software\s+house|assistenza\s+informatica|consulenza\s+it|cyber|cybersecurity|cloud|saas|sistemist|network|hardware|computer|riparaz)\b/i

    let subcategories = rawSubs
      .map((s) => s.trim())
      .filter((s) => {
        const ns = normalizeSub(s)
        if (!ns) return false
        if (ns.length < 3) return false
        if (GENERIC_SUB_RE.test(ns)) return false
        return true
      })

    if (isItQuery) {
      const itOnly = subcategories.filter((s) => IT_SUB_RE.test(normalizeSub(s)))
      if (itOnly.length > 0) subcategories = itOnly
    }

    if (subcategories.length === 0) return { subcategories: [], results: [] }

    const searches = await Promise.all(
      subcategories
        .slice(0, 10)
        .map((sub) =>
          textToFilterSearchActionExpanded(`${sub} ${city}`)
            .then((r) => (Array.isArray(r?.results) ? (r.results as any[]) : []))
            .catch(() => [])
        )
    )
    const seen = new Set<string>(); const merged: any[] = []
    for (const batch of searches) for (const item of batch) { const key = item?.sito || item?.nome || JSON.stringify(item); if (!seen.has(key)) { seen.add(key); merged.push(item) } }
    return { subcategories, results: merged }
  } catch { return { subcategories: [], results: [] } }
}



export async function analyzeSiteAction(url: string): Promise<{ success: boolean; lead: any }> {
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://116.203.137.39:8002'
    const res = await fetch(`${backendUrl}/audit-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    })
    if (!res.ok) return { success: false, lead: null }
    const lead = await res.json()
    return { success: true, lead }
  } catch {
    return { success: false, lead: null }
  }
}
