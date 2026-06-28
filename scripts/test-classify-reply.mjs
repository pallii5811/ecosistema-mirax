/**
 * Test classificazione risposte AI SDR (rule-based, no API)
 * Run: node scripts/test-classify-reply.mjs
 */

import assert from 'node:assert/strict'

function normalize(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function classifyReplyRules(replySnippet) {
  const t = normalize(replySnippet)
  if (/\b(unsubscribe|opt.?out|rimuov|non contatt)\b/.test(t)) return 'unsubscribe'
  if (/\b(non sono|persona sbagliata|wrong person|referente)\b/.test(t)) return 'wrong_person'
  if (/\b(non interess|no grazie|non mi interessa)\b/.test(t)) return 'not_interested'
  if (/\b(interessat|mandami|call|appuntament|ok proced)\b/.test(t)) return 'interested'
  if (/\b(piu tardi|non ora|tra un mese|richiam|mese prossim|occupat)\b/.test(t)) return 'not_now'
  return 'unknown'
}

const FIXTURES = [
  { text: 'Mi interessa, mandami maggiori info. Possiamo fare una call giovedì?', expect: 'interested' },
  { text: 'Non mi interessa, grazie lo stesso.', expect: 'not_interested' },
  { text: 'Riprova tra un mese, ora siamo occupati con altri progetti.', expect: 'not_now' },
  { text: 'Non sono la persona giusta, inoltra a mario@azienda.it', expect: 'wrong_person' },
  { text: 'Rimuovetemi dalla lista unsubscribe please', expect: 'unsubscribe' },
]

let passed = 0
for (const f of FIXTURES) {
  const got = classifyReplyRules(f.text)
  assert.equal(got, f.expect, `Fixture failed: ${f.text.slice(0, 40)}...`)
  console.log(`✓ ${f.expect} — "${f.text.slice(0, 50)}…"`)
  passed += 1
}

console.log(`\n[test-classify-reply] ${passed}/${FIXTURES.length} OK`)
