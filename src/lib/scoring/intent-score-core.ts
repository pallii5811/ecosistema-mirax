/**
 * Core intent score — no Next.js path aliases (testable from Node scripts).
 */

import { DEFAULT_SIGNAL_RELATIONSHIPS, type SignalRelationship } from './signal-relationships.ts'

export type CoreScorableSignal = {
  signalType?: string
  type?: string
  title?: string
  detectedAt?: string
  confidence?: number
  signal_strength?: number
  freshness_hours?: number
  source_tier?: 'official' | 'aggregator' | 'inferred'
}

export type IntentScoreBreakdown = {
  score: number
  basePoints: number
  recentMultiplier: number
  strengthMultiplier: number
  relationshipMultiplier: number
  contributors: string[]
  signalTypes: string[]
}

export function computeSignalStrength(signal: {
  confidence?: number
  freshness_hours?: number
  source_tier?: 'official' | 'aggregator' | 'inferred'
  signal_strength?: number
}): number {
  if (typeof signal.signal_strength === 'number' && Number.isFinite(signal.signal_strength)) {
    return Math.max(0, Math.min(100, Math.round(signal.signal_strength)))
  }
  const confidence = typeof signal.confidence === 'number' ? signal.confidence : 50
  const freshness_hours = typeof signal.freshness_hours === 'number' ? signal.freshness_hours : 0
  const tierMult =
    signal.source_tier === 'official' ? 1.0 : signal.source_tier === 'inferred' ? 0.5 : 0.8
  const freshMult = Math.max(0, (168 - freshness_hours) / 168)
  return Math.max(0, Math.min(100, Math.round(confidence * freshMult * tierMult)))
}

export function resolveSignalType(signal: CoreScorableSignal): string {
  return String(signal.signalType || signal.type || '').trim()
}

function relationshipMultiplier(types: Set<string>, relationships: SignalRelationship[]): number {
  let mult = 1
  for (const rel of relationships) {
    if (types.has(rel.signal_a_type) && types.has(rel.signal_b_type)) {
      mult *= 1 + rel.weight * 0.5
    }
  }
  return mult
}

export function buildIntentScoreBreakdown(
  signals: CoreScorableSignal[],
  relationships: SignalRelationship[] = DEFAULT_SIGNAL_RELATIONSHIPS,
): IntentScoreBreakdown {
  if (!signals.length) {
    return {
      score: 0,
      basePoints: 0,
      recentMultiplier: 1,
      strengthMultiplier: 1,
      relationshipMultiplier: 1,
      contributors: [],
      signalTypes: [],
    }
  }

  const types = new Set(signals.map(resolveSignalType).filter(Boolean))
  const has = (t: string) => types.has(t)

  let basePoints = 0
  const contributors: string[] = []

  if (has('hiring') && has('crm_change')) {
    basePoints += 35
    contributors.push('Assunzioni + cambio CRM (+35)')
  }
  if (has('tender_won')) {
    basePoints += 25
    contributors.push('Gara vinta (+25)')
  }
  if (has('funding_received') || has('funding_news')) {
    basePoints += 20
    contributors.push('Funding (+20)')
  }
  if (has('hiring')) {
    basePoints += 15
    contributors.push('Assunzioni (+15)')
  }
  if (has('expansion') || has('new_location')) {
    basePoints += 15
    contributors.push('Espansione (+15)')
  }
  if (has('executive_change')) {
    basePoints += 15
    contributors.push('Cambio executive (+15)')
  }
  if (has('website_changed')) {
    basePoints += 10
    contributors.push('Sito modificato (+10)')
  }
  if (has('site_stale')) {
    basePoints += 5
    contributors.push('Sito datato (+5)')
  }

  let score = basePoints

  const recentSignals = signals.filter(
    (s) =>
      s.detectedAt &&
      Date.now() - new Date(s.detectedAt).getTime() < 30 * 24 * 60 * 60 * 1000,
  )
  const recentMultiplier = recentSignals.length >= 3 ? 1.2 : 1
  if (recentMultiplier > 1) contributors.push('≥3 segnali recenti (×1.2)')
  score *= recentMultiplier

  const avgStrength =
    signals.reduce((a, s) => a + computeSignalStrength(s), 0) / Math.max(1, signals.length)
  const strengthMultiplier = avgStrength / 100
  score *= strengthMultiplier

  const relMult = relationshipMultiplier(types, relationships)
  if (relMult > 1) contributors.push(`Relazioni segnali (×${relMult.toFixed(2)})`)
  score *= relMult

  return {
    score: Math.min(100, Math.round(score)),
    basePoints,
    recentMultiplier,
    strengthMultiplier,
    relationshipMultiplier: relMult,
    contributors,
    signalTypes: [...types],
  }
}

export function calculateIntentScore(
  signals: CoreScorableSignal[],
  relationships?: SignalRelationship[],
): number {
  return buildIntentScoreBreakdown(signals, relationships).score
}

export function intentScoreLabel(score: number): 'freddo' | 'tiepido' | 'caldo' | 'hot' {
  if (score >= 80) return 'hot'
  if (score >= 60) return 'caldo'
  if (score >= 30) return 'tiepido'
  return 'freddo'
}

export function intentScoreTone(score: number): string {
  if (score >= 80) return 'bg-violet-600 text-white border-violet-700'
  if (score >= 60) return 'bg-emerald-600 text-white border-emerald-700'
  if (score >= 30) return 'bg-amber-100 text-amber-800 border-amber-300'
  return 'bg-rose-50 text-rose-700 border-rose-200'
}
