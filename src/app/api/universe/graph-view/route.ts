/**
 * GET /api/universe/graph-view?city=Taormina&entity_id=...
 * Nodi + archi per canvas visuale.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/server'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import { buildCityGraphView, buildEntityGraphView } from '@/lib/universe/build-graph-view'

export async function GET(req: NextRequest) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const sp = req.nextUrl.searchParams
    const entityId = sp.get('entity_id')?.trim() || ''
    const city = sp.get('city')?.trim() || undefined
    const name = sp.get('name')?.trim() || undefined
    const limit = Math.min(80, Math.max(5, Number(sp.get('limit')) || 40))

    const sb = createServiceRoleClient()
    const graph = entityId
      ? await buildEntityGraphView(sb, entityId, 2)
      : await buildCityGraphView(sb, { city, name_contains: name, limit })

    return NextResponse.json({ ok: true, ...graph })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Errore graph view'
    console.error('[universe/graph-view]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
