import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * GET /api/sequences/runs?status=active|paused|completed|cancelled
 * Lista delle campagne dell'utente con next_scheduled per ogni run.
 *
 * Restituisce anche tableMissing=true se le tabelle non sono ancora attive
 * (così la UI può mostrare un avviso e suggerire la migration).
 */

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ runs: [], error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 100))

  try {
    let query = supabase
      .from('sequence_runs')
      .select('id, sequence_id, sequence_name, recipient_email, recipient_name, sender_email, sender_name, status, steps_total, steps_sent, created_at, completed_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status) query = query.eq('status', status)

    const { data: runs, error } = await query

    if (error) {
      if (/relation .* does not exist/i.test(error.message)) {
        return NextResponse.json({ runs: [], tableMissing: true })
      }
      return NextResponse.json({ runs: [], error: error.message }, { status: 500 })
    }

    const runArr = Array.isArray(runs) ? runs : []
    if (runArr.length === 0) return NextResponse.json({ runs: [] })

    // Fetch next pending email per ogni run (per mostrare scheduled_at)
    const runIds = runArr.map((r: any) => r.id)
    const { data: pendings } = await supabase
      .from('scheduled_emails')
      .select('run_id, scheduled_at, step_index, subject')
      .in('run_id', runIds)
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .order('scheduled_at', { ascending: true })

    const nextByRun = new Map<string, { scheduled_at: string; step_index: number; subject: string }>()
    for (const p of pendings ?? []) {
      const rid = (p as any).run_id
      if (!nextByRun.has(rid)) {
        nextByRun.set(rid, {
          scheduled_at: (p as any).scheduled_at,
          step_index: (p as any).step_index,
          subject: (p as any).subject,
        })
      }
    }

    const enriched = runArr.map((r: any) => ({
      ...r,
      next_scheduled: nextByRun.get(r.id) || null,
    }))

    return NextResponse.json({ runs: enriched })
  } catch (e: any) {
    return NextResponse.json({ runs: [], error: e?.message || 'Errore' }, { status: 500 })
  }
}
