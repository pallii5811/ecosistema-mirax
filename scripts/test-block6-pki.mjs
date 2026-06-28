/**
 * Blocco 6 — unit tests: PKI score
 */
import assert from 'node:assert/strict'
import { computePKI } from '../src/lib/pki.ts'

const report = computePKI({
  pipeline: { total: 20, won: 6, lost: 4, active: 10, stagnant: 2, pipelineValue: 5000, avgScore: 72 },
  outreach: { contacted: 30, interested: 8, notInterested: 5, responseRate: 40, interestRate: 27 },
  environments: { count: 3, totalLeads: 120 },
  knowledge: { count: 12 },
  mesh: null,
  closurePatterns: [
    {
      signal: 'score_hot',
      label: 'Score ≥ 70',
      won: 4,
      lost: 1,
      baselineWinRate: 60,
      segmentWinRate: 80,
      liftPts: 20,
      confidence: 0.9,
    },
  ],
})

assert.ok(report.score >= 0 && report.score <= 100)
assert.ok(['A', 'B', 'C', 'D', 'F'].includes(report.grade))
assert.equal(report.components.conversion > 0, true)
assert.equal(report.top_lift_pattern?.signal, 'score_hot')
assert.ok(report.signals.length >= 4)

const empty = computePKI({
  pipeline: { total: 0, won: 0, lost: 0, active: 0, stagnant: 0, pipelineValue: 0, avgScore: 0 },
  outreach: { contacted: 0, interested: 0, notInterested: 0, responseRate: 0, interestRate: 0 },
  environments: { count: 0, totalLeads: 0 },
  knowledge: { count: 0 },
  closurePatterns: [],
})

assert.equal(empty.score, 0)
assert.equal(empty.grade, 'F')

console.log('[test-block6-pki] OK')
