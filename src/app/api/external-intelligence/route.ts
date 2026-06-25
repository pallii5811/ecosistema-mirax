import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { analyzeExternalIntelligence } from '@/lib/external-trigger-intelligence'

function pickString(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { lead?: Record<string, unknown> } | null
  const lead = body?.lead && typeof body.lead === 'object' ? body.lead : null
  if (!lead) return NextResponse.json({ error: 'Lead mancante' }, { status: 400 })

  const companyName = pickString(lead, ['nome', 'azienda', 'business_name', 'company', 'name'])
  const website = pickString(lead, ['sito', 'website', 'url'])
  const city = pickString(lead, ['citta', 'city', 'location'])
  if (!companyName) return NextResponse.json({ error: 'Nome azienda mancante' }, { status: 400 })

  try {
    const intelligence = await analyzeExternalIntelligence({ companyName, website, city })
    return NextResponse.json({ ok: true, intelligence })
  } catch (e: unknown) {
    console.error('[external-intelligence] error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Errore intelligence esterna' }, { status: 500 })
  }
}
