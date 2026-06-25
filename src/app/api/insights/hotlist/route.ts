import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * GET /api/insights/hotlist
 *
 * Restituisce i lead "più caldi" dell'utente (pipeline + ricerche):
 *  - Top by lead_score
 *  - Stato pipeline corrente
 *  - Categoria/città dove conferte di più (pattern recognition)
 *  - Statistiche di conversione personale
 *
 * Tutto computato server-side per essere indipendente da AI esterna.
 */

type HotLead = {
  id: string
  source: 'pipeline'
  lead_name: string
  lead_website: string | null
  lead_city: string | null
  lead_category: string | null
  lead_score: number
  stage: string
  deal_value: number
  updated_at: string
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { hotlist: [], stats: null, patterns: null, error: 'Unauthorized' },
      { status: 401 }
    )
  }

  // Pipeline leads (sempre presente, owned)
  const { data: pipelineItems } = await supabase
    .from('lead_pipeline')
    .select('id, lead_name, lead_website, lead_city, lead_category, lead_score, stage, deal_value, updated_at')
    .eq('user_id', user.id)
    .order('lead_score', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(50)

  const items = Array.isArray(pipelineItems) ? pipelineItems : []

  const hotlist: HotLead[] = items.slice(0, 20).map((it: any) => ({
    id: it.id,
    source: 'pipeline',
    lead_name: it.lead_name,
    lead_website: it.lead_website,
    lead_city: it.lead_city,
    lead_category: it.lead_category,
    lead_score: Number(it.lead_score) || 0,
    stage: it.stage,
    deal_value: Number(it.deal_value) || 0,
    updated_at: it.updated_at,
  }))

  // Stats
  const won = items.filter((i: any) => i.stage === 'vinto')
  const lost = items.filter((i: any) => i.stage === 'perso')
  const totalContacted = items.filter((i: any) => !['nuovo'].includes(i.stage)).length
  const conversionRate =
    won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0

  // Pattern: quale categoria/città converte di più
  type Acc = { total: number; won: number; revenue: number }
  const catAcc = new Map<string, Acc>()
  const cityAcc = new Map<string, Acc>()
  for (const i of items as any[]) {
    const cat = (typeof i.lead_category === 'string' && i.lead_category.trim()) || 'Senza categoria'
    const city = (typeof i.lead_city === 'string' && i.lead_city.trim()) || 'Senza città'
    const c = catAcc.get(cat) || { total: 0, won: 0, revenue: 0 }
    c.total++
    if (i.stage === 'vinto') {
      c.won++
      c.revenue += Number(i.deal_value) || 0
    }
    catAcc.set(cat, c)
    const ci = cityAcc.get(city) || { total: 0, won: 0, revenue: 0 }
    ci.total++
    if (i.stage === 'vinto') {
      ci.won++
      ci.revenue += Number(i.deal_value) || 0
    }
    cityAcc.set(city, ci)
  }
  const bestCat = Array.from(catAcc.entries())
    .map(([name, d]) => ({ name, ...d, winRate: d.total > 0 ? Math.round((d.won / d.total) * 100) : 0 }))
    .sort((a, b) => b.winRate - a.winRate || b.revenue - a.revenue)[0] || null
  const bestCity = Array.from(cityAcc.entries())
    .map(([name, d]) => ({ name, ...d, winRate: d.total > 0 ? Math.round((d.won / d.total) * 100) : 0 }))
    .sort((a, b) => b.winRate - a.winRate || b.revenue - a.revenue)[0] || null

  // Modello scoring personale
  let model: any = null
  try {
    const { data } = await supabase
      .from('user_scoring_models')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
    model = data || null
  } catch {
    /* silent */
  }

  return NextResponse.json({
    hotlist,
    stats: {
      total: items.length,
      contacted: totalContacted,
      won: won.length,
      lost: lost.length,
      conversionRate,
    },
    patterns: {
      bestCategory: bestCat,
      bestCity: bestCity,
    },
    model,
  })
}
