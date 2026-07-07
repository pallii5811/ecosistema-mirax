/**
 * Self-check routing guards — no network, no LLM.
 * Run: node scripts/test-routing-guards.mjs
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// Load compiled TS via tsx if available, else use dynamic import from built output
let planner
try {
  const tsx = await import('tsx/esm/api').catch(() => null)
  if (tsx?.register) {
    tsx.register()
    planner = await import('../src/lib/uqe/mirax-query-planner.ts')
  }
} catch {
  // fall through
}

if (!planner) {
  console.error('Install tsx or run after build. Trying direct path...')
  process.exit(1)
}

const {
  buildHeuristicMiraxQueryPlan,
  applyRoutingGuards,
  isSellerAbstractQuery,
} = planner

const cases = [
  {
    query: 'imprese di pulizie a otranto',
    expectStrategy: 'maps',
    label: 'categoria + città',
  },
  {
    query: 'ristoranti Milano',
    expectStrategy: 'maps',
    label: 'maps classico',
  },
  {
    query: 'aziende che stanno investendo in marketing',
    expectStrategy: 'hybrid',
    notStrategy: 'organic_web_search',
    label: 'buyer signal marketing',
  },
  {
    query: 'trovami clienti per commercialista',
    expectStrategy: 'organic_web_search',
    label: 'seller abstract',
  },
  {
    query: 'hotel a Roma senza meta pixel',
    expectStrategy: 'maps',
    label: 'categoria + città + filtro tecnico',
  },
]

let failed = 0

for (const c of cases) {
  const plan = buildHeuristicMiraxQueryPlan(c.query)
  const guarded = applyRoutingGuards(plan, c.query)
  const strategy = guarded.search_strategy
  const ok =
    strategy === c.expectStrategy &&
    (!c.notStrategy || strategy !== c.notStrategy)

  if (!ok) {
    failed++
    console.error(`FAIL [${c.label}] "${c.query}"`)
    console.error(`  got: ${strategy}, expected: ${c.expectStrategy}`)
    console.error(`  sector=${guarded.sector} location=${guarded.location}`)
  } else {
    console.log(`OK   [${c.label}] → ${strategy}`)
  }
}

const sellerOk = isSellerAbstractQuery('trovami clienti per commercialista')
const buyerOk = !isSellerAbstractQuery('aziende che stanno investendo in marketing')
if (!sellerOk || !buyerOk) {
  failed++
  console.error('FAIL isSellerAbstractQuery heuristics')
} else {
  console.log('OK   isSellerAbstractQuery')
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log(`\nAll ${cases.length + 1} routing checks passed.`)
