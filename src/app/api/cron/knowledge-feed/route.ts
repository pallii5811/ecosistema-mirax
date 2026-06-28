import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { verifyCronBearer } from '@/lib/cron-auth'
import { feedKnowledgeForUser } from '@/lib/knowledge-service'

/**
 * GET/POST /api/cron/knowledge-feed
 * Alimenta knowledge_objects da pipeline vinta, outreach interessato, stats ambienti.
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

  const maxUsers = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('max_users')) || 20))

  const { data: pipelineUsers } = await supabase
    .from('lead_pipeline')
    .select('user_id')
    .limit(500)

  const userIds = Array.from(
    new Set((pipelineUsers ?? []).map((r) => String((r as any).user_id ?? '')).filter(Boolean)),
  ).slice(0, maxUsers)

  let inserted = 0
  let skipped = 0
  let errors = 0

  for (const userId of userIds) {
    const r = await feedKnowledgeForUser(supabase, userId)
    inserted += r.inserted
    skipped += r.skipped
    errors += r.errors
  }

  return NextResponse.json({
    ok: true,
    users: userIds.length,
    inserted,
    skipped,
    errors,
  })
}

export async function GET(req: NextRequest) {
  return handler(req)
}

export async function POST(req: NextRequest) {
  return handler(req)
}
