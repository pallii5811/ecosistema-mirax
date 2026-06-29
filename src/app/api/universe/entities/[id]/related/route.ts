/**
 * POST /api/universe/entities/:id/related
 * Get related entities filtered by relationship type.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/server'
import { getRelatedEntities, getSubgraph } from '@/lib/universe'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import type { RelationshipType } from '@/lib/universe'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const { relationship_type, depth = 1 } = body || {}

    const sb = createServiceRoleClient()

    if (depth > 1) {
      const graph = await getSubgraph(sb, id, depth)
      return NextResponse.json(graph)
    }

    const related = await getRelatedEntities(sb, id, relationship_type as RelationshipType)
    return NextResponse.json({ related })
  } catch (e: any) {
    console.error('[universe/entities/:id/related] error:', e)
    return NextResponse.json({ error: e.message || 'Errore lettura relazioni' }, { status: 500 })
  }
}
