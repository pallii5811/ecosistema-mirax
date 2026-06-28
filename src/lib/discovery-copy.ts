/**
 * Copy Discovery — traduce jargon tecnico in linguaggio umano (brief §6.1).
 */

import type { BuyingSignal } from '@/utils/buyingSignals'
import type { MiraxSignal } from '@/lib/mirax-signals'

const SIGNAL_HUMAN_TITLES: Record<string, string> = {
  active_meta_ads_broken_funnel: 'Investe in pubblicità ma il sito non converte',
  active_meta_ads_running: 'Sta già investendo in pubblicità Meta',
  paid_infra_without_capture: 'Fa ads ma non raccoglie contatti sul sito',
  measured_slow_site: 'Il sito è troppo lento — perde clienti',
  pixel_without_measurement: 'Spende in ads senza misurare i risultati',
  paid_traffic_without_tracking: 'Budget ads senza tracciamento conversioni',
  structured_company_tracking_gap: 'Azienda strutturata ma poco digitale',
  slow_site_conversion_risk: 'Sito lento che fa perdere richieste',
  strong_reputation_under_monetized: 'Ottime recensioni ma poca acquisizione online',
  contact_friction: 'Difficile contattarli — opportunità CTA',
  paid_traffic_landing_leak: 'Traffico a pagamento che non converte',
  local_reputation_social_gap: 'Buona reputazione, social assenti',
  trust_blocker_no_ssl: 'Sito segnalato come non sicuro',
  site_stale_copyright: 'Sito non aggiornato da tempo',
  site_stale_slow: 'Sito lento — manutenzione trascurata',
  site_stale_audit_age: 'Presenza online da rinnovare',
  meta_ads_started: 'Investe in pubblicità su Meta',
  google_ads_started: 'Investe in Google Ads',
  registry_employees_growth: 'Azienda in crescita (più dipendenti)',
  registry_revenue_growth: 'Fatturato in crescita — budget probabile',
  hiring_indeed_jobs: 'Sta assumendo — fase di espansione',
  hiring_organic_growth: 'Team in crescita',
  intent_marketing_spend: 'Sta investendo in marketing',
}

const TECH_JARGON_REPLACEMENTS: Array<[RegExp, string]> = [
  [/missing\s*fb?\s*pixel/gi, 'Non traccia i visitatori — perde soldi sugli annunci'],
  [/missing\s*gtm/gi, 'Non misura da dove arrivano i clienti'],
  [/no\s*gtm/gi, 'Non misura da dove arrivano i clienti'],
  [/disastro\s*seo/gi, 'Il sito è poco visibile su Google'],
  [/seo\s*error/gi, 'Errori che penalizzano Google'],
  [/senza\s*ssl/gi, 'Sito non sicuro per i clienti'],
  [/no\s*ssl/gi, 'Sito non sicuro per i clienti'],
  [/meta\s*pixel/gi, 'tracciamento visitatori'],
  [/google\s*tag\s*manager/gi, 'misurazione marketing'],
  [/google\s*analytics/gi, 'analisi traffico'],
]

export function humanizeSignalTitle(signal: Pick<BuyingSignal | MiraxSignal, 'title'> & { id?: string }): string {
  const mapped = signal.id ? SIGNAL_HUMAN_TITLES[signal.id] : undefined
  if (mapped) return mapped
  let text = signal.title
  for (const [re, replacement] of TECH_JARGON_REPLACEMENTS) {
    text = text.replace(re, replacement)
  }
  return text
}

export function discoveryMotivo(
  primaryReason: string,
  signals: Array<Pick<BuyingSignal | MiraxSignal, 'title'> & { id?: string; openingLine?: string }>,
): string {
  const top = signals[0]
  if (top) return humanizeSignalTitle(top)
  let text = primaryReason
  for (const [re, replacement] of TECH_JARGON_REPLACEMENTS) {
    text = text.replace(re, replacement)
  }
  return text
}

export function discoveryPitch(
  signals: Array<Pick<BuyingSignal | MiraxSignal, 'title' | 'openingLine'> & { id?: string }>,
): string {
  const line = signals.find((s) => typeof s.openingLine === 'string' && s.openingLine.trim())?.openingLine?.trim()
  if (line) {
    const sentences = line.split(/(?<=[.!?])\s+/).filter(Boolean)
    return sentences.slice(0, 2).join(' ')
  }
  const title = signals[0]?.title
  return title ? humanizeSignalTitle(signals[0]) : 'Opportunità commerciale rilevata sui dati pubblici dell\'azienda.'
}
