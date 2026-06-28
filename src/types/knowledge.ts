export const KNOWLEDGE_OBJECT_TYPES = ['pattern', 'insight', 'correlation', 'closure'] as const
export type KnowledgeObjectType = (typeof KNOWLEDGE_OBJECT_TYPES)[number]

export const KNOWLEDGE_SOURCES = ['manual', 'pipeline', 'outreach', 'environment', 'cron'] as const
export type KnowledgeSource = (typeof KNOWLEDGE_SOURCES)[number]

export type KnowledgeObject = {
  id: string
  user_id: string
  environment_id: string | null
  object_type: KnowledgeObjectType
  title: string
  body: string | null
  payload: Record<string, unknown>
  source: KnowledgeSource
  confidence: number
  created_at: string
  updated_at: string
}

export type KnowledgeSearchResult = KnowledgeObject & {
  similarity?: number
}
