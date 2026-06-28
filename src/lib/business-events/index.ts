import type { MiraxSignal } from '@/lib/mirax-signals'
import { asRecord, readString } from '@/lib/business-events/types'
import { detectHiringSignals, detectMarketingIntentSignals } from '@/lib/business-events/marketing-intent'
import { detectRegistrySignals } from '@/lib/business-events/registry-delta'
import { detectSiteStaleSignals, detectSiteStaleFromHeaders } from '@/lib/business-events/site-stale'
import { detectCrmStackSignals, detectCrmChangeSignals } from '@/lib/business-events/crm-stack'
import { detectSectorInvestmentSignals } from '@/lib/business-events/sector-investment'
import { detectTenderWinSignals } from '@/lib/business-events/tender-wins'
import { detectIntentMarketingSpend } from '@/lib/intent-marketing-spend'

export type { BusinessSignalType } from '@/lib/business-events/types'
export { BUSINESS_SIGNAL_LABELS, BUSINESS_SIGNAL_FILTER_OPTIONS } from '@/lib/business-events/types'

function uniqueById(signals: MiraxSignal[]): MiraxSignal[] {
  const seen = new Set<string>()
  return signals.filter((s) => {
    if (seen.has(s.id)) return false
    seen.add(s.id)
    return s.evidence.length > 0
  })
}

/** Raccolta sincrona da dati lead già presenti (zero fetch, safe in UI). */
export function collectBusinessEventsFromLead(input: unknown): MiraxSignal[] {
  const lead = asRecord(input)
  if (Object.keys(lead).length === 0) return []

  const merged = uniqueById([
    ...detectSiteStaleSignals(lead),
    ...detectRegistrySignals(lead),
    ...detectHiringSignals(lead),
    ...detectMarketingIntentSignals(lead),
    ...detectCrmStackSignals(lead),
    ...detectCrmChangeSignals(lead),
    ...detectSectorInvestmentSignals(lead),
    ...detectTenderWinSignals(lead),
    ...(() => {
      const intent = detectIntentMarketingSpend(lead)
      return intent ? [intent] : []
    })(),
  ])

  return merged.sort((a, b) => {
    const rank = { critical: 0, high: 1, medium: 2 }
    return rank[a.severity] - rank[b.severity] || b.confidence - a.confidence
  })
}

/** Refresh on-demand con fetch HTTP (Last-Modified). Usato dalla API route. */
export async function collectBusinessEventsAsync(input: unknown): Promise<MiraxSignal[]> {
  const lead = asRecord(input)
  const base = collectBusinessEventsFromLead(lead)
  const extra = await detectSiteStaleFromHeaders(lead)
  return uniqueById([...base, ...extra])
}

export function normalizeLeadWebsite(input: unknown): string {
  const lead = asRecord(input)
  const raw = readString(lead, ['sito', 'website', 'url'])
  if (!raw) return ''
  return raw.trim().toLowerCase().replace(/\/+$/, '')
}

export function normalizeLeadName(input: unknown): string {
  const lead = asRecord(input)
  return readString(lead, ['azienda', 'nome', 'name', 'company'])
}

export function miraxSignalToDbRow(
  signal: MiraxSignal,
  userId: string,
  leadWebsite: string,
  leadName: string | null,
) {
  return {
    user_id: userId,
    lead_website: leadWebsite,
    lead_name: leadName,
    signal_type: signal.signalType || 'site_stale',
    title: signal.title,
    severity: signal.severity,
    confidence: signal.confidence,
    evidence: signal.evidence,
    source: signal.evidence[0]?.source || 'lead_data',
    detected_at: signal.detectedAt || new Date().toISOString(),
  }
}
