/**
 * GET /api/universe/webhooks/deliveries
 * Fase 10 — audit log consegne webhook grafo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import { listWebhookDeliveries } from '@/lib/universe/webhooks'
import { universeClientError } from '@/lib/universe/errors'

export async function GET(req: NextRequest) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 20))

  try {
    const deliveries = await listWebhookDeliveries(supabase, user.id, limit)
    return NextResponse.json({ ok: true, deliveries })
  } catch (e: unknown) {
    const { message, status } = universeClientError(e, 'webhooks/deliveries')
    return NextResponse.json({ error: message }, { status })
  }
}
