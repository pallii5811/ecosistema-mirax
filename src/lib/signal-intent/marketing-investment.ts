import type { MiraxSignal } from '@/lib/mirax-signals'
import { analyzeMiraxSignals } from '@/lib/mirax-signals'
import { asRecord, readNumber } from '@/lib/business-events/types'
import { isAuditPendingLead } from '@/lib/lead-audit-status'

/** Buyer: aziende che *comprano* servizi marketing — non agenzie che li vendono. */
export function isBuyerMarketingInvestmentQuery(query: string): boolean {
  const q = (query || '').trim()
  if (!q) return false
  return (
    /\b(stanno|che|stanno\s+per)\s+invest\w*\s+in\s+marketing\b/i.test(q) ||
    /\binvest\w*\s+in\s+marketing\b/i.test(q) ||
    /\b(budget|spend\w*|spesa)\b.*\bmarketing\b/i.test(q) ||
    /\bmarketing\b.*\b(budget|spend\w*|invest\w*)\b/i.test(q)
  )
}

export function isSellerMarketingAgencySector(sector: string): boolean {
  const s = sector.trim().toLowerCase()
  return /agenzie?\s+(di\s+)?marketing|marketing\s+agenz|web\s+agenc|digital\s+market/i.test(s)
}

/** Budget ads verificato dalla Meta Ad Library API — unico proxy onesto di "sta investendo". */
export function hasVerifiedMarketingAdSpend(lead: Record<string, unknown>): boolean {
  const tr = asRecord(lead.technical_report)
  const verified = lead.meta_ads_verified === true || tr.meta_ads_verified === true
  const count =
    readNumber(lead, ['active_meta_ads', 'meta_ads_count']) ??
    readNumber(tr, ['active_meta_ads', 'meta_ads_count'])
  return verified && count !== null && count > 0
}

export function isMarketingAdLookupDone(lead: Record<string, unknown>): boolean {
  return typeof lead.meta_ads_lookup_at === 'string' && lead.meta_ads_lookup_at.length > 0
}

export function verifiedMetaAdCount(lead: Record<string, unknown>): number | null {
  if (!hasVerifiedMarketingAdSpend(lead)) return null
  const tr = asRecord(lead.technical_report)
  return (
    readNumber(lead, ['active_meta_ads', 'meta_ads_count']) ??
    readNumber(tr, ['active_meta_ads', 'meta_ads_count'])
  )
}

/** Segnale business con evidenza Ad Library o worker — esclude pixel/tag tecnici. */
export function findInvestingMarketingBusinessSignal(lead: Record<string, unknown>): MiraxSignal | null {
  const summary = analyzeMiraxSignals(lead)
  for (const sig of summary.businessSignals) {
    if (sig.signalType !== 'investing_marketing' && sig.signalType !== 'meta_ads_started') continue
    const fromLibrary = sig.evidence.some(
      (e) =>
        e.source === 'meta_ad_library' ||
        /inserzion|ad library|campagn/i.test(`${e.label} ${e.value}`),
    )
    if (fromLibrary) return sig
  }
  if (hasVerifiedMarketingAdSpend(lead)) {
    const count = verifiedMetaAdCount(lead)
    return {
      id: 'verified_meta_ad_spend',
      kind: 'business',
      signalType: 'investing_marketing',
      title: 'Investe in pubblicità Meta',
      severity: 'high',
      confidence: 94,
      reason: 'La Meta Ad Library conferma inserzioni attive.',
      evidence: [
        {
          label: 'Inserzioni Meta attive',
          value: String(count ?? 'sì'),
          source: 'meta_ad_library',
          url: typeof lead.meta_ad_library_url === 'string' ? lead.meta_ad_library_url : undefined,
        },
      ],
      status: 'confirmed',
      detectedAt: new Date().toISOString(),
    }
  }
  return null
}

export function isInvestingMarketingEnrichmentPending(lead: Record<string, unknown>): boolean {
  if (isAuditPendingLead(lead)) return true
  if (lead.claude_enrichment) return false
  if (isMarketingAdLookupDone(lead)) return false
  return true
}
