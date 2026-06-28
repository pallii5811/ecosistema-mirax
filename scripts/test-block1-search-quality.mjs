#!/usr/bin/env node
/** Unit tests — Blocco 1 search/contact quality helpers */
import assert from 'node:assert/strict'
import {
  computeContactVisibilityStats,
  formatContactVisibilityMessage,
  hasLeadContact,
  shouldTreatScrapeAsExhausted,
  SCRAPE_PLATEAU_STALE_POLLS,
} from '../src/lib/search-contact-quality.ts'

let failed = 0
function test(name, fn) {
  try {
    fn()
    console.log('OK', name)
  } catch (e) {
    failed++
    console.error('FAIL', name, e.message)
  }
}

test('hasLeadContact phone', () => {
  assert.equal(hasLeadContact({ telefono: '3331234567' }), true)
  assert.equal(hasLeadContact({ telefono: 'N/D' }), false)
})

test('hasLeadContact rejects fake email domain', () => {
  assert.equal(hasLeadContact({ email: 'info@example.com' }), false)
  assert.equal(hasLeadContact({ email: 'info@azienda.it' }), true)
})

test('contact visibility stats', () => {
  const leads = [
    { telefono: '333' },
    { email: 'a@b.it' },
    { telefono: 'N/D' },
  ]
  const s = computeContactVisibilityStats(leads)
  assert.equal(s.rawTotal, 3)
  assert.equal(s.withContact, 2)
  assert.equal(s.hiddenNoContact, 1)
  assert.match(formatContactVisibilityMessage(s), /2 con contatto · 1 nascosti/)
})

test('plateau exhaustion', () => {
  assert.equal(
    shouldTreatScrapeAsExhausted({
      status: 'processing',
      rawResultCount: 40,
      displayedCount: 12,
      maxLeads: 50,
      stalePolls: SCRAPE_PLATEAU_STALE_POLLS,
    }),
    true,
  )
  assert.equal(
    shouldTreatScrapeAsExhausted({
      status: 'completed',
      rawResultCount: 40,
      displayedCount: 50,
      maxLeads: 50,
      stalePolls: 0,
    }),
    false,
  )
  assert.equal(
    shouldTreatScrapeAsExhausted({
      status: 'completed',
      rawResultCount: 30,
      displayedCount: 28,
      maxLeads: 50,
      stalePolls: 0,
    }),
    true,
  )
})

if (failed) process.exit(1)
console.log('\nAll Block 1 search-quality tests passed.')
