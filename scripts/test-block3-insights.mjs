/**
 * Blocco 3 — unit tests: insights "cosa fare ora"
 */
import assert from 'node:assert/strict'
import {
  buildEdatActions,
  buildPipelineActions,
  sortInsightActions,
} from '../src/lib/insights-action-rules.ts'

const now = Date.parse('2026-06-24T12:00:00.000Z')
const old = new Date(now - 10 * 86_400_000).toISOString()

const pipelineActions = buildPipelineActions(
  [
    { lead_name: 'A', stage: 'nuovo', lead_score: 80, updated_at: old },
    { lead_name: 'B', stage: 'proposta', updated_at: old },
  ],
  now,
)
assert.ok(pipelineActions.some((a) => a.type === 'hot_uncontacted'))
assert.ok(pipelineActions.some((a) => a.type === 'urgent_proposal'))

const edat = buildEdatActions({
  staleLeadCount: 5,
  staleExamples: ['Acme'],
  unreadAlerts: 2,
  monitoredCount: 3,
  outreachFollowUpCount: 4,
  pendingSequenceEmails: 7,
})
assert.ok(edat.some((a) => a.type === 'stale_leads'))
assert.ok(edat.some((a) => a.type === 'sequence_pending'))

const sorted = sortInsightActions([
  { type: 'x', severity: 'info', title: '', body: '', cta: { label: '', href: '' }, count: 1, examples: [] },
  { type: 'y', severity: 'critical', title: '', body: '', cta: { label: '', href: '' }, count: 1, examples: [] },
])
assert.equal(sorted[0].severity, 'critical')

console.log('[test-block3-insights] OK')
