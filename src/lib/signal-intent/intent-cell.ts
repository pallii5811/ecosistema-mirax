import type { SignalIntentSpec } from '@/lib/signal-intent/types'
import { readClaudeEnrichment } from '@/lib/claude-intent-enrich/types'
import { hiringCellForLead } from '@/lib/signal-intent/hiring-cell'
import { analyzeMiraxSignals } from '@/lib/mirax-signals'
import { SIGNAL_REQUIREMENT_META } from '@/lib/signal-intent/catalog'
import { isAuditPendingLead } from '@/lib/lead-audit-status'
import {
  findInvestingMarketingBusinessSignal,
  isInvestingMarketingEnrichmentPending,
} from '@/lib/signal-intent/marketing-investment'

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

  const required = intent?.required_signals ?? []

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

  if (required.includes('hiring')) {
    const hiring = hiringCellForLead(lead, intent)
    const summary = analyzeMiraxSignals(lead)
    const hiringSig = summary.businessSignals.find((s) => s.signalType === 'hiring')
    const evidenceLine =
      hiringSig?.evidence?.map((e) => `${e.label}: ${e.value}`).join(' · ') ||
      hiring?.jobTitles?.join(' · ') ||
      hiringSig?.reason ||
      undefined

    if (hiring?.status === 'confirmed') {
      const role =
        intent.hiring_roles?.length > 0
          ? intent.hiring_roles.join(', ')
          : 'commerciale'
      return {
        status: 'match',
        label: `Assume ${role}`,
        className: 'bg-violet-600 text-white border-violet-700',
        detail: evidenceLine || hiring.label,
      }
    }
    if (hiring?.status === 'pending' || !lead.business_events_external_at) {
      return {
        status: 'pending',
        label: 'Verifica assunzioni…',
        className: 'bg-amber-100 text-amber-900 border-amber-300',
        detail: 'Controllo sito e fonti lavoro',
      }
    }
    if (hiring?.status === 'none') {
      return {
        status: 'no_match',
        label: 'Nessuna assunzione rilevata',
        className: 'bg-zinc-100 text-zinc-600 border-zinc-300',
      }
    }
  }

  if (required.includes('investing_marketing')) {
    const marketingSig = findInvestingMarketingBusinessSignal(lead)
    if (marketingSig) {
      const evidenceLine =
        marketingSig.evidence.map((e) => `${e.label}: ${e.value}`).join(' · ') || marketingSig.reason
      return {
        status: 'match',
        label: 'Investe in marketing',
        className: 'bg-violet-600 text-white border-violet-700',
        detail: evidenceLine,
      }
    }
    if (isInvestingMarketingEnrichmentPending(lead)) {
      return {
        status: 'pending',
        label: 'Verifica budget ads…',
        className: 'bg-amber-100 text-amber-900 border-amber-300',
        detail: 'Controllo Meta Ad Library e fonti esterne',
      }
    }
    if (!isAuditPendingLead(lead)) {
      return {
        status: 'no_match',
        label: 'Nessun budget ads verificato',
        className: 'bg-zinc-100 text-zinc-600 border-zinc-300',
        detail: 'Nessuna inserzione Meta attiva in Ad Library',
      }
    }
  }

  for (const req of required) {
    if (req === 'hiring' || req === 'investing_marketing') continue
    const summary = analyzeMiraxSignals(lead)
    const sig = summary.businessSignals.find((s) => s.signalType === req)
    const meta = SIGNAL_REQUIREMENT_META[req as keyof typeof SIGNAL_REQUIREMENT_META]
    if (sig) {
      return {
        status: 'match',
        label: meta?.label || req,
        className: 'bg-violet-600 text-white border-violet-700',
        detail: sig.evidence?.[0]?.value || sig.reason,
      }
    }
  }

  if (required.length) {
    if (!isAuditPendingLead(lead)) {
      return {
        status: 'no_match',
        label: 'Nessuna evidenza trovata',
        className: 'bg-zinc-100 text-zinc-600 border-zinc-300',
      }
    }
    return {
      status: 'pending',
      label: 'Verifica in corso…',
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
  if (intent?.required_signals?.includes('investing_marketing')) return 'Investe in marketing'
  if (intent?.required_signals?.includes('tender_won')) return 'Gare'
  if (intent?.required_signals?.includes('sector_investment')) return 'Investimenti'
  return 'Dato richiesto'
}
