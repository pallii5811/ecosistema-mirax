/**
 * Logica display risultati streaming — port fedele del legacy DashboardShell.
 * Regola d'oro: durante una ricerca il totale NON scende mai.
 */
import { buildTechFilter, deduplicateResults, hasLeadContactOrWebsite, leadRowKey, normalizeLeadFields } from '@/components/dashboard/lead-utils'
import { hasLeadContact } from '@/lib/search-contact-quality'
import { isAuditPendingLead } from '@/lib/lead-audit-status'
import { clampSearchMaxLeads } from '@/lib/search-job-payload'
import { shouldRejectEnterpriseLead } from '@/lib/lead-enterprise-guard'

export type StreamingBatchOpts = {
  query: string
  maxLeads: number
  credits: number
  activeFilters: Record<string, unknown> | null
  /** Durante scrape: sito/audit ok. A fine job: telefono/email. */
  scraping: boolean
}

function contactGate(lead: unknown, scraping: boolean): boolean {
  if (hasLeadContact(lead)) return true
  if (scraping) {
    if (hasLeadContactOrWebsite(lead)) return true
    if (isAuditPendingLead(lead)) return true
  }
  return false
}

function applyActiveFilters(
  leads: Record<string, unknown>[],
  activeFilters: Record<string, unknown> | null,
): Record<string, unknown>[] {
  if (!activeFilters) return leads
  if (activeFilters.has_website === false) {
    return leads.filter((lead) => {
      const s = (lead.sito || lead.website || '').toString().trim()
      return !s || s === 'N/D' || s === 'N/A' || s === 'N.D.' || s === 'n/d'
    })
  }
  if (activeFilters.has_website === true) {
    return leads.filter((lead) => {
      const s = (lead.sito || lead.website || '').toString().trim()
      return s && s !== 'N/D' && s !== 'N/A' && s !== 'N.D.' && s !== 'n/d'
    })
  }
  return leads
}

/** Normalizza + filtra un batch in arrivo dal worker (no filterLeadsDeterministic in streaming). */
export function normalizeStreamingBatch(raw: unknown[], opts: StreamingBatchOpts): Record<string, unknown>[] {
  const techFilter = buildTechFilter(opts.query)
  const scraping = opts.scraping

  let leads = (
    deduplicateResults(Array.isArray(raw) ? raw.map(normalizeLeadFields) : []) as Record<string, unknown>[]
  ).filter((l) => contactGate(l, scraping))

  leads = leads.filter((lead) => !shouldRejectEnterpriseLead(lead, opts.query))
  leads = applyActiveFilters(leads, opts.activeFilters)
  if (techFilter) leads = leads.filter(techFilter)

  const cap = clampSearchMaxLeads(opts.maxLeads, opts.credits)
  return leads.slice(0, cap)
}

/** Merge per chiave stabile — arricchisce, non rimuove. */
export function mergeLeadsMonotonic(
  previous: Record<string, unknown>[],
  incoming: Record<string, unknown>[],
): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>()
  for (const lead of previous) {
    byKey.set(leadRowKey(lead), lead)
  }
  for (const lead of incoming) {
    const k = leadRowKey(lead)
    const prev = byKey.get(k)
    byKey.set(k, prev ? ({ ...prev, ...lead } as Record<string, unknown>) : lead)
  }
  return Array.from(byKey.values())
}

/**
 * Applica batch al display corrente.
 * @returns nuova lista display + quanti lead nuovi per addebito crediti
 */
export function applyStreamingDisplay(
  current: Record<string, unknown>[],
  incomingBatch: Record<string, unknown>[],
  opts: StreamingBatchOpts & { allowShrink?: boolean },
): { display: Record<string, unknown>[]; newCount: number } {
  const cap = clampSearchMaxLeads(opts.maxLeads, opts.credits)
  const prevCount = current.length

  if (incomingBatch.length === 0 && !opts.allowShrink) {
    return { display: current, newCount: 0 }
  }

  let merged = mergeLeadsMonotonic(current, incomingBatch)
  merged = merged.slice(0, cap)

  if (!opts.allowShrink && merged.length < prevCount) {
    merged = mergeLeadsMonotonic(current, []).slice(0, Math.max(cap, prevCount))
  }

  const newCount = Math.max(0, merged.length - prevCount)
  return { display: merged, newCount }
}
