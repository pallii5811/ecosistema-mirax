import type { EnvironmentStats } from '../types/environments'
import type { KnowledgeObjectType } from '../types/knowledge'
import {
  buildKnowledgeDocument,
  clampConfidence,
  knowledgeDedupeKey,
} from './knowledge-object'
import { liteTextEmbedding, embeddingToPgVector } from './knowledge-embeddings'

export type KnowledgeInsertDraft = {
  object_type: KnowledgeObjectType
  title: string
  body: string
  payload?: Record<string, unknown>
  source: 'pipeline' | 'outreach' | 'environment' | 'cron'
  confidence: number
  environment_id?: string | null
}

export function draftsFromWonDeals(
  deals: Array<{
    lead_name?: string
    lead_category?: string | null
    lead_city?: string | null
    lead_score?: number
    deal_value?: number
  }>,
): KnowledgeInsertDraft[] {
  const out: KnowledgeInsertDraft[] = []
  for (const d of deals) {
    const name = String(d.lead_name ?? '').trim()
    const cat = String(d.lead_category ?? '').trim()
    const city = String(d.lead_city ?? '').trim()
    if (!name) continue
    const title = `Chiusura: ${name}`
    const body = [
      cat ? `Categoria ${cat}` : '',
      city ? `Zona ${city}` : '',
      typeof d.lead_score === 'number' ? `Score ${d.lead_score}` : '',
      typeof d.deal_value === 'number' && d.deal_value > 0 ? `Valore €${d.deal_value}` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    out.push({
      object_type: 'closure',
      title,
      body: body || 'Deal chiuso in pipeline',
      payload: { lead_name: name, category: cat, city, score: d.lead_score, deal_value: d.deal_value },
      source: 'pipeline',
      confidence: 0.85,
    })
  }
  return out
}

export function draftsFromInterestedOutreach(
  rows: Array<{ lead_name?: string | null; lead_website?: string | null; channel?: string }>,
): KnowledgeInsertDraft[] {
  const out: KnowledgeInsertDraft[] = []
  for (const r of rows) {
    const name = String(r.lead_name ?? r.lead_website ?? '').trim()
    if (!name) continue
    out.push({
      object_type: 'pattern',
      title: `Interesse outreach: ${name}`,
      body: `Risposta positiva via ${r.channel ?? 'canale'}`,
      payload: { lead_name: r.lead_name, website: r.lead_website, channel: r.channel },
      source: 'outreach',
      confidence: 0.7,
    })
  }
  return out
}

export function draftsFromEnvironmentStats(
  environmentId: string,
  envName: string,
  stats: EnvironmentStats,
): KnowledgeInsertDraft[] {
  const out: KnowledgeInsertDraft[] = []

  for (const cat of stats.top_categories ?? []) {
    if (!cat.name || cat.count < 2) continue
    out.push({
      object_type: 'correlation',
      title: `${cat.name} — cluster in ${envName}`,
      body: `${cat.count} lead nella categoria dominante dell'ambiente`,
      payload: { category: cat.name, count: cat.count, environment_id: environmentId },
      source: 'environment',
      confidence: clampConfidence(0.5 + Math.min(0.4, cat.count / 20)),
      environment_id: environmentId,
    })
  }

  for (const city of stats.top_cities ?? []) {
    if (!city.name || city.count < 2) continue
    out.push({
      object_type: 'correlation',
      title: `${city.name} — hub geografico ${envName}`,
      body: `${city.count} lead concentrati in questa città`,
      payload: { city: city.name, count: city.count, environment_id: environmentId },
      source: 'environment',
      confidence: clampConfidence(0.45 + Math.min(0.35, city.count / 25)),
      environment_id: environmentId,
    })
  }

  if (stats.leads_no_pixel > 3) {
    out.push({
      object_type: 'insight',
      title: `Gap Meta Pixel in ${envName}`,
      body: `${stats.leads_no_pixel} lead senza pixel — opportunità ads/recupero`,
      payload: { leads_no_pixel: stats.leads_no_pixel },
      source: 'environment',
      confidence: 0.75,
      environment_id: environmentId,
    })
  }

  return out
}

export function withEmbedding(draft: KnowledgeInsertDraft) {
  const doc = buildKnowledgeDocument(draft.title, draft.body)
  const embedding = liteTextEmbedding(doc)
  return {
    ...draft,
    embedding: embeddingToPgVector(embedding),
    dedupe_key: knowledgeDedupeKey(draft.object_type, draft.title),
  }
}
