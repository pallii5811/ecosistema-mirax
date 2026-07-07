import { NextRequest } from 'next/server'
import { apiError, apiResponse, authenticateApiKey } from '@/lib/api-auth'
import { createServiceRoleClient } from '@/utils/supabase/server'
import { normalizeLead } from '@/lib/nous/normalizer'
import { fetchMergedLeadsFiltered } from '@/lib/search-leads/read-leads'

export async function GET(req: NextRequest) {
  const { userId, error } = await authenticateApiKey(req)
  if (error || !userId) return apiError(error || 'Unauthorized', 401)

  const { searchParams } = new URL(req.url)

  const categoria = searchParams.get('categoria')
  const citta = searchParams.get('citta')
  const no_pixel = searchParams.get('no_pixel') === 'true'
  const min_score = Number.parseInt(searchParams.get('min_score') || '0', 10)
  const limit = Math.min(Number.parseInt(searchParams.get('limit') || '50', 10) || 50, 200)
  const page = Math.max(Number.parseInt(searchParams.get('page') || '1', 10) || 1, 1)

  if (!categoria || !citta) {
    return apiError('Parameters "categoria" and "citta" are required')
  }

  const supabase = createServiceRoleClient()

  const { data: searches, error: qErr } = await supabase
    .from('searches')
    .select('id, results')
    .eq('user_id', userId)
    .ilike('category', `%${categoria}%`)
    .ilike('location', `%${citta}%`)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(5)

  if (qErr) return apiError('Query failed', 500)

  if (!searches || searches.length === 0) {
    return apiResponse({ data: [], total: 0, page, limit, pages: 0 })
  }

  const searchIds = searches.map((s) => s.id)
  const legacyRows = searches.map((s) => ({
    searchId: s.id,
    results: (s as { results?: unknown }).results,
  }))

  let leads = await fetchMergedLeadsFiltered(
    supabase,
    {
      searchIds,
      noPixel: no_pixel,
      minQueryScore: min_score > 0 ? min_score : undefined,
    },
    legacyRows,
  )

  // Fallback score filter on merged payload when query_score hot col is null
  if (min_score > 0) {
    leads = leads.filter((l) => {
      const hot = Number(l.query_score)
      const legacy = Number(l.score)
      const score = Number.isFinite(hot) ? hot : legacy
      return score >= min_score
    })
  }

  if (no_pixel) {
    leads = leads.filter((l) => {
      const px = l.has_pixel ?? l.meta_pixel
      return px !== true
    })
  }

  const seen = new Set<string>()
  leads = leads.filter((l) => {
    const key = String(
      l.website_domain || l.sito || l.website || l.nome || l.azienda || l.name || '',
    )
      .trim()
      .toLowerCase()
    if (!key) return false
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const total = leads.length
  const pages = Math.ceil(total / limit)
  const paginated = leads.slice((page - 1) * limit, page * limit)

  const clean = paginated.map((l) => {
    if (!l || typeof l !== 'object') return l
    const { __ckb_search_id, ...rest } = l as Record<string, unknown>
    return rest
  })

  return apiResponse({ data: clean, total, page, limit, pages })
}

export async function POST(req: NextRequest) {
  const { userId, error } = await authenticateApiKey(req)
  if (error || !userId) return apiError(error || 'Unauthorized', 401)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return apiError('Invalid body', 400)

  const lead = normalizeLead(body)
  if (!lead.nome && !lead.sito && !lead.email) {
    return apiError('Serve almeno nome, sito o email', 400)
  }

  const supabase = createServiceRoleClient()
  const { data, error: insErr } = await supabase
    .from('leads')
    .insert({
      user_id: userId,
      name: lead.nome || null,
      website: lead.sito || null,
      email: lead.email || null,
      phone: lead.telefono || null,
      city: lead.citta || null,
      category: lead.categoria || null,
      score: lead.score || null,
      raw: body,
    })
    .select('id, name, website, email, created_at')
    .single()

  if (insErr) return apiError(insErr.message || 'Insert failed', 500)

  return apiResponse({ data }, 201)
}
