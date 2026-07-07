import { NextResponse } from 'next/server'
import { unifiedSearchAction } from '@/app/dashboard/unified-search-action'

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: string; maxLeads?: number }
    const query = String(body.query || '').trim()
    if (!query) {
      return NextResponse.json({ error: 'QUERY_EMPTY' }, { status: 400 })
    }
    const result = await unifiedSearchAction(query, { maxLeads: body.maxLeads })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/unified-search]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
