#!/usr/bin/env node
/**
 * Fase 8 — website diff engine tests
 */
import {
  detectWebsiteChange,
  normalizeWebsiteUrl,
  stripHtml,
} from '../src/lib/website-diff/detect-core.ts'

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

console.log('═══ Website Diff (Fase 8) ═══\n')

const html = '<html><body><h1>Servizi fotovoltaico</h1><p>Contattaci</p></body></html>'
const text = stripHtml(html)
if (text.includes('fotovoltaico')) ok('stripHtml estrae testo')
else fail('stripHtml')

if (normalizeWebsiteUrl('https://WWW.Example.com/') === 'example.com') ok('normalizeWebsiteUrl')
else fail('normalize')

const same = detectWebsiteChange(text, text)
if (!same.changed) ok('testo identico → no change')
else fail('identical', String(same.similarity))

const changed = detectWebsiteChange(
  text,
  'Servizi fotovoltaico industriali batterie storage team commerciale nuova sede Milano partnership',
)
if (changed.changed) ok(`contenuto nuovo → changed (sim=${changed.similarity.toFixed(2)})`)
else fail('changed detect')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
