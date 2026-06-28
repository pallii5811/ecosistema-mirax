#!/usr/bin/env node
/**
 * Fase 11 — CRM auto-sync core tests
 */
import {
  shouldAutoSyncLead,
  shouldAutoCreateDeal,
  buildMiraxCrmPayload,
  hubspotPropertiesFromMirax,
  leadSyncDedupeKey,
} from '../src/lib/crm/hub-core.ts'

let passed = 0
let failed = 0

function ok(label) {
  passed += 1
  console.log(`✓ ${label}`)
}
function fail(label, detail) {
  failed += 1
  console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('═══ CRM auto-sync (Fase 11-11) ═══\n')

const off = { auto_sync_hot_leads: false, auto_create_deals: false }
const onSync = { auto_sync_hot_leads: true, auto_create_deals: false }
const onDeal = { auto_sync_hot_leads: true, auto_create_deals: true }

if (!shouldAutoSyncLead(59, onSync)) ok('score 59 + toggle ON → no sync')
else fail('59 sync')

if (shouldAutoSyncLead(60, onSync)) ok('score 60 + toggle ON → sync')
else fail('60 sync')

if (!shouldAutoSyncLead(80, off)) ok('toggle OFF → no sync')
else fail('off sync')

if (shouldAutoCreateDeal(80, onDeal)) ok('score 80 + deal toggle → create deal')
else fail('deal 80')

if (!shouldAutoCreateDeal(79, onDeal)) ok('score 79 → no deal')
else fail('deal 79')

const lead = {
  nome: 'Acme Srl',
  email: 'info@acme.it',
  sito: 'https://acme.it',
  business_signals: [{ type: 'hiring', title: 'Assunzione commerciale' }],
}
const payload = buildMiraxCrmPayload(lead, 72)
if (payload.intentScore === 72 && payload.signalTypes.includes('hiring')) ok('buildMiraxCrmPayload')
else fail('payload', JSON.stringify(payload))

const props = hubspotPropertiesFromMirax(lead, payload)
if (props.company === 'Acme Srl' && props.mirax_intent_score === '72') ok('hubspotPropertiesFromMirax')
else fail('hubspot props', JSON.stringify(props))

if (leadSyncDedupeKey(lead) === 'email:info@acme.it') ok('dedupe by email')
else fail('dedupe email')

if (leadSyncDedupeKey({ sito: 'https://foo.it' }) === 'site:https://foo.it') ok('dedupe by site')
else fail('dedupe site')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
