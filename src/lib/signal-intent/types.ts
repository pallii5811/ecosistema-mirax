/**
 * MIRAX Signal Intent v2 — query NL → requisiti segnali d'acquisto (onnivoro).
 */

export type MiraxSignalRequirement =
  | 'hiring'
  | 'registry_change'
  | 'sector_investment'
  | 'tender_won'
  | 'funding_received'
  | 'crm_detected'
  | 'crm_installed'
  | 'crm_change'
  | 'site_stale'
  | 'meta_ads_started'
  | 'google_ads_started'
  | 'investing_marketing'
  | 'seeking_supplier'
  | 'expansion'
  | 'executive_change'
  | 'investing_expansion'
  | 'new_product'
  | 'market_entry'
  | 'new_company'
  | 'tech_migration'

export type IntentTechnicalFilters = {
  has_gtm?: boolean | null
  has_meta_pixel?: boolean | null
  has_google_analytics?: boolean | null
  has_ssl?: boolean | null
  errors_seo?: boolean | null
  site_speed?: 'fast' | 'slow' | null
  mobile_friendly?: boolean | null
  load_speed_slow?: boolean | null
  has_chatbot?: boolean | null
  has_booking?: boolean | null
  /** Tecnologie / piattaforme rilevate dalla query (wordpress, shopify, react, ...) */
  technologies?: string[] | null
}

export type IntentSocialFilters = {
  has_instagram?: boolean | null
  has_facebook?: boolean | null
  has_linkedin?: boolean | null
  missing_instagram?: boolean | null
  missing_facebook?: boolean | null
  missing_linkedin?: boolean | null
  reviews_negative?: boolean | null
  social_followers_low?: boolean | null
}

export type IntentBusinessFilters = {
  revenue_min?: number | null
  revenue_max?: number | null
  employees_min?: number | null
  employees_max?: number | null
  founded_after?: string | null
  founded_before?: string | null
}

export type SignalIntentSpec = {
  /** Segnali richiesti dalla query utente */
  required_signals: MiraxSignalRequirement[]
  /** Ruoli hiring: programmatori, commerciali, … */
  hiring_roles: string[]
  /** Settore / tema investimento: fotovoltaico, AI, … */
  sector_keywords: string[]
  /** CRM specifici: hubspot, salesforce, … */
  crm_keywords: string[]
  /** Utente chiede cambio CRM recente */
  require_crm_change: boolean
  /** Finestra temporale in giorni (default 365 se tender/gara) */
  time_window_days: number | null
  /** Spiegazione per UI */
  intent_summary: string | null
  /** Parser semantico — categoria estratta dalla query */
  category?: string | null
  /** Parser semantico — località estratta dalla query */
  location?: string | null
  technical_filters?: IntentTechnicalFilters
  social_filters?: IntentSocialFilters
  business_filters?: IntentBusinessFilters
  /** Spiegazione LLM / fallback semantico */
  reasoning?: string | null
  /** Origine interpretazione */
  parse_source?: 'heuristic' | 'semantic_ai' | 'semantic_graph' | 'merged'
}

export const EMPTY_SIGNAL_INTENT: SignalIntentSpec = {
  required_signals: [],
  hiring_roles: [],
  sector_keywords: [],
  crm_keywords: [],
  require_crm_change: false,
  time_window_days: null,
  intent_summary: null,
  category: null,
  location: null,
  technical_filters: {},
  social_filters: {},
  business_filters: {},
  reasoning: null,
  parse_source: undefined,
}
