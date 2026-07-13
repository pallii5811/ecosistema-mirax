/**
 * Run: node scripts/test-seller-buyer-inference.mjs
 */
import assert from 'node:assert/strict'
import {
  inferSellerBuyerProfile,
  enrichCommercialIntentFromSellerQuery,
} from '../src/lib/signal-intent/seller-buyer-inference.ts'
import { EMPTY_COMMERCIAL_INTENT } from '../src/lib/signal-intent/commercial-intent.ts'

const q = 'mi servono clienti per vendere il mio software di lead generation'
const profile = inferSellerBuyerProfile(q, null)

assert.equal(profile.is_seller_query, true)
assert.ok(profile.user_service?.includes('lead generation'))
assert.equal(profile.maps_category, 'Agenzie di marketing')
assert.equal(profile.default_location, 'Italia')

const enriched = enrichCommercialIntentFromSellerQuery(q, { ...EMPTY_COMMERCIAL_INTENT, original_query: q })
assert.ok(enriched.user_service_description)
assert.equal(enriched.target_profile.locations?.[0], 'Italia')
assert.ok(enriched.target_profile.industries?.includes('marketing'))

console.log('[test-seller-buyer-inference] OK')
