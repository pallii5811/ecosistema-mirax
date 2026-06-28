import type { IntentTechnicalFilters, SignalIntentSpec } from './types'
import { intentSpecHasMatches } from './parse-semantic'

export type LegacyTechnicalFilters = {
  no_website?: boolean
  no_instagram?: boolean
  no_facebook?: boolean
  no_pixel?: boolean
  no_gtm?: boolean
  no_ga4?: boolean
  no_google_ads?: boolean
  seo_errors?: boolean
  no_ssl?: boolean
  no_mobile?: boolean
  slow_speed?: boolean
}

export function intentTechnicalToLegacy(tf?: IntentTechnicalFilters | null): LegacyTechnicalFilters {
  if (!tf) return {}
  const out: LegacyTechnicalFilters = {}
  if (tf.has_gtm === false) out.no_gtm = true
  if (tf.has_meta_pixel === false) out.no_pixel = true
  if (tf.has_google_analytics === false) out.no_ga4 = true
  if (tf.has_ssl === false) out.no_ssl = true
  if (tf.errors_seo === true) out.seo_errors = true
  if (tf.site_speed === 'slow') out.slow_speed = true
  if (tf.mobile_friendly === false) out.no_mobile = true
  return out
}

function readLeadRecord(lead: unknown): Record<string, unknown> {
  return lead && typeof lead === 'object' ? (lead as Record<string, unknown>) : {}
}

function leadMatchesTechnicalFilters(lead: Record<string, unknown>, tf?: IntentTechnicalFilters | null): boolean {
  if (!tf) return true
  const tr = (lead.technical_report && typeof lead.technical_report === 'object'
    ? lead.technical_report
    : {}) as Record<string, unknown>
  const stack = Array.isArray(lead.tech_stack) ? lead.tech_stack.join(' ').toLowerCase() : ''

  if (tf.has_gtm === true && lead.google_tag_manager !== true) return false
  if (tf.has_gtm === false && lead.google_tag_manager === true) return false
  if (tf.has_meta_pixel === true && lead.meta_pixel !== true) return false
  if (tf.has_meta_pixel === false && lead.meta_pixel === true) return false
  if (tf.has_google_analytics === true && lead.google_analytics !== true && tr.has_ga4 !== true) return false
  if (tf.has_google_analytics === false && (lead.google_analytics === true || tr.has_ga4 === true)) return false
  if (tf.has_ssl === true && lead.ssl === false) return false
  if (tf.has_ssl === false && lead.ssl === true) return false

  if (tf.errors_seo === true) {
    const htmlErr = tr.html_errors
    const hasErr = tr.seo_disaster === true || htmlErr === true || (typeof htmlErr === 'number' && htmlErr > 0) || stack.includes('disastro seo')
    if (!hasErr) return false
  }
  if (tf.errors_seo === false) {
    const htmlErr = tr.html_errors
    const hasErr = tr.seo_disaster === true || htmlErr === true || (typeof htmlErr === 'number' && htmlErr > 0)
    if (hasErr) return false
  }

  if (tf.site_speed === 'slow') {
    const spd = tr.load_speed_s ?? tr.load_speed_seconds ?? lead.load_speed_seconds
    if (!(typeof spd === 'number' && spd > 3)) return false
  }
  if (tf.site_speed === 'fast') {
    const spd = tr.load_speed_s ?? tr.load_speed_seconds ?? lead.load_speed_seconds
    if (typeof spd === 'number' && spd > 3) return false
  }

  if (tf.mobile_friendly === true && lead.mobile_friendly !== true && tr.mobile_friendly !== true) return false
  if (tf.mobile_friendly === false && (lead.mobile_friendly === true || tr.mobile_friendly === true)) return false

  return true
}

function leadMatchesSocialFilters(lead: Record<string, unknown>, intent: SignalIntentSpec): boolean {
  const sf = intent.social_filters
  if (!sf) return true

  const ig = String(lead.instagram || '').trim()
  const fb = String(lead.facebook || '').trim()
  const li = String(lead.linkedin || '').trim()
  const ratingRaw = lead.rating ?? lead.google_rating ?? ''
  const rating = parseFloat(String(ratingRaw).replace(/[^\d.]/g, ''))

  if (sf.has_instagram === true && (!ig || ig === 'N/D')) return false
  if (sf.has_instagram === false && ig && ig !== 'N/D') return false
  if (sf.has_facebook === true && (!fb || fb === 'N/D')) return false
  if (sf.has_facebook === false && fb && fb !== 'N/D') return false
  if (sf.has_linkedin === true && (!li || li === 'N/D')) return false
  if (sf.has_linkedin === false && li && li !== 'N/D') return false
  if (sf.reviews_negative === true && !(Number.isFinite(rating) && rating > 0 && rating < 4)) return false

  return true
}

function leadMatchesBusinessFilters(lead: Record<string, unknown>, intent: SignalIntentSpec): boolean {
  const bf = intent.business_filters
  if (!bf) return true

  const openapi = lead.openapi_enriched && typeof lead.openapi_enriched === 'object'
    ? (lead.openapi_enriched as Record<string, unknown>)
    : {}
  const revenue = Number(lead.fatturato ?? lead.revenue ?? openapi.fatturato ?? 0)
  const employees = Number(lead.dipendenti ?? lead.employees ?? openapi.dipendenti ?? 0)
  const founded = String(lead.data_costituzione ?? openapi.data_costituzione ?? '')

  if (bf.revenue_min != null && revenue > 0 && revenue < bf.revenue_min) return false
  if (bf.revenue_max != null && revenue > bf.revenue_max) return false
  if (bf.employees_min != null && employees > 0 && employees < bf.employees_min) return false
  if (bf.employees_max != null && employees > bf.employees_max) return false
  if (bf.founded_after && founded && founded < bf.founded_after) return false
  if (bf.founded_before && founded && founded > bf.founded_before) return false

  return true
}

export function leadMatchesIntentSpec(lead: unknown, intent: SignalIntentSpec | null | undefined): boolean {
  if (!intent || !intentSpecHasMatches(intent)) return true
  const row = readLeadRecord(lead)
  return (
    leadMatchesTechnicalFilters(row, intent.technical_filters) &&
    leadMatchesSocialFilters(row, intent) &&
    leadMatchesBusinessFilters(row, intent)
  )
}

export function filterLeadsByIntentSpec<T>(leads: T[], intent: SignalIntentSpec | null | undefined): T[] {
  if (!intent || !intentSpecHasMatches(intent)) return leads
  return leads.filter((l) => leadMatchesIntentSpec(l, intent))
}
