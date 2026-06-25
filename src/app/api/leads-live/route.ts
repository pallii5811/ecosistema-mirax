import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category') || ''
    const city = searchParams.get('city') || ''

    if (!city) {
      return NextResponse.json({ leads: [] })
    }

    const supabase = await createClient()

    let query = supabase
      .from('leads')
      .select('*')
      .ilike('city', `%${city}%`)
      .order('created_at', { ascending: false })
      .limit(200)

    if (category) {
      query = query.ilike('category', `%${category}%`)
    }

    const { data, error } = await query

    if (error) throw error

    return NextResponse.json({ leads: data || [] })

  } catch (error) {
    console.error('leads-live error:', error)
    return NextResponse.json({ leads: [] })
  }
}
