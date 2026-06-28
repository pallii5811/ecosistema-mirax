import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { buildKnowledgeDocument } from '@/lib/knowledge-object'
import { cosineSimilarity, embeddingToPgVector, liteTextEmbedding } from '@/lib/knowledge-embeddings'

/**
 * GET /api/insights/knowledge-search?q=...&environment_id=...
 * Vector search CKBase-lite per Smart Insights (Blocco 6.5).
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const query = String(req.nextUrl.searchParams.get('q') ?? '').trim()
  if (query.length < 2) {
    return NextResponse.json({ error: 'query troppo corta' }, { status: 400 })
  }

  const limit = Math.min(10, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 5))
  const envId = req.nextUrl.searchParams.get('environment_id')
  const queryVec = liteTextEmbedding(buildKnowledgeDocument(query))

  try {
    const { data: rpcData, error: rpcErr } = await supabase.rpc('match_knowledge_objects', {
      query_embedding: embeddingToPgVector(queryVec),
      match_count: limit,
      filter_user_id: user.id,
      filter_environment_id: envId,
    })

    if (!rpcErr && Array.isArray(rpcData)) {
      return NextResponse.json({ results: rpcData, mode: 'pgvector', query })
    }
  } catch {
    /* fallback */
  }

  let q = supabase
    .from('knowledge_objects')
    .select('id, object_type, title, body, confidence, environment_id, embedding')
    .eq('user_id', user.id)
    .limit(200)

  if (envId) q = q.eq('environment_id', envId)

  const { data, error } = await q
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) {
      return NextResponse.json({ results: [], enabled: false, query })
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

  return NextResponse.json({ results: scored, mode: 'fallback', query })
}
