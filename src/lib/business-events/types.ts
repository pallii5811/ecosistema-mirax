import type { MiraxSignal } from '@/lib/mirax-signals'

export type BusinessSignalType =
  | 'hiring'
  | 'new_location'
  | 'registry_change'
  | 'funding_news'
  | 'site_stale'
  | 'meta_ads_started'
  | 'google_ads_started'
  | 'sector_investment'
  | 'tender_won'
  | 'crm_detected'
  | 'crm_change'

export type BusinessEventCollector = (lead: Record<string, unknown>) => MiraxSignal[]

export const BUSINESS_SIGNAL_LABELS: Record<BusinessSignalType, string> = {
  hiring: 'Assunzioni / crescita',
  new_location: 'Nuova sede',
  registry_change: 'Cambio registro',
  funding_news: 'Finanziamenti',
  site_stale: 'Sito datato',
  meta_ads_started: 'Ads Meta attive',
  google_ads_started: 'Google Ads attivi',
  sector_investment: 'Investimento settore',
  tender_won: 'Gara vinta',
  crm_detected: 'CRM rilevato',
  crm_change: 'Cambio CRM',
}

export const BUSINESS_SIGNAL_FILTER_OPTIONS: Array<{ id: BusinessSignalType; label: string; hint: string }> = [
  { id: 'hiring', label: 'Assunzioni', hint: 'Azienda in crescita (registro/dipendenti)' },
  { id: 'meta_ads_started', label: 'Ads Meta', hint: 'Inserzioni attive verificate' },
  { id: 'google_ads_started', label: 'Google Ads', hint: 'Tag pubblicitari rilevati' },
  { id: 'site_stale', label: 'Sito datato', hint: 'Sito lento o non aggiornato' },
  { id: 'registry_change', label: 'Registro', hint: 'Variazioni fatturato/dipendenti' },
  { id: 'sector_investment', label: 'Settore', hint: 'Investimenti in settori specifici (fotovoltaico, edilizia…)' },
  { id: 'tender_won', label: 'Gare', hint: 'Aggiudicazioni / appalti pubblici' },
  { id: 'crm_detected', label: 'CRM', hint: 'HubSpot, Salesforce, Pipedrive… rilevati sul sito' },
]

function readString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function readNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const n = Number(value.replace(',', '.').replace(/[^0-9.]/g, ''))
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export { readString, readNumber, asRecord }
