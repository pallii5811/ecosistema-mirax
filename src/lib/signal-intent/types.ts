/**
 * MIRAX Signal Intent v2 — query NL → requisiti segnali d'acquisto (onnivoro).
 */

export type MiraxSignalRequirement =
  | 'hiring'
  | 'registry_change'
  | 'sector_investment'
  | 'tender_won'
  | 'crm_detected'
  | 'crm_change'
  | 'site_stale'
  | 'meta_ads_started'
  | 'google_ads_started'
  | 'investing_marketing'

export type SignalIntentSpec = {
  /** Segnali richiesti dalla query utente */
  required_signals: MiraxSignalRequirement[]
  /** Ruoli hiring: programmatori, commerciali, … */
  hiring_roles: string[]
  /** Settore / tema investimento: fotovoltaico, AI, … */
  sector_keywords: string[]
  /** CRM specifici: hubspot, salesforce, … */
  crm_keywords: string[]
  /** Utente chiede cambio CRM recente */
  require_crm_change: boolean
  /** Finestra temporale in giorni (default 365 se tender/gara) */
  time_window_days: number | null
  /** Spiegazione per UI */
  intent_summary: string | null
}

export const EMPTY_SIGNAL_INTENT: SignalIntentSpec = {
  required_signals: [],
  hiring_roles: [],
  sector_keywords: [],
  crm_keywords: [],
  require_crm_change: false,
  time_window_days: null,
  intent_summary: null,
}
