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

function workerSignalsFromLead(lead: Record<string, unknown>): MiraxSignal[] {
  const raw = lead.business_signals
  if (!Array.isArray(raw)) return []
  const out: MiraxSignal[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const st = String(row.type || row.signalType || '')
    if (!st) continue
    const statusRaw = String(row.status || 'confirmed')
    const status =
      statusRaw === 'unknown' || statusRaw === 'inferred' || statusRaw === 'confirmed' ? statusRaw : 'confirmed'
    const sevRaw = String(row.severity || 'medium')
    const severity =
      sevRaw === 'critical' || sevRaw === 'high' || sevRaw === 'medium' || sevRaw === 'low' ? sevRaw : 'medium'
    const evidenceRaw = Array.isArray(row.evidence) ? row.evidence : []
    const evidence = evidenceRaw
      .filter((e) => e && typeof e === 'object')
      .map((e) => {
        const ev = e as Record<string, unknown>
        return {
          label: String(ev.label || 'Info'),
          value: String(ev.value || ''),
          source: String(ev.source || row.source || 'worker'),
          url: ev.url ? String(ev.url) : undefined,
        }
      })
    if (!evidence.length && status !== 'unknown') continue
    const retry =
      typeof row.retry_after_minutes === 'number'
        ? row.retry_after_minutes
        : undefined
    out.push({
      id: `worker_${st}_${out.length}`,
      kind: 'business',
      signalType: st,
      title: String(row.title || st),
      severity,
      confidence: typeof row.confidence === 'number' ? row.confidence : 0,
      reason:
        status === 'unknown'
          ? 'Dato temporaneamente non disponibile — riproveremo automaticamente.'
          : String(row.title || 'Segnale business da enrichment worker'),
      evidence: evidence.length
        ? evidence
        : [{ label: 'Stato', value: 'In aggiornamento', source: 'system' }],
      status,
      retryAfterMinutes: typeof retry === 'number' ? retry : undefined,
      detectedAt: new Date().toISOString(),
    })
  }
  return out
}

/** Raccolta sincrona da dati lead già presenti (zero fetch, safe in UI). */
export function collectBusinessEventsFromLead(input: unknown): MiraxSignal[] {
  const lead = asRecord(input)
  if (Object.keys(lead).length === 0) return []

  const workerDirect = workerSignalsFromLead(lead)
  const workerTypes = new Set(workerDirect.map((s) => s.signalType))

  const merged = uniqueById([
    ...workerDirect,
    ...detectSiteStaleSignals(lead),
    ...detectRegistrySignals(lead),
    ...detectHiringSignals(lead).filter((s) => !workerTypes.has('hiring')),
    ...detectMarketingIntentSignals(lead),
    ...detectCrmStackSignals(lead),
    ...detectCrmChangeSignals(lead),
    ...detectSectorInvestmentSignals(lead),
    ...detectTenderWinSignals(lead).filter((s) => !workerTypes.has('tender_won')),
    ...(() => {
      const intent = detectIntentMarketingSpend(lead)
      return intent ? [intent] : []
    })(),
  ])

  return merged.sort((a, b) => {
    const rank = { critical: 0, high: 1, medium: 2, low: 3 }
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
