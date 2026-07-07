/**
 * POST /api/universe/feedback
 * Record explicit or implicit user feedback on a lead/search result.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import { recordFeedback, type FeedbackAction } from '@/lib/universe/feedback'
import { universeClientError } from '@/lib/universe/errors'

const VALID_ACTIONS: FeedbackAction[] = [
  'save',
  'contact',
  'export',
  'ignore',
  'dismiss',
  'thumb_up',
  'thumb_down',
  'closed_won',
  'closed_lost',
]

export async function POST(req: NextRequest) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const action = body?.action as FeedbackAction | undefined

    if (!action || !VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'Azione feedback non valida' }, { status: 400 })
    }

    const entityId = typeof body?.entity_id === 'string' ? body.entity_id : null
    const userQuery = typeof body?.user_query === 'string' ? body.user_query : null

    const sb = await createClient()
    const record = await recordFeedback(sb, {
      user_id: auth.userId,
      entity_id: entityId,
      action,
      user_query: userQuery || null,
      search_intent: body?.search_intent ?? {},
      outcome: typeof body?.outcome === 'string' ? body.outcome : null,
      feedback_value: typeof body?.feedback_value === 'number' ? body.feedback_value : undefined,
      metadata: body?.metadata ?? {},
    })

    return NextResponse.json({ ok: true, feedback: record })
  } catch (e: unknown) {
    const { message, status } = universeClientError(e, 'feedback')
    return NextResponse.json({ error: message }, { status })
  }
}
