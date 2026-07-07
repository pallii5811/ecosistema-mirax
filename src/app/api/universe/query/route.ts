/**
 * POST /api/universe/query
 * Structured query on the knowledge graph (foundation for Agentic Search).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { executeUniverseQuery } from '@/lib/universe'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import { universeClientError } from '@/lib/universe/errors'
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

    const sb = await createClient()
    const result = await executeUniverseQuery(sb, query)

    return NextResponse.json(result)
  } catch (e: unknown) {
    const { message, status } = universeClientError(e, 'query')
    return NextResponse.json({ error: message }, { status })
  }
}
