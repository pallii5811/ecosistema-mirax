/**
 * GET /api/universe/events/recent
 * Fase 8 — feed eventi recenti con nomi entità (paginato).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import { getEvents } from '@/lib/universe/event-repository'
import { universeClientError } from '@/lib/universe/errors'

export async function GET(req: NextRequest) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 25))
    const offset = Math.max(0, Number(req.nextUrl.searchParams.get('offset')) || 0)
    const entityId = req.nextUrl.searchParams.get('entity_id')?.trim() || undefined

    const sb = await createClient()
    const events = await getEvents(sb, { entity_id: entityId, limit, offset })

    const entityIds = [
      ...new Set(events.map((e) => e.entity_id).filter((id): id is string => Boolean(id))),
    ]

    const nameById = new Map<string, string>()
    if (entityIds.length) {
      const { data: entities } = await sb
        .from('universe_entities')
        .select('id, name')
        .in('id', entityIds)
      for (const row of entities ?? []) {
        nameById.set(row.id, row.name)
      }
    }

    const enriched = events.map((ev) => ({
      ...ev,
      entity_name: ev.entity_id ? nameById.get(ev.entity_id) ?? null : null,
    }))

    return NextResponse.json({
      ok: true,
      events: enriched,
      count: enriched.length,
      offset,
      limit,
    })
  } catch (e: unknown) {
    const { message, status } = universeClientError(e, 'events/recent')
    return NextResponse.json({ error: message }, { status })
  }
}
