import { parseSignalIntentHeuristic } from '@/lib/signal-intent/parse-heuristic'
import type { MiraxSignalRequirement } from '@/lib/signal-intent/types'

/** Cheap pre-parser hints for retrieval; not authoritative for request_mode or roles. */
export type CommercialIntentHints = {
  possible_signals: MiraxSignalRequirement[]
  possible_seller_frame: boolean
  possible_explicit_demand: boolean
  possible_digital_audit: boolean
  possible_procurement: boolean
  location_hint: string | null
  sector_keywords: string[]
}

const EXPLICIT_DEMAND_RE =
  /\b(cercano|stanno\s+cercando|in\s+cerca\s+di|vogliono|devono|hanno\s+bisogno|stanno\s+assumendo|assunzione|assunzioni|assumono|raccogliendo|raccolgono|chiudendo\s+un\s+round|gara\s+per|bando\s+per|rfp\b|chi\s+(?:assume|assumono|cerca|cercano|ha\s+chiuso)|avviato\s+processi\s+di\s+assunzione)\b/i

const SELLER_FRAME_RE =
  /\b(sono\s+un|sono\s+una|vendo\b|vengo\b|promuovo|freelanc|libero\s+profession|mi\s+servono\s+clienti|trov\w+\s+clienti|clienti\s+(?:potenziali|in\b)|lead\s+caldi|chi\s+potrebbe\s+comprar|offro\b|installiamo|realizziamo|ottimizzo|aiuto\s+aziende|mi\s+occupo)\b/i

const DIGITAL_AUDIT_RE =
  /\b(senza\s+(?:meta\s+pixel|pixel|gtm|google\s+tag\s+manager|google\s+analytics|ssl)|mancanza\s+di\s+(?:pixel|tracciamento)|seo\s+(?:debole|errori)|sito\s+(?:lento|non\s+mobile|obsoleto)|website\s+weakness|digital\s+audit)/i

const PROCUREMENT_RE =
  /\b(gare?\s+d['’]appalto|gara\s+pubblica|bando\s+pubblico|bandi\s+pubblici|appalto\s+pubblico|procurement|acquisto\s+pubblico|mepa\b|ted\b)/i

export function extractCommercialIntentHints(query: string): CommercialIntentHints {
  const q = query.trim()
  const heuristic = parseSignalIntentHeuristic(q)
  return {
    possible_signals: heuristic.required_signals,
    possible_seller_frame: SELLER_FRAME_RE.test(q),
    possible_explicit_demand: EXPLICIT_DEMAND_RE.test(q),
    possible_digital_audit: DIGITAL_AUDIT_RE.test(q),
    possible_procurement: PROCUREMENT_RE.test(q),
    location_hint: heuristic.location ?? null,
    sector_keywords: heuristic.sector_keywords,
  }
}
