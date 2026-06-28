// Shared outreach domain logic — single source of truth used by the console,
// the reusable status hook and any component that fires/measures outreach.
// Keeping these helpers in one place guarantees identical guardrail and funnel
// behaviour everywhere (no drift, no duplicated bugs).

export type OutreachMode = 'sell_service' | 'mirax_promo'
export type Outcome = 'interested' | 'not_interested' | 'no_answer'

export type OutreachStatusItem = {
  lead_website: string | null
  lead_name: string | null
  channel: string
  status: string
  mode: string
  created_at: string
}

// Anti-duplicate window: warn before contacting a lead reached within this many days.
export const RECENT_CONTACT_DAYS = 7
// Soft daily send limit to protect messaging accounts from bans.
export const DAILY_SOFT_LIMIT = 80

export const OUTCOME_STATUSES = new Set<string>(['interested', 'not_interested', 'no_answer', 'replied'])
// Outcomes that count as "the lead answered".
export const RESPONSE_OUTCOMES = new Set<string>(['interested', 'not_interested', 'replied'])

export const OUTCOME_META: Record<Outcome, { label: string; active: string; idle: string }> = {
  interested: {
    label: 'Interessato',
    active: 'border-emerald-300 bg-emerald-500 text-white',
    idle: 'border-slate-200 text-slate-500 hover:border-emerald-300 hover:text-emerald-600',
  },
  not_interested: {
    label: 'Non interessato',
    active: 'border-rose-300 bg-rose-500 text-white',
    idle: 'border-slate-200 text-slate-500 hover:border-rose-300 hover:text-rose-600',
  },
  no_answer: {
    label: 'Nessuna risposta',
    active: 'border-slate-300 bg-slate-500 text-white',
    idle: 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700',
  },
}

export const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
  telegram: 'Telegram',
  linkedin: 'LinkedIn',
  call: 'Telefono',
  other: 'Altro',
}

export const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: 'bg-emerald-500',
  email: 'bg-blue-500',
  telegram: 'bg-sky-500',
  linkedin: 'bg-[#0a66c2]',
  call: 'bg-slate-500',
  other: 'bg-slate-400',
}

export function normalizeWebsite(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase().replace(/\/+$/, '')
  return trimmed || null
}

// Match keys for a lead (both website and name) so it matches if either was logged.
export function leadMatchKeys(website: string | null | undefined, name: string | null | undefined): string[] {
  const web = normalizeWebsite(website)
  const nm = name ? name.trim().toLowerCase() : ''
  return [web ? `w:${web}` : null, nm ? `n:${nm}` : null].filter(Boolean) as string[]
}

// Canonical single key per lead (prefer website) for distinct counting.
export function canonicalKey(website: string | null | undefined, name: string | null | undefined): string | null {
  const web = normalizeWebsite(website)
  if (web) return `w:${web}`
  const nm = name ? name.trim().toLowerCase() : ''
  return nm ? `n:${nm}` : null
}

export type OutreachComplianceChannel = 'email' | 'phone' | 'whatsapp'

export type OutreachComplianceResult = {
  allowed: boolean
  status: 'clear' | 'blocked' | 'unknown' | 'manual_review'
  message: string
  requiresConfirmation: boolean
}

/** Client-side helper: chiama API compliance prima di aprire canale outreach. */
export async function verifyOutreachCompliance(params: {
  channel: OutreachComplianceChannel
  email?: string | null
  phone?: string | null
  logBasis?: boolean
}): Promise<OutreachComplianceResult> {
  const target =
    params.channel === 'email'
      ? params.email?.trim()
      : params.phone?.trim()

  if (!target) {
    return {
      allowed: true,
      status: 'unknown',
      message: 'Nessun target da verificare.',
      requiresConfirmation: false,
    }
  }

  try {
    const res = await fetch('/api/compliance/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: params.channel,
        target,
        email: params.email,
        phone: params.phone,
        logBasis: params.logBasis ?? false,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return {
        allowed: true,
        status: 'unknown',
        message: typeof data.error === 'string' ? data.error : 'Verifica non disponibile.',
        requiresConfirmation: true,
      }
    }
    const status = data.status as OutreachComplianceResult['status']
    return {
      allowed: status !== 'blocked',
      status,
      message: typeof data.message === 'string' ? data.message : 'Verifica completata.',
      requiresConfirmation: status === 'unknown' || status === 'manual_review',
    }
  } catch {
    return {
      allowed: true,
      status: 'unknown',
      message: 'Verifica compliance non disponibile — procedi con cautela.',
      requiresConfirmation: true,
    }
  }
}

export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.floor((Date.now() - t) / 86_400_000)
}

export type OutreachDerived = {
  sentKeys: Set<string>
  lastSend: Map<string, string>
  latestOutcome: Map<string, string>
}

// Derive per-lead views from the raw event log (expects newest-first order).
export function deriveOutreach(items: OutreachStatusItem[]): OutreachDerived {
  const sentKeys = new Set<string>()
  const lastSend = new Map<string, string>()
  const latestOutcome = new Map<string, string>()
  for (const item of items) {
    const keys = leadMatchKeys(item.lead_website, item.lead_name)
    const isSend = item.status === 'sent'
    const isOutcome = OUTCOME_STATUSES.has(item.status)
    for (const k of keys) {
      if (isSend) {
        sentKeys.add(k)
        if (!lastSend.has(k)) lastSend.set(k, item.created_at)
      }
      if (isOutcome && !latestOutcome.has(k)) latestOutcome.set(k, item.status)
    }
  }
  return { sentKeys, lastSend, latestOutcome }
}

export type OutreachFunnel = {
  contacted: number
  responses: number
  interested: number
  notInterested: number
  responseRate: number
  interestRate: number
}

// Global funnel over distinct leads (canonical key).
export function computeFunnel(items: OutreachStatusItem[]): OutreachFunnel {
  const sent = new Set<string>()
  const outcome = new Map<string, string>()
  for (const item of items) {
    const key = canonicalKey(item.lead_website, item.lead_name)
    if (!key) continue
    if (item.status === 'sent') sent.add(key)
    if (OUTCOME_STATUSES.has(item.status) && !outcome.has(key)) outcome.set(key, item.status)
  }
  let responses = 0
  let interested = 0
  let notInterested = 0
  for (const st of outcome.values()) {
    if (RESPONSE_OUTCOMES.has(st)) responses += 1
    if (st === 'interested') interested += 1
    if (st === 'not_interested') notInterested += 1
  }
  const contacted = sent.size
  return {
    contacted,
    responses,
    interested,
    notInterested,
    responseRate: contacted > 0 ? Math.round((responses / contacted) * 100) : 0,
    interestRate: contacted > 0 ? Math.round((interested / contacted) * 100) : 0,
  }
}

// ============================================================================
// Campaign Agent — explainable, deterministic prioritisation engine.
// The agent reasons over the whole list and proposes an ordered outreach plan
// (who to contact first, on which channel, and WHY). Deterministic by design:
// fully transparent/auditable (manifesto: spiegabilità) and zero extra egress.
// ============================================================================

export type RecommendedChannel = 'whatsapp' | 'email' | 'linkedin'

export const RECOMMENDED_CHANNEL_LABEL: Record<RecommendedChannel, string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
  linkedin: 'LinkedIn',
}

export type CampaignPriority = 'high' | 'medium' | 'low'

export const PRIORITY_META: Record<CampaignPriority, { label: string; badge: string; dot: string }> = {
  high: { label: 'Alta', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  medium: { label: 'Media', badge: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  low: { label: 'Bassa', badge: 'border-slate-200 bg-slate-50 text-slate-500', dot: 'bg-slate-400' },
}

export type CampaignLeadStatus = {
  contacted: boolean
  lastDays: number | null
  outcome: string | null
}

export type CampaignAgentLead = {
  score?: number | null
  phone?: string | null
  email?: string | null
  problemsCount?: number
}

export type CampaignStep<T> = {
  lead: T
  priority: CampaignPriority
  priorityScore: number
  channel: RecommendedChannel
  reasons: string[]
  status: CampaignLeadStatus
  excluded: boolean
}

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/

export function recommendChannel(lead: CampaignAgentLead): RecommendedChannel {
  if (lead.phone && lead.phone.trim()) return 'whatsapp'
  if (lead.email && EMAIL_RE.test(lead.email)) return 'email'
  return 'linkedin'
}

// Produce an ordered, explainable outreach plan. `statusOf` injects per-lead
// outreach history so the agent respects guardrails and the closed-loop funnel.
export function buildCampaignPlan<T extends CampaignAgentLead>(
  leads: T[],
  statusOf: (lead: T) => CampaignLeadStatus
): CampaignStep<T>[] {
  const steps = leads.map<CampaignStep<T>>((lead) => {
    const status = statusOf(lead)
    const channel = recommendChannel(lead)
    const reasons: string[] = []

    let score = typeof lead.score === 'number' ? lead.score : 50
    if (typeof lead.score === 'number') reasons.push(`Score AI ${lead.score}`)

    if (channel === 'whatsapp') {
      score += 15
      reasons.push('Telefono disponibile → WhatsApp (canale ad alta risposta)')
    } else if (channel === 'email') {
      score += 6
      reasons.push('Email disponibile')
    } else {
      score -= 5
      reasons.push('Nessun contatto diretto → ricerca LinkedIn')
    }

    const pc = lead.problemsCount || 0
    if (pc > 0) {
      score += Math.min(15, pc * 5)
      reasons.push(`${pc} ${pc === 1 ? 'opportunità da agganciare' : 'opportunità da agganciare'}`)
    }

    const recentlyContacted = status.lastDays !== null && status.lastDays <= RECENT_CONTACT_DAYS
    let excluded = false

    if (status.outcome === 'not_interested') {
      excluded = true
      score -= 1000
      reasons.push('Esito: non interessato — escluso dal piano')
    } else if (status.outcome === 'interested') {
      score += 20
      reasons.push('Esito: interessato — follow-up caldo, priorità')
    } else if (recentlyContacted) {
      score -= 50
      reasons.push(`Contattato ${status.lastDays === 0 ? 'oggi' : `${status.lastDays}g fa`} — rispetta finestra anti-duplicato`)
    } else if (status.contacted) {
      score -= 25
      reasons.push(`Già contattato${status.lastDays !== null ? ` ${status.lastDays}g fa` : ''} — eventuale follow-up`)
    } else {
      reasons.push('Mai contattato — priorità al primo contatto')
    }

    const priority: CampaignPriority = score >= 80 ? 'high' : score >= 55 ? 'medium' : 'low'
    return { lead, priority, priorityScore: score, channel, reasons, status, excluded }
  })

  steps.sort((a, b) => b.priorityScore - a.priorityScore)
  return steps
}

// Best-effort POST to the audit log. Never throws.
export async function logOutreach(payload: {
  leadId?: string
  website?: string | null
  name?: string | null
  channel: string
  message?: string
  rationale?: string
  mode?: OutreachMode
  status?: string
  leadScore?: number
  leadPhone?: string
  leadEmail?: string
  leadCity?: string
  leadCategory?: string
}): Promise<void> {
  try {
    await fetch('/api/outreach/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    /* best-effort */
  }
}
