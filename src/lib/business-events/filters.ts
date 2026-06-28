import type { BusinessSignalType } from '@/lib/business-events/types'
import { collectBusinessEventsFromLead } from '@/lib/business-events'
import { analyzeMiraxSignals, hasBusinessSignalType } from '@/lib/mirax-signals'

export function leadMatchesBusinessSignalFilters(lead: unknown, filters: BusinessSignalType[]): boolean {
  if (!filters.length) return true
  const summary = analyzeMiraxSignals(lead)
  return hasBusinessSignalType(summary, filters)
}

export function filterLeadsByBusinessSignals<T>(leads: T[], filters: BusinessSignalType[]): T[] {
  if (!filters.length) return leads
  return leads.filter((lead) => leadMatchesBusinessSignalFilters(lead, filters))
}

export function countLeadsWithBusinessSignals(leads: unknown[]): number {
  return leads.filter((l) => collectBusinessEventsFromLead(l).length > 0).length
}
