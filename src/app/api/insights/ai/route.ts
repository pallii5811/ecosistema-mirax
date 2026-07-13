import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { runInsightsAgent } from '@/lib/agents/insights-agent'

/**
 * GET /api/insights/ai
 * Sales Coach AI — powered by Insights Agent (PKI + knowledge + pipeline).
 */

type Insight = {
  icon: 'trend' | 'risk' | 'opportunity' | 'win' | 'focus'
  title: string
  body: string
  severity: 'info' | 'warning' | 'success' | 'critical'
}

function fallbackInsights(summary: Record<string, unknown>): Insight[] {
  const tips: Insight[] = []
  const total = Number(summary.total) || 0
  const winRate = Number(summary.winRate) || 0
  const stagnantCount = Number(summary.stagnantCount) || 0
  const topCategory = String(summary.topCategory ?? '')
  const topCategoryRevenue = Number(summary.topCategoryRevenue) || 0
  const avgDealSize = Number(summary.avgDealSize) || 0
  const pki = summary.pki as { score?: number; topLiftPattern?: string } | undefined

  if (total === 0) {
    tips.push({
      icon: 'focus',
      title: 'Inizia ad aggiungere lead alla pipeline',
      body: 'Non hai ancora deal in pipeline. Vai alla Ricerca, trova lead, e aggiungili alla pipeline per sbloccare insight personalizzati.',
      severity: 'info',
    })
    return tips
  }

  if (typeof pki?.score === 'number' && pki.score >= 70) {
    tips.push({
      icon: 'win',
      title: `PKI ${pki.score}/100 — performance solida`,
      body: pki.topLiftPattern
        ? `Pattern vincente: ${pki.topLiftPattern}. Replica su lead simili questa settimana.`
        : 'Mantieni il ritmo su outreach e follow-up entro 48 ore.',
      severity: 'success',
    })
  }

  if (winRate >= 40) {
    tips.push({
      icon: 'win',
      title: `Win rate del ${winRate}% — top performance`,
      body: 'Il tuo tasso di chiusura è sopra la media B2B italiana (28-32%). Concentrati su deal con valore alto per scalare.',
      severity: 'success',
    })
  } else if (winRate > 0 && winRate < 20) {
    tips.push({
      icon: 'risk',
      title: `Win rate basso (${winRate}%)`,
      body: 'Qualifica meglio i lead prima di contattarli. Filtra per score >= 60 e usa Smart Insights per identificare le categorie che convertono.',
      severity: 'warning',
    })
  }

  if (stagnantCount > 0) {
    tips.push({
      icon: 'risk',
      title: `${stagnantCount} deal fermi da oltre 7 giorni`,
      body: 'I deal stagnanti perdono probabilità di chiusura ogni settimana. Riprendili oggi con una sequenza email.',
      severity: 'warning',
    })
  }

  if (topCategory && topCategoryRevenue > 0) {
    tips.push({
      icon: 'opportunity',
      title: `Specializzati in "${topCategory}"`,
      body: `Questa categoria ti ha portato ${Math.round(topCategoryRevenue)}€ di revenue. Cerca altri lead simili per replicare il successo.`,
      severity: 'success',
    })
  }

  if (avgDealSize > 0) {
    tips.push({
      icon: 'trend',
      title: `Deal medio: ${Math.round(avgDealSize)}€`,
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

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ insights: [], usedAI: false }, { status: 401 })

  const knowledgeQuery = req.nextUrl.searchParams.get('q') || 'pattern conversione pipeline'

  const agent = await runInsightsAgent(supabase, {
    userId: user.id,
    knowledgeQuery,
    knowledgeLimit: 5,
  })

  const summary = agent.summary

  const apiKey = (['1','true','yes','on'].includes(String(process.env.UQE_OPENAI_ENABLED || '').toLowerCase()) ? '' : '')
  const total = Number(summary.total) || 0

  if (!apiKey || total === 0) {
    return NextResponse.json({
      insights: fallbackInsights(summary),
      usedAI: false,
      generatedAt: new Date().toISOString(),
      summary,
      agent: 'insights',
      pkiGrade: agent.pkiGrade,
    })
  }

  const systemPrompt = `Sei un sales coach B2B italiano esperto di pipeline management.
Analizzi i dati REALI di un venditore e produci 3-5 insight azionabili.

Regole rigorose:
- Lingua: italiano.
- Cita SEMPRE i numeri reali del summary (revenue, win rate, deal count, PKI score).
- Se presente pki.topLiftPattern o closure_patterns, suggerisci azioni basate su quei pattern.
- Se knowledge_hits è presente, collega 1 insight a un pattern CKBase rilevante.
- Niente frasi generiche. Sii specifico su fase pipeline e numeri.
- Ogni insight: title (max 70 char), body (max 220 char), severity, icon (trend/risk/opportunity/win/focus).
- Rispondi SOLO JSON: { "insights": [{"icon":"...","title":"...","body":"...","severity":"..."}] }`

  const userPrompt = `Analizza questa pipeline e produci 3-5 insight:
${JSON.stringify(summary, null, 2)}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)

    const res = await fetch('data:,mirax-legacy-provider-removed', {
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
        agent: 'insights',
      })
    }

    const data = await res.json()
    const raw = data?.choices?.[0]?.message?.content || ''
    let parsed: { insights?: unknown[] } | null = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }

    const rawInsights = Array.isArray(parsed?.insights) ? parsed.insights : []
    const cleaned: Insight[] = rawInsights
      .map((item) => {
        const i = item as Record<string, unknown>
        return {
        icon: ['trend', 'risk', 'opportunity', 'win', 'focus'].includes(String(i?.icon))
          ? (i.icon as Insight['icon'])
          : 'focus',
        title: typeof i?.title === 'string' ? i.title.slice(0, 100) : 'Insight',
        body: typeof i?.body === 'string' ? i.body.slice(0, 300) : '',
        severity: ['info', 'warning', 'success', 'critical'].includes(String(i?.severity))
          ? (i.severity as Insight['severity'])
          : 'info',
        }
      })
      .filter((i) => !!i.body)
      .slice(0, 5)

    if (cleaned.length === 0) {
      return NextResponse.json({
        insights: fallbackInsights(summary),
        usedAI: false,
        generatedAt: new Date().toISOString(),
        summary,
        agent: 'insights',
      })
    }

    return NextResponse.json({
      insights: cleaned,
      usedAI: true,
      generatedAt: new Date().toISOString(),
      summary,
      agent: 'insights',
      pkiGrade: agent.pkiGrade,
    })
  } catch {
    return NextResponse.json({
      insights: fallbackInsights(summary),
      usedAI: false,
      generatedAt: new Date().toISOString(),
      summary,
      agent: 'insights',
    })
  }
}
