import { collectBusinessEventsFromLead } from '@/lib/business-events'
import { asRecord, readString } from '@/lib/business-events/types'
import { detectCrmStackSignals } from '@/lib/business-events/crm-stack'
import { detectSectorInvestmentSignals } from '@/lib/business-events/sector-investment'
import { detectTenderWinSignals } from '@/lib/business-events/tender-wins'
import type { MiraxSignalRequirement, SignalIntentSpec } from '@/lib/signal-intent/types'
import { EMPTY_SIGNAL_INTENT } from '@/lib/signal-intent/types'
import { intentSpecHasMatches } from '@/lib/signal-intent/parse-semantic'
import { hasBusinessSignalType } from '@/lib/mirax-signals'
import { analyzeMiraxSignals } from '@/lib/mirax-signals'
import { hiringMatchTextFromLead, textMatchesHiringRoles } from '@/lib/signal-intent/hiring-roles'
import { readClaudeEnrichment } from '@/lib/claude-intent-enrich/types'
import {
  findInvestingMarketingBusinessSignal,
  hasVerifiedMarketingAdSpend,
  isInvestingMarketingEnrichmentPending,
} from '@/lib/signal-intent/marketing-investment'

function jobMatchesRoles(lead: Record<string, unknown>, roles: string[]): boolean {
  if (!roles.length) return true
  const hay = hiringMatchTextFromLead(lead)
  if (!hay.trim()) return false
  return textMatchesHiringRoles(hay, roles)
}

function crmMatchesKeywords(lead: Record<string, unknown>, keywords: string[]): boolean {
  if (!keywords.length) return true
  const stack = lead.detected_crm_stack
  const list = Array.isArray(stack) ? stack.map(String) : []
  const hay = list.join(' ').toLowerCase()
  return keywords.some((k) => hay.includes(k.toLowerCase()))
}

function requirementSatisfied(lead: Record<string, unknown>, req: MiraxSignalRequirement, intent: SignalIntentSpec): boolean {
  const summary = analyzeMiraxSignals(lead)
  const allSignals = [
    ...collectBusinessEventsFromLead(lead),
    ...detectCrmStackSignals(lead),
    ...detectSectorInvestmentSignals(lead, intent.sector_keywords),
    ...detectTenderWinSignals(lead, intent.time_window_days),
  ]

  switch (req) {
    case 'hiring': {
      const claude = lead.claude_enrichment
      if (claude && typeof claude === 'object') {
        const c = claude as Record<string, unknown>
        if (c.matches_request === true) {
          return jobMatchesRoles(lead, intent.hiring_roles) || !intent.hiring_roles.length
        }
        if (c.checked_at || c.summary) return false
      }
      return hasBusinessSignalType(summary, ['hiring']) && jobMatchesRoles(lead, intent.hiring_roles)
    }
    case 'registry_change':
      return hasBusinessSignalType(summary, ['registry_change'])
    case 'site_stale':
      return hasBusinessSignalType(summary, ['site_stale'])
    case 'meta_ads_started':
      return hasBusinessSignalType(summary, ['meta_ads_started'])
    case 'google_ads_started':
      return hasBusinessSignalType(summary, ['google_ads_started'])
    case 'investing_marketing': {
      const claude = readClaudeEnrichment(lead)
      if (claude?.matches_request === true) return true
      if (claude?.checked_at) return false
      if (hasVerifiedMarketingAdSpend(lead)) return true
      if (findInvestingMarketingBusinessSignal(lead)) return true
      if (isInvestingMarketingEnrichmentPending(lead)) return false
      return false
    }
    case 'sector_investment':
      return detectSectorInvestmentSignals(lead, intent.sector_keywords).length > 0
    case 'tender_won':
      return detectTenderWinSignals(lead, intent.time_window_days).length > 0
    case 'crm_detected':
      return detectCrmStackSignals(lead).length > 0 && crmMatchesKeywords(lead, intent.crm_keywords)
    case 'crm_change': {
      const changes = lead.audit_changes
      if (!Array.isArray(changes)) return false
      const crmChanges = changes.filter(
        (c) =>
          c &&
          typeof c === 'object' &&
          (String((c as Record<string, unknown>).field || '').includes('crm') ||
            String((c as Record<string, unknown>).label || '').toLowerCase().includes('crm')),
      )
      if (!crmChanges.length) return false
      if (!intent.time_window_days) return true
      const cutoff = Date.now() - intent.time_window_days * 86400000
      return crmChanges.some((c) => {
        const d = Date.parse(String((c as Record<string, unknown>).detected_at || ''))
        return Number.isFinite(d) && d >= cutoff
      })
    }
    default:
      return allSignals.some((s) => s.signalType === req)
  }
}

export function leadMatchesSignalIntent(lead: unknown, intent: SignalIntentSpec | null | undefined): boolean {
  const spec = intent?.required_signals?.length ? intent : EMPTY_SIGNAL_INTENT
  if (!spec.required_signals.length) return true
  const row = asRecord(lead)
  if (!Object.keys(row).length) return false
  return spec.required_signals.every((req) => requirementSatisfied(row, req, spec))
}

export function filterLeadsBySignalIntent<T>(leads: T[], intent: SignalIntentSpec | null | undefined): T[] {
  if (!intent?.required_signals?.length) return leads
  return leads.filter((l) => leadMatchesSignalIntent(l, intent))
}

/** Auto-attiva chip Segnali Business quando possibile */
export function signalIntentToBusinessFilters(intent: SignalIntentSpec): import('@/lib/business-events/types').BusinessSignalType[] {
  const map: Partial<Record<MiraxSignalRequirement, import('@/lib/business-events/types').BusinessSignalType>> = {
    hiring: 'hiring',
    registry_change: 'registry_change',
    site_stale: 'site_stale',
    meta_ads_started: 'meta_ads_started',
    google_ads_started: 'google_ads_started',
    sector_investment: 'sector_investment',
    tender_won: 'tender_won',
    crm_detected: 'crm_detected',
    crm_change: 'crm_change',
  }
  return intent.required_signals
    .map((r) => map[r])
    .filter((x): x is import('@/lib/business-events/types').BusinessSignalType => Boolean(x))
}

export function describeSignalIntent(intent: SignalIntentSpec | null | undefined): string | null {
  if (!intent) return null
  if (intent.reasoning) return intent.reasoning
  if (!intent.required_signals?.length && !intentSpecHasMatches(intent)) return null
  return intent.intent_summary || intent.required_signals.join(', ')
}
