import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { enrichLeadFree } from '@/lib/free-enrichment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const website: string =
      typeof body?.website === 'string'
        ? body.website
        : typeof body?.url === 'string'
          ? body.url
          : typeof body?.lead?.sito === 'string'
            ? body.lead.sito
            : typeof body?.lead?.website === 'string'
              ? body.lead.website
              : ''

    if (!website || !website.trim()) {
      return NextResponse.json({
        ok: false,
        error: 'Sito web mancante',
        intel: null,
      })
    }

    const intel = await enrichLeadFree(website)

    return NextResponse.json({
      ok: true,
      intel,
    })
  } catch (e: any) {
    // Mai 500 sul client: l'audit non deve mai rompere la UI.
    return NextResponse.json({
      ok: false,
      error: e?.message || 'Errore audit',
      intel: null,
    })
  }
}
