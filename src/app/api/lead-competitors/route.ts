import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://116.203.137.39:8001'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = await req.json()
  const { lead } = body

  console.log('=== LEAD-COMPETITORS DEBUG ===')
  console.log('local_competitors:', JSON.stringify(lead?.local_competitors))
  console.log('categoria:', lead?.categoria)
  console.log('category:', lead?.category)
  console.log('citta:', lead?.citta)
  console.log('city:', lead?.city)
  console.log('==============================')

  const category = lead?.categoria || lead?.category || ''
  const city = lead?.citta || lead?.city || ''

  if (lead?.local_competitors && lead.local_competitors.length > 0) {
    console.log('RETURNING FROM DB:', lead.local_competitors.length)
    return NextResponse.json({
      competitors: lead.local_competitors,
      source: 'db',
    })
  }

  console.log('CALLING BACKEND with category:', category, 'city:', city)

  if (!category || !city) {
    console.log('MISSING DATA - category or city empty')
    return NextResponse.json({ competitors: [], source: 'missing_data' })
  }

  try {
    const res = await fetch(`${BACKEND_URL}/scrape-competitors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, city }),
      signal: AbortSignal.timeout(60000),
    })
    const data = await res.json()
    console.log('BACKEND RESPONSE:', JSON.stringify(data))
    return NextResponse.json({ ...data, source: 'scraping' })
  } catch (e) {
    console.log('BACKEND ERROR:', String(e))
    return NextResponse.json({ competitors: [], source: 'error' })
  }
}
