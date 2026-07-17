import assert from 'node:assert/strict'

import {
  STAGE1_CAPABILITY_MATRIX,
  resolveStage1CapabilityFromSignals,
  stage1SearchOutcomeStatus,
  stage1UserMessage,
} from '../src/lib/stage1-capabilities.ts'

assert.equal(STAGE1_CAPABILITY_MATRIX.length, 6)
assert.equal(resolveStage1CapabilityFromSignals([]).id, 'digital_audit')
assert.equal(resolveStage1CapabilityFromSignals(['hiring_sales']).status, 'SUPPORTED_PARTIAL')
assert.equal(resolveStage1CapabilityFromSignals(['tender_won']).id, 'procurement')
assert.equal(resolveStage1CapabilityFromSignals(['expansion']).id, 'growth_expansion')
assert.equal(resolveStage1CapabilityFromSignals(['unknown_signal_xyz']).status, 'BETA')

assert.equal(
  stage1SearchOutcomeStatus(resolveStage1CapabilityFromSignals([]), { brakeEngaged: true }),
  'unavailable',
)
assert.equal(
  stage1SearchOutcomeStatus(resolveStage1CapabilityFromSignals(['expansion']), {
    found: 2,
    target: 5,
  }),
  'partial',
)
assert.match(stage1UserMessage(resolveStage1CapabilityFromSignals(['tender_won'])), /SUPPORTED_PARTIAL/)

console.log('stage1-capabilities: ok')
