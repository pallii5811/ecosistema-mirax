/**
 * GET /api/universe/stats — metriche grafo per UI Agentic Search.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import { isUniverseEnabled } from '@/lib/universe/sidecar'
import { isUniverseReadEnabled } from '@/lib/universe/hydrate-leads'
import { universeClientError } from '@/lib/universe/errors'

export async function GET() {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const sb = await createClient()
    const { count: companies, error: e1 } = await sb
      .from('universe_entities')
      .select('*', { count: 'exact', head: true })
      .eq('entity_type', 'company')
      .is('merged_into_id', null)

    const { count: observations, error: e2 } = await sb
      .from('universe_observations')
      .select('*', { count: 'exact', head: true })

    if (e1 || e2) {
      console.error('[universe/stats] count error', e1, e2)
      return NextResponse.json({ error: 'Errore recupero statistiche' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      companies: companies ?? 0,
      observations: observations ?? 0,
      universe_enabled: isUniverseEnabled(),
      universe_read_enabled: isUniverseReadEnabled(),
    })
  } catch (e: unknown) {
    const { message, status } = universeClientError(e, 'stats')
    return NextResponse.json({ error: message }, { status })
  }
}
