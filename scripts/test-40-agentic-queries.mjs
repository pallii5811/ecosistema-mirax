#!/usr/bin/env node
/**
 * 40 diverse natural-language queries against the extended test graph.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { seedExtendedGraphTest, cleanupExtendedGraphTest } from './seed-graph-test-extended.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function parseEnv(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 1) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}
function loadEnv() {
  for (const p of [path.join(ROOT, '.env.local'), path.join(ROOT, '.env.ecosistema.secrets')]) {
    if (!fs.existsSync(p)) continue
    const env = parseEnv(fs.readFileSync(p, 'utf8'))
    if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) return env
  }
  throw new Error('env')
}
const env = loadEnv()
process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { parseCommercialIntent, parseCommercialIntentOffline } = await import('../src/lib/signal-intent/parse-commercial-intent.ts')
const useOffline = process.argv.includes('--offline') || process.argv.includes('--no-llm')
const { executeCommercialUniverseSearch } = await import('../src/lib/universe/agentic-search.ts')

const CASES = [
  // Location / base
  { q: 'aziende a Milano', expectNames: ['Bistrot Milano Srl'], min: 1 },
  { q: 'aziende a Padova', expectNames: ['SoftwareHouse Padova Srl'], min: 1 },
  { q: 'aziende a Roma', expectNames: ['Impresa Edile Roma Spa'], min: 1 },
  { q: 'aziende a Torino', expectNames: ['Shop Online Torino Srl'], min: 1 },
  { q: 'ristoranti a Milano', expectNames: ['Bistrot Milano Srl'], min: 1 },
  { q: 'software house a Padova', expectNames: ['SoftwareHouse Padova Srl'], min: 1 },
  { q: 'imprese edili a Roma', expectNames: ['Impresa Edile Roma Spa'], min: 1 },
  { q: 'ecommerce a Torino', expectNames: ['Shop Online Torino Srl'], min: 1 },

  // Size / revenue
  { q: 'aziende a Milano con più di 10 dipendenti', expectNames: ['Ristorante La Scala Srl'], min: 1 },
  { q: 'aziende a Milano con fatturato superiore a 1 milione', expectNames: ['Ristorante La Scala Srl'], min: 1 },
  { q: 'aziende con più di 50 dipendenti', expectNames: ['Impresa Edile Roma Spa'], min: 1 },

  // Technology
  { q: 'aziende che usano WordPress', expectNames: ['Bistrot Milano Srl'], min: 1 },
  { q: 'aziende che usano Shopify', expectNames: ['Shop Online Torino Srl'], min: 1 },
  { q: 'aziende che usano React', expectNames: ['SoftwareHouse Padova Srl'], min: 1 },
  { q: 'aziende che usano Meta Pixel', expectNames: ['Shop Online Torino Srl'], min: 1 },
  { q: 'aziende senza Meta Pixel', expectNames: ['Trattoria Duomo Srl'], min: 1 },
  { q: 'aziende con Google Analytics', expectNames: ['SoftwareHouse Padova Srl'], min: 1 },

  // Business signals / events
  { q: 'aziende che hanno vinto gare pubbliche', expectNames: ['Impresa Edile Roma Spa'], min: 1 },
  { q: 'aziende in assunzione', expectNames: ['SoftwareHouse Padova Srl'], min: 1 },
  { q: 'aziende che assumono a Roma', expectNames: ['Impresa Edile Roma Spa'], min: 1 },
  { q: 'aziende che assumono sviluppatori', expectNames: ['SoftwareHouse Padova Srl'], min: 1 },
  { q: 'aziende che hanno ricevuto finanziamenti', expectNames: ['SoftwareHouse Padova Srl'], min: 1 },
  { q: 'startup a Padova', expectNames: ['SoftwareHouse Padova Srl'], min: 1 },

  // Combination filters
  { q: 'aziende a Milano nel settore ristorazione con più di 5 dipendenti', expectNames: ['Bistrot Milano Srl'], min: 1 },
  { q: 'ecommerce a Torino che usano Meta Pixel', expectNames: ['Shop Online Torino Srl'], min: 1 },
  { q: 'aziende a Roma con più di 50 dipendenti', expectNames: ['Impresa Edile Roma Spa'], min: 1 },
  { q: 'aziende a Padova nel settore software', expectNames: ['SoftwareHouse Padova Srl'], min: 1 },

  // Graph single-hop
  { q: 'fornitori di Bistrot Milano Srl', expectNames: ['Fornitore Alimentari Nord Srl'], min: 1 },
  { q: 'clienti di Bistrot Milano Srl', expectNames: ['Ristorante La Scala Srl'], min: 1 },
  { q: 'competitor di Bistrot Milano Srl', expectNames: ['Trattoria Duomo Srl'], min: 1 },
  { q: 'partner di Bistrot Milano Srl', expectNames: ['Delivery Express Srl'], min: 1 },
  { q: 'investitori di Bistrot Milano Srl', expectNames: ['VC FoodTech Srl'], min: 1 },
  { q: 'dipendenti di Impresa Edile Roma Spa', expectNames: ['Mario Rossi'], min: 1 },
  { q: 'fornitori di SoftwareHouse Padova Srl', expectNames: ['Cloud Provider Italia Srl'], min: 1 },
  { q: 'clienti di SoftwareHouse Padova Srl', expectNames: ['Azienda Agricola Veneta Spa'], min: 1 },
  { q: 'competitor di SoftwareHouse Padova Srl', expectNames: ['DevCompetitor Srl'], min: 1 },
  { q: 'fornitori di Impresa Edile Roma Spa', expectNames: ['Materiali Edili Sud Srl'], min: 1 },

  // Graph multi-hop
  { q: 'competitor dei clienti di Bistrot Milano Srl', expectNames: ['Trattoria Duomo Srl'], min: 1 },
  { q: 'competitor dei fornitori di Bistrot Milano Srl', expectNames: [], min: 0 }, // no competitor seeded for fornitoreAlim
  { q: 'fornitori dei clienti di Bistrot Milano Srl', expectNames: [], min: 0 }, // no supplier of Ristorante La Scala seeded
]

async function main() {
  await cleanupExtendedGraphTest()
  await seedExtendedGraphTest()
  console.log(`Running ${CASES.length} agentic search test cases...\n`)

  let passed = 0
  let failed = 0
  const failures = []

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]
    process.stdout.write(`${String(i + 1).padStart(2)}. "${c.q}" — `)
    try {
      const intent = useOffline ? parseCommercialIntentOffline(c.q) : await parseCommercialIntent(c.q)
      const { results, total } = await executeCommercialUniverseSearch(supabase, intent, { limit: 10, skipOpportunities: true, skipHydration: true, skipRanking: true })
      const names = results.map((r) => (r.azienda || r.nome || '').trim()).filter(Boolean)

      if (results.length < c.min) {
        throw new Error(`expected >=${c.min} results, got ${results.length}`)
      }
      for (const exp of c.expectNames) {
        if (!names.includes(exp)) {
          throw new Error(`missing expected "${exp}" in [${names.join(', ')}]`)
        }
      }
      console.log(`✅ ${results.length}/${total}`)
      passed++
    } catch (err) {
      console.log(`❌ ${err.message}`)
      try {
        const dbg = useOffline ? parseCommercialIntentOffline(c.q) : await parseCommercialIntent(c.q)
        console.log('   intent:', JSON.stringify({ source: dbg.parse_source, target: dbg.target_profile, signals: dbg.signals, tech: dbg.tech_profile, graph: dbg.graph_constraints }))
      } catch {}
      failures.push({ q: c.q, error: err.message })
      failed++
    }
  }

  await cleanupExtendedGraphTest()

  console.log('\n' + '═'.repeat(80))
  console.log(`Risultato: ${passed}/${CASES.length} pass, ${failed} fail`)
  if (failures.length) {
    console.log('\nFallimenti:')
    for (const f of failures) console.log(`  - ${f.q}: ${f.error}`)
  }
  console.log('═'.repeat(80))
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
