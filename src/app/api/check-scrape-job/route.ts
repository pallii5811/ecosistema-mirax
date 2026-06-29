import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import { hydrateLeadsFromUniverse, isUniverseReadEnabled } from '@/lib/universe/hydrate-leads'

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
      .select('status, results')
      .eq('id', jobId)
      .single()

    if (error || !data) {
      return NextResponse.json({ status: 'not_found', results: [] })
    }

    // Handle results in various formats: array, single object, or JSON string
    let results: any[] = []
    if (Array.isArray(data.results)) {
      results = data.results
    } else if (typeof data.results === 'string') {
      try {
        const parsed = JSON.parse(data.results)
        results = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : []
      } catch { results = [] }
    } else if (data.results && typeof data.results === 'object') {
      results = [data.results]
    }

    let universe_hydrated = 0
    if (isUniverseReadEnabled() && results.length > 0) {
      try {
        const svc = createServiceRoleClient()
        const hydrated = await hydrateLeadsFromUniverse(svc, results as Record<string, unknown>[], { max: 100 })
        results = hydrated.leads
        universe_hydrated = hydrated.hydrated_count
      } catch (e) {
        console.warn('[check-scrape-job] universe hydrate skipped:', e)
      }
    }

    return NextResponse.json({
      status: data.status,
      results,
      universe_hydrated,
    })

  } catch (error) {
    console.error('check-scrape-job error:', error)
    return NextResponse.json({ status: 'error', results: [] })
  }
}
