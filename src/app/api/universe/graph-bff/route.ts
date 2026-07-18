/**
 * POST /api/universe/graph-bff
 * BFF Neo4j — unico punto di accesso al grafo dal frontend.
 * Body: { cypher: string, params?: object, mode?: 'READ' | 'WRITE', database?: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import {
  getNeo4jDatabase,
  isNeo4jConfigured,
  Neo4jConfigError,
  runNeo4jQuery,
  type Neo4jAccessMode,
} from '@/lib/universe/neo4j-client'

const MAX_CYPHER_LENGTH = 20_000

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export async function POST(req: NextRequest) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  if (!isNeo4jConfigured()) {
    return NextResponse.json(
      { error: 'Neo4j non configurato su questo ambiente' },
      { status: 503 },
    )
  }

  try {
    const body = await req.json().catch(() => null)
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: 'Body JSON non valido' }, { status: 400 })
    }

    const cypher = typeof body.cypher === 'string' ? body.cypher.trim() : ''
    if (!cypher) {
      return NextResponse.json({ error: 'cypher obbligatorio' }, { status: 400 })
    }
    if (cypher.length > MAX_CYPHER_LENGTH) {
      return NextResponse.json({ error: 'cypher troppo lunga' }, { status: 400 })
    }

    const params = isPlainObject(body.params) ? body.params : {}
    const mode: Neo4jAccessMode = body.mode === 'WRITE' ? 'WRITE' : 'READ'
    const database = typeof body.database === 'string' ? body.database.trim() : undefined

    const result = await runNeo4jQuery({ cypher, params, mode, database: database || getNeo4jDatabase() })

    return NextResponse.json({
      ok: true,
      user_id: auth.userId,
      ...result,
    })
  } catch (e: unknown) {
    if (e instanceof Neo4jConfigError) {
      return NextResponse.json({ error: e.message }, { status: 503 })
    }
    const message = e instanceof Error ? e.message : 'Errore esecuzione query Neo4j'
    console.error('[graph-bff]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET() {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  if (!isNeo4jConfigured()) {
    return NextResponse.json({ ok: false, configured: false, connected: false })
  }

  try {
    const { verifyNeo4jConnectivity } = await import('@/lib/universe/neo4j-client')
    const connected = await verifyNeo4jConnectivity()
    if (!connected) {
      return NextResponse.json({
        ok: false, configured: true, connected: false, writable: false, readable: false,
        database: getNeo4jDatabase(), node_count: null, relationship_count: null,
        last_successful_write: null, last_error: 'connectivity_check_failed',
      })
    }
    const [counts, writeState] = await Promise.all([
      runNeo4jQuery({
        cypher: 'MATCH (n) WITH count(n) AS node_count OPTIONAL MATCH ()-[r]->() RETURN node_count, count(r) AS relationship_count',
        params: {}, mode: 'READ', database: getNeo4jDatabase(),
      }),
      runNeo4jQuery({
        cypher: "OPTIONAL MATCH (h:MiraxGraphHealth {id:'main'}) RETURN h.last_successful_write AS last_successful_write, h.last_error AS last_error",
        params: {}, mode: 'READ', database: getNeo4jDatabase(),
      }),
    ])
    const countRow = counts.records[0] ?? {}
    const stateRow = writeState.records[0] ?? {}
    const lastSuccessfulWrite = stateRow.last_successful_write ?? null
    return NextResponse.json({
      ok: true,
      configured: true,
      connected,
      readable: true,
      writable: Boolean(lastSuccessfulWrite) && !stateRow.last_error,
      database: getNeo4jDatabase(),
      node_count: countRow.node_count ?? 0,
      relationship_count: countRow.relationship_count ?? 0,
      last_successful_write: lastSuccessfulWrite,
      last_error: stateRow.last_error ?? null,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Neo4j unreachable'
    console.error('[graph-bff] health check failed', { database: getNeo4jDatabase(), error: message })
    return NextResponse.json({
      ok: false,
      configured: true,
      connected: false,
      database: getNeo4jDatabase(),
      error: message,
    })
  }
}
