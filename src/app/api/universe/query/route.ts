/**
 * POST /api/universe/query
 * Structured query on the knowledge graph (foundation for Agentic Search).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/server'
import { executeUniverseQuery } from '@/lib/universe'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import type { UniverseQuery } from '@/lib/universe'

export async function POST(req: NextRequest) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const query = body as UniverseQuery

    if (!query.entity_type) {
      return NextResponse.json({ error: 'entity_type obbligatorio' }, { status: 400 })
    }

    const sb = createServiceRoleClient()
    const result = await executeUniverseQuery(sb, query)

    return NextResponse.json(result)
  } catch (e: any) {
    console.error('[universe/query] error:', e)
    return NextResponse.json({ error: e.message || 'Errore query grafo' }, { status: 500 })
  }
}
