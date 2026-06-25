import { NextRequest, NextResponse } from 'next/server'
import { analyzeAdsPresence } from '@/lib/ads-analysis'
import { createClient } from '@/utils/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const name = searchParams.get('name') || ''
  const website = searchParams.get('website') || ''
  const city = searchParams.get('city') || ''
  const category = searchParams.get('category') || ''
  const metaPixelOnSite = searchParams.get('metaPixel') === '1'
  const googleAdsTagOnSite = searchParams.get('googleAdsTag') === '1'

  const analysis = await analyzeAdsPresence(name, website, city, category, {
    metaPixelOnSite,
    googleAdsTagOnSite,
  })
  return NextResponse.json(analysis)
}
