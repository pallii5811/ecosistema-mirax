import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { filterMarketPoints, leadToMarketPoint } from '@/lib/competitive/market-metrics'

/**
 * GET /api/competitors/market-map?category=&city=&minIntent=
 * Punti scatter: competitor tracciati + lead da ricerche recenti.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ points: [], error: 'Unauthorized' }, { status: 401 })

  const category = req.nextUrl.searchParams.get('category') || undefined
  const city = req.nextUrl.searchParams.get('city') || undefined
  const minIntent = Number(req.nextUrl.searchParams.get('minIntent') || '0') || 0

  const points = []

  const { data: competitors, error: compErr } = await supabase
    .from('competitors')
    .select('*')
    .eq('user_id', user.id)
    .limit(80)

  if (!compErr && competitors) {
    for (const c of competitors) {
      const leadLike: Record<string, unknown> = {
        name: c.name,
        website: c.website,
        city: c.city,
        category: c.category,
        business_signals: c.signal_snapshot,
        score: c.intent_score,
        fatturato: c.estimated_revenue,
      }
      const pt = leadToMarketPoint(leadLike, c.id, 'competitor')
      pt.digitalMaturity = c.digital_maturity ?? pt.digitalMaturity
      pt.growthRate = c.growth_rate ?? pt.growthRate
      pt.intentScore = c.intent_score ?? pt.intentScore
      if (c.estimated_revenue) pt.estimatedRevenue = Number(c.estimated_revenue)
      points.push(pt)
    }
  }

  const { data: searches } = await supabase
    .from('searches')
    .select('id, results')
    .eq('user_id', user.id)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(8)

  for (const row of searches ?? []) {
    const results = (row as { results?: unknown }).results
    if (!Array.isArray(results)) continue
    for (let i = 0; i < Math.min(results.length, 25); i++) {
      const r = results[i]
      if (!r || typeof r !== 'object') continue
      const lead = r as Record<string, unknown>
      const id = `${row.id}:${i}`
      points.push(leadToMarketPoint(lead, id, 'lead'))
    }
  }

  const filtered = filterMarketPoints(points, { category, city, minIntent })

  const categories = [...new Set(points.map((p) => p.category).filter(Boolean))] as string[]
  const cities = [...new Set(points.map((p) => p.city).filter(Boolean))] as string[]

  return NextResponse.json({
    points: filtered,
    meta: {
      total: filtered.length,
      competitors: filtered.filter((p) => p.kind === 'competitor').length,
      leads: filtered.filter((p) => p.kind === 'lead').length,
      categories: categories.sort(),
      cities: cities.sort(),
    },
    tableMissing: compErr ? /does not exist/i.test(compErr.message) : false,
  })
}
