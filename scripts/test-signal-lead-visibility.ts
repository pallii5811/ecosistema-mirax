/**
 * Self-check signal-led visibility/charging semantics — no network, no LLM.
 * Run: npx tsx scripts/test-signal-lead-visibility.ts
 */
import { strict as assert } from 'node:assert'
import { shouldShowLeadForSignalIntent } from '../src/lib/signal-intent/lead-visibility'
import type { SignalIntentSpec } from '../src/lib/signal-intent/types'

const intent: SignalIntentSpec = {
  required_signals: ['investing_marketing'],
  hiring_roles: [],
  sector_keywords: [],
  crm_keywords: [],
  require_crm_change: false,
  time_window_days: null,
  intent_summary: 'Investe in marketing',
  technical_filters: {},
  social_filters: {},
  business_filters: {},
}

const weakLead = {
  azienda: 'Brand generico',
  sito: 'https://example.it',
  tech_stack: ['No Pixel'],
  technical_report: { has_facebook_pixel: false },
}

const strongLead = {
  azienda: 'PMI con ads attive',
  sito: 'https://pmi-ads.example',
  meta_ads_verified: true,
  active_meta_ads: 7,
  meta_ad_library_url: 'https://www.facebook.com/ads/library/?active_status=active',
}

const enterpriseLeads = [
  {
    azienda: 'Uniqlo',
    sito: 'https://www.uniqlo.com/it/it/home',
    meta_ads_verified: true,
    active_meta_ads: 20,
  },
  {
    azienda: 'Nike Milano',
    sito: 'https://www.nike.com/it/retail/s/nike-milano',
    meta_ads_verified: true,
    active_meta_ads: 20,
  },
  {
    azienda: 'Ferrari Flagship Store Milano',
    sito: 'https://store.ferrari.com/store-locator/milano',
    meta_ads_verified: true,
    active_meta_ads: 20,
  },
]

assert.equal(
  shouldShowLeadForSignalIntent(weakLead, intent, { finalize: false, scraping: true }),
  true,
  'durante streaming il pending puo restare visibile',
)

assert.equal(
  shouldShowLeadForSignalIntent(weakLead, intent, { finalize: true, scraping: false }),
  false,
  'a fine ricerca un lead senza evidenza marketing non deve restare',
)

assert.equal(
  shouldShowLeadForSignalIntent(strongLead, intent, { finalize: true, scraping: false }),
  true,
  'a fine ricerca un lead con Meta Ads verificato deve restare',
)

for (const lead of enterpriseLeads) {
  assert.equal(
    shouldShowLeadForSignalIntent(lead, intent, { finalize: true, scraping: false }),
    false,
    `${lead.azienda} non deve passare come PMI/signal-led lead anche se ha ads`,
  )
}

console.log('OK signal lead visibility guards')
