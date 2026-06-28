import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import {
  collectBusinessEventsAsync,
  collectBusinessEventsFromLead,
  miraxSignalToDbRow,
  normalizeLeadName,
  normalizeLeadWebsite,
} from '@/lib/business-events'

function asLead(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const obj = body as Record<string, unknown>
    const lead = obj.lead
    if (lead && typeof lead === 'object' && !Array.isArray(lead)) return lead as Record<string, unknown>
    return obj
  }
  return {}
}

function isMissingTable(message: string | undefined): boolean {
  if (!message) return false
  return /lead_business_signals/i.test(message) && /(does not exist|relation|schema cache|could not find)/i.test(message)
}

/** GET /api/lead/business-events?website=...&name=... — segnali da cache DB o calcolo live */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const website = req.nextUrl.searchParams.get('website')?.trim().toLowerCase() || ''
  const name = req.nextUrl.searchParams.get('name')?.trim() || ''

  if (!website && !name) {
    return NextResponse.json({ error: 'website o name richiesto' }, { status: 400 })
  }

  const svc = createServiceRoleClient()
  let query = svc
    .from('lead_business_signals')
    .select('*')
    .eq('user_id', user.id)
    .order('detected_at', { ascending: false })
    .limit(20)

  if (website) query = query.eq('lead_website', website)

  const { data: cached, error: cacheError } = await query

  if (!cacheError && cached && cached.length > 0) {
    return NextResponse.json({
      signals: cached.map((row) => ({
        id: row.id,
        kind: 'business',
        signalType: row.signal_type,
        title: row.title,
        severity: row.severity,
        confidence: row.confidence,
        reason: row.title,
        evidence: row.evidence,
        detectedAt: row.detected_at,
        source: row.source,
      })),
      fromCache: true,
    })
  }

  if (cacheError && !isMissingTable(cacheError.message)) {
    return NextResponse.json({ error: cacheError.message }, { status: 500 })
  }

  return NextResponse.json({ signals: [], fromCache: false, needsLead: true })
}

/** POST /api/lead/business-events — refresh on-demand (body: { lead, refresh?: boolean }) */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const lead = asLead(body)
  const refresh = Boolean(body && typeof body === 'object' && (body as Record<string, unknown>).refresh)

  const leadWebsite = normalizeLeadWebsite(lead)
  const leadName = normalizeLeadName(lead) || null

  if (!leadWebsite && !leadName) {
    return NextResponse.json({ error: 'Lead non valido: manca sito o nome' }, { status: 400 })
  }

  const signals = refresh ? await collectBusinessEventsAsync(lead) : collectBusinessEventsFromLead(lead)

  const svc = createServiceRoleClient()
  const websiteKey = leadWebsite || `name:${leadName?.toLowerCase() || 'unknown'}`

  if (signals.length > 0) {
    const rows = signals.map((s) => miraxSignalToDbRow(s, user.id, websiteKey, leadName))
    const { error: upsertError } = await svc.from('lead_business_signals').upsert(rows, {
      onConflict: 'user_id,lead_website,signal_type,title',
      ignoreDuplicates: false,
    })

    if (upsertError && !isMissingTable(upsertError.message)) {
      return NextResponse.json({ error: upsertError.message, signals, persisted: false }, { status: 500 })
    }
  }

  return NextResponse.json({
    signals,
    persisted: signals.length > 0,
    refresh,
    count: signals.length,
  })
}
