/**
 * GET /api/universe/entities/[id]/pii
 * Returns audited PII contacts for an entity (PEC, mobile, and fresh phone/email).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import {
  getEntityPii,
  logPiiAccess,
  checkPiiAccessAllowed,
  DEFAULT_PII_POLICY,
} from '@/lib/universe/pii'
import { universeClientError } from '@/lib/universe/errors'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'entity_id richiesto' }, { status: 400 })
    }

    const sb = await createClient()
    const { allowed, remaining, count } = await checkPiiAccessAllowed(sb, auth.userId, DEFAULT_PII_POLICY)
    if (!allowed) {
      return NextResponse.json(
        { error: `Limite di ${DEFAULT_PII_POLICY.max_daily_accesses} accessi PII/giorno raggiunto` },
        { status: 429 },
      )
    }

    const pii = await getEntityPii(sb, id)
    await logPiiAccess(sb, {
      user_id: auth.userId,
      entity_id: id,
      access_type: 'all',
      reason: 'Explicit contact reveal from dashboard',
      source: 'dashboard',
    })

    return NextResponse.json({ ok: true, pii, remaining, count })
  } catch (e: unknown) {
    const { message, status } = universeClientError(e, 'pii')
    return NextResponse.json({ error: message }, { status })
  }
}
