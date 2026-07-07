/**
 * POST /api/universe/entities/search
 * Search entities in the knowledge graph.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { listEntities, getLatestObservation } from '@/lib/universe'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import { universeClientError } from '@/lib/universe/errors'
import type { EntityType, UniverseEntity } from '@/lib/universe'

export async function POST(req: NextRequest) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const {
      entity_type,
      city,
      country,
      name_contains,
      observations,
      limit = 50,
      offset = 0,
      with_latest_observations,
    } = body || {}

    const sb = await createClient()

    const entities = await listEntities(sb, {
      entity_type: entity_type as EntityType,
      city,
      country,
      name_contains,
      limit,
      offset,
    })

    let enriched: Array<UniverseEntity & { latest_observations?: Record<string, unknown> }> = entities

    if (with_latest_observations && entities.length > 0) {
      enriched = await Promise.all(
        entities.map(async (entity) => {
          const attrs = Array.isArray(with_latest_observations)
            ? with_latest_observations
            : ['meta_pixel', 'google_tag_manager', 'rating', 'employees', 'revenue']
          const latest: Record<string, unknown> = {}
          for (const attr of attrs) {
            const obs = await getLatestObservation(sb, entity.id, attr)
            if (obs) latest[attr] = obs.value
          }
          return { ...entity, latest_observations: latest }
        })
      )
    }

    return NextResponse.json({ entities: enriched, count: entities.length })
  } catch (e: unknown) {
    const { message, status } = universeClientError(e, 'entities/search')
    return NextResponse.json({ error: message }, { status })
  }
}
