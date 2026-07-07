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
  if (!s) return false
  if (s === 'marketing' || s === 'comunicazione' || s === 'pubblicità' || s === 'pubblicita') return true
  return /agenzie?\s+(di\s+)?marketing|marketing\s+agenz|web\s+agenc|digital\s+market|agenzia\s+marketing/i.test(s)
}

/** Categoria Maps per buyer "investono in marketing" — mai settore marketing/agenzie. */
export function buyerMarketingMapsSector(): string {
  return 'Negozi'
}

export function isMarketingAgencyLead(lead: Record<string, unknown>): boolean {
  const text = [
    lead.azienda,
    lead.nome,
    lead.name,
    lead.business_name,
    lead.categoria,
    lead.category,
    lead.sito,
    lead.website,
  ]
    .map((x) => String(x ?? '').toLowerCase())
    .join(' ')
  const cat = String(lead.categoria ?? lead.category ?? '').toLowerCase()
  if (/agenz/i.test(cat) && /marketing|comunicaz|pubblicit|digital/i.test(cat)) return true
  if (cat === 'marketing' || cat === 'agenzie di marketing' || cat === 'agenzie marketing') return true
  const agencyPatterns = [
    /\bagenzia\b.*\b(marketing|comunicaz|digital|web)\b/,
    /\b(marketing|comunicaz|digital)\b.*\bagenzia\b/,
    /\bdigital\s+marketing\b/,
    /\bweb\s+agenc/,
    /\bagency\b/,
    /\bseo\s+agency\b/,
    /\bsocial\s+media\s+agency\b/,
    /\bmarketing\s+italia\b/,
    /\bpasso\s+al\s+marketing\b/,
    /\bmedia\s*marketing\b/,
  ]
  return agencyPatterns.some((p) => p.test(text))
}

export function filterOutMarketingAgencies<T>(leads: T[], query: string): T[] {
  if (!isBuyerMarketingInvestmentQuery(query)) return leads
  return leads.filter((lead) => {
    if (!lead || typeof lead !== 'object') return false
    return !isMarketingAgencyLead(lead as Record<string, unknown>)
  })
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
