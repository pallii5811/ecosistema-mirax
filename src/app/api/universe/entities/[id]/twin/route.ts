/**
 * GET /api/universe/entities/:id/twin
 * Fase 7 — Digital Twin snapshot (grafo + contesto utente).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { buildDigitalTwin } from '@/lib/universe/digital-twin'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import { universeClientError } from '@/lib/universe/errors'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const twin = await buildDigitalTwin(supabase, id, { userId: user?.id })

    if (!twin) {
      return NextResponse.json({ error: 'Entità non trovata' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, twin })
  } catch (e: unknown) {
    const { message, status } = universeClientError(e, 'entities/:id/twin')
    return NextResponse.json({ error: message }, { status })
  }
}
