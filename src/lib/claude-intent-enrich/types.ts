/** Risultato enrichment Claude — solo ciò che l'utente ha chiesto nella query. */
export type ClaudeLeadEnrichment = {
  matches_request: boolean
  confidence: number
  summary: string
  evidence: Array<{ label: string; value: string; url?: string }>
  checked_at: string
  model?: string
}

export function readClaudeEnrichment(lead: Record<string, unknown>): ClaudeLeadEnrichment | null {
  const raw = lead.claude_enrichment
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const summary = typeof o.summary === 'string' ? o.summary.trim() : ''
  if (!summary) return null
  return {
    matches_request: o.matches_request === true,
    confidence: typeof o.confidence === 'number' ? o.confidence : 0,
    summary,
    evidence: Array.isArray(o.evidence)
      ? o.evidence
          .filter((e) => e && typeof e === 'object')
          .map((e) => {
            const ev = e as Record<string, unknown>
            return {
              label: String(ev.label || 'Info'),
              value: String(ev.value || ''),
              url: typeof ev.url === 'string' ? ev.url : undefined,
            }
          })
          .slice(0, 5)
      : [],
    checked_at: typeof o.checked_at === 'string' ? o.checked_at : new Date().toISOString(),
    model: typeof o.model === 'string' ? o.model : undefined,
  }
}
