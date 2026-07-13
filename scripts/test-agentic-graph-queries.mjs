#!/usr/bin/env node
/**
 * Test utente finale per query graph — crea un piccolo grafo di test,
 * esegue query in linguaggio naturale e verifica i risultati.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { seedGraphTest, cleanupGraphTest } from './seed-graph-test.mjs'

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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { parseCommercialIntent } = await import('../src/lib/signal-intent/parse-commercial-intent.ts')
const { executeCommercialUniverseSearch } = await import('../src/lib/universe/agentic-search.ts')

const CASES = [
  {
    query: 'fornitori di Cliente Target Srl',
    expectedNames: ['Fornitore Alpha Srl', 'Fornitore Beta Srl'],
    minResults: 2,
  },
  {
    query: 'clienti di Cliente Target Srl',
    expectedNames: ['Mio Cliente Srl'],
    minResults: 1,
  },
  {
    query: 'competitor di Cliente Target Srl',
    expectedNames: ['Competitor Gamma Srl'],
    minResults: 1,
  },
  {
    query: 'partner di Cliente Target Srl',
    expectedNames: ['Partner Delta Srl'],
    minResults: 1,
  },
  {
    query: 'competitor dei clienti di Cliente Target Srl',
    expectedNames: ['Competitor di Mio Cliente Srl'],
    minResults: 1,
  },
]

async function main() {
  await cleanupGraphTest()
  await seedGraphTest()
  console.log('Grafo di test creato.\n')

  let passed = 0
  let failed = 0

  for (const c of CASES) {
    console.log('─'.repeat(80))
    console.log(`QUERY: "${c.query}"`)
    try {
      const intent = await parseCommercialIntent(c.query)
      console.log(`INTENT: ${intent.intent_summary || '(nessuna sintesi)'} | source: ${intent.parse_source}`)
      const { results, total } = await executeCommercialUniverseSearch(supabase, intent, { limit: 10 })
      console.log(`RESULTS: ${results.length}/${total}`)
      const names = results.map((r) => r.azienda || r.nome).filter(Boolean)
      console.log(`NAMES: ${names.join(', ') || '(nessuno)'}`)

      if (results.length < c.minResults) {
        throw new Error(`Aspettati almeno ${c.minResults} risultati, trovati ${results.length}`)
      }
      for (const exp of c.expectedNames) {
        if (!names.includes(exp)) {
          throw new Error(`Manca il risultato atteso "${exp}"`)
        }
      }

      if (results[0]?.path_evidence?.length) {
        console.log(`PATH: ${results[0].path_evidence.map((h) => `${h.from_entity_name} [${h.relationship_type}] ${h.to_entity_name}`).join(' → ')}`)
      }
      console.log('✅ PASS\n')
      passed++
    } catch (err) {
      console.error(`❌ FAIL: ${err.message}\n`)
      failed++
    }
  }

  await cleanupGraphTest()
  console.log(`\nRiepilogo: ${passed} pass, ${failed} fail`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
