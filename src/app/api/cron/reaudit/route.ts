import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { verifyCronBearer } from '@/lib/cron-auth'
import { emitMiraxEvent } from '@/lib/events/emit'
import {
  DEFAULT_REAUDIT_BATCH,
  applyReauditToLead,
  auditWebsiteForReaudit,
  leadNeedsReaudit,
  parseSearchResults,
  pickReauditBatch,
  type ReauditCandidate,
} from '@/lib/reaudit'

/**
 * GET/POST /api/cron/reaudit
 * Re-audit periodico lead obsoleti (freshness < 40 / 30 giorni).
 * Schedule consigliato: giornaliero (vercel.json).
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

  const maxParam = req.nextUrl.searchParams.get('max')
  const maxLeads = Math.min(50, Math.max(1, Number(maxParam) || DEFAULT_REAUDIT_BATCH))

  const supabase = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Priorità: lead monitorati dall'utente
  const monitorPriority = new Set<string>()
  const monitorUserByKey = new Map<string, string>()
  const { data: monitors } = await supabase
    .from('lead_monitors')
    .select('user_id, search_id, lead_index')

  for (const m of monitors ?? []) {
    const key = `${(m as any).search_id}:${(m as any).lead_index}`
    monitorPriority.add(key)
    if ((m as any).user_id) monitorUserByKey.set(key, (m as any).user_id)
  }

  const { data: searches, error: searchErr } = await supabase
    .from('searches')
    .select('id, user_id, results')
    .eq('status', 'completed')
    .not('results', 'is', null)
    .order('created_at', { ascending: false })
    .limit(80)

  if (searchErr) {
    return NextResponse.json({ ok: false, error: searchErr.message }, { status: 500 })
  }

  const candidates: ReauditCandidate[] = []
  for (const row of searches ?? []) {
    const searchId = String((row as any).id ?? '')
    const userId = (row as any).user_id as string | null
    const results = parseSearchResults((row as any).results)
    results.forEach((lead, leadIndex) => {
      if (!leadNeedsReaudit(lead)) return
      const key = `${searchId}:${leadIndex}`
      candidates.push({
        searchId,
        leadIndex,
        lead,
        userId: monitorUserByKey.get(key) ?? userId,
        priority: monitorPriority.has(key) ? 10 : 0,
      })
    })
  }

  const batch = pickReauditBatch(candidates, maxLeads)
  let reaudited = 0
  let changesDetected = 0
  const touchedSearches = new Map<string, Record<string, unknown>[]>()

  for (const item of batch) {
    const site = String(item.lead.sito ?? item.lead.website ?? '').trim()
    const audit = await auditWebsiteForReaudit(site)
    const { updated, changes, reaudited: did } = applyReauditToLead(item.lead, audit)
    if (!did) continue

    reaudited++
    if (changes.length > 0) changesDetected++

    const arr = touchedSearches.get(item.searchId) ?? parseSearchResults(
      (searches ?? []).find((s) => (s as any).id === item.searchId)?.results,
    )
    arr[item.leadIndex] = updated
    touchedSearches.set(item.searchId, arr)

    const leadName = String(updated.azienda ?? updated.nome ?? item.lead.azienda ?? 'Lead')

    if (item.userId) {
      await emitMiraxEvent(supabase, {
        userId: item.userId,
        eventType: 'lead.reaudited',
        payload: {
          search_id: item.searchId,
          lead_index: item.leadIndex,
          lead_name: leadName,
          website: site,
        },
      })

      if (changes.length > 0) {
        await emitMiraxEvent(supabase, {
          userId: item.userId,
          eventType: 'lead.change_detected',
          payload: {
            search_id: item.searchId,
            lead_index: item.leadIndex,
            lead_name: leadName,
            website: site,
            changes,
          },
        })
      }

      // Aggiorna snapshot monitor
      const key = `${item.searchId}:${item.leadIndex}`
      if (monitorPriority.has(key)) {
        await supabase
          .from('lead_monitors')
          .update({
            last_snapshot: updated,
            last_checked_at: new Date().toISOString(),
          })
          .eq('search_id', item.searchId)
          .eq('lead_index', item.leadIndex)
      }
    }
  }

  for (const [searchId, results] of touchedSearches.entries()) {
    await supabase.from('searches').update({ results }).eq('id', searchId)
  }

  return NextResponse.json({
    ok: true,
    candidates: candidates.length,
    batch: batch.length,
    reaudited,
    changesDetected,
    searchesUpdated: touchedSearches.size,
  })
}

export async function GET(req: NextRequest) {
  return handler(req)
}

export async function POST(req: NextRequest) {
  return handler(req)
}
