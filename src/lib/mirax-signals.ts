/**
 * Contratto unificato segnali MIRAX — technical + business + intent + compliance.
 * Estende buyingSignals.ts senza breaking change.
 */

import type { BuyingSignal, BuyingSignalSummary } from '@/utils/buyingSignals'
import { analyzeBuyingSignals } from '@/utils/buyingSignals'
import { collectBusinessEventsFromLead, type BusinessSignalType } from '@/lib/business-events'

export type MiraxSignalKind = 'technical' | 'business' | 'intent' | 'compliance'

export type MiraxSignalEvidence = {
  label: string
  value: string
  source: string
  url?: string
}

export type MiraxSignal = {
  id: string
  kind: MiraxSignalKind
  signalType?: BusinessSignalType | string
  title: string
  severity: 'critical' | 'high' | 'medium'
  confidence: number
  reason: string
  evidence: MiraxSignalEvidence[]
  serviceToSell?: string
  openingLine?: string
  nextBestAction?: string
  detectedAt?: string
}

export type MiraxSignalSummary = {
  score: number
  label: 'freddo' | 'interessante' | 'caldo' | 'caldissimo'
  primaryReason: string
  signals: MiraxSignal[]
  businessSignals: MiraxSignal[]
  technicalSignals: MiraxSignal[]
  intentSignals: MiraxSignal[]
  buying: BuyingSignalSummary
}

const SOURCE_MAP: Record<string, string> = {
  website_audit: 'website_audit',
  lead_data: 'lead_data',
  registry: 'openapi_it',
  reviews: 'google_reviews',
  ads: 'meta_ad_library',
  contacts: 'lead_data',
}

export function buyingSignalToMirax(signal: BuyingSignal): MiraxSignal {
  return {
    id: signal.id,
    kind: 'technical',
    title: signal.title,
    severity: signal.severity,
    confidence: signal.confidence,
    reason: signal.reason,
    evidence: signal.evidence.map((e) => ({
      label: e.label,
      value: e.value,
      source: SOURCE_MAP[e.source] || e.source,
    })),
    serviceToSell: signal.serviceToSell,
    openingLine: signal.openingLine,
    nextBestAction: signal.nextBestAction,
  }
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function signalWeight(signal: MiraxSignal) {
  const severityWeight = signal.severity === 'critical' ? 34 : signal.severity === 'high' ? 24 : 14
  return severityWeight + Math.round(signal.confidence * 0.18)
}

function labelFromScore(score: number): MiraxSignalSummary['label'] {
  if (score >= 80) return 'caldissimo'
  if (score >= 60) return 'caldo'
  if (score >= 35) return 'interessante'
  return 'freddo'
}

/** Analisi completa: segnali tecnici (buyingSignals) + business events dal lead. */
export function analyzeMiraxSignals(input: unknown): MiraxSignalSummary {
  const buying = analyzeBuyingSignals(input)
  const technicalSignals = buying.signals.map(buyingSignalToMirax)
  const businessSignals = collectBusinessEventsFromLead(input)
  const intentSignals = businessSignals.filter((s) => s.kind === 'intent')
  const pureBusinessSignals = businessSignals.filter((s) => s.kind !== 'intent')

  const allSignals = [...businessSignals, ...technicalSignals].sort((a, b) => {
    const rank = { critical: 0, high: 1, medium: 2 }
    return rank[a.severity] - rank[b.severity] || b.confidence - a.confidence
  })

  const businessBoost = pureBusinessSignals.length > 0 ? Math.min(25, pureBusinessSignals.length * 8) : 0
  const intentBoost = intentSignals.length > 0 ? 12 : 0
  const score = clampScore(buying.score + businessBoost + intentBoost)
  const primaryReason =
    intentSignals[0]?.title || businessSignals[0]?.title || buying.primaryReason

  return {
    score,
    label: labelFromScore(score),
    primaryReason,
    signals: allSignals,
    businessSignals: pureBusinessSignals,
    technicalSignals,
    intentSignals,
    buying,
  }
}

export function hasBusinessSignalType(summary: MiraxSignalSummary, types: string[]): boolean {
  if (types.length === 0) return true
  const set = new Set(types)
  return summary.businessSignals.some((s) => s.signalType && set.has(s.signalType))
}

export function miraxSignalWeight(signal: MiraxSignal) {
  return signalWeight(signal)
}
