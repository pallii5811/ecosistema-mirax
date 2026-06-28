import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { requestIncrementalScrape, formatCanonicalLabel } from '@/lib/search-cache'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { category, city, num_results, max_results } = body

    if (!category || !city) {
      return NextResponse.json({ error: 'category and city required' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const cap = Number(max_results ?? num_results ?? 0) || 10

    const result = await requestIncrementalScrape(supabase, {
      category: formatCanonicalLabel(String(category)),
      location: formatCanonicalLabel(String(city)),
      maxLeads: cap,
      userId: user?.id,
    })

    console.log('[trigger-scrape]', result)
    return NextResponse.json({
      job_id: result.jobId,
      reused: result.reused,
      existing_raw: result.existingRaw,
      existing_with_contact: result.existingWithContact,
    })

  } catch (error) {
    console.error('trigger-scrape error:', error)
    return NextResponse.json(
      { error: 'Service unavailable' },
      { status: 500 }
    )
  }
}
