#!/usr/bin/env node
/**
 * Fase 8 — realtime signal merge tests (no Supabase)
 */

function normalizeWebsiteUrl(raw) {
  const s = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return s.replace(/^www\./, '')
}

function applyRealtimeSignalToResults(results, signal) {
  const target = normalizeWebsiteUrl(signal.lead_website)
  let changed = false
  const next = results.map((item) => {
    const lead = item
    const raw = String(lead.sito || lead.website || '').trim()
    const w = normalizeWebsiteUrl(raw)
    if (!w || w !== target) return item
    const existing = Array.isArray(lead.business_signals) ? lead.business_signals : []
    changed = true
    return {
      ...lead,
      business_signals: [
        ...existing,
        { type: signal.signal_type, title: signal.title, confidence: signal.confidence },
      ],
    }
  })
  return changed ? next : results
}

let passed = 0
let failed = 0
function ok(l) {
  passed++
  console.log(`✓ ${l}`)
}
function fail(l, d) {
  failed++
  console.error(`✗ ${l}${d ? ` — ${d}` : ''}`)
}

console.log('═══ Realtime signal merge (Fase 8) ═══\n')

const results = [{ azienda: 'Acme', sito: 'https://acme.it', business_signals: [] }]
const signal = {
  lead_website: 'acme.it',
  signal_type: 'hiring',
  title: 'Assunzioni dev',
  confidence: 85,
}
const merged = applyRealtimeSignalToResults(results, signal)
if (merged[0].business_signals?.length === 1) ok('merge INSERT in lead match')
else fail('merge', String(merged[0].business_signals?.length))

const noop = applyRealtimeSignalToResults(results, { ...signal, lead_website: 'other.it' })
if (noop === results) ok('no match → unchanged ref')
else fail('noop')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
