import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * GET /api/insights/ai
 * Genera 3-5 insight commerciali AI basati sui dati REALI della pipeline dell'utente.
 * Differente dai tips hardcoded della pagina: qui analizziamo pattern, stagnazione,
 * concentrazione settoriale, opportunità di follow-up con GPT-4o-mini.
 *
 * Cache lato client: il chiamante decide. Lato server è gratis (no cache),
 * ma il modello costa pochissimo perché passiamo solo il riassunto aggregato.
 *
 * Response:
 *   { insights: [{ icon, title, body, severity }], usedAI: boolean, generatedAt }
 */

type Insight = {
  icon: 'trend' | 'risk' | 'opportunity' | 'win' | 'focus'
  title: string
  body: string
  severity: 'info' | 'warning' | 'success' | 'critical'
}

function fallbackInsights(summary: any): Insight[] {
  // Fallback offline se OpenAI non risponde — mai lasciare l'utente senza nulla
  const tips: Insight[] = []
  if (summary.total === 0) {
    tips.push({
      icon: 'focus',
      title: 'Inizia ad aggiungere lead alla pipeline',
      body: 'Non hai ancora deal in pipeline. Vai alla Ricerca, trova lead, e aggiungili alla pipeline per sbloccare insight personalizzati.',
      severity: 'info',
    })
    return tips
  }
  if (summary.winRate >= 40) {
    tips.push({
      icon: 'win',
      title: `Win rate del ${summary.winRate}% — top performance`,
      body: 'Il tuo tasso di chiusura è sopra la media B2B italiana (28-32%). Concentrati su deal con valore alto per scalare.',
      severity: 'success',
    })
  } else if (summary.winRate > 0 && summary.winRate < 20) {
    tips.push({
      icon: 'risk',
      title: `Win rate basso (${summary.winRate}%)`,
      body: 'Qualifica meglio i lead prima di contattarli. Filtra per score >= 60 e usa Smart Insights per identificare le categorie che convertono.',
      severity: 'warning',
    })
  }
  if (summary.stagnantCount > 0) {
    tips.push({
      icon: 'risk',
      title: `${summary.stagnantCount} deal fermi da oltre 7 giorni`,
      body: 'I deal stagnanti perdono il 60% di probabilità di chiusura ogni settimana. Riprendili oggi con una sequenza email.',
      severity: 'warning',
    })
  }
  if (summary.topCategory && summary.topCategoryRevenue > 0) {
    tips.push({
      icon: 'opportunity',
      title: `Specializzati in "${summary.topCategory}"`,
      body: `Questa categoria ti ha portato ${Math.round(summary.topCategoryRevenue)}€ di revenue. Cerca altri lead simili per replicare il successo.`,
      severity: 'success',
    })
  }
  if (summary.avgDealSize > 0) {
    tips.push({
      icon: 'trend',
      title: `Deal medio: ${Math.round(summary.avgDealSize)}€`,
      body: 'Per crescere senza aumentare i contatti, lavora sull\'up-sell e sui pacchetti retainer mensili.',
      severity: 'info',
    })
  }
  if (tips.length === 0) {
    tips.push({
      icon: 'focus',
      title: 'Mantieni il momentum',
      body: 'Aggiungi più deal alla pipeline e contattali entro 48 ore: la velocità di risposta è il singolo fattore più correlato alla chiusura.',
      severity: 'info',
    })
  }
  return tips
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ insights: [], usedAI: false }, { status: 401 })

  // Aggrega dati pipeline lato server (niente PII raw a OpenAI)
  const { data: items } = await supabase
    .from('lead_pipeline')
    .select('stage, deal_value, lead_category, lead_city, lead_score, created_at, updated_at')
    .eq('user_id', user.id)
    .limit(500)

  const pipeline = Array.isArray(items) ? items : []

  const won = pipeline.filter((p: any) => p.stage === 'vinto')
  const lost = pipeline.filter((p: any) => p.stage === 'perso')
  const active = pipeline.filter((p: any) => !['vinto', 'perso'].includes(p.stage))
  const totalRevenue = won.reduce((s: number, p: any) => s + (Number(p.deal_value) || 0), 0)
  const pipelineValue = active.reduce((s: number, p: any) => s + (Number(p.deal_value) || 0), 0)
  const avgDealSize = won.length > 0 ? totalRevenue / won.length : 0
  const winRate = won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0
  const stagnantCount = active.filter((p: any) => {
    const days = (Date.now() - new Date(p.updated_at).getTime()) / 86400000
    return days > 7
  }).length

  // Top categories by revenue
  const catMap = new Map<string, { won: number; total: number; revenue: number }>()
  for (const p of pipeline as any[]) {
    const cat = (typeof p.lead_category === 'string' && p.lead_category.trim()) || 'Altro'
    const cur = catMap.get(cat) || { won: 0, total: 0, revenue: 0 }
    cur.total++
    if (p.stage === 'vinto') {
      cur.won++
      cur.revenue += Number(p.deal_value) || 0
    }
    catMap.set(cat, cur)
  }
  const bestCats = Array.from(catMap.entries())
    .map(([cat, d]) => ({ cat, ...d }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 3)

  const topCategory = bestCats[0]?.cat || ''
  const topCategoryRevenue = bestCats[0]?.revenue || 0

  // Avg score
  const validScores = pipeline.map((p: any) => Number(p.lead_score)).filter((n) => Number.isFinite(n) && n > 0)
  const avgScore = validScores.length > 0 ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length) : 0

  // Stages distribution
  const stageDistribution: Record<string, number> = {}
  for (const p of pipeline as any[]) {
    const s = String(p.stage || 'nuovo')
    stageDistribution[s] = (stageDistribution[s] || 0) + 1
  }

  const summary = {
    total: pipeline.length,
    active: active.length,
    won: won.length,
    lost: lost.length,
    totalRevenue,
    pipelineValue,
    avgDealSize,
    winRate,
    stagnantCount,
    avgScore,
    bestCategories: bestCats,
    topCategory,
    topCategoryRevenue,
    stageDistribution,
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || pipeline.length === 0) {
    return NextResponse.json({
      insights: fallbackInsights(summary),
      usedAI: false,
      generatedAt: new Date().toISOString(),
      summary,
    })
  }

  // Chiamata GPT-4o-mini con summary aggregato (nessun PII, solo metriche)
  const systemPrompt = `Sei un sales coach B2B italiano esperto di pipeline management.
Analizzi i dati REALI di un venditore e produci 3-5 insight azionabili.

Regole rigorose:
- Lingua: italiano.
- Cita SEMPRE i numeri reali del summary (revenue, win rate, deal count).
- Niente frasi generiche tipo "fai più follow-up". Sii specifico: dì QUALE deal, QUALE fase, perché.
- Ogni insight ha: title (max 70 char), body (max 220 char), severity (info/warning/success/critical), icon (trend/risk/opportunity/win/focus).
- Tono: diretto, professionale, niente emoji.
- Se i dati indicano qualcosa di buono → severity success/win. Se rischio → warning/critical. Se neutro → info.
- Rispondi SOLO con JSON valido nel formato: { "insights": [{"icon":"...","title":"...","body":"...","severity":"..."}] }`

  const userPrompt = `Analizza questa pipeline e produci 3-5 insight:
${JSON.stringify(summary, null, 2)}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

    if (!res.ok) {
      return NextResponse.json({
        insights: fallbackInsights(summary),
        usedAI: false,
        generatedAt: new Date().toISOString(),
        summary,
      })
    }

    const data = await res.json()
    const raw = data?.choices?.[0]?.message?.content || ''
    let parsed: any = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }

    const rawInsights = Array.isArray(parsed?.insights) ? parsed.insights : []
    const cleaned: Insight[] = rawInsights
      .map((i: any) => ({
        icon: ['trend', 'risk', 'opportunity', 'win', 'focus'].includes(i?.icon) ? i.icon : 'focus',
        title: typeof i?.title === 'string' ? i.title.slice(0, 100) : 'Insight',
        body: typeof i?.body === 'string' ? i.body.slice(0, 300) : '',
        severity: ['info', 'warning', 'success', 'critical'].includes(i?.severity) ? i.severity : 'info',
      }))
      .filter((i: Insight) => !!i.body)
      .slice(0, 5)

    if (cleaned.length === 0) {
      return NextResponse.json({
        insights: fallbackInsights(summary),
        usedAI: false,
        generatedAt: new Date().toISOString(),
        summary,
      })
    }

    return NextResponse.json({
      insights: cleaned,
      usedAI: true,
      generatedAt: new Date().toISOString(),
      summary,
    })
  } catch {
    return NextResponse.json({
      insights: fallbackInsights(summary),
      usedAI: false,
      generatedAt: new Date().toISOString(),
      summary,
    })
  }
}
