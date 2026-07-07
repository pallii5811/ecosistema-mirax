/**
 * GET /api/universe/entities/:id
 * Get entity detail with latest observations and relationships summary.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { getEntityById, getTimeline, getRelatedEntities, getEvents } from '@/lib/universe'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import { universeClientError } from '@/lib/universe/errors'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params
    const sb = await createClient()

    const entity = await getEntityById(sb, id)
    if (!entity) {
      return NextResponse.json({ error: 'Entità non trovata' }, { status: 404 })
    }

    const timeline = await getTimeline(sb, id)
    const related = await getRelatedEntities(sb, id)
    const events = await getEvents(sb, { entity_id: id, limit: 50 })

    return NextResponse.json({ entity, timeline, related, events })
  } catch (e: unknown) {
    const { message, status } = universeClientError(e, 'entities/:id')
    return NextResponse.json({ error: message }, { status })
  }
}
