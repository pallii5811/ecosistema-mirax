import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  buildQueriedSourceEvents,
  ledgerActualCost,
  leadEvidenceUrl,
  normalizeObservationDate,
  sourceMetadataFromLead,
} from '../src/lib/evaluation/v5-source-telemetry'

assert.equal(ledgerActualCost({ status: 'released', estimated_cost_eur: 1 }), 0)
assert.equal(ledgerActualCost({ status: 'reserved', estimated_cost_eur: 1 }), 0)
assert.equal(ledgerActualCost({ status: 'settled', actual_cost_eur: 0.02 }), 0.02)
assert.equal(ledgerActualCost({ status: 'failed', actual_cost_eur: null, estimated_cost_eur: 0.03 }), 0.03)
assert.equal(normalizeObservationDate('luglio 2026'), null)
assert.equal(normalizeObservationDate('2026'), null)
assert.equal(normalizeObservationDate('2026-07-14T10:00:00Z'), '2026-07-14T10:00:00Z')
assert.equal(leadEvidenceUrl({ agentic_source_url: 'https://source.example/evidence' }), 'https://source.example/evidence')
assert.equal(leadEvidenceUrl({ technical_report: { agentic_source_url: 'https://source.example/report' } }), 'https://source.example/report')

const telemetry = buildQueriedSourceEvents({
  runId: 'run', canaryId: 'canary', searchId: 'search', vertical: 'manufacturing',
  fallbackSource: 'official_company_website',
  queryYield: {
    'site:infojobs.it operai Italia': {
      pages: 1, leads: 1, source_lane: 'job_market', source_types: ['job_board'],
      expected_signals: ['hiring_operational'], query_status: 'completed', urls_discovered: 7,
      source_urls: ['https://www.infojobs.it/job/1', 'https://www.infojobs.it/job/2'],
      source_observations: [{ url: 'https://www.infojobs.it/job/1', observed_at: '2026-07-14T10:00:00Z' }],
    },
    'site:ted.europa.eu appalto Italia': {
      pages: 0, leads: 0, source_lane: 'public_procurement',
      source_types: ['public_procurement_portal'], expected_signals: ['contract_awarded'],
      query_status: 'completed', urls_discovered: 0, source_urls: [],
    },
  },
  ledger: [
    { operation_type: 'intent_compile', status: 'settled', actual_cost_eur: 0.05 },
    { operation_type: 'search_web', status: 'settled', actual_cost_eur: 0.015 },
    { operation_type: 'open_page', status: 'settled', actual_cost_eur: 0.0006 },
    { operation_type: 'llm_extract', status: 'settled', actual_cost_eur: 0.02, metadata: { source_url: 'https://www.infojobs.it/job/1' } },
    { operation_type: 'open_page', status: 'released', estimated_cost_eur: 99 },
  ],
})

assert.equal(telemetry.events.length, 3, 'two URLs plus a zero-yield query must remain observable')
assert.equal(telemetry.events.filter((event) => event.source_id === 'job_board').length, 2)
assert.equal(telemetry.events.filter((event) => event.source_id === 'public_procurement_portal').length, 1)
assert.ok(telemetry.events.some((event) => event.source_url === 'https://www.infojobs.it/job/1'))
assert.ok(telemetry.events.some((event) => event.observation_date === '2026-07-14T10:00:00Z'))
assert.ok(Math.abs(telemetry.actualCostEur - 0.0856) < 1e-10)
assert.ok(Math.abs(telemetry.attributedCostEur - telemetry.actualCostEur) < 1e-10)

const leadSource = sourceMetadataFromLead({
  source_lane: 'job_market', source_types: ['job_board'], query_source: 'careers sales',
  source_publisher: 'azienda.example', source_observation_date: '2026-07-14T11:00:00Z',
}, 'https://azienda.example/careers', 'official_company_website')
assert.equal(leadSource.sourceId, 'job_board')
assert.equal(leadSource.publisher, 'azienda.example')
assert.equal(leadSource.query, 'careers sales')

const finalizer = fs.readFileSync('scripts/run-v5-shadow-case.ts', 'utf8')
assert.doesNotMatch(finalizer, /extractionRejectedEvents/)
assert.doesNotMatch(finalizer, /candidate_ref:\s*`extraction-/)
assert.match(finalizer, /row\.stage === 'rejected'/)
const promoter = fs.readFileSync('scripts/promote-rejected-v5-adversarial.mjs', 'utf8')
assert.match(promoter, /candidate_ref !~ '\^extraction-/)
assert.match(promoter, /metadata->>'company'/)

console.log('v5 source telemetry: PASS')
