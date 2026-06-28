import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { buildKnowledgeDocument } from '@/lib/knowledge-object'
import { cosineSimilarity, embeddingToPgVector, liteTextEmbedding } from '@/lib/knowledge-embeddings'

/**
 * POST /api/knowledge/search
 * Body: { query: string, environment_id?: string, limit?: number }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const query = String(body?.query ?? '').trim()
  if (query.length < 2) {
    return NextResponse.json({ error: 'query troppo corta' }, { status: 400 })
  }

  const limit = Math.min(20, Math.max(1, Number(body?.limit) || 10))
  const envId = typeof body?.environment_id === 'string' ? body.environment_id : null
  const queryVec = liteTextEmbedding(buildKnowledgeDocument(query))

  // Try RPC match_knowledge_objects (pgvector)
  try {
    const { data: rpcData, error: rpcErr } = await supabase.rpc('match_knowledge_objects', {
      query_embedding: embeddingToPgVector(queryVec),
      match_count: limit,
      filter_user_id: user.id,
      filter_environment_id: envId,
    })

    if (!rpcErr && Array.isArray(rpcData)) {
      return NextResponse.json({ results: rpcData, mode: 'pgvector' })
    }
  } catch {
    /* fallback below */
  }

  // Fallback: in-memory cosine (dev / no extension)
  let q = supabase
    .from('knowledge_objects')
    .select('id, object_type, title, body, payload, source, confidence, environment_id, embedding, created_at')
    .eq('user_id', user.id)
    .limit(200)

  if (envId) q = q.eq('environment_id', envId)

  const { data, error } = await q
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) {
      return NextResponse.json({ results: [], enabled: false })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const scored = (data ?? [])
    .map((row) => {
      let emb: number[] = []
      if (Array.isArray(row.embedding)) emb = row.embedding
      else if (typeof row.embedding === 'string') {
        try {
          emb = JSON.parse(row.embedding.replace(/^\[/, '['))
        } catch {
          emb = []
        }
      }
      const similarity = emb.length > 0 ? cosineSimilarity(queryVec, emb) : 0
      const { embedding: _e, ...rest } = row
      return { ...rest, similarity }
    })
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, limit)

  return NextResponse.json({ results: scored, mode: 'fallback' })
}
