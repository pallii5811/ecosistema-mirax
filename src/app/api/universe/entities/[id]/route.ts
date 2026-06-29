/**
 * GET /api/universe/entities/:id
 * Get entity detail with latest observations and relationships summary.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/server'
import { getEntityById, getTimeline, getRelatedEntities, getEvents } from '@/lib/universe'
import { requireUniverseAuth } from '@/lib/universe/require-auth'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params
    const sb = createServiceRoleClient()

    const entity = await getEntityById(sb, id)
    if (!entity) {
      return NextResponse.json({ error: 'Entità non trovata' }, { status: 404 })
    }

    const timeline = await getTimeline(sb, id)
    const related = await getRelatedEntities(sb, id)
    const events = await getEvents(sb, { entity_id: id, limit: 50 })

    return NextResponse.json({ entity, timeline, related, events })
  } catch (e: any) {
    console.error('[universe/entities/:id] error:', e)
    return NextResponse.json({ error: e.message || 'Errore lettura entità' }, { status: 500 })
  }
}
