import {
  CRM_KEYWORD_EXTRACTORS,
  HIRING_ROLE_PATTERNS,
  NL_SIGNAL_PATTERNS,
  SECTOR_KEYWORD_EXTRACTORS,
} from '@/lib/signal-intent/catalog'
import {
  EMPTY_SIGNAL_INTENT,
  type MiraxSignalRequirement,
  type SignalIntentSpec,
} from '@/lib/signal-intent/types'

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}

function extractTimeWindowDays(query: string): number | null {
  const q = query.toLowerCase()
  const m30 = q.match(/\b(ultim[oi]\s+)?30\s+giorni\b/)
  if (m30) return 30
  const m60 = q.match(/\b(ultim[oi]\s+)?60\s+giorni\b/)
  if (m60) return 60
  const m90 = q.match(/\b(ultim[oi]\s+)?90\s+giorni\b/)
  if (m90) return 90
  const mYear = q.match(/\b(ultim[oa]\s+)?anno\b/)
  if (mYear) return 365
  const mMonths = q.match(/\bultim[oi]\s+(\d{1,2})\s+mesi\b/)
  if (mMonths) return Math.min(730, parseInt(mMonths[1], 10) * 30)
  return null
}

function buildSummary(spec: SignalIntentSpec): string | null {
  const parts: string[] = []
  if (spec.required_signals.length) {
    parts.push(`Segnali: ${spec.required_signals.join(', ')}`)
  }
  if (spec.hiring_roles.length) parts.push(`Ruoli: ${spec.hiring_roles.join(', ')}`)
  if (spec.sector_keywords.length) parts.push(`Settore: ${spec.sector_keywords.join(', ')}`)
  if (spec.crm_keywords.length) parts.push(`CRM: ${spec.crm_keywords.join(', ')}`)
  if (spec.time_window_days) parts.push(`Finestra: ${spec.time_window_days}g`)
  return parts.length ? parts.join(' · ') : null
}

/** Parser rule-based — funziona offline, merge con output LLM. */
export function parseSignalIntentHeuristic(userQuery: string): SignalIntentSpec {
  const q = (userQuery || '').trim()
  if (!q) return { ...EMPTY_SIGNAL_INTENT }

  const required_signals: MiraxSignalRequirement[] = []
  for (const entry of NL_SIGNAL_PATTERNS) {
    if (entry.patterns.some((p) => p.test(q))) {
      required_signals.push(entry.requirement)
    }
  }

  const hiring_roles: string[] = []
  for (const entry of HIRING_ROLE_PATTERNS) {
    if (entry.patterns.some((p) => p.test(q))) hiring_roles.push(entry.role)
  }
  if (hiring_roles.length && !required_signals.includes('hiring')) {
    required_signals.push('hiring')
  }

  const sector_keywords: string[] = []
  for (const entry of SECTOR_KEYWORD_EXTRACTORS) {
    if (entry.patterns.some((p) => p.test(q))) sector_keywords.push(entry.keyword)
  }
  if (sector_keywords.length && !required_signals.includes('sector_investment')) {
    const investIntent = /\b(invest|investono|investimento|puntano\s+su|fotovoltaic|rinnovabil|impianti\s+solari)\b/i.test(q)
    const highIntentKw = sector_keywords.some((k) =>
      ['fotovoltaico', 'software', 'logistica'].includes(k),
    )
    if (investIntent || highIntentKw) {
      required_signals.push('sector_investment')
    }
  }

  const crm_keywords: string[] = []
  for (const entry of CRM_KEYWORD_EXTRACTORS) {
    if (entry.patterns.some((p) => p.test(q))) crm_keywords.push(entry.crm)
  }

  const require_crm_change =
    (/\b(cambiat\w*|migrat\w*|nuovo\s+crm|switch|sostituit\w*)\b/i.test(q) &&
      (/\bcrm\b/i.test(q) || crm_keywords.length > 0)) ||
    required_signals.includes('crm_change')

  if (require_crm_change && !required_signals.includes('crm_change')) {
    required_signals.push('crm_change')
  } else if (crm_keywords.length && !required_signals.includes('crm_detected')) {
    required_signals.push('crm_detected')
  }

  if (require_crm_change) {
    const idx = required_signals.indexOf('crm_detected')
    if (idx >= 0 && crm_keywords.length === 0) required_signals.splice(idx, 1)
  }

  let time_window_days = extractTimeWindowDays(q)
  if (required_signals.includes('tender_won') && !time_window_days) {
    time_window_days = 365
  }
  if (require_crm_change && !time_window_days) {
    time_window_days = 30
  }

  const spec: SignalIntentSpec = {
    required_signals: unique(required_signals),
    hiring_roles: unique(hiring_roles),
    sector_keywords: unique(sector_keywords),
    crm_keywords: unique(crm_keywords),
    require_crm_change,
    time_window_days,
    intent_summary: null,
  }
  spec.intent_summary = buildSummary(spec)
  return spec
}

export function mergeSignalIntent(a: SignalIntentSpec, b: SignalIntentSpec): SignalIntentSpec {
  const merged: SignalIntentSpec = {
    required_signals: unique([...a.required_signals, ...b.required_signals]),
    hiring_roles: unique([...a.hiring_roles, ...b.hiring_roles]),
    sector_keywords: unique([...a.sector_keywords, ...b.sector_keywords]),
    crm_keywords: unique([...a.crm_keywords, ...b.crm_keywords]),
    require_crm_change: a.require_crm_change || b.require_crm_change,
    time_window_days: a.time_window_days ?? b.time_window_days,
    intent_summary: null,
  }
  merged.intent_summary = buildSummary(merged) || a.intent_summary || b.intent_summary
  return merged
}

export function coerceSignalIntent(raw: unknown): SignalIntentSpec {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_SIGNAL_INTENT }
  const o = raw as Record<string, unknown>
  const asReq = (v: unknown): MiraxSignalRequirement[] =>
    Array.isArray(v)
      ? v.filter((x): x is MiraxSignalRequirement => typeof x === 'string')
      : []
  const asStr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && Boolean(x.trim())).map((s) => s.trim()) : []

  const spec: SignalIntentSpec = {
    required_signals: asReq(o.required_signals),
    hiring_roles: asStr(o.hiring_roles),
    sector_keywords: asStr(o.sector_keywords),
    crm_keywords: asStr(o.crm_keywords),
    require_crm_change: o.require_crm_change === true,
    time_window_days:
      typeof o.time_window_days === 'number' && Number.isFinite(o.time_window_days)
        ? Math.round(o.time_window_days)
        : null,
    intent_summary: typeof o.intent_summary === 'string' ? o.intent_summary : null,
  }
  if (!spec.intent_summary) spec.intent_summary = buildSummary(spec)
  return spec
}
