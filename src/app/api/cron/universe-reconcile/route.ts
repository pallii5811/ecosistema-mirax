/**
 * GET/POST /api/cron/universe-reconcile
 * Confronta lead legacy (searches.results) vs entità Universe; opzionale backfill ingest.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { verifyCronBearer } from '@/lib/cron-auth'
import { getEntityByCanonicalId, ingestMiraxLead, normalizeDomain } from '@/lib/universe'

function leadDomain(lead: Record<string, unknown>): string | null {
  const raw = String(lead.sito || lead.website || lead.url || '').trim()
  if (!raw || raw === 'N/D') return null
  try {
    return normalizeDomain(raw.startsWith('http') ? raw : `https://${raw}`)
  } catch {
    return null
  }
}

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

  const maxSearches = Math.min(20, Math.max(1, Number(req.nextUrl.searchParams.get('max_searches')) || 5))
  const samplePerSearch = Math.min(50, Math.max(5, Number(req.nextUrl.searchParams.get('sample')) || 20))
  const backfill = process.env.UNIVERSE_ENABLED === '1' || req.nextUrl.searchParams.get('backfill') === '1'

  const supabase = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: searches, error } = await supabase
    .from('searches')
    .select('id, results, created_at')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(maxSearches)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  let checked = 0
  let missing = 0
  let backfilled = 0
  const missingSamples: Array<{ search_id: string; domain: string; name: string }> = []

  for (const row of searches ?? []) {
    const results = Array.isArray((row as { results?: unknown }).results)
      ? ((row as { results: unknown[] }).results as Record<string, unknown>[])
      : []
    const sample = results.slice(0, samplePerSearch)

    for (const lead of sample) {
      if (!lead || typeof lead !== 'object') continue
      const domain = leadDomain(lead)
      if (!domain) continue
      checked += 1

      const entity = await getEntityByCanonicalId(supabase, domain, 'company')
      if (!entity) {
        missing += 1
        if (missingSamples.length < 10) {
          missingSamples.push({
            search_id: String((row as { id: string }).id),
            domain,
            name: String(lead.azienda || lead.nome || lead.name || domain),
          })
        }
        if (backfill) {
          try {
            await ingestMiraxLead(supabase, lead as Parameters<typeof ingestMiraxLead>[1], 'reconcile_cron')
            backfilled += 1
          } catch (e) {
            console.warn('[universe-reconcile] backfill failed:', domain, e)
          }
        }
      }
    }
  }

  const driftPct = checked > 0 ? Math.round((missing / checked) * 1000) / 10 : 0

  return NextResponse.json({
    ok: true,
    checked,
    missing,
    drift_pct: driftPct,
    backfill_enabled: backfill,
    backfilled,
    missing_samples: missingSamples,
  })
}

export async function GET(req: NextRequest) {
  return handler(req)
}

export async function POST(req: NextRequest) {
  return handler(req)
}
