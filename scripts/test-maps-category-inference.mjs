#!/usr/bin/env node
import { parseSignalIntentHeuristic, inferMapsCategoryFromIntent } from './lib/signal-intent-parser.mjs'

const CASES = [
  {
    q: 'aziende che stanno assumendo programmatori python a Milano',
    expectCategory: 'Servizi informatici',
    expectHiring: true,
  },
  {
    q: 'software house che assumono developer a Torino',
    expectCategory: 'Software house',
    expectHiring: true,
  },
  {
    q: 'ristoranti che assumono personale a Milano',
    expectCategory: 'Ristoranti',
    expectHiring: true,
  },
  {
    q: 'startup che cercano fondi di investimento',
    expectCategory: 'Startup',
    expectHiring: false,
    expectSector: true,
  },
]

let failed = 0
for (const c of CASES) {
  const intent = parseSignalIntentHeuristic(c.q)
  const cat = inferMapsCategoryFromIntent(c.q, intent)
  const hasHiring = intent.required_signals.includes('hiring')
  const hasSector = intent.required_signals.includes('sector_investment')
  if (cat !== c.expectCategory || hasHiring !== c.expectHiring) {
    console.error(`✗ "${c.q}" → cat=${cat} hiring=${hasHiring}`)
    failed++
  } else if (c.expectSector && !hasSector) {
    console.error(`✗ "${c.q}" → sector_investment mancante`)
    failed++
  } else {
    console.log(`✓ ${c.expectCategory} + hiring=${c.expectHiring}`)
  }
}

if (failed) process.exit(1)
console.log(`\ntest-maps-category-inference: ${CASES.length}/${CASES.length} OK`)
