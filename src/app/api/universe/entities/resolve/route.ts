/**
 * GET /api/universe/entities/resolve?domain=...
 * Risolve un lead MIRAX (dominio) → entità nel grafo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import {
  normalizeDomain,
  getEntityByCanonicalId,
  getEntityByAlias,
  getTimeline,
  getRelatedEntities,
  getEvents,
} from '@/lib/universe'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import { universeClientError } from '@/lib/universe/errors'

export async function GET(req: NextRequest) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const raw =
      req.nextUrl.searchParams.get('domain') ??
      req.nextUrl.searchParams.get('website') ??
      req.nextUrl.searchParams.get('sito') ??
      ''
    const domain = normalizeDomain(raw)
    if (!domain) {
      return NextResponse.json({ error: 'domain o website richiesto' }, { status: 400 })
    }

    const sb = await createClient()
    let entity = await getEntityByCanonicalId(sb, domain, 'company')
    if (!entity) entity = await getEntityByAlias(sb, 'domain', domain)

    if (!entity) {
      return NextResponse.json({ entity: null, domain }, { status: 404 })
    }

    const [timeline, related, events] = await Promise.all([
      getTimeline(sb, entity.id),
      getRelatedEntities(sb, entity.id),
      getEvents(sb, { entity_id: entity.id, limit: 20 }),
    ])

    return NextResponse.json({
      entity,
      domain,
      timeline: timeline.slice(0, 12),
      related: related.slice(0, 12),
      events: events.slice(0, 12),
    })
  } catch (e: unknown) {
    const { message, status } = universeClientError(e, 'entities/resolve')
    return NextResponse.json({ error: message }, { status })
  }
}
