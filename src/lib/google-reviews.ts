import 'server-only'

export async function fetchGoogleReviews(
  businessName: string,
  city: string
): Promise<{ reviews: any[]; rating: number; total: number }> {
  try {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    if (!apiKey) return { reviews: [], rating: 0, total: 0 }

    const q = `${String(businessName || '').trim()} ${String(city || '').trim()}`.trim()
    if (!q) return { reviews: [], rating: 0, total: 0 }

    const searchRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&key=${apiKey}`
    )
    const searchData = (await searchRes.json()) as any
    const placeId = searchData?.results?.[0]?.place_id
    if (!placeId) return { reviews: [], rating: 0, total: 0 }

    const detailRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=reviews,rating,user_ratings_total&key=${apiKey}`
    )
    const detailData = (await detailRes.json()) as any

    return {
      reviews: Array.isArray(detailData?.result?.reviews) ? detailData.result.reviews : [],
      rating: typeof detailData?.result?.rating === 'number' ? detailData.result.rating : 0,
      total: typeof detailData?.result?.user_ratings_total === 'number' ? detailData.result.user_ratings_total : 0,
    }
  } catch (e) {
    console.error('[REVIEWS]', e)
    return { reviews: [], rating: 0, total: 0 }
  }
}

export async function analyzeReviewsWithAI(
  reviews: any[],
  businessName: string
): Promise<{
  positiveThemes: string[]
  negativeThemes: string[]
  opportunities: string[]
  sentiment: 'positive' | 'neutral' | 'negative'
  summary: string
}> {
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return {
      positiveThemes: [],
      negativeThemes: [],
      opportunities: [],
      sentiment: 'neutral',
      summary: 'Nessuna recensione disponibile',
    }
  }

  const apiKey = (['1','true','yes','on'].includes(String(process.env.UQE_OPENAI_ENABLED || '').toLowerCase()) ? '' : '')
  if (!apiKey) {
    return {
      positiveThemes: [],
      negativeThemes: [],
      opportunities: [],
      sentiment: 'neutral',
      summary: 'Analisi AI recensioni non attiva',
    }
  }

  const reviewTexts = reviews
    .slice(0, 20)
    .map((r: any) => {
      const rating = typeof r?.rating === 'number' ? r.rating : 0
      const text = typeof r?.text === 'string' ? r.text : ''
      return `[${rating}⭐] ${text}`
    })
    .join('\n')

  const prompt = `Analizza queste recensioni Google di "${businessName}":

${reviewTexts}

Rispondi SOLO con JSON valido:
{
  "positiveThemes": ["tema1", "tema2"],
  "negativeThemes": ["problema1", "problema2"],
  "opportunities": ["opportunità commerciale1", "opportunità2"],
  "sentiment": "positive|neutral|negative",
  "summary": "Riassunto in 2 righe"
}

Le "opportunities" devono essere problemi reali che un consulente digitale può risolvere.
Solo JSON, zero testo aggiuntivo.`

  const res = await fetch('data:,mirax-legacy-provider-removed', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0,
    }),
  })

  const data = (await res.json()) as any
  const content = data?.choices?.[0]?.message?.content || '{}'

  try {
    const parsed = JSON.parse(String(content).replace(/```json|```/g, '').trim())
    return {
      positiveThemes: Array.isArray(parsed?.positiveThemes) ? parsed.positiveThemes.filter((x: any) => typeof x === 'string') : [],
      negativeThemes: Array.isArray(parsed?.negativeThemes) ? parsed.negativeThemes.filter((x: any) => typeof x === 'string') : [],
      opportunities: Array.isArray(parsed?.opportunities) ? parsed.opportunities.filter((x: any) => typeof x === 'string') : [],
      sentiment: parsed?.sentiment === 'positive' || parsed?.sentiment === 'negative' ? parsed.sentiment : 'neutral',
      summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
    }
  } catch {
    return {
      positiveThemes: [],
      negativeThemes: [],
      opportunities: [],
      sentiment: 'neutral',
      summary: 'Errore parsing AI',
    }
  }
}
