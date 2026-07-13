#!/usr/bin/env node
/**
 * Test hiring role matching — allineato worker + UI filter.
 * Run: node scripts/test-hiring-roles.mjs
 */
import assert from 'node:assert/strict'
import {
  expandHiringRoles,
  hiringMatchTextFromLead,
  textMatchesHiringRoles,
} from '../src/lib/signal-intent/hiring-roles.ts'

function leadMatchesCommercialeHiring(lead) {
  const hay = hiringMatchTextFromLead(lead)
  return hay.length > 0 && textMatchesHiringRoles(hay, ['commerciale'])
}

assert.ok(expandHiringRoles(['commerciale']).includes('sales'))
assert.ok(textMatchesHiringRoles('Account Manager B2B', ['commerciale']))

const leadWithRole = {
  business_signals: [{ type: 'hiring', title: 'Sta assumendo' }],
  business_hiring_jobs: [{ title: 'Commerciale esterno — Milano' }],
  business_events_external_at: '2026-07-05T00:00:00Z',
}
assert.ok(leadMatchesCommercialeHiring(leadWithRole), 'commerciale match via job title')

const leadGeneric = {
  business_signals: [{ type: 'hiring', title: 'Sta assumendo — pagina careers rilevata sul sito' }],
  business_hiring_jobs: [{ title: 'Sta assumendo — pagina careers rilevata sul sito' }],
  business_events_external_at: '2026-07-05T00:00:00Z',
}
assert.ok(!leadMatchesCommercialeHiring(leadGeneric), 'generic careers must not match commerciale')

const leadEvidence = {
  business_signals: [
    {
      type: 'hiring',
      title: 'Sta assumendo — Sales Manager',
      evidence: [{ label: 'Offerta', value: 'Sales Manager Nord Italia' }],
    },
  ],
  business_events_external_at: '2026-07-05T00:00:00Z',
}
assert.ok(
  textMatchesHiringRoles(hiringMatchTextFromLead(leadEvidence), ['commerciale']),
  'evidence sales manager matches commerciale',
)
assert.ok(leadMatchesCommercialeHiring(leadEvidence))

assert.ok(!textMatchesHiringRoles('communication agency milano', ['commerciale']), 'communication != commerciale')

console.log('✓ test-hiring-roles.mjs OK')
