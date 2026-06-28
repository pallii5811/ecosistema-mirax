/**
 * Blocco 4 — unit tests: adaptive scoring weights
 */
import assert from 'node:assert/strict'
import {
  adjustWeightsFromFeedback,
  outreachStatusToFeedbackOutcome,
  pipelineStageToFeedbackOutcome,
} from '../src/lib/adaptive-scoring.ts'

const base = {
  weight_no_pixel: 25,
  weight_no_gtm: 15,
  weight_no_ssl: 10,
  weight_has_email: 20,
  weight_seo_errors: 15,
  weight_slow_speed: 10,
  weight_no_google_ads: 5,
}

assert.equal(outreachStatusToFeedbackOutcome('interested'), 'positive')
assert.equal(outreachStatusToFeedbackOutcome('not_interested'), 'negative')
assert.equal(pipelineStageToFeedbackOutcome('vinto'), 'positive')

const unchanged = adjustWeightsFromFeedback(base, [
  { outcome: 'positive', scoreAtTime: 70 },
  { outcome: 'negative', scoreAtTime: 68 },
])
assert.equal(unchanged.weight_no_pixel, 25)

const boosted = adjustWeightsFromFeedback(base, [
  { outcome: 'positive', scoreAtTime: 85 },
  { outcome: 'positive', scoreAtTime: 90 },
  { outcome: 'negative', scoreAtTime: 40 },
  { outcome: 'negative', scoreAtTime: 35 },
  { outcome: 'positive', scoreAtTime: 88 },
])
assert.ok(boosted.weight_no_pixel > base.weight_no_pixel)

console.log('[test-block4-adaptive-scoring] OK')
