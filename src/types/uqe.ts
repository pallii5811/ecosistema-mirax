/**
 * Universal Query Engine — piano d'azione strutturato (Fase 4).
 * L'AI compila questo schema via Tool Calling; l'esecutore lo interpreta senza ambiguità.
 */

export type UqeSearchStrategy = 'graph' | 'maps' | 'hybrid' | 'organic_web_search' | 'fallback'

export type UqeParseSource = 'llm' | 'heuristic' | 'fallback'

/** Segnali d'acquisto supportati dal motore MIRAX. */
export type UqeSignalType =
  | 'hiring'
  | 'funding'
  | 'tender_won'
  | 'site_stale'
  | 'investing_marketing'
  | 'seeking_supplier'
  | 'expansion'
  | 'executive_change'
  | 'registry_change'
  | 'sector_investment'
  | 'no_pixel'
  | 'crm_change'
  | 'investing_expansion'
  | 'new_company'
  | 'tech_migration'
  | 'funding_received'

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
  no_pixel: 'no_pixel',
  'no meta pixel': 'no_pixel',
  site_stale: 'site_stale',
  expansion: 'expansion',
  espansione: 'expansion',
  new_company: 'new_company',
  nuova_apertura: 'new_company',
  costituzione: 'new_company',
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
    user_message: userMessage,
    reasoning: 'Query non mappabile in un piano eseguibile.',
  }
}
