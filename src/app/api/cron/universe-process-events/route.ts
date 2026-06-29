/**
 * GET/POST /api/cron/universe-process-events
 * Fase 8 — consumer batch universe_events (marca processed).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { verifyCronBearer } from '@/lib/cron-auth'
import { processUniverseEventBatch } from '@/lib/universe/event-consumer'

async function handler(req: NextRequest) {
  const auth = verifyCronBearer(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: auth.status })
  }

  if (process.env.UNIVERSE_ENABLED !== '1') {
    return NextResponse.json({ ok: true, skipped: true, reason: 'UNIVERSE_ENABLED=0' })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ ok: false, error: 'Supabase env mancante' }, { status: 500 })
  }

  const supabase = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50))

  try {
    const result = await processUniverseEventBatch(supabase, limit)
    return NextResponse.json({ ok: true, ...result })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'process failed'
    if (/universe_events|does not exist/i.test(message)) {
      return NextResponse.json({ ok: true, skipped: true, tableMissing: true })
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handler(req)
}

export async function POST(req: NextRequest) {
  return handler(req)
}
