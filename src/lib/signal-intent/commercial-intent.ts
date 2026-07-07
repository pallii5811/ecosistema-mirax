/**
 * MIRAX Commercial Intent v1
 *
 * Rappresenta l'interpretazione di una query in linguaggio naturale libero.
 * A differenza di SignalIntentSpec (ottimizzato per segnali noti),
 * CommercialIntent e' pensato per essere flessibile e supportare query
 * commerciali arbitrarie come:
 * - "aziende a Milano che stanno investendo in marketing"
 * - "software house a Padova che stanno assumendo commerciali"
 * - "trovami i lead piu caldi che potrebbero comprare i miei servizi di consulenza a Genova"
 */

export type CommercialEntityType = 'company' | 'person' | 'public_body'

export type CommercialRankingHint =
  | 'hottest'
  | 'most_ready'
  | 'largest'
  | 'recently_active'
  | 'closest'
  | 'default'

export type CommercialSignal = {
  type: string
  params?: Record<string, unknown>
  time_window_days?: number
}

export type CommercialTargetProfile = {
  entity_types?: CommercialEntityType[]
  industries?: string[]
  roles?: string[]
  locations?: string[]
  company_size?: {
    min_employees?: number
    max_employees?: number
    revenue_min?: number
    revenue_max?: number
  }
}

export type CommercialTechProfile = {
  has?: string[]
  missing?: string[]
}

export type CommercialGraphConstraint = {
  relationship_type: string
  direction: 'incoming' | 'outgoing' | 'any'
  target_filter?: {
    industry?: string
    location?: string
    entity_type?: string
  }
}

export interface CommercialIntent {
  /** Cosa vende/propone l'utente. Es: "consulenza marketing", "software CRM", "pezzi di ricambio auto" */
  user_service_description: string | null

  /** Profilo ideale del target */
  target_profile: CommercialTargetProfile

  /** Segnali di opportunita' (hiring, funding, tender_won, site_stale, seeking_supplier, ...) */
  signals: CommercialSignal[]

  /** Vincoli tecnologici */
  tech_profile: CommercialTechProfile

  /** Vincoli sul grafo (relazioni richieste) */
  graph_constraints: CommercialGraphConstraint[]

  /** Come ordinare i risultati */
  ranking_hint: CommercialRankingHint

  /** Sintesi da mostrare in UI */
  intent_summary: string | null

  /** Spiegazione del ragionamento */
  reasoning: string | null

  /** Confidenza 0-1 */
  confidence: number

  /** Query originale */
  original_query: string

  /** Parser source */
  parse_source: 'llm' | 'heuristic' | 'fallback'
}

export const EMPTY_COMMERCIAL_INTENT: CommercialIntent = {
  user_service_description: null,
  target_profile: {},
  signals: [],
  tech_profile: {},
  graph_constraints: [],
  ranking_hint: 'default',
  intent_summary: null,
  reasoning: null,
  confidence: 0,
  original_query: '',
  parse_source: 'fallback',
}

/** Converte un CommercialIntent in un oggetto compatto per logging/cache. */
export function commercialIntentKey(intent: CommercialIntent): string {
  return JSON.stringify({
    s: intent.user_service_description,
    t: intent.target_profile,
    sig: intent.signals,
    tech: intent.tech_profile,
    g: intent.graph_constraints,
    r: intent.ranking_hint,
  })
}
