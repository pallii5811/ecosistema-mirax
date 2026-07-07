/**
 * POST/DELETE /api/universe/entities/:id/context
 * Fase 7 — contesto utente privato (saved, pipeline, note, …).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import { universeClientError } from '@/lib/universe/errors'
import {
  deleteUserContext,
  listUserContextForEntity,
  upsertUserContext,
  type UserContextType,
} from '@/lib/universe/user-context-repository'

const VALID_TYPES = new Set<UserContextType>([
  'saved',
  'contacted',
  'pipeline',
  'ignored',
  'note',
  'hidden',
])

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { id } = await params
  const contexts = await listUserContextForEntity(supabase, user.id, id)
  return NextResponse.json({ ok: true, contexts })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const context_type = String(body?.context_type ?? '').trim() as UserContextType

    if (!VALID_TYPES.has(context_type)) {
      return NextResponse.json({ error: 'context_type non valido' }, { status: 400 })
    }

    const metadata =
      body?.metadata && typeof body.metadata === 'object'
        ? (body.metadata as Record<string, unknown>)
        : {}

    const ctx = await upsertUserContext(supabase, {
      user_id: user.id,
      entity_id: id,
      context_type,
      metadata,
    })

    return NextResponse.json({ ok: true, context: ctx })
  } catch (e: unknown) {
    const { message, status } = universeClientError(e, 'entities/:id/context')
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  try {
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const context_type = String(searchParams.get('context_type') ?? '').trim() as UserContextType

    if (!VALID_TYPES.has(context_type)) {
      return NextResponse.json({ error: 'context_type richiesto' }, { status: 400 })
    }

    await deleteUserContext(supabase, user.id, id, context_type)
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const { message, status } = universeClientError(e, 'entities/:id/context')
    return NextResponse.json({ error: message }, { status })
  }
}
