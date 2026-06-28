/**
 * CKBase-lite — embedding deterministico 384d (no API esterna).
 */

export const KNOWLEDGE_EMBEDDING_DIM = 384

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9àèéìòù]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
}

function hashToken(token: string): number {
  let h = 2166136261
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Bag-of-words hashed embedding, L2-normalized. */
export function liteTextEmbedding(text: string, dim = KNOWLEDGE_EMBEDDING_DIM): number[] {
  const vec = new Array(dim).fill(0)
  const tokens = tokenize(text)
  if (tokens.length === 0) return vec

  for (const token of tokens) {
    const h = hashToken(token)
    const idx = h % dim
    const sign = (h & 1) === 0 ? 1 : -1
    vec[idx] += sign * (1 + (token.length % 5) * 0.1)
  }

  let norm = 0
  for (const v of vec) norm += v * v
  norm = Math.sqrt(norm) || 1
  return vec.map((v) => v / norm)
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom > 0 ? dot / denom : 0
}

export function embeddingToPgVector(values: number[]): string {
  return `[${values.map((v) => Number(v.toFixed(6))).join(',')}]`
}
