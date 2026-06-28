import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { verifyCronBearer } from '@/lib/cron-auth'
import {
  buildCompetitorAlertCopy,
  computeDigitalMaturityFromLead,
  computeGrowthRateFromSignals,
  parseEstimatedRevenue,
  pickStrongCompetitorSignals,
} from '@/lib/competitive/market-metrics'
import { buildIntentScoreBreakdown } from '@/lib/scoring/intent-score-core'
import type { CoreScorableSignal } from '@/lib/scoring/intent-score-core'

const BACKEND_URL = process.env.BACKEND_URL || 'http://116.203.137.39:8002'
const MAX_PER_RUN = 12
const SCAN_TIMEOUT_MS = 45_000

type CompetitorRow = {
  id: string
  user_id: string
  name: string
  website: string | null
  city: string | null
  category: string | null
  tracked_signals: string[] | null
  signal_snapshot: unknown
  last_signal_type: string | null
}

async function scanViaWorker(competitor: CompetitorRow): Promise<{
  signals: CoreScorableSignal[]
  lead: Record<string, unknown>
} | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/track-competitor-signals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: competitor.name,
        website: competitor.website,
        city: competitor.city,
        category: competitor.category,
        tracked_signals: competitor.tracked_signals,
      }),
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      signals?: CoreScorableSignal[]
      lead?: Record<string, unknown>
    }
    return {
      signals: Array.isArray(data.signals) ? data.signals : [],
      lead: data.lead && typeof data.lead === 'object' ? data.lead : {},
    }
  } catch {
    return null
  }
}

function signalsFromSnapshot(snapshot: unknown): CoreScorableSignal[] {
  if (!Array.isArray(snapshot)) return []
  return snapshot.filter((s) => s && typeof s === 'object') as CoreScorableSignal[]
}

/**
 * GET/POST /api/cron/competitor-signals
 * Scansiona competitor con waterfall worker e genera alert su segnali forti.
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

  const { data: rows, error } = await supabase
    .from('competitors')
    .select('*')
    .order('last_scanned_at', { ascending: true, nullsFirst: true })
    .limit(MAX_PER_RUN)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  let scanned = 0
  let alertsCreated = 0
  const now = new Date().toISOString()

  for (const row of (rows ?? []) as CompetitorRow[]) {
    const scannedResult = await scanViaWorker(row)
    let signals = scannedResult?.signals ?? []
    let leadLike: Record<string, unknown> = scannedResult?.lead ?? {
      name: row.name,
      website: row.website,
      city: row.city,
      category: row.category,
    }

    if (!signals.length) {
      signals = signalsFromSnapshot(row.signal_snapshot)
    }

    leadLike = { ...leadLike, business_signals: signals }
    const intent = buildIntentScoreBreakdown(signals).score
    const digital = computeDigitalMaturityFromLead(leadLike)
    const growth = computeGrowthRateFromSignals(signals)
    const revenue = parseEstimatedRevenue(leadLike)

    const strong = pickStrongCompetitorSignals(signals)
    const top = strong[0]

    await supabase
      .from('competitors')
      .update({
        signal_snapshot: signals,
        digital_maturity: digital,
        growth_rate: growth,
        intent_score: intent,
        estimated_revenue: revenue,
        last_signal_type: top?.type ?? row.last_signal_type,
        last_signal_strength: top?.strength ?? 0,
        last_scanned_at: now,
        updated_at: now,
      })
      .eq('id', row.id)

    scanned++

    if (top && top.type !== row.last_signal_type) {
      const copy = buildCompetitorAlertCopy(row.name, top, row.city)
      const { error: alertErr } = await supabase.from('competitor_alerts').insert({
        user_id: row.user_id,
        competitor_id: row.id,
        signal_type: top.type,
        title: copy.title,
        body: copy.body,
        strength: top.strength,
      })
      if (!alertErr) alertsCreated++
    }
  }

  return NextResponse.json({
    ok: true,
    scanned,
    alertsCreated,
    candidates: rows?.length ?? 0,
  })
}

export async function GET(req: NextRequest) {
  return handler(req)
}

export async function POST(req: NextRequest) {
  return handler(req)
}
