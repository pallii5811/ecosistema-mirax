import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import { hydrateLeadsFromUniverse, isUniverseReadEnabled } from '@/lib/universe/hydrate-leads'
import { fetchMergedLeadsForSearch } from '@/lib/search-leads/read-leads'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const jobId = searchParams.get('job_id')

    if (!jobId) {
      return NextResponse.json({ status: 'error', results: [] })
    }

    const supabase = await createClient()

    const { data, error } = await supabase
      .from('searches')
      .select('status, results, intent, updated_at')
      .eq('id', jobId)
      .single()

    if (error || !data) {
      return NextResponse.json({ status: 'not_found', results: [] })
    }

    let results = await fetchMergedLeadsForSearch(supabase, jobId, {
      legacyResults: data.results,
    })

    let universe_hydrated = 0
    if (isUniverseReadEnabled() && results.length > 0) {
      try {
        const svc = createServiceRoleClient()
        const hydrated = await hydrateLeadsFromUniverse(svc, results, { max: 100 })
        results = hydrated.leads
        universe_hydrated = hydrated.hydrated_count
      } catch (e) {
        console.warn('[check-scrape-job] universe hydrate skipped:', e)
      }
    }

    const intent = data.intent as Record<string, unknown> | null
    const user_message =
      intent && typeof intent.completion_user_message === 'string'
        ? intent.completion_user_message
        : null

    return NextResponse.json({
      status: data.status,
      results,
      universe_hydrated,
      user_message,
      updated_at: data.updated_at ?? null,
    })
  } catch (error) {
    console.error('check-scrape-job error:', error)
    return NextResponse.json({ status: 'error', results: [] })
  }
}
