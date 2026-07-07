/**
 * Payload standard per job searches (worker legge `zone` come cap max lead).
 */

export const MAX_LEADS_PER_SEARCH = 10000

export const AGENTIC_NICHE_USER_MESSAGE =
  "Ricerca di nicchia rilevata: MIRAX attiva l'Agente AI per scoprire lead B2B sul web in tempo reale."

export function buildAgenticExhaustionMessage(found: number, requested: number): string {
  return `Ricerca esaurita: trovati ${found} lead su ${requested} richiesti. Il web non offre altri risultati validi per questa nicchia.`
}

export type PendingSearchInsert = {
  category: string
  location: string
  status: 'pending'
  results: unknown[]
  created_at: string
  user_id?: string
  zone?: string
  intent?: Record<string, unknown> | null
}

export function encodeMaxLeadsZone(maxLeads: unknown): string | undefined {
  const n = Number(maxLeads)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return String(Math.min(MAX_LEADS_PER_SEARCH, Math.max(5, Math.round(n))))
}

export function clampSearchMaxLeads(maxLeads: unknown, credits?: number): number {
  const n = Math.round(Number(maxLeads) || 10)
  const capped = Math.min(MAX_LEADS_PER_SEARCH, Math.max(5, n))
  if (typeof credits === 'number' && credits > 0) return Math.min(capped, credits)
  return capped
}

export function buildPendingSearchInsert(opts: {
  category: string
  location: string
  userId?: string | null
  maxLeads?: number | null
  intent?: Record<string, unknown> | null
}): PendingSearchInsert {
  const row: PendingSearchInsert = {
    category: opts.category.trim(),
    location: opts.location.trim(),
    status: 'pending',
    results: [],
    created_at: new Date().toISOString(),
  }
  if (opts.userId) row.user_id = opts.userId
  const zone = encodeMaxLeadsZone(opts.maxLeads)
  if (zone) row.zone = zone
  if (opts.intent) row.intent = opts.intent
  return row
}
