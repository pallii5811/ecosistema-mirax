import { NextRequest, NextResponse } from 'next/server'
import { analyzeTrends } from '@/lib/trends-analysis'
import { createClient } from '@/utils/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category') || ''
  const city = searchParams.get('city') || ''

  const analysis = await analyzeTrends(category, city)
  return NextResponse.json(analysis)
}
