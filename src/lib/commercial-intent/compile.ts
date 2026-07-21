import { parseSignalIntentHeuristic } from '@/lib/signal-intent/parse-heuristic'
import { inferSellerBuyerProfile } from '@/lib/signal-intent/seller-buyer-inference'
import type { MiraxSignalRequirement } from '@/lib/signal-intent/types'
import {
  EMPTY_COMMERCIAL_INTENT_SPEC,
  type CommercialIntentSpec,
  type CommercialRequestMode,
  type IntentStrength,
  type ObservableEvent,
} from './types'

const EXPLICIT_DEMAND_RE =
  /\b(cercano|stanno\s+cercando|in\s+cerca\s+di|vogliono|devono|hanno\s+bisogno|stanno\s+assumendo|assunzione|assunzioni|assumono|raccogliendo|raccolgono|chiudendo\s+un\s+round|gara\s+per|bando\s+per|rfp\b|chi\s+(?:assume|assumono|cerca|cercano|ha\s+chiuso)|avviato\s+processi\s+di\s+assunzione)\b/i

const SELLER_FRAME_RE =
  /\b(sono\s+un|sono\s+una|vendo\b|vengo\b|promuovo|freelanc|libero\s+profession|mi\s+servono\s+clienti|trov\w+\s+clienti|clienti\s+(?:potenziali|in\b)|lead\s+caldi|chi\s+potrebbe\s+comprar|consulenza\s+\w+.*\bclienti\b|servizi\s+(?:[a-zà-ù]+(?:\s+[a-zà-ù]+){0,4}\s+)?per\b|servizi\s+(?:di|per)\s+|vendere\s+(?:il\s+mio|i\s+miei|la\s+mia))\b/i

const DIGITAL_AUDIT_RE =
  /\b(senza\s+(?:meta\s+pixel|pixel|gtm|google\s+tag\s+manager|google\s+analytics|ssl)|mancanza\s+di\s+(?:pixel|tracciamento)|seo\s+(?:debole|errori)|sito\s+(?:lento|non\s+mobile|obsoleto)|website\s+weakness|digital\s+audit)/i

const PROCUREMENT_RE =
  /\b(gare?\s+d['’]appalto|gara\s+pubblica|bando\s+pubblico|bandi\s+pubblici|appalto\s+pubblico|procurement|acquisto\s+pubblico|mepa\b|ted\b)/i

const FUNDING_SIGNALS = new Set<MiraxSignalRequirement>(['funding_received'])
const HIRING_SIGNALS = new Set<MiraxSignalRequirement>([
  'hiring',
  'hiring_technology',
  'hiring_sales',
  'hiring_marketing',
  'hiring_operational',
])
const EVENT_SIGNALS = new Set<MiraxSignalRequirement>([
  'funding_received',
  'hiring',
  'hiring_technology',
  'hiring_sales',
  'hiring_marketing',
  'hiring_operational',
  'tender_won',
  'seeking_supplier',
  'expansion',
  'executive_change',
  'registry_change',
  'sector_investment',
  'investing_marketing',
  'crm_change',
  'crm_detected',
  'tech_migration',
])

function supplementSignals(query: string, signals: MiraxSignalRequirement[]): MiraxSignalRequirement[] {
  const out = new Set(signals)
  const q = query.toLowerCase()
  if (/\b(raccolgono|raccogliendo|round|finanziamento|funding|investimento|seed)\b/.test(q)) {
    out.add('funding_received')
  }
  if (/\b(assumono|assumendo|assunzioni|ingegner|sviluppat|developer|programmator|profili\s+tecnici)\b/.test(q)) {
    out.add('hiring_technology')
  }
  if (/\bcrm\b/.test(q) && /\b(cercano|cercando|cerca|nuovo|migrazione|selezione)\b/.test(q)) {
    out.add('crm_detected')
  }
  return [...out]
}

function isExplicitBuyerDemand(query: string): boolean {
  return EXPLICIT_DEMAND_RE.test(query)
}

function specOfferFromSellerFrame(query: string): string | null {
  const q = query.trim()
  const vendo = q.match(/\bvendo\s+(.+?)(?:,|\?|$)/i)
  if (vendo?.[1]) return vendo[1].trim().slice(0, 120)
  const servizi = q.match(/\bservizi\s+(.+?)(?:,|\?|$)/i)
  if (servizi?.[1]) return `servizi ${servizi[1].trim()}`.slice(0, 120)
  const promo = q.match(/\bpromuovo\s+(.+?)(?:,|\?|$)/i)
  if (promo?.[1]) return promo[1].trim().slice(0, 120)
  if (/\bfreelanc/i.test(q)) return 'servizi professionali freelance'
  return 'offerta commerciale'
}

function hasObservableEventLanguage(query: string): boolean {
  return /\b(assumono|assunzione|assunzioni|raccolgono|raccogliendo|round|finanziamento|funding|investimento|gara|bando|hanno\s+vinto|stanno\s+investendo)\b/i.test(
    query,
  )
}

function detectRequestMode(query: string, signals: MiraxSignalRequirement[]): CommercialRequestMode {
  const q = query.trim()
  const seller = inferSellerBuyerProfile(q)
  if (DIGITAL_AUDIT_RE.test(q)) return 'digital_audit'
  if (SELLER_FRAME_RE.test(q) || seller.is_seller_query) return 'seller_driven_lead_discovery'
  if (isExplicitBuyerDemand(q)) return 'explicit_demand'
  if (PROCUREMENT_RE.test(q)) return 'procurement_discovery'
  if (signals.some((s) => EVENT_SIGNALS.has(s)) && hasObservableEventLanguage(q)) {
    return 'event_based_discovery'
  }
  return 'company_filter'
}

function targetRoleForSignals(signals: MiraxSignalRequirement[]): string | null {
  if (signals.some((s) => FUNDING_SIGNALS.has(s) || s === 'funding_received')) return 'recipient'
  if (signals.some((s) => HIRING_SIGNALS.has(s))) return 'employer'
  if (signals.includes('tender_won') || signals.includes('seeking_supplier')) return 'buyer'
  if (signals.some((s) => s.startsWith('crm') || s === 'technology_migration')) return 'buyer'
  return 'target_company'
}

function relationshipsForSignals(signals: MiraxSignalRequirement[]): string[] {
  const out: string[] = []
  if (signals.some((s) => FUNDING_SIGNALS.has(s))) out.push('startup_raising_or_receiving_investment')
  if (signals.includes('hiring_technology')) out.push('employer_hiring_software_or_it_engineers')
  if (signals.includes('hiring_sales')) out.push('employer_hiring_sales_team')
  if (signals.includes('hiring_marketing')) out.push('employer_hiring_marketing_team')
  if (signals.some((s) => s.startsWith('crm') || s === 'tech_migration')) {
    out.push('target_company_seeking_crm_solution')
  }
  if (signals.includes('tender_won')) out.push('company_awarded_public_contract')
  if (signals.includes('seeking_supplier')) out.push('company_seeking_supplier')
  if (signals.includes('site_stale') || signals.includes('no_pixel') || signals.includes('no_gtm')) {
    out.push('company_with_digital_presence_gap')
  }
  return [...new Set(out)]
}

function observableEventsFromSignals(signals: MiraxSignalRequirement[]): ObservableEvent[] {
  return signals.map((signal, index) => ({
    id: `event-${signal}-${index}`,
    description: `Observable ${signal.replace(/_/g, ' ')} event`,
    signals: [signal],
  }))
}

function intentStrength(mode: CommercialRequestMode, signals: MiraxSignalRequirement[]): IntentStrength {
  if (mode === 'explicit_demand' || mode === 'event_based_discovery') return 'direct'
  if (mode === 'seller_driven_lead_discovery') return 'strong_inferred'
  if (signals.length) return 'strong_inferred'
  return 'moderate_inferred'
}

function normalizedGoal(query: string, mode: CommercialRequestMode, buyerNeed: string | null): string {
  const base = query.trim()
  if (buyerNeed) return buyerNeed
  if (mode === 'digital_audit') return 'Identify companies with verifiable digital presence gaps'
  if (mode === 'procurement_discovery') return 'Identify companies with active procurement opportunities'
  if (mode === 'seller_driven_lead_discovery') return 'Discover buyer companies matching seller offer fit'
  return base
}

/** Compile authoritative CommercialIntentSpec without exact-query hardcoding. */
export function compileCommercialIntentSpec(query: string): CommercialIntentSpec {
  const q = query.trim()
  if (!q) return { ...EMPTY_COMMERCIAL_INTENT_SPEC }

  const heuristic = parseSignalIntentHeuristic(q)
  const seller = inferSellerBuyerProfile(q, {
    user_service_description: null,
    target_profile: {
      industries: heuristic.sector_keywords,
      locations: heuristic.location ? [heuristic.location] : [],
      roles: heuristic.hiring_roles,
    },
    signals: heuristic.required_signals.map((type) => ({ type })),
    original_query: q,
    parse_source: 'heuristic',
    confidence: 0.7,
  } as never)

  const signals = supplementSignals(q, heuristic.required_signals)
  const mode = detectRequestMode(q, signals)
  const buyerNeed =
    seller.user_service && seller.is_seller_query
      ? `Companies that may need ${seller.user_service}`
      : heuristic.intent_summary || null

  const directSignals = mode === 'explicit_demand' || mode === 'event_based_discovery' ? [...signals] : []
  const inferredSignals =
    mode === 'seller_driven_lead_discovery' || mode === 'company_filter'
      ? [...signals, ...(seller.buyer_industries ?? [])]
      : []

  const geography = heuristic.location ? [heuristic.location] : []
  const sectors = heuristic.sector_keywords.length
    ? heuristic.sector_keywords
    : seller.buyer_industries ?? []

  const offerDescription =
    seller.user_service || (SELLER_FRAME_RE.test(q) ? specOfferFromSellerFrame(q) : null)

  return {
    original_query: q,
    normalized_goal: normalizedGoal(q, mode, buyerNeed),
    request_mode: mode,
    seller_profile: {
      offer_description: offerDescription,
      products_or_services: offerDescription ? [offerDescription] : [],
      problems_solved: buyerNeed ? [buyerNeed] : [],
      preferred_buyer_roles: heuristic.hiring_roles,
    },
    seller_offer: { description: offerDescription, category: seller.maps_category },
    problem_solved: buyerNeed,
    buyer_need: buyerNeed,
    target_company_profile: {
      entity_types: ['company'],
      industries: sectors,
      geographies: geography,
      excluded_attributes: ['publisher', 'recruiter', 'investor', 'lender'],
    },
    target_role: targetRoleForSignals(signals),
    geography,
    sectors,
    freshness: heuristic.time_window_days ? { maximum_age_days: heuristic.time_window_days } : null,
    direct_demand_signals: directSignals,
    inferred_fit_signals: inferredSignals,
    observable_events: observableEventsFromSignals(signals),
    required_relationships: relationshipsForSignals(signals),
    excluded_roles: ['publisher', 'recruiter', 'investor', 'lender', 'advisor', 'authority'],
    evidence_policy: {
      must_have_facts: ['official_domain', 'source_url', 'literal_excerpt'],
      forbidden_inferences: ['title alone proves need', 'vendor page as buyer evidence'],
      maximum_age_days: heuristic.time_window_days ?? 180,
    },
    source_requirements: {
      allowed_source_classes: ['official_company_website', 'recognized_local_news', 'industry_publication'],
      excluded_source_classes: ['generic_blog', 'directory', 'search_snippet'],
    },
    intent_strength_required: intentStrength(mode, signals),
    capability_status: 'supported',
    confidence: Math.max(0.6, seller.user_service ? 0.75 : 0.6),
    clarification_required: false,
  }
}
