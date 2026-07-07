/**
 * MIRAX Signal Registry — configurazione dichiarativa waterfall per tipo segnale.
 * Fase 5.1: ogni segnale definisce fonti in cascata, timeout, tier.
 */

export type SourceType = 'internal' | 'http_scrape' | 'api'
export type SourceTier = 'primary' | 'secondary' | 'tertiary' | 'fallback'

export type SignalSourceConfig = {
  name: string
  type: SourceType
  timeout_ms: number
  tier: SourceTier
}

export type SignalConfig = {
  sources: SignalSourceConfig[]
  max_sources_to_try: number
  parallel: boolean
  fallback_value?: null
}

export const SIGNAL_REGISTRY: Record<string, SignalConfig> = {
  hiring: {
    sources: [
      { name: 'mirax_audit', type: 'internal', timeout_ms: 500, tier: 'primary' },
      { name: 'indeed_it', type: 'http_scrape', timeout_ms: 5000, tier: 'primary' },
      { name: 'infojobs_it', type: 'http_scrape', timeout_ms: 5000, tier: 'secondary' },
      { name: 'google_jobs', type: 'http_scrape', timeout_ms: 6000, tier: 'secondary' },
      { name: 'linkedin_jobs', type: 'http_scrape', timeout_ms: 5000, tier: 'tertiary' },
      { name: 'company_careers_page', type: 'http_scrape', timeout_ms: 8000, tier: 'fallback' },
    ],
    max_sources_to_try: 5,
    parallel: false,
    fallback_value: null,
  },
  tender_won: {
    sources: [
      { name: 'mirax_audit', type: 'internal', timeout_ms: 500, tier: 'primary' },
      { name: 'anac_opendata', type: 'api', timeout_ms: 5000, tier: 'primary' },
      { name: 'ted_europa', type: 'api', timeout_ms: 6000, tier: 'secondary' },
      { name: 'bandi_italia', type: 'http_scrape', timeout_ms: 5000, tier: 'tertiary' },
    ],
    max_sources_to_try: 3,
    parallel: false,
  },
  funding_received: {
    sources: [
      { name: 'news_api', type: 'api', timeout_ms: 4000, tier: 'primary' },
      { name: 'google_news_scrape', type: 'http_scrape', timeout_ms: 4000, tier: 'secondary' },
      { name: 'openapi_cciaa', type: 'api', timeout_ms: 5000, tier: 'tertiary' },
    ],
    max_sources_to_try: 2,
    parallel: true,
  },
  executive_change: {
    sources: [
      { name: 'news_api', type: 'api', timeout_ms: 4000, tier: 'primary' },
      { name: 'google_news_scrape', type: 'http_scrape', timeout_ms: 4000, tier: 'secondary' },
    ],
    max_sources_to_try: 2,
    parallel: true,
  },
  website_changed: {
    sources: [{ name: 'mirax_diff_engine', type: 'internal', timeout_ms: 2000, tier: 'primary' }],
    max_sources_to_try: 1,
    parallel: false,
  },
  registry_change: {
    sources: [
      { name: 'mirax_audit', type: 'internal', timeout_ms: 500, tier: 'primary' },
      { name: 'openapi_cciaa', type: 'api', timeout_ms: 5000, tier: 'primary' },
    ],
    max_sources_to_try: 2,
    parallel: false,
  },
  site_stale: {
    sources: [{ name: 'mirax_audit', type: 'internal', timeout_ms: 500, tier: 'primary' }],
    max_sources_to_try: 1,
    parallel: false,
  },
  google_ads_started: {
    sources: [{ name: 'mirax_audit', type: 'internal', timeout_ms: 500, tier: 'primary' }],
    max_sources_to_try: 1,
    parallel: false,
  },
  meta_ads_started: {
    sources: [{ name: 'mirax_audit', type: 'internal', timeout_ms: 500, tier: 'primary' }],
    max_sources_to_try: 1,
    parallel: false,
  },
  crm_detected: {
    sources: [{ name: 'mirax_audit', type: 'internal', timeout_ms: 500, tier: 'primary' }],
    max_sources_to_try: 1,
    parallel: false,
  },
  crm_change: {
    sources: [{ name: 'mirax_diff_engine', type: 'internal', timeout_ms: 2000, tier: 'primary' }],
    max_sources_to_try: 1,
    parallel: false,
  },
  sector_investment: {
    sources: [
      { name: 'mirax_audit', type: 'internal', timeout_ms: 500, tier: 'primary' },
      { name: 'news_api', type: 'api', timeout_ms: 4000, tier: 'secondary' },
    ],
    max_sources_to_try: 2,
    parallel: false,
  },
  partnership: {
    sources: [
      { name: 'news_api', type: 'api', timeout_ms: 4000, tier: 'primary' },
      { name: 'google_news_scrape', type: 'http_scrape', timeout_ms: 4000, tier: 'secondary' },
    ],
    max_sources_to_try: 2,
    parallel: true,
  },
  expansion: {
    sources: [
      { name: 'news_api', type: 'api', timeout_ms: 4000, tier: 'primary' },
      { name: 'openapi_cciaa', type: 'api', timeout_ms: 5000, tier: 'secondary' },
    ],
    max_sources_to_try: 2,
    parallel: true,
  },
  price_change: {
    sources: [{ name: 'mirax_diff_engine', type: 'internal', timeout_ms: 2000, tier: 'primary' }],
    max_sources_to_try: 1,
    parallel: false,
  },
  acquisition: {
    sources: [
      { name: 'news_api', type: 'api', timeout_ms: 4000, tier: 'primary' },
      { name: 'google_news_scrape', type: 'http_scrape', timeout_ms: 4000, tier: 'secondary' },
    ],
    max_sources_to_try: 2,
    parallel: true,
  },
}

export const SIGNAL_REGISTRY_KEYS = Object.keys(SIGNAL_REGISTRY)

export function getSignalConfig(signalType: string): SignalConfig | undefined {
  return SIGNAL_REGISTRY[signalType]
}

export function getSourcesForSignal(signalType: string): SignalSourceConfig[] {
  const cfg = SIGNAL_REGISTRY[signalType]
  if (!cfg) return []
  return cfg.sources.slice(0, cfg.max_sources_to_try)
}

/** Fonte audit sempre prima — zero rete. */
export function orderedWaterfallSources(signalTypes: string[]): Map<string, SignalSourceConfig[]> {
  const out = new Map<string, SignalSourceConfig[]>()
  for (const st of signalTypes) {
    const cfg = SIGNAL_REGISTRY[st]
    if (!cfg) continue
    const sources = [...cfg.sources]
    sources.sort((a, b) => {
      if (a.name === 'mirax_audit') return -1
      if (b.name === 'mirax_audit') return 1
      const tierOrder: Record<SourceTier, number> = { primary: 0, secondary: 1, tertiary: 2, fallback: 3 }
      return tierOrder[a.tier] - tierOrder[b.tier]
    })
    out.set(st, sources.slice(0, cfg.max_sources_to_try))
  }
  return out
}
