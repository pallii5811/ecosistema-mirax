import { leadMatchesSignalIntent } from '@/lib/signal-intent/match-lead'
import type { SignalIntentSpec } from '@/lib/signal-intent/types'

export type LeadVisibilityOpts = {
  finalize: boolean
  scraping: boolean
}

/**
 * Gate riga tabella risultati rispetto al signal intent.
 * Con segnali attivi: mostra SEMPRE tutte le aziende (badge viola/giallo/grigio).
 * Filtro strict solo via "Solo con segnale" in ResultsTable.
 */
export function shouldShowLeadForSignalIntent(
  lead: unknown,
  intent: SignalIntentSpec | null | undefined,
  _opts: LeadVisibilityOpts,
): boolean {
  if (!intent?.required_signals?.length) return true
  // Non nascondere lead in attesa di arricchimento — la colonna intent mostra lo stato.
  void lead
  return true
}

export function countLeadsMatchingSignalIntent(
  leads: unknown[],
  intent: SignalIntentSpec | null | undefined,
): number {
  if (!intent?.required_signals?.length) return 0
  return leads.filter((l) => leadMatchesSignalIntent(l, intent)).length
}

export function isSignalFocusedIntent(intent: SignalIntentSpec | null | undefined): boolean {
  return Boolean(intent?.required_signals?.length)
}

/** @deprecated use isSignalFocusedIntent */
export function isHiringFocusedIntent(intent: SignalIntentSpec | null | undefined): boolean {
  return Boolean(intent?.required_signals?.includes('hiring'))
}

export function signalFilterButtonLabel(intent: SignalIntentSpec | null | undefined): string {
  if (!intent?.required_signals?.length) return 'Solo caldi'
  if (intent.required_signals.includes('hiring')) return 'Solo con assunzioni'
  if (intent.required_signals.includes('sector_investment') || intent.required_signals.includes('investing_marketing')) {
    return 'Solo con investimenti'
  }
  if (intent.required_signals.includes('tender_won')) return 'Solo con gare'
  return 'Solo con segnale'
}

export function resultsSummaryForIntent(
  total: number,
  matched: number,
  intent: SignalIntentSpec | null | undefined,
): string {
  if (!isSignalFocusedIntent(intent)) return `Trovati ${total} risultati.`
  if (matched > 0) return `${total} aziende trovate · ${matched} con segnale confermato.`
  return `${total} aziende trovate · verifica segnali nella colonna dedicata.`
}
