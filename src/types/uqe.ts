/**
 * Universal Query Engine — piano d'azione strutturato (Fase 4).
 * L'AI compila questo schema via Tool Calling; l'esecutore lo interpreta senza ambiguità.
 */

export type UqeSearchStrategy = 'graph' | 'maps' | 'hybrid' | 'organic_web_search' | 'fallback'

export type UqeParseSource = 'llm' | 'heuristic' | 'fallback'

export type UqeSourceLane =
  | 'public_registry'
  | 'public_procurement'
  | 'job_market'
  | 'funding'
  | 'company_web'
  | 'news'
  | 'technology'
  | 'real_estate'
  | 'regulatory'
  | 'ads'
  | 'reviews'
  | 'events'
  | 'marketplace'
  | 'partnerships'
  | 'compliance'
  | 'web_evidence'

export type UqeSourceCoverageStatus = 'supported' | 'unsupported' | 'generic_fallback_partial'

export interface UqeSourcePlanItem {
  lane: UqeSourceLane
  source_types: string[]
  query_templates: string[]
  expected_evidence: string[]
  priority: number
  llm_required: boolean
  /** Runtime truth from the capability registry, never inferred from a label. */
  coverage_status?: UqeSourceCoverageStatus
  adapter_ids?: string[]
  coverage_gaps?: string[]
  execution_mode?: 'adapter' | 'generic_fallback' | 'blocked'
}

export interface UqeEvidencePolicy {
  require_source_url: boolean
  require_official_domain: boolean
  min_signal_confidence: number
  max_age_days: number | null
}

export interface UqeCommercialHypothesis {
  offer: string
  target_profile: string[]
  buyer_pains: string[]
  buying_signals: string[]
  hiring_roles: string[]
  decision_maker_roles: string[]
  disqualifiers: string[]
}

export interface UqeRankingPolicy {
  signal_match_mode: 'any' | 'all'
  max_signal_age_days: number
  require_concrete_evidence: boolean
  weights: {
    intent_fit: number
    signal_strength: number
    recency: number
    evidence_quality: number
    contactability: number
  }
}

/** Segnali d'acquisto supportati dal motore MIRAX. */
export type UqeSignalType =
  | 'hiring'
  | 'funding'
  | 'tender_won'
  | 'site_stale'
  | 'meta_ads_started'
  | 'google_ads_started'
  | 'investing_marketing'
  | 'seeking_supplier'
  | 'expansion'
  | 'executive_change'
  | 'registry_change'
  | 'sector_investment'
  | 'no_pixel'
  | 'crm_change'
  | 'investing_expansion'
  | 'new_product'
  | 'market_entry'
  | 'new_company'
  | 'crm_installed'
  | 'tech_migration'
  | 'funding_received'
  | 'no_dmarc'
  | 'no_gtm'
  | 'missing_instagram'
  | 'missing_google_ads'
  | 'seo_errors'

export interface MiraxQueryPlan {
  /** Query originale dell'utente */
  original_query: string

  /** Motore primario: grafo Neo4j, discovery Maps/worker, o entrambi */
  search_strategy: UqeSearchStrategy

  /** Settore/categoria target (es. "edile", "ristorazione", "agenzie marketing") */
  sector: string

  /** Località (città, provincia, regione o "Italia") */
  location: string

  /** Segnali richiesti (es. hiring, no_pixel, sector_investment) */
  required_signals: string[]

  /** Filtri tecnici normalizzati (es. { has_meta_pixel: false }) */
  technical_filters: Record<string, unknown>

  /** Campi da estrarre/arricchire per ogni lead */
  extraction_schema: string[]

  /** Confidenza parser 0–1 */
  confidence: number

  /** Sintesi intent per UI */
  intent_summary: string

  /** Origine del piano */
  parse_source: UqeParseSource

  /** Contratto canonico v1 condiviso con il worker, quando compilato dall'LLM. */
  canonical_plan?: import('@/lib/contracts/commercial-search-plan').CommercialSearchPlan

  /** Domande che il discovery engine deve riuscire a provare. */
  research_questions?: string[]

  /** Fonti ordinate per valore/costo, estensibili anche per query long-tail. */
  source_plan?: UqeSourcePlanItem[]

  /** Aggregate runtime coverage of all planned lanes. */
  source_coverage?: {
    status: UqeSourceCoverageStatus
    adapter_ids: string[]
    missing_signals: string[]
  }

  /** Contratto minimo per poter pubblicare una riga come lead verificato. */
  evidence_policy?: UqeEvidencePolicy

  /** Ipotesi commerciale esplicita: offerta -> dolore -> segnali osservabili. */
  commercial_hypothesis?: UqeCommercialHypothesis

  /** Contratto deterministico per ordinare i lead piu caldi. */
  ranking_policy?: UqeRankingPolicy

  /**
   * Messaggio utente quando search_strategy === 'fallback'
   * o quando la query non è mappabile con sufficiente confidenza.
   */
  user_message?: string | null

  /** Spiegazione interna (debug / ai_debug) */
  reasoning?: string | null
}

export const DEFAULT_EXTRACTION_SCHEMA = ['email', 'telefono', 'sito', 'azienda', 'citta'] as const

export const UQE_SIGNAL_ALIASES: Record<string, UqeSignalType> = {
  hiring: 'hiring',
  assunzioni: 'hiring',
  assunzione: 'hiring',
  funding: 'funding',
  investimento: 'sector_investment',
  investimenti: 'sector_investment',
  sector_investment: 'sector_investment',
  gara: 'tender_won',
  tender_won: 'tender_won',
  no_dmarc: 'no_dmarc',
  no_gtm: 'no_gtm',
  missing_instagram: 'missing_instagram',
  missing_google_ads: 'missing_google_ads',
  seo_errors: 'seo_errors',
  no_pixel: 'no_pixel',
  'no meta pixel': 'no_pixel',
  'senza pixel': 'no_pixel',
  meta_ads: 'meta_ads_started',
  'meta ads': 'meta_ads_started',
  facebook_ads: 'meta_ads_started',
  'facebook ads': 'meta_ads_started',
  instagram_ads: 'meta_ads_started',
  'instagram ads': 'meta_ads_started',
  google_ads: 'google_ads_started',
  'google ads': 'google_ads_started',
  campagne_google: 'google_ads_started',
  ads: 'investing_marketing',
  pubblicita: 'investing_marketing',
  pubblicità: 'investing_marketing',
  marketing_spend: 'investing_marketing',
  site_stale: 'site_stale',
  expansion: 'expansion',
  espansione: 'expansion',
  investing_expansion: 'investing_expansion',
  cerca_fornitore: 'seeking_supplier',
  seeking_supplier: 'seeking_supplier',
  supplier_search: 'seeking_supplier',
  cambio_dirigenza: 'executive_change',
  executive_change: 'executive_change',
  nuovo_prodotto: 'new_product',
  new_product: 'new_product',
  nuovo_mercato: 'market_entry',
  market_entry: 'market_entry',
  new_company: 'new_company',
  nuova_apertura: 'new_company',
  costituzione: 'new_company',
  crm_installed: 'crm_installed',
  tech_migration: 'tech_migration',
  migrazione_tech: 'tech_migration',
  digital_transformation: 'tech_migration',
  funding_received: 'funding_received',
  finanziamento: 'funding_received',
  commercialista: 'new_company',
  contabilita: 'new_company',
}

export class UqePlannerError extends Error {
  readonly code: string

  constructor(message: string, code = 'UQE_PLANNER_ERROR') {
    super(message)
    this.name = 'UqePlannerError'
    this.code = code
  }
}

export function createFallbackPlan(
  originalQuery: string,
  userMessage: string,
  parseSource: UqeParseSource = 'fallback',
): MiraxQueryPlan {
  return {
    original_query: originalQuery,
    search_strategy: 'fallback',
    sector: '',
    location: '',
    required_signals: [],
    technical_filters: {},
    extraction_schema: [...DEFAULT_EXTRACTION_SCHEMA],
    confidence: 0,
    intent_summary: userMessage,
    parse_source: parseSource,
    research_questions: [],
    source_plan: [],
    evidence_policy: {
      require_source_url: true,
      require_official_domain: true,
      min_signal_confidence: 0.7,
      max_age_days: null,
    },
    user_message: userMessage,
    reasoning: 'Query non mappabile in un piano eseguibile.',
  }
}
