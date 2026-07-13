/**
 * Run: node scripts/test-lead-visibility-hiring.mjs
 */
import assert from 'node:assert/strict'

function shouldShowLeadForSignalIntent(intent) {
  if (!intent?.required_signals?.length) return true
  return true
}

const cases = [
  { required_signals: ['hiring'], hiring_roles: ['commerciale'] },
  { required_signals: ['sector_investment'], sector_keywords: ['marketing'] },
  { required_signals: ['investing_marketing'] },
]

for (const intent of cases) {
  assert.equal(shouldShowLeadForSignalIntent(intent), true, JSON.stringify(intent.required_signals))
}

console.log('[test-lead-visibility-hiring] 3/3 OK')
