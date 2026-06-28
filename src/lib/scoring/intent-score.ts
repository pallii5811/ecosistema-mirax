/**
 * Fase 7 — Intent Score 0-100 (manifesto v3.0).
 * Lead collection + re-export core formula.
 */

import type { MiraxSignal } from '@/lib/mirax-signals'
import { analyzeMiraxSignals } from '@/lib/mirax-signals'
import { asRecord } from '@/lib/business-events/types'
import {
  buildIntentScoreBreakdown,
  calculateIntentScore,
  computeSignalStrength,
  intentScoreLabel,
  intentScoreTone,
  type IntentScoreBreakdown,
  type CoreScorableSignal,
} from '@/lib/scoring/intent-score-core'

export type ScorableSignal = MiraxSignal & CoreScorableSignal

export {
  buildIntentScoreBreakdown,
  calculateIntentScore,
  computeSignalStrength,
  intentScoreLabel,
  intentScoreTone,
}
export type { IntentScoreBreakdown }

function workerSignalToMirax(raw: Record<string, unknown>): ScorableSignal | null {
  const type = String(raw.type || raw.signal_type || '').trim()
  const title = String(raw.title || '').trim()
  if (!type || !title) return null
  const confidence = typeof raw.confidence === 'number' ? raw.confidence : 60
  const evidenceRaw = raw.evidence
  const evidenceArr = Array.isArray(evidenceRaw)
    ? evidenceRaw
    : evidenceRaw && typeof evidenceRaw === 'object'
      ? [
          {
            label: 'Evidenza',
            value: String((evidenceRaw as Record<string, unknown>).source || type),
            source: String((evidenceRaw as Record<string, unknown>).source || 'worker'),
            url: typeof (evidenceRaw as Record<string, unknown>).url === 'string'
              ? ((evidenceRaw as Record<string, unknown>).url as string)
              : undefined,
          },
        ]
      : [{ label: 'Fonte', value: String(raw.source || 'worker'), source: String(raw.source || 'worker') }]

  return {
    id: `worker_${type}_${title.slice(0, 24).replace(/\s+/g, '_')}`,
    kind: 'business',
    signalType: type,
    type,
    title,
    severity: confidence >= 80 ? 'critical' : confidence >= 60 ? 'high' : 'medium',
    confidence,
    reason: typeof raw.reasoning === 'string' ? raw.reasoning : title,
    evidence: evidenceArr.filter((e) => e && typeof e === 'object') as MiraxSignal['evidence'],
    detectedAt: typeof raw.detected_at === 'string' ? raw.detected_at : undefined,
    freshness_hours: typeof raw.freshness_hours === 'number' ? raw.freshness_hours : undefined,
    source_tier:
      raw.source_tier === 'official' || raw.source_tier === 'inferred' || raw.source_tier === 'aggregator'
        ? raw.source_tier
        : undefined,
    signal_strength: typeof raw.signal_strength === 'number' ? raw.signal_strength : undefined,
  }
}

export function collectScorableSignals(input: unknown): ScorableSignal[] {
  const lead = asRecord(input)
  const summary = analyzeMiraxSignals(lead)
  const fromMirax = summary.signals.map((s) => ({ ...s, type: s.signalType }))
  const workerRaw = Array.isArray(lead.business_signals) ? lead.business_signals : []
  const fromWorker = workerRaw
    .map((s) => (s && typeof s === 'object' ? workerSignalToMirax(s as Record<string, unknown>) : null))
    .filter((s): s is ScorableSignal => Boolean(s))

  const seen = new Set<string>()
  const merged: ScorableSignal[] = []
  for (const s of [...fromWorker, ...fromMirax]) {
    const key = `${s.signalType || s.type || ''}::${s.title}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({
      ...s,
      signal_strength: computeSignalStrength(s),
    })
  }
  return merged
}

export function calculateIntentScoreFromLead(input: unknown): IntentScoreBreakdown {
  return buildIntentScoreBreakdown(collectScorableSignals(input))
}

export function filterLeadsByMinIntentScore<T extends unknown>(
  leads: T[],
  minScore: number,
): T[] {
  if (!minScore || minScore <= 0) return leads
  return leads.filter((lead) => calculateIntentScoreFromLead(lead).score >= minScore)
}
