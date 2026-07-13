import type { SignalIntentSpec } from '@/lib/signal-intent/types'
import type { ClaudeLeadEnrichment } from '@/lib/claude-intent-enrich/types'

/**
 * Retired compatibility surface. Per-lead UI enrichment used to issue
 * unmetered provider calls. The worker evidence pipeline is now the sole
 * governed implementation; callers receive no synthetic enrichment here.
 */
export async function enrichLeadWithClaude(
  lead: Record<string, unknown>,
  userQuery: string,
  intent: SignalIntentSpec,
): Promise<ClaudeLeadEnrichment | null> {
  void lead
  void userQuery
  void intent
  return null
}

export async function enrichLeadsBatchWithClaude(
  leads: Record<string, unknown>[],
  userQuery: string,
  intent: SignalIntentSpec,
  maxLeads = 20,
): Promise<Record<string, unknown>[]> {
  void userQuery
  void intent
  return leads.slice(0, Math.max(0, maxLeads))
}
