import type { SignalIntentSpec } from '@/lib/signal-intent/types'
import { hiringMatchTextFromLead, textMatchesHiringRoles } from '@/lib/signal-intent/hiring-roles'

export type HiringCellData = {
  status: 'confirmed' | 'pending' | 'none' | 'idle'
  label: string
  className: string
  jobTitles: string[]
  roleMatch: boolean
}

function readLeadName(lead: Record<string, unknown>): string {
  for (const k of ['azienda', 'nome', 'name', 'company']) {
    const v = lead[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function readCity(lead: Record<string, unknown>, fallback = 'Milano'): string {
  for (const k of ['citta', 'city', 'localita']) {
    const v = lead[k]
    if (typeof v === 'string' && v.trim()) return v.trim().split(',')[0].trim()
  }
  return fallback
}

function jobTitlesFromLead(lead: Record<string, unknown>): string[] {
  const jobs = lead.business_hiring_jobs
  if (!Array.isArray(jobs)) return []
  return jobs
    .map((j) => (j && typeof j === 'object' ? String((j as Record<string, unknown>).title || '') : ''))
    .filter((t) => t.length > 2)
    .slice(0, 3)
}

function rolesFromIntent(intent: SignalIntentSpec | null | undefined): string[] {
  return (intent?.hiring_roles || []).map((r) => r.toLowerCase()).filter(Boolean)
}

function titleMatchesRoles(titles: string[], roles: string[]): boolean {
  if (!roles.length) return titles.length > 0
  const hay = titles.length ? titles.join(' ') : ''
  if (hay.trim()) return textMatchesHiringRoles(hay, roles)
  return false
}

/** Dato hiring per colonna dedicata — separato da audit sito (Pixel/SEO). */
export function hiringCellForLead(
  lead: Record<string, unknown>,
  intent: SignalIntentSpec | null | undefined,
  defaultCity = 'Milano',
): HiringCellData | null {
  if (!intent?.required_signals?.includes('hiring')) return null

  const titles = jobTitlesFromLead(lead)
  const roles = rolesFromIntent(intent)
  const roleMatch =
    titleMatchesRoles(titles, roles) ||
    (roles.length > 0 && textMatchesHiringRoles(hiringMatchTextFromLead(lead), roles))
  const externalDone = Boolean(lead.business_events_external_at)
  const signals = lead.business_signals
  const hasHiringSignal =
    titles.length > 0 ||
    (Array.isArray(signals) &&
      signals.some(
        (s) =>
          s &&
          typeof s === 'object' &&
          (s as Record<string, unknown>).type === 'hiring' &&
          (s as Record<string, unknown>).status !== 'unknown',
      ))

  if (hasHiringSignal && (roleMatch || !roles.length)) {
    const primary = titles[0] || 'Offerta su Indeed'
    return {
      status: 'confirmed',
      label: roles.includes('programmatore') ? `Python/dev — ${primary}` : primary,
      className: 'bg-violet-600 text-white border-violet-700',
      jobTitles: titles,
      roleMatch: true,
    }
  }

  if (!externalDone) {
    return {
      status: 'pending',
      label: 'Verifica Indeed…',
      className: 'bg-amber-100 text-amber-900 border-amber-300',
      jobTitles: [],
      roleMatch: false,
    }
  }

  return {
    status: 'none',
    label: 'Nessuna offerta rilevata',
    className: 'bg-zinc-100 text-zinc-600 border-zinc-300',
    jobTitles: [],
    roleMatch: false,
  }
}

export function indeedSearchUrl(lead: Record<string, unknown>, city = 'Milano'): string {
  const name = readLeadName(lead)
  const loc = readCity(lead, city)
  const q = encodeURIComponent(`"${name}"`)
  const l = encodeURIComponent(loc)
  return `https://it.indeed.com/jobs?q=${q}&l=${l}&sort=date&fromage=30`
}
