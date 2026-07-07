import type { CommercialIntent } from '@/lib/signal-intent/commercial-intent'

export type SellerBuyerProfile = {
  is_seller_query: boolean
  user_service: string | null
  buyer_industries: string[]
  maps_category: string | null
  default_location: string | null
  intent_summary: string | null
}

const SELLER_QUERY =
  /\b(mi\s+servono\s+clienti|trov\w+\s+clienti|clienti\s+per|cerco\s+clienti|potenziali\s+clienti|vendere\s+(?:il\s+mio|i\s+miei|la\s+mia|un\s+mio|una\s+mia)|chi\s+(?:comprerebbe|acquista|potrebbe\s+comprare)|promuovere\s+(?:il\s+mio|i\s+miei)|lead\s+per\s+vendere|sono\s+(?:un|una)\b|potrebbero\s+aver\s+bisogno|che\s+potrebbero\s+aver\s+bisogno|freelanc\w*|libero\s+profession\w*)\b/i

/** Cosa vende l'utente — estrazione leggera dal testo. */
function extractUserService(query: string): string | null {
  const q = query.trim()
  const patterns: RegExp[] = [
    /\bsono\s+(?:un|una)\s+(.+?)(?:\s*,|\s+trov|\s+cerc|\s+che|\.$)/i,
    /\bvendere\s+(?:il\s+mio|i\s+miei|la\s+mia|un\s+mio|una\s+mia)\s+(.+?)(?:\.|$)/i,
    /\bclienti\s+per\s+(?:vendere\s+)?(?:il\s+mio|i\s+miei|la\s+mia|un\s+mio|una\s+mia)?\s*(.+?)(?:\.|$)/i,
    /\bsoftware\s+(?:di|per)\s+(.+?)(?:\.|$)/i,
    /\bservizi?\s+(?:di|per)\s+(.+?)(?:\.|$)/i,
    /\bprodott\w+\s+(?:di|per)\s+(.+?)(?:\.|$)/i,
  ]
  for (const re of patterns) {
    const m = q.match(re)
    if (m?.[1]?.trim()) return m[1].trim().slice(0, 120)
  }
  if (/\blead\s*gen/i.test(q)) return 'software di lead generation'
  if (/\bmarketing\s+digitale\b/i.test(q)) return 'servizi di marketing digitale'
  if (/\bcrm\b/i.test(q)) return 'software CRM'
  return null
}

type BuyerRule = {
  patterns: RegExp[]
  industries: string[]
  maps_category: string
}

const BUYER_RULES: BuyerRule[] = [
  {
    patterns: [/\bpython\b/i, /\bprogrammatore\b/i, /\bdeveloper\b/i, /\bsviluppat\w*\b/i, /\bfull[\s-]?stack\b/i],
    industries: ['software', 'tech', 'pmi'],
    maps_category: 'Servizi informatici',
  },
  {
    patterns: [/\blead\s*gen/i, /generazione\s+lead/i, /prospecting/i, /prospezione/i, /outbound/i],
    industries: ['marketing', 'vendite'],
    maps_category: 'Agenzie di marketing',
  },
  {
    patterns: [/\bcrm\b/i, /gestionale/i, /erp\b/i],
    industries: ['software', 'commerciale'],
    maps_category: 'Aziende',
  },
  {
    patterns: [/marketing\s+digitale/i, /\bseo\b/i, /\bads\b/i, /social\s+media/i, /pubblicit/i],
    industries: ['ristorazione', 'retail', 'hotel'],
    maps_category: 'Aziende',
  },
  {
    patterns: [/consulenz/i, /formazione/i, /coaching/i],
    industries: ['pmi'],
    maps_category: 'Aziende',
  },
  {
    patterns: [/\bsoftware\b/i, /\bsaas\b/i, /app\b/i, /piattaforma/i],
    industries: ['marketing', 'software'],
    maps_category: 'Agenzie di marketing',
  },
  {
    patterns: [/sito\s+web/i, /web\s+agency/i, /ecommerce/i, /shopify/i],
    industries: ['retail', 'ristorazione'],
    maps_category: 'Aziende',
  },
  {
    patterns: [/fotovoltaic/i, /pannelli\s+solari/i, /energia/i],
    industries: ['edilizia', 'industria'],
    maps_category: 'Imprese edili',
  },
]

function matchBuyerRule(text: string): BuyerRule | null {
  const hay = text.toLowerCase()
  for (const rule of BUYER_RULES) {
    if (rule.patterns.some((p) => p.test(hay))) return rule
  }
  return null
}

export function inferSellerBuyerProfile(
  query: string,
  intent?: Partial<CommercialIntent> | null,
): SellerBuyerProfile {
  const q = (query || '').trim()
  const isSeller = SELLER_QUERY.test(q)
  const service =
    intent?.user_service_description?.trim() ||
    extractUserService(q) ||
    null

  const rule = matchBuyerRule(`${q} ${service || ''}`)
  const buyerIndustries = rule?.industries ?? (isSeller || service ? ['pmi'] : [])
  const mapsCategory = rule?.maps_category ?? (isSeller || service ? 'Aziende' : null)

  let intentSummary: string | null = null
  if (isSeller || service) {
    const target = mapsCategory || buyerIndustries.join(', ')
    intentSummary = service
      ? `Clienti per ${service} → ${target}`
      : `Ricerca clienti → ${target}`
  }

  const isDevSeller =
    /\b(python|programmatore|developer|sviluppat\w*|software\s+engineer|full[\s-]?stack)\b/i.test(
      `${q} ${service || ''}`,
    )

  return {
    is_seller_query: isSeller,
    user_service: service,
    buyer_industries: buyerIndustries,
    maps_category: mapsCategory,
    default_location: isDevSeller ? 'Milano' : isSeller || service ? 'Italia' : null,
    intent_summary: intentSummary,
  }
}

/** Arricchisce CommercialIntent con target buyer quando l'utente descrive cosa vende. */
export function enrichCommercialIntentFromSellerQuery(
  query: string,
  intent: CommercialIntent,
): CommercialIntent {
  const profile = inferSellerBuyerProfile(query, intent)
  if (!profile.is_seller_query && !profile.user_service) return intent

  const next: CommercialIntent = { ...intent, target_profile: { ...intent.target_profile } }

  if (profile.user_service && !next.user_service_description) {
    next.user_service_description = profile.user_service
  }
  if (!next.target_profile.industries?.length && profile.buyer_industries.length) {
    next.target_profile.industries = profile.buyer_industries
  }
  if (!next.target_profile.locations?.length && profile.default_location) {
    next.target_profile.locations = [profile.default_location]
  }
  if (profile.intent_summary && (!next.intent_summary || next.intent_summary === 'Ricerca commerciale')) {
    next.intent_summary = profile.intent_summary
  }
  if (!next.reasoning && profile.intent_summary) {
    next.reasoning = profile.intent_summary
  }
  if (next.confidence < 0.55) next.confidence = 0.55

  const isDevSeller =
    /\b(python|programmatore|developer|sviluppat\w*|software\s+engineer|full[\s-]?stack)\b/i.test(
      `${query} ${profile.user_service || ''}`,
    )
  if (isDevSeller) {
    const roles = [...(next.target_profile.roles ?? [])]
    if (!roles.includes('programmatore')) roles.push('programmatore')
    next.target_profile.roles = roles
    const hasHiring = next.signals.some((s) => s.type === 'hiring')
    if (!hasHiring) {
      next.signals = [
        ...next.signals,
        { type: 'hiring', params: { roles } },
      ]
    }
  }

  return next
}
