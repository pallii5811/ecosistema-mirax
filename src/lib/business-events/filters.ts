import type { BusinessSignalType } from '@/lib/business-events/types'
import { collectBusinessEventsFromLead } from '@/lib/business-events'
import { analyzeMiraxSignals, hasBusinessSignalType } from '@/lib/mirax-signals'

export type BusinessSignalFilterResult<T> = {
  visible: T[]
  hasActiveFilter: boolean
  missingSignals: boolean
}

export function leadMatchesBusinessSignalFilters(lead: unknown, filters: BusinessSignalType[]): boolean {
  if (!filters.length) return true
  const summary = analyzeMiraxSignals(lead)
  return hasBusinessSignalType(summary, filters)
}

export function filterLeadsByBusinessSignals<T>(
  leads: T[],
  filters: BusinessSignalType[],
): BusinessSignalFilterResult<T> {
  if (!filters.length) {
    return { visible: leads, hasActiveFilter: false, missingSignals: false }
  }

  const filtered = leads.filter((lead) => leadMatchesBusinessSignalFilters(lead, filters))

  if (filtered.length === 0 && leads.length > 0) {
    return { visible: leads, hasActiveFilter: true, missingSignals: true }
  }

  return { visible: filtered, hasActiveFilter: true, missingSignals: false }
}

export function countLeadsWithBusinessSignals(leads: unknown[]): number {
  return leads.filter((l) => collectBusinessEventsFromLead(l).length > 0).length
}
