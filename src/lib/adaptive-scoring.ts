/**
 * Adattamento pesi score da esiti outreach + pipeline (rule-based, no ML).
 * @see docs/SCORE_AI_RULES.md
 */

import type { ScoringWeights } from '@/types/scoring'

export type ScoringFeedbackSample = {
  outcome: 'positive' | 'negative'
  scoreAtTime: number | null
}

const WEIGHT_KEYS: (keyof ScoringWeights)[] = [
  'weight_no_pixel',
  'weight_no_gtm',
  'weight_no_ssl',
  'weight_has_email',
  'weight_seo_errors',
  'weight_slow_speed',
  'weight_no_google_ads',
]

function clampWeight(n: number, min = 3, max = 45): number {
  return Math.max(min, Math.min(max, Math.round(n)))
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

/**
 * Se i deal positivi hanno score medio più alto dei negativi, aumenta leggermente i pesi
 * (il segnale "opportunity" predice bene per questo utente).
 */
export function adjustWeightsFromFeedback(
  base: ScoringWeights,
  samples: ScoringFeedbackSample[],
): ScoringWeights {
  if (samples.length < 5) return { ...base }

  const positives = samples.filter((s) => s.outcome === 'positive' && typeof s.scoreAtTime === 'number')
  const negatives = samples.filter((s) => s.outcome === 'negative' && typeof s.scoreAtTime === 'number')

  if (positives.length < 2 || negatives.length < 2) return { ...base }

  const posAvg = avg(positives.map((s) => s.scoreAtTime as number))
  const negAvg = avg(negatives.map((s) => s.scoreAtTime as number))
  const spread = posAvg - negAvg

  if (Math.abs(spread) < 8) return { ...base }

  const factor = spread > 0 ? 1.04 : 0.96
  const out = { ...base }
  for (const key of WEIGHT_KEYS) {
    out[key] = clampWeight(out[key] * factor)
  }
  return out
}

export function outreachStatusToFeedbackOutcome(
  status: string,
): 'positive' | 'negative' | null {
  const st = status.trim().toLowerCase()
  if (st === 'interested' || st === 'replied') return 'positive'
  if (st === 'not_interested') return 'negative'
  if (st === 'sent') return null
  return null
}

export function pipelineStageToFeedbackOutcome(
  stage: string,
): 'positive' | 'negative' | null {
  if (stage === 'vinto') return 'positive'
  if (stage === 'perso') return 'negative'
  return null
}
