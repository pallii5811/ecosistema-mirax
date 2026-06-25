import 'server-only'

type GooglePlaceCandidate = {
  place_id?: string
  name?: string
  rating?: number
  user_ratings_total?: number
  formatted_address?: string
}

export type LocalCompetitor = {
  name: string
  placeId: string | null
  rating: number | null
  totalReviews: number | null
  address: string | null
  phone: string | null
  website: string | null
  googleMapsUrl: string | null
}

export type CompetitorAnalysis = {
  overallCompetitionScore: number
  competitors: LocalCompetitor[]
  marketPosition: {
    summary: string
    strengths: string[]
    weaknesses: string[]
    suggestedAngle: string
    threatLevel: 'low' | 'medium' | 'high'
  }
  opportunities: string[]
  urgencyMessage: string
}

async function fetchGooglePlacesTextSearch(query: string): Promise<GooglePlaceCandidate[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) return []

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`
  )

  const data = (await res.json()) as any
  const results = Array.isArray(data?.results) ? (data.results as any[]) : []
  return results
}

async function fetchGooglePlaceDetails(placeId: string): Promise<{
  phone: string | null
  website: string | null
  googleMapsUrl: string | null
}> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) return { phone: null, website: null, googleMapsUrl: null }

  const fields = ['formatted_phone_number', 'website', 'url'].join(',')
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=${encodeURIComponent(fields)}&key=${apiKey}`
  )
  const data = (await res.json()) as any

  return {
    phone: typeof data?.result?.formatted_phone_number === 'string' ? data.result.formatted_phone_number : null,
    website: typeof data?.result?.website === 'string' ? data.result.website : null,
    googleMapsUrl: typeof data?.result?.url === 'string' ? data.result.url : null,
  }
}

function normalizeCompetitorFromCandidate(c: GooglePlaceCandidate): LocalCompetitor {
  return {
    name: typeof c?.name === 'string' ? c.name : '—',
    placeId: typeof c?.place_id === 'string' ? c.place_id : null,
    rating: typeof c?.rating === 'number' ? c.rating : null,
    totalReviews: typeof c?.user_ratings_total === 'number' ? c.user_ratings_total : null,
    address: typeof c?.formatted_address === 'string' ? c.formatted_address : null,
    phone: null,
    website: null,
    googleMapsUrl: null,
  }
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(String(raw).replace(/```json|```/g, '').trim()) as T
  } catch {
    return null
  }
}

function sanitizeAnalysis(parsed: any, competitors: LocalCompetitor[]): CompetitorAnalysis {
  const threatLevel = parsed?.marketPosition?.threatLevel
  const normalizedThreat: 'low' | 'medium' | 'high' = threatLevel === 'low' || threatLevel === 'high' ? threatLevel : 'medium'

  return {
    overallCompetitionScore:
      typeof parsed?.overallCompetitionScore === 'number' && Number.isFinite(parsed.overallCompetitionScore)
        ? Math.max(0, Math.min(100, Math.round(parsed.overallCompetitionScore)))
        : 0,
    competitors,
    marketPosition: {
      summary: typeof parsed?.marketPosition?.summary === 'string' ? parsed.marketPosition.summary : '',
      strengths: Array.isArray(parsed?.marketPosition?.strengths)
        ? parsed.marketPosition.strengths.filter((x: any) => typeof x === 'string')
        : [],
      weaknesses: Array.isArray(parsed?.marketPosition?.weaknesses)
        ? parsed.marketPosition.weaknesses.filter((x: any) => typeof x === 'string')
        : [],
      suggestedAngle: typeof parsed?.marketPosition?.suggestedAngle === 'string' ? parsed.marketPosition.suggestedAngle : '',
      threatLevel: normalizedThreat,
    },
    opportunities: Array.isArray(parsed?.opportunities) ? parsed.opportunities.filter((x: any) => typeof x === 'string') : [],
    urgencyMessage: typeof parsed?.urgencyMessage === 'string' ? parsed.urgencyMessage : '',
  }
}

export async function analyzeLocalCompetitors(
  businessName: string,
  city: string,
  category: string,
  existingCompetitors?: Array<{ name: string; rating?: number; reviews_count?: number }>
): Promise<CompetitorAnalysis> {
  try {
    const name = String(businessName || '').trim()
    const c = String(city || '').trim()
    const cat = String(category || '').trim()

    if (!name || !c) {
      return {
        overallCompetitionScore: 0,
        competitors: [],
        marketPosition: { summary: 'Dati insufficienti (nome/città mancanti)', strengths: [], weaknesses: [], suggestedAngle: '', threatLevel: 'medium' },
        opportunities: [],
        urgencyMessage: '',
      }
    }

    let competitors: LocalCompetitor[] = []

    if (Array.isArray(existingCompetitors) && existingCompetitors.length > 0) {
      competitors = existingCompetitors.map((comp) => ({
        name: typeof comp?.name === 'string' && comp.name.trim().length > 0 ? comp.name : '—',
        placeId: null,
        rating: typeof comp?.rating === 'number' ? comp.rating : null,
        totalReviews: typeof comp?.reviews_count === 'number' ? comp.reviews_count : null,
        address: null,
        phone: null,
        website: null,
        googleMapsUrl: null,
      }))
    } else {
      const placesKey = process.env.GOOGLE_PLACES_API_KEY
      if (!placesKey) {
        return {
          overallCompetitionScore: 0,
          competitors: [],
          marketPosition: { summary: 'GOOGLE_PLACES_API_KEY mancante', strengths: [], weaknesses: [], suggestedAngle: '', threatLevel: 'medium' },
          opportunities: [],
          urgencyMessage: '',
        }
      }

      const query = `${cat || 'attività'} vicino a ${c}`
      const candidates = await fetchGooglePlacesTextSearch(query)

      const filtered = candidates
        .filter((x) => typeof x?.name === 'string' && x.name.trim().length > 0)
        .filter((x) => (typeof x?.name === 'string' ? x.name.toLowerCase() : '') !== name.toLowerCase())
        .slice(0, 6)

      const competitorsBase = filtered.map(normalizeCompetitorFromCandidate)

      competitors = await Promise.all(
        competitorsBase.map(async (comp) => {
          if (!comp.placeId) return comp
          try {
            const det = await fetchGooglePlaceDetails(comp.placeId)
            return { ...comp, ...det }
          } catch {
            return comp
          }
        })
      )
    }

    const openAiKey = process.env.OPENAI_API_KEY
    if (!openAiKey) {
      return {
        overallCompetitionScore: 0,
        competitors,
        marketPosition: { summary: 'OPENAI_API_KEY mancante', strengths: [], weaknesses: [], suggestedAngle: '', threatLevel: 'medium' },
        opportunities: [],
        urgencyMessage: '',
      }
    }

    const compactCompetitors = competitors.map((x) => ({
      name: x.name,
      rating: x.rating,
      totalReviews: x.totalReviews,
      address: x.address,
      website: x.website,
      googleMapsUrl: x.googleMapsUrl,
    }))

    const prompt = `Sei un consulente commerciale digitale. Devi fare una "Local Competitor Analysis" per questa attività:

Business: ${name}
Città/Zona: ${c}
Categoria: ${cat || '—'}

Ecco una lista di competitor locali (da Google Places) con metriche:
${JSON.stringify(compactCompetitors, null, 2)}

Rispondi SOLO con JSON valido (zero testo extra):
{
  "overallCompetitionScore": 0,
  "marketPosition": {
    "summary": "",
    "strengths": [""],
    "weaknesses": [""],
    "suggestedAngle": "",
    "threatLevel": "low|medium|high"
  },
  "opportunities": [""],
  "urgencyMessage": ""
}

Regole:
- overallCompetitionScore: 0-100 (più alto = mercato più competitivo).
- opportunities: deve contenere opportunità commerciali pratiche per vendere servizi digitali (ads, seo, social, landing, tracking).
- urgencyMessage: 1-2 frasi, tono commerciale ma non aggressivo.`

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 650,
        temperature: 0,
      }),
    })

    const data = (await res.json()) as any
    const content = data?.choices?.[0]?.message?.content || '{}'
    const parsed = safeJsonParse<any>(String(content))

    if (!parsed) {
      return {
        overallCompetitionScore: 0,
        competitors,
        marketPosition: { summary: 'Errore parsing AI', strengths: [], weaknesses: [], suggestedAngle: '', threatLevel: 'medium' },
        opportunities: [],
        urgencyMessage: '',
      }
    }

    return sanitizeAnalysis(parsed, competitors)
  } catch (e) {
    console.error('[COMPETITORS]', e)
    return {
      overallCompetitionScore: 0,
      competitors: [],
      marketPosition: { summary: 'Errore inatteso', strengths: [], weaknesses: [], suggestedAngle: '', threatLevel: 'medium' },
      opportunities: [],
      urgencyMessage: '',
    }
  }
}
