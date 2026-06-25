import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://116.203.137.39:8002'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

    const { url } = await req.json()
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL mancante' }, { status: 400 })
    }

    // Normalize URL
    let normalizedUrl = url.trim()
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`
    }

    const res = await fetch(`${BACKEND_URL}/audit-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: normalizedUrl }),
      signal: AbortSignal.timeout(120000), // 2 min timeout
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json(
        { error: `Backend error: ${res.status} ${text}` },
        { status: 502 }
      )
    }

    const data = await res.json()
    return NextResponse.json({ success: true, lead: data })
  } catch (e: any) {
    console.error('[analyze-site] error:', e)
    return NextResponse.json(
      { error: e?.message || 'Errore durante l\'analisi del sito' },
      { status: 500 }
    )
  }
}
