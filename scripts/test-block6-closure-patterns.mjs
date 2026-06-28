/**
 * Blocco 6 — unit tests: closure patterns
 */
import assert from 'node:assert/strict'
import { analyzeClosurePatterns } from '../src/lib/closure-patterns.ts'

const pipeline = [
  { lead_website: 'https://a.it', lead_score: 80, stage: 'vinto', updated_at: '2026-06-20T00:00:00Z' },
  { lead_website: 'https://b.it', lead_score: 80, stage: 'vinto', updated_at: '2026-06-21T00:00:00Z' },
  { lead_website: 'https://c.it', lead_score: 30, stage: 'perso', updated_at: '2026-06-22T00:00:00Z' },
  { lead_website: 'https://d.it', lead_score: 30, stage: 'perso', updated_at: '2026-06-22T00:00:00Z' },
]

const outreach = [
  { lead_website: 'https://a.it', channel: 'whatsapp', status: 'interested', created_at: '2026-06-10T00:00:00Z' },
  { lead_website: 'https://b.it', channel: 'email', status: 'sent', created_at: '2026-06-01T00:00:00Z' },
]

const patterns = analyzeClosurePatterns(pipeline, outreach)
assert.ok(patterns.length > 0)

const hot = patterns.find((p) => p.signal === 'score_hot')
assert.ok(hot)
assert.equal(hot.won, 2)
assert.ok(hot.liftPts > 0)

const tooFew = analyzeClosurePatterns(pipeline.slice(0, 2), outreach)
assert.deepEqual(tooFew, [])

console.log('[test-block6-closure-patterns] OK')
