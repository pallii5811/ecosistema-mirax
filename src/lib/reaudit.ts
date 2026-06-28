import { computeFreshnessScore } from '@/lib/lead-object'
import { isBlankWebsite, mergeAuditIntoLead } from '@/lib/merge-audit-into-lead'
import { detectLeadChanges } from '@/lib/events/detect-changes'

export const REAUDIT_FRESHNESS_THRESHOLD = 40
export const DEFAULT_REAUDIT_BATCH = 20

const BACKEND_URL = process.env.BACKEND_URL || 'http://116.203.137.39:8002'
const AUDIT_TIMEOUT_MS = 90_000

export type ReauditCandidate = {
  searchId: string
  leadIndex: number
  lead: Record<string, unknown>
  userId?: string | null
  priority: number
}

export function parseSearchResults(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed)
        ? (parsed.filter((x) => x && typeof x === 'object') as Record<string, unknown>[])
        : []
    } catch {
      return []
    }
  }
  return []
}

export function leadFreshnessScore(lead: Record<string, unknown>): number {
  if (typeof lead.freshness_score === 'number' && Number.isFinite(lead.freshness_score)) {
    return Math.round(lead.freshness_score)
  }
  return computeFreshnessScore(lead.last_audited_at)
}

/** Lead con freshness sotto soglia (o mai auditato) e sito valido. */
export function leadNeedsReaudit(lead: Record<string, unknown>, threshold = REAUDIT_FRESHNESS_THRESHOLD): boolean {
  const last = lead.last_audited_at
  const freshness = leadFreshnessScore(lead)
  if (freshness > threshold && last) return false
  const site = String(lead.sito ?? lead.website ?? '').trim()
  return !isBlankWebsite(site)
}

function normalizeUrl(site: string): string {
  const s = site.trim()
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  return `https://${s}`
}

export async function auditWebsiteForReaudit(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/audit-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: normalizeUrl(url) }),
      signal: AbortSignal.timeout(AUDIT_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export type ReauditLeadResult = {
  updated: Record<string, unknown>
  changes: ReturnType<typeof detectLeadChanges>
  reaudited: boolean
}

export function applyReauditToLead(
  lead: Record<string, unknown>,
  audit: Record<string, unknown> | null,
): ReauditLeadResult {
  if (!audit) {
    return { updated: lead, changes: [], reaudited: false }
  }
  const merged = mergeAuditIntoLead(lead, audit)
  const changes = detectLeadChanges(lead, merged)
  if (changes.length > 0) {
    const prev = Array.isArray(lead.change_history) ? lead.change_history : []
    merged.change_history = [...prev, ...changes]
  }
  return { updated: merged, changes, reaudited: true }
}

/** Ordina candidati: monitor attivi prima, poi freshness più bassa. */
export function sortReauditCandidates(candidates: ReauditCandidate[]): ReauditCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    return leadFreshnessScore(a.lead) - leadFreshnessScore(b.lead)
  })
}

export function pickReauditBatch(
  candidates: ReauditCandidate[],
  max: number,
): ReauditCandidate[] {
  return sortReauditCandidates(candidates).slice(0, Math.max(0, max))
}
