import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { verifyCronBearer } from '@/lib/cron-auth'
import { processMiraxEvents, type PendingMiraxEvent } from '@/lib/events/consumer'

const BATCH_SIZE = 80

/**
 * GET/POST /api/cron/process-events
 * Consumer event bus EDAT: alert in-app + webhook Zapier/Make.
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

  const { data: events, error } = await supabase
    .from('mirax_events')
    .select('id, user_id, event_type, payload, attempts')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (error) {
    if (/relation .* does not exist|mirax_events/i.test(error.message)) {
      return NextResponse.json({ ok: true, processed: 0, failed: 0, tableMissing: true })
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  if (!events || events.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, failed: 0 })
  }

  const result = await processMiraxEvents(supabase, events as PendingMiraxEvent[])

  return NextResponse.json({
    ok: true,
    fetched: events.length,
    ...result,
  })
}

export async function GET(req: NextRequest) {
  return handler(req)
}

export async function POST(req: NextRequest) {
  return handler(req)
}
