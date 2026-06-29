import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { verifyCronBearer } from '@/lib/cron-auth'
import { calculateIntentScoreFromLead } from '@/lib/scoring/intent-score'
import { getEntityByAlias, appendEvent } from '@/lib/universe'
import {
  detectWebsiteChange,
  htmlHash,
  normalizeWebsiteUrl,
  textSample,
} from '@/lib/website-diff/detect'

const MIN_INTENT_FOR_MONITOR = 40
const MAX_LEADS_PER_RUN = 24
const FETCH_TIMEOUT_MS = 8000

async function fetchHtml(url: string): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const href = url.startsWith('http') ? url : `https://${url}`
    const res = await fetch(href, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'MIRAX-WebsiteCron/1.0 (+https://ecosistema-mirax.vercel.app)' },
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

type LeadCandidate = {
  userId: string
  leadName: string
  website: string
  intentScore: number
}

/**
 * GET/POST /api/cron/website-change-detect
 * Cron ogni 6h — diff HTML siti lead caldi, INSERT segnale website_changed.
 */
async function handler(req: NextRequest) {
  const auth = verifyCronBearer(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: auth.status })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ ok: false, error: 'Supabase env mancante' }, { status: 500 })
  }

  const supabase = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: searches, error: searchErr } = await supabase
    .from('searches')
    .select('id, user_id, results')
    .eq('status', 'completed')
    .not('results', 'is', null)
    .order('created_at', { ascending: false })
    .limit(60)

  if (searchErr) {
    return NextResponse.json({ ok: false, error: searchErr.message }, { status: 500 })
  }

  const seen = new Set<string>()
  const candidates: LeadCandidate[] = []

  for (const row of searches ?? []) {
    const userId = String((row as { user_id?: string }).user_id || '')
    const results = (row as { results?: unknown }).results
    if (!userId || !Array.isArray(results)) continue

    for (const item of results) {
      if (!item || typeof item !== 'object') continue
      const lead = item as Record<string, unknown>
      const rawSite = String(lead.sito || lead.website || lead.url || '').trim()
      if (!rawSite || rawSite === 'N/D') continue
      const website = normalizeWebsiteUrl(rawSite)
      const key = `${userId}::${website}`
      if (seen.has(key)) continue
      seen.add(key)

      const intentScore = calculateIntentScoreFromLead(lead).score
      if (intentScore < MIN_INTENT_FOR_MONITOR) continue

      candidates.push({
        userId,
        leadName: String(lead.azienda || lead.nome || lead.name || '').trim() || website,
        website: rawSite,
        intentScore,
      })
      if (candidates.length >= MAX_LEADS_PER_RUN) break
    }
    if (candidates.length >= MAX_LEADS_PER_RUN) break
  }

  let checked = 0
  let changed = 0
  let snapshots = 0
  const errors: string[] = []

  for (const c of candidates) {
    checked += 1
    const html = await fetchHtml(c.website)
    if (!html) {
      errors.push(`fetch_fail:${c.website}`)
      continue
    }

    const text = textSample(html)
    const hash = htmlHash(text)
    const normUrl = normalizeWebsiteUrl(c.website)

    const { data: prevRows } = await supabase
      .from('website_snapshots')
      .select('text_sample, html_hash')
      .eq('lead_website', normUrl)
      .order('captured_at', { ascending: false })
      .limit(1)

    const prevText = String(prevRows?.[0]?.text_sample || '')

    if (!prevText) {
      await supabase.from('website_snapshots').upsert(
        {
          lead_website: normUrl,
          html_hash: hash,
          text_sample: text,
        },
        { onConflict: 'lead_website,html_hash', ignoreDuplicates: true },
      )
      snapshots += 1
      continue
    }

    const diff = detectWebsiteChange(prevText, text)
    if (!diff.changed) continue

    changed += 1
    await supabase.from('website_snapshots').insert({
      lead_website: normUrl,
      html_hash: hash,
      text_sample: text,
    })

    const title = 'Sito web modificato significativamente'

    // Universe sidecar: emit website_changed event
    if (process.env.UNIVERSE_ENABLED === '1') {
      Promise.resolve().then(async () => {
        try {
          const company = await getEntityByAlias(supabase, 'domain', normUrl, 'company')
          if (company) {
            await appendEvent(supabase, {
              entity_id: company.id,
              event_type: 'website_changed',
              payload: {
                website: normUrl,
                similarity: diff.similarity,
                summary: diff.summary.slice(0, 180),
              },
              source: 'mirax_diff_engine',
            })
          }
        } catch (e) {
          console.warn('[website-change-detect] Universe event failed:', e)
        }
      }).catch(() => {})
    }

    await supabase.from('lead_business_signals').upsert(
      {
        user_id: c.userId,
        lead_website: normUrl,
        lead_name: c.leadName,
        signal_type: 'website_changed',
        title,
        severity: 'medium',
        confidence: 80,
        evidence: [
          {
            label: 'Diff',
            value: diff.summary.slice(0, 180),
            source: 'mirax_diff_engine',
            url: c.website.startsWith('http') ? c.website : `https://${c.website}`,
          },
          { label: 'Similarity', value: `${Math.round(diff.similarity * 100)}%`, source: 'mirax_diff_engine' },
        ],
        source: 'mirax_diff_engine',
        detected_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,lead_website,signal_type,title', ignoreDuplicates: false },
    )
  }

  return NextResponse.json({
    ok: true,
    checked,
    changed,
    snapshots,
    candidates: candidates.length,
    errors: errors.slice(0, 8),
  })
}

export async function GET(req: NextRequest) {
  return handler(req)
}

export async function POST(req: NextRequest) {
  return handler(req)
}
