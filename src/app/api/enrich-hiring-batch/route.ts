import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const BACKEND_URL = (process.env.BACKEND_URL || 'http://116.203.137.39:8002').replace(/\/$/, '')

function leadKey(lead: Record<string, unknown>): string {
  const site = String(lead.sito || lead.website || lead.url || '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '')
  if (site) return site
  const name = String(lead.azienda || lead.nome || lead.name || '')
    .trim()
    .toLowerCase()
  return name ? `name:${name}` : ''
}

/** POST — Indeed/external enrichment batch via worker staging */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const leads = Array.isArray(body?.leads)
      ? (body.leads as unknown[]).filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x))
      : []
    const location = typeof body?.location === 'string' ? body.location.trim() : 'Milano'
    const maxLeads = Math.min(40, Math.max(1, Number(body?.max_leads) || 25))

    if (!leads.length) {
      return NextResponse.json({ error: 'leads richiesto' }, { status: 400 })
    }

    const res = await fetch(`${BACKEND_URL}/enrich-hiring-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads, location, max_leads: maxLeads }),
      signal: AbortSignal.timeout(120_000),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return NextResponse.json(
        { error: typeof data?.detail === 'string' ? data.detail : 'Worker enrichment failed' },
        { status: res.status >= 400 ? res.status : 502 },
      )
    }

    const enriched = Array.isArray(data?.leads) ? data.leads : []
    return NextResponse.json({
      ok: true,
      processed: Number(data?.processed) || enriched.length,
      with_hiring: Number(data?.enriched) || 0,
      leads: enriched,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Errore enrichment hiring'
    console.error('[enrich-hiring-batch]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export { leadKey }
