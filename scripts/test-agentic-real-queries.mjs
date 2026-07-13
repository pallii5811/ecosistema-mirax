#!/usr/bin/env node
/**
 * Test utente finale su dati reali del grafo.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

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

const { parseCommercialIntent } = await import('../src/lib/signal-intent/parse-commercial-intent.ts')
const { executeCommercialUniverseSearch } = await import('../src/lib/universe/agentic-search.ts')

const QUERIES = [
  'aziende a Taormina',
  'aziende a Milano senza Meta Pixel',
  'aziende che usano WordPress',
  'aziende che hanno vinto gare pubbliche',
  'aziende in assunzione',
]

async function main() {
  console.log('Testing agentic search on real graph data\n')
  for (const query of QUERIES) {
    console.log('─'.repeat(80))
    console.log(`QUERY: "${query}"`)
    try {
      const intent = await parseCommercialIntent(query)
      console.log(`INTENT: ${intent.intent_summary || '(nessuna sintesi)'} | source: ${intent.parse_source}`)
      console.log('INTENT JSON:', JSON.stringify(intent, null, 2).slice(0, 800))
      const { results, total } = await executeCommercialUniverseSearch(supabase, intent, { limit: 8 })
      console.log(`RESULTS: ${results.length}/${total}`)
      console.log(`TOP: ${(results[0]?.azienda || results[0]?.nome || 'n/d')} (${results[0]?.citta || 'n/d'}) score=${results[0]?.opportunity_score ?? results[0]?._score ?? 'n/d'}`)
      console.log('✅ OK\n')
    } catch (err) {
      console.error(`❌ FAILED: ${err.message}\n`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
