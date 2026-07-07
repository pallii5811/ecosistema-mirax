/**
 * GET /api/universe/timeline/:id
 * Timeline osservazioni per entità (opzionale filtro attributo).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { getTimeline, getEntityById } from '@/lib/universe'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import { universeClientError } from '@/lib/universe/errors'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params
    const attribute = req.nextUrl.searchParams.get('attribute') ?? undefined
    const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 100))

    const sb = await createClient()
    const entity = await getEntityById(sb, id)
    if (!entity) {
      return NextResponse.json({ error: 'Entità non trovata' }, { status: 404 })
    }

    const timeline = await getTimeline(sb, id, attribute)
    return NextResponse.json({
      entity_id: id,
      attribute: attribute ?? null,
      points: timeline.slice(0, limit),
      count: timeline.length,
    })
  } catch (e: unknown) {
    const { message, status } = universeClientError(e, 'timeline/:id')
    return NextResponse.json({ error: message }, { status })
  }
}
