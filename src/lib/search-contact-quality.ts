/** Contact visibility + scrape plateau detection (Blocco 1). */

const FAKE_EMAIL_DOMAINS = new Set([
  'website.com', 'example.com', 'email.com', 'sito.com', 'domain.com', 'test.com',
  'yoursite.com', 'yourdomain.com', 'tuosito.com', 'tuodominio.com', 'sitoweb.com',
  'miosito.com', 'nomedominio.com', 'nomesito.com', 'sample.com', 'placeholder.com', 'mail.com',
])

const EMPTY_CONTACT = new Set(['', 'n/d', 'n/a', 'none', 'null', 'n.d.', 'undefined'])

export type ContactVisibilityStats = {
  rawTotal: number
  withContact: number
  hiddenNoContact: number
}

/** Lead has phone or real email — same gate used before showing results. */
export function hasLeadContact(lead: unknown): boolean {
  if (!lead || typeof lead !== 'object') return false
  const obj = lead as Record<string, unknown>
  const isVal = (v: unknown) => {
    if (v == null) return false
    const s = String(v).trim().toLowerCase()
    return s.length > 0 && !EMPTY_CONTACT.has(s)
  }
  const hasPhone = isVal(obj.telefono) || isVal(obj.phone)
  const email = String(obj.email ?? '').trim().toLowerCase()
  const hasEmail =
    email.includes('@') &&
    !EMPTY_CONTACT.has(email) &&
    !FAKE_EMAIL_DOMAINS.has(email.split('@')[1] ?? '')
  return hasPhone || hasEmail
}

export function computeContactVisibilityStats(leads: unknown[]): ContactVisibilityStats {
  const list = Array.isArray(leads) ? leads : []
  const rawTotal = list.length
  const withContact = list.filter(hasLeadContact).length
  return {
    rawTotal,
    withContact,
    hiddenNoContact: Math.max(0, rawTotal - withContact),
  }
}

export function formatContactVisibilityMessage(stats: ContactVisibilityStats): string | null {
  if (stats.rawTotal <= 0) return null
  if (stats.hiddenNoContact <= 0) {
    return `${stats.withContact} lead con contatto verificato`
  }
  return `${stats.rawTotal} trovati · ${stats.withContact} con contatto · ${stats.hiddenNoContact} nascosti (senza telefono/email)`
}

/** Single line for in-progress search — avoids conflicting counters in the UI. */
export function formatSearchProgressMessage(
  stats: ContactVisibilityStats | null,
  displayed: number,
  maxLeads: number,
): string {
  const target = Math.max(1, maxLeads)
  if (!stats || stats.rawTotal <= 0) {
    return `${displayed} / ${target} lead in lista — ricerca in corso`
  }
  const mapsPart =
    stats.hiddenNoContact > 0
      ? `${stats.rawTotal} su Maps (${stats.withContact} con contatto, ${stats.hiddenNoContact} senza contatto ancora)`
      : `${stats.rawTotal} su Maps (${stats.withContact} con contatto)`
  return `${displayed} / ${target} in lista · ${mapsPart}`
}

/** Poll intervals: 5s auto-scrape → 18 stale polls ≈ 90s plateau. */
export const SCRAPE_PLATEAU_STALE_POLLS = 18
export const SCRAPE_PLATEAU_MS = 90_000
export const SCRAPE_POLL_INTERVAL_MS = 3000

export function stalePollsThreshold(pollIntervalMs: number): number {
  return Math.max(6, Math.ceil(SCRAPE_PLATEAU_MS / Math.max(1000, pollIntervalMs)))
}

export type ScrapeExhaustionInput = {
  status?: string | null
  rawResultCount: number
  displayedCount: number
  maxLeads: number
  stalePolls: number
  maxStalePolls?: number
}

/** True when Maps/scrape stopped producing new leads or job finished below cap. */
export function shouldTreatScrapeAsExhausted(input: ScrapeExhaustionInput): boolean {
  const maxStale = input.maxStalePolls ?? SCRAPE_PLATEAU_STALE_POLLS
  const status = String(input.status ?? '').toLowerCase()

  if (status === 'completed' || status === 'error') {
    return input.displayedCount < input.maxLeads
  }
  if (input.stalePolls >= maxStale && input.rawResultCount > 0) {
    return true
  }
  if (input.stalePolls >= maxStale * 2) {
    return true
  }
  return false
}
