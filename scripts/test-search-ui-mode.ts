/**
 * Self-check UI mode guards — no network, no LLM.
 * Run: npx tsx scripts/test-search-ui-mode.ts
 */
import { strict as assert } from 'node:assert'
import { shouldUseAgenticSearchUi } from '../src/lib/search-ui-mode'

const marketingIntent = { required_signals: ['investing_marketing'] }
const hiringIntent = { required_signals: ['hiring'] }
const techAuditIntent = { required_signals: [], technical_filters: { has_meta_pixel: false } }

assert.equal(
  shouldUseAgenticSearchUi(
    { search_strategy: 'organic_web_search', source: 'agentic_worker' },
    marketingIntent,
  ),
  true,
  'organic_web_search deve mostrare UX agentica',
)

assert.equal(
  shouldUseAgenticSearchUi(
    { search_strategy: '', source: '' },
    marketingIntent,
  ),
  true,
  'debug parziale + investing_marketing deve mostrare UX agentica',
)

assert.equal(
  shouldUseAgenticSearchUi(
    { search_strategy: 'maps', source: 'maps_worker' },
    marketingIntent,
  ),
  false,
  'debug esplicitamente Maps deve restare Maps per rendere visibile un eventuale routing backend sbagliato',
)

assert.equal(
  shouldUseAgenticSearchUi(
    { search_strategy: 'maps', source: 'maps_worker' },
    techAuditIntent,
  ),
  false,
  'categoria/audit tecnico locale deve restare Maps',
)

assert.equal(
  shouldUseAgenticSearchUi(
    { search_strategy: '', source: '' },
    hiringIntent,
  ),
  true,
  'debug parziale + hiring deve mostrare UX agentica',
)

console.log('OK search UI mode guards')
