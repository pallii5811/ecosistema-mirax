import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { coerceSignalIntent } from '@/lib/signal-intent/parse-heuristic'
import { enrichLeadsBatchWithClaude } from '@/lib/claude-intent-enrich'
import type { SignalIntentSpec } from '@/lib/signal-intent/types'

/**
 * POST /api/claude-enrich-batch
 * Maps + audit già fatti → Claude arricchisce con il dato richiesto dall'utente.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY non configurata' }, { status: 503 })
    }

    const body = await req.json().catch(() => ({}))
    const userQuery = typeof body?.user_query === 'string' ? body.user_query.trim() : ''
    const rawLeads = Array.isArray(body?.leads)
      ? (body.leads as unknown[]).filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x))
      : []
    const maxLeads = Math.min(25, Math.max(1, Number(body?.max_leads) || 15))

    let intent: SignalIntentSpec | null = null
    if (body?.signal_intent && typeof body.signal_intent === 'object') {
      intent = coerceSignalIntent(body.signal_intent)
    }

    if (!userQuery) {
      return NextResponse.json({ error: 'user_query richiesto' }, { status: 400 })
    }
    if (!rawLeads.length) {
      return NextResponse.json({ error: 'leads richiesto' }, { status: 400 })
    }
    if (!intent?.required_signals?.length && !intent?.reasoning) {
      return NextResponse.json({ error: 'signal_intent richiesto' }, { status: 400 })
    }

    const pending = rawLeads.filter((l) => !l.claude_enrichment).slice(0, maxLeads)
    const enriched = await enrichLeadsBatchWithClaude(pending, userQuery, intent, maxLeads)

    const matches = enriched.filter((l) => {
      const c = l.claude_enrichment
      return c && typeof c === 'object' && (c as Record<string, unknown>).matches_request === true
    }).length

    return NextResponse.json({
      ok: true,
      processed: enriched.length,
      matches,
      leads: enriched,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Errore Claude enrich'
    console.error('[claude-enrich-batch]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
