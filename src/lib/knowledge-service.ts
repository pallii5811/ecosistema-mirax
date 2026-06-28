import type { SupabaseClient } from '@supabase/supabase-js'
import type { EnvironmentStats } from '@/types/environments'
import {
  draftsFromEnvironmentStats,
  draftsFromInterestedOutreach,
  draftsFromWonDeals,
  withEmbedding,
} from '@/lib/knowledge-feed'
import {
  buildKnowledgeDocument,
  clampConfidence,
  sanitizeKnowledgeSource,
  sanitizeKnowledgeType,
} from '@/lib/knowledge-object'
import { embeddingToPgVector, liteTextEmbedding } from '@/lib/knowledge-embeddings'

export async function upsertKnowledgeDraft(
  supabase: SupabaseClient,
  userId: string,
  draft: ReturnType<typeof withEmbedding>,
): Promise<'inserted' | 'skipped' | 'error'> {
  const { data: existing } = await supabase
    .from('knowledge_objects')
    .select('id')
    .eq('user_id', userId)
    .eq('object_type', draft.object_type)
    .eq('title', draft.title)
    .maybeSingle()

  if (existing?.id) return 'skipped'

  const { error } = await supabase.from('knowledge_objects').insert({
    user_id: userId,
    environment_id: draft.environment_id ?? null,
    object_type: draft.object_type,
    title: draft.title,
    body: draft.body,
    payload: draft.payload ?? {},
    source: draft.source,
    confidence: draft.confidence,
    embedding: draft.embedding,
    updated_at: new Date().toISOString(),
  })

  return error ? 'error' : 'inserted'
}

export async function feedKnowledgeForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ inserted: number; skipped: number; errors: number }> {
  let inserted = 0
  let skipped = 0
  let errors = 0

  const { data: won } = await supabase
    .from('lead_pipeline')
    .select('lead_name, lead_category, lead_city, lead_score, deal_value')
    .eq('user_id', userId)
    .eq('stage', 'vinto')
    .order('updated_at', { ascending: false })
    .limit(30)

  for (const draft of draftsFromWonDeals(won ?? [])) {
    const r = await upsertKnowledgeDraft(supabase, userId, withEmbedding(draft))
    if (r === 'inserted') inserted++
    else if (r === 'skipped') skipped++
    else errors++
  }

  const { data: interested } = await supabase
    .from('outreach_log')
    .select('lead_name, lead_website, channel')
    .eq('user_id', userId)
    .in('status', ['interested', 'replied'])
    .order('created_at', { ascending: false })
    .limit(40)

  for (const draft of draftsFromInterestedOutreach(interested ?? [])) {
    const r = await upsertKnowledgeDraft(supabase, userId, withEmbedding(draft))
    if (r === 'inserted') inserted++
    else if (r === 'skipped') skipped++
    else errors++
  }

  const { data: environments } = await supabase
    .from('environments')
    .select('id, name, stats')
    .eq('user_id', userId)
    .limit(30)

  for (const env of environments ?? []) {
    const stats =
      typeof env.stats === 'object' && env.stats
        ? (env.stats as EnvironmentStats)
        : ({} as EnvironmentStats)
    const drafts = draftsFromEnvironmentStats(env.id as string, String(env.name ?? 'Ambiente'), stats)
    for (const draft of drafts) {
      const r = await upsertKnowledgeDraft(supabase, userId, withEmbedding(draft))
      if (r === 'inserted') inserted++
      else if (r === 'skipped') skipped++
      else errors++
    }
  }

  return { inserted, skipped, errors }
}

export async function createKnowledgeObject(
  supabase: SupabaseClient,
  userId: string,
  input: {
    title: string
    body?: string | null
    object_type?: unknown
    source?: unknown
    confidence?: unknown
    environment_id?: string | null
    payload?: Record<string, unknown>
  },
) {
  const title = String(input.title ?? '').trim().slice(0, 300)
  if (!title) throw new Error('title required')

  const body = input.body ? String(input.body).slice(0, 8000) : null
  const doc = buildKnowledgeDocument(title, body)
  const embedding = embeddingToPgVector(liteTextEmbedding(doc))

  const { data, error } = await supabase
    .from('knowledge_objects')
    .insert({
      user_id: userId,
      environment_id: input.environment_id ?? null,
      object_type: sanitizeKnowledgeType(input.object_type),
      title,
      body,
      payload: input.payload ?? {},
      source: sanitizeKnowledgeSource(input.source),
      confidence: clampConfidence(input.confidence),
      embedding,
    })
    .select('*')
    .single()

  if (error) throw error
  return data
}
