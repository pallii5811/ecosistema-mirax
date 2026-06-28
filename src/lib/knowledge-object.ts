import {
  KNOWLEDGE_OBJECT_TYPES,
  KNOWLEDGE_SOURCES,
  type KnowledgeObjectType,
  type KnowledgeSource,
} from '../types/knowledge'

export const KNOWLEDGE_EMBEDDING_DIM = 384

export function sanitizeKnowledgeType(v: unknown): KnowledgeObjectType {
  return KNOWLEDGE_OBJECT_TYPES.includes(v as KnowledgeObjectType)
    ? (v as KnowledgeObjectType)
    : 'insight'
}

export function sanitizeKnowledgeSource(v: unknown): KnowledgeSource {
  return KNOWLEDGE_SOURCES.includes(v as KnowledgeSource) ? (v as KnowledgeSource) : 'manual'
}

export function clampConfidence(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0.5
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100))
}

export function buildKnowledgeDocument(title: string, body?: string | null): string {
  return [title.trim(), body?.trim() ?? ''].filter(Boolean).join('\n')
}

export function knowledgeDedupeKey(objectType: string, title: string): string {
  return `${objectType}::${title.trim().toLowerCase()}`
}
