import { createClient } from '@supabase/supabase-js'
import { loadMergedSearchCache } from '../src/lib/search-cache.ts'
import { parseSignalIntentOffline } from '../src/lib/signal-intent/parse-semantic.ts'
import { inferMapsCategoryFromIntent } from '../src/lib/signal-intent/infer-maps-category.ts'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) { console.error('missing env'); process.exit(1) }
const sb = createClient(url, key)

const query = 'software house a Bologna'
const offline = parseSignalIntentOffline(query)
const inferred = inferMapsCategoryFromIntent(query, offline)
console.log('inferred category:', inferred)
console.log('offline required_signals:', offline.required_signals)

const category = inferred || 'Software house'
const variants = ['software house','informatica','tecnologia','sviluppatori software','sviluppatore software','it','developer']

const cache = await loadMergedSearchCache(sb, { category, location: 'Bologna', categoryVariants: variants, includeInFlight: true })
console.log('rows:', cache.rows.length, 'rawTotal:', cache.rawTotal, 'withContact:', cache.withContact)
for (const r of cache.rows.slice(0,10)) {
  const parsed = Array.isArray(r.results) ? r.results.length : typeof r.results==='string'? JSON.parse(r.results).length : 0
  console.log('row:', r.id, '| cat:', r.category, '| loc:', r.location, '| status:', r.status, '| results:', parsed)
}
