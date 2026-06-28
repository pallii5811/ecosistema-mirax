/**
 * Insights Agent — PKI + knowledge retrieval per Sales Coach.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadInsightsSnapshot } from '@/lib/insights-data'
import { buildKnowledgeDocument } from '@/lib/knowledge-object'
import { cosineSimilarity, liteTextEmbedding } from '@/lib/knowledge-embeddings'

export type InsightsAgentInput = {
  userId: string
  knowledgeQuery?: string
  knowledgeLimit?: number
}

export type KnowledgeHit = {
  id: string
  title: string
  object_type: string
  confidence: number
  similarity: number
}

export type InsightsAgentOutput = {
  summary: Record<string, unknown>
  pkiScore: number
  pkiGrade: string
  closurePatterns: Array<{ label: string; liftPts: number }>
  knowledgeHits: KnowledgeHit[]
}

async function searchKnowledge(
  supabase: SupabaseClient,
  userId: string,
  query: string,
  limit: number,
): Promise<KnowledgeHit[]> {
  const queryVec = liteTextEmbedding(buildKnowledgeDocument(query))

  const { data } = await supabase
    .from('knowledge_objects')
    .select('id, title, object_type, confidence, embedding')
    .eq('user_id', userId)
    .limit(120)

  return (data ?? [])
    .map((row) => {
      let emb: number[] = []
      if (Array.isArray(row.embedding)) emb = row.embedding
      const similarity = emb.length > 0 ? cosineSimilarity(queryVec, emb) : 0
      return {
        id: String(row.id),
        title: String(row.title ?? ''),
        object_type: String(row.object_type ?? ''),
        confidence: Number(row.confidence) || 0,
        similarity,
      }
    })
    .filter((r) => r.similarity > 0.15)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}

export async function runInsightsAgent(
  supabase: SupabaseClient,
  input: InsightsAgentInput,
): Promise<InsightsAgentOutput> {
  const snapshot = await loadInsightsSnapshot(supabase, input.userId)
  const { pipeline, pki, closurePatterns } = snapshot

  const { data: pipelineRows } = await supabase
    .from('lead_pipeline')
    .select('stage, deal_value, lead_category')
    .eq('user_id', input.userId)
    .limit(500)

  const rows = Array.isArray(pipelineRows) ? pipelineRows : []
  const catMap = new Map<string, { won: number; total: number; revenue: number }>()
  const stageDistribution: Record<string, number> = {}

  for (const p of rows as Array<{ stage?: string; deal_value?: number; lead_category?: string }>) {
    const cat = (typeof p.lead_category === 'string' && p.lead_category.trim()) || 'Altro'
    const cur = catMap.get(cat) || { won: 0, total: 0, revenue: 0 }
    cur.total++
    if (p.stage === 'vinto') {
      cur.won++
      cur.revenue += Number(p.deal_value) || 0
    }
    catMap.set(cat, cur)
    const st = String(p.stage || 'nuovo')
    stageDistribution[st] = (stageDistribution[st] || 0) + 1
  }

  const bestCats = Array.from(catMap.entries())
    .map(([cat, d]) => ({ cat, ...d }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 3)

  const topCategory = bestCats[0]?.cat || ''
  const topCategoryRevenue = bestCats[0]?.revenue || 0

  let knowledgeHits: KnowledgeHit[] = []
  const q = String(input.knowledgeQuery ?? '').trim()
  if (q.length >= 3) {
    try {
      knowledgeHits = await searchKnowledge(supabase, input.userId, q, input.knowledgeLimit ?? 5)
    } catch {
      knowledgeHits = []
    }
  }

  const summary: Record<string, unknown> = {
    total: pipeline.total,
    active: pipeline.active,
    won: pipeline.won,
    lost: pipeline.lost,
    totalRevenue: pipeline.totalRevenue,
    pipelineValue: pipeline.pipelineValue,
    avgDealSize: pipeline.avgDealSize,
    winRate: pipeline.winRate,
    stagnantCount: pipeline.stagnant,
    avgScore: pipeline.avgScore,
    bestCategories: bestCats,
    topCategory,
    topCategoryRevenue,
    stageDistribution,
    outreach: snapshot.outreach,
    knowledgeCount: snapshot.knowledge.count,
    environmentCount: snapshot.environments.count,
    pki: {
      score: pki.score,
      grade: pki.grade,
      components: pki.components,
      topLiftPattern: pki.top_lift_pattern?.label ?? null,
    },
    closure_patterns: closurePatterns.slice(0, 3).map((p) => ({
      label: p.label,
      liftPts: p.liftPts,
      segmentWinRate: p.segmentWinRate,
    })),
    knowledge_hits: knowledgeHits.map((k) => ({
      title: k.title,
      type: k.object_type,
      similarity: Math.round(k.similarity * 100) / 100,
    })),
  }

  return {
    summary,
    pkiScore: pki.score,
    pkiGrade: pki.grade,
    closurePatterns: closurePatterns.slice(0, 5).map((p) => ({ label: p.label, liftPts: p.liftPts })),
    knowledgeHits,
  }
}
