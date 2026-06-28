/**
 * Test Signal Intent v2 (onnivoro)
 * Run: node scripts/test-signal-intent.mjs
 */
import assert from 'node:assert/strict'

function parseHeuristic(q) {
  const required = []
  if (/\b(assum|assunz|assumendo|hiring|offerte?\s+di\s+lavoro)\b/i.test(q)) required.push('hiring')
  if (/\b(fotovoltaic|fotovoltaico|pannelli\s+solari)\b/i.test(q)) required.push('sector_investment')
  if (/\b(gara|appalto|aggiudicat)\b/i.test(q)) required.push('tender_won')
  if (/\b(cambiat.*crm|migrat.*crm)\b/i.test(q)) required.push('crm_change')
  const hiring_roles = []
  if (/\bprogrammator|developer\b/i.test(q)) hiring_roles.push('programmatore')
  if (/\bcommercial|venditor\b/i.test(q)) hiring_roles.push('commerciale')
  const sector_keywords = []
  if (/\bfotovoltaic/i.test(q)) sector_keywords.push('fotovoltaico')
  let time_window_days = null
  if (/\b30\s+giorni\b/i.test(q)) time_window_days = 30
  if (/\bultim.*anno\b/i.test(q)) time_window_days = 365
  return { required_signals: required, hiring_roles, sector_keywords, time_window_days }
}

const q1 = parseHeuristic('trova aziende che stanno assumendo programmatori a Milano')
assert.ok(q1.required_signals.includes('hiring'))
assert.ok(q1.hiring_roles.includes('programmatore'))

const q2 = parseHeuristic('imprese edili che hanno vinto una gara nell ultimo anno')
assert.ok(q2.required_signals.includes('tender_won'))
assert.equal(q2.time_window_days, 365)

const q3 = parseHeuristic('PMI che investono nel fotovoltaico')
assert.ok(q3.required_signals.includes('sector_investment'))
assert.ok(q3.sector_keywords.includes('fotovoltaico'))

const q4 = parseHeuristic('aziende che hanno cambiato CRM negli ultimi 30 giorni')
assert.ok(q4.required_signals.includes('crm_change'))
assert.equal(q4.time_window_days, 30)

console.log('[test-signal-intent] 4/4 OK')
