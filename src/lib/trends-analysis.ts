import 'server-only'

type TrendsAnalysis = {
  trend: 'growing' | 'stable' | 'declining'
  growthPercentage: number | null
  peakMonths: string[]
  bestContactTime: string
  marketOpportunity: string
  insights: string[]
  source: string
}

export async function analyzeTrends(category: string, city: string): Promise<TrendsAnalysis> {
  const cat = String(category || '').trim()
  const c = String(city || '').trim()

  if (!cat || !c) {
    return {
      trend: 'stable',
      growthPercentage: null,
      peakMonths: [],
      bestContactTime: 'Dati insufficienti',
      marketOpportunity: '',
      insights: [],
      source: 'error',
    }
  }

  // Chiama il backend Hetzner per Google Trends reale
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://116.203.137.39:8002'
    const res = await fetch(`${backendUrl}/trends-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: cat, city: c }),
      signal: AbortSignal.timeout(25000),
    })

    if (res.ok) {
      const data = (await res.json()) as any
      if (data && data.trend) {
        return {
          trend: data.trend || 'stable',
          growthPercentage: data.growthPercentage ?? null,
          peakMonths: data.peakMonths || [],
          bestContactTime: data.bestContactTime || '',
          marketOpportunity: data.marketOpportunity || '',
          insights: data.insights || [],
          source: 'pytrends',
        }
      }
    }
  } catch {
    // Fallback a GPT se pytrends non disponibile
  }

  // Fallback GPT migliorato con anno corretto
  const apiKey = (['1','true','yes','on'].includes(String(process.env.UQE_OPENAI_ENABLED || '').toLowerCase()) ? '' : '')
  if (!apiKey) {
    return {
      trend: 'stable',
      growthPercentage: null,
      peakMonths: [],
      bestContactTime: '',
      marketOpportunity: '',
      insights: [],
      source: 'error',
    }
  }

  try {
    const prompt = `Sei un esperto di trend di mercato italiano.
Analizza il settore: ${cat} nella città: ${c}
Anno: 2026

Fornisci dati REALI e SPECIFICI basati sulla tua conoscenza 
del mercato italiano 2024-2026. NON inventare percentuali 
casuali — usa stime basate su dati reali del settore.

Rispondi SOLO con JSON:
{
  "trend": "growing|stable|declining",
  "growthPercentage": numero_realistico_o_null,
  "peakMonths": ["mese1", "mese2"],
  "bestContactTime": "periodo specifico es: lunedì-venerdì mattina",
  "marketOpportunity": "opportunità specifica per questo settore in questa città",
  "insights": [
    "insight basato su dati reali 1",
    "insight basato su dati reali 2",
    "insight basato su dati reali 3"
  ]
}
Solo JSON.`

    const res = await fetch('data:,mirax-legacy-provider-removed', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
        temperature: 0,
      }),
    })

    const data = (await res.json()) as any
    const content = data?.choices?.[0]?.message?.content || '{}'
    const parsed = JSON.parse(String(content).replace(/```json|```/g, '').trim())

    return {
      trend: parsed?.trend || 'stable',
      growthPercentage: parsed?.growthPercentage ?? null,
      peakMonths: parsed?.peakMonths || [],
      bestContactTime: parsed?.bestContactTime || '',
      marketOpportunity: parsed?.marketOpportunity || '',
      insights: parsed?.insights || [],
      source: 'gpt',
    }
  } catch {
    return {
      trend: 'stable',
      growthPercentage: null,
      peakMonths: [],
      bestContactTime: '',
      marketOpportunity: '',
      insights: [],
      source: 'error',
    }
  }
}
