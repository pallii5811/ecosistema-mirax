import type { SignalIntentSpec } from '@/lib/signal-intent/types'
import { readClaudeEnrichment } from '@/lib/claude-intent-enrich/types'

export type IntentCellData = {
  status: 'match' | 'pending' | 'no_match' | 'idle'
  label: string
  className: string
  detail?: string
}

/** Colonna "Dato richiesto" — priorità Claude, fallback legacy hiring. */
export function intentCellForLead(
  lead: Record<string, unknown>,
  intent: SignalIntentSpec | null | undefined,
): IntentCellData | null {
  if (!intent?.required_signals?.length && !intent?.reasoning) return null

  const claude = readClaudeEnrichment(lead)
  if (claude) {
    if (claude.matches_request) {
      return {
        status: 'match',
        label: claude.summary,
        className: 'bg-violet-600 text-white border-violet-700',
        detail: claude.evidence[0]?.value,
      }
    }
    return {
      status: 'no_match',
      label: claude.summary,
      className: 'bg-zinc-100 text-zinc-600 border-zinc-300',
      detail: claude.evidence[0]?.value,
    }
  }

  if (!lead.claude_enrichment && intent.required_signals.length) {
    return {
      status: 'pending',
      label: 'Claude analizza…',
      className: 'bg-amber-100 text-amber-900 border-amber-300',
    }
  }

  return null
}

export function showIntentDataColumn(intent: SignalIntentSpec | null | undefined): boolean {
  return Boolean(intent?.required_signals?.length || intent?.reasoning)
}

export function intentColumnTitle(intent: SignalIntentSpec | null | undefined): string {
  if (intent?.required_signals?.includes('hiring')) return 'Assunzioni'
  if (intent?.required_signals?.includes('tender_won')) return 'Gare'
  if (intent?.required_signals?.includes('sector_investment')) return 'Investimenti'
  return 'Dato richiesto'
}
