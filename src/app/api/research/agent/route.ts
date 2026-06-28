import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { runResearchAgent } from '@/lib/research/agent'

/**
 * POST /api/research/agent
 * On-demand deep research per lead (Fase 6 — HITL, no auto-outreach).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'JSON non valido' }, { status: 400 })
  }

  const name = String(body.name || body.azienda || '').trim()
  if (!name) return NextResponse.json({ error: 'name obbligatorio' }, { status: 400 })

  const result = await runResearchAgent(
    {
      name,
      website: typeof body.website === 'string' ? body.website : undefined,
      city: typeof body.city === 'string' ? body.city : undefined,
      sector: typeof body.sector === 'string' ? body.sector : undefined,
      piva: typeof body.piva === 'string' ? body.piva : undefined,
    },
    {
      query: typeof body.query === 'string' ? body.query : undefined,
      skipCache: body.skip_cache === true,
    },
  )

  return NextResponse.json({ ok: true, ...result })
}
