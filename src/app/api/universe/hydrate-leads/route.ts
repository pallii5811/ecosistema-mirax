/**
 * POST /api/universe/hydrate-leads
 * Fase 6 — arricchisce lead JSONB legacy con osservazioni dal grafo (read sidecar).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/server'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import { hydrateLeadsFromUniverse, isUniverseReadEnabled } from '@/lib/universe/hydrate-leads'

export async function POST(req: NextRequest) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  if (!isUniverseReadEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'UNIVERSE_READ_ENABLED=0',
      leads: [],
      hydrated_count: 0,
    })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const raw = Array.isArray(body?.leads) ? body.leads : []
    const leads = raw.filter((l: unknown) => l && typeof l === 'object') as Record<string, unknown>[]
    const max = Math.min(100, Math.max(1, Number(body?.max) || 50))

    if (!leads.length) {
      return NextResponse.json({ error: 'leads[] richiesto' }, { status: 400 })
    }

    const sb = createServiceRoleClient()
    const result = await hydrateLeadsFromUniverse(sb, leads, { max })

    return NextResponse.json({
      ok: true,
      hydrated_count: result.hydrated_count,
      total: leads.length,
      leads: result.leads,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Errore hydrate'
    console.error('[universe/hydrate-leads]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
