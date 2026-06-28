import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import { buildReplyClassificationAuditRecord } from '@/lib/ai-act-audit'
import {
  classifyReplyWithAI,
  type ReplyIntent,
} from '@/lib/outreach-reply-classifier'

function isMissingTable(message: string | undefined): boolean {
  if (!message) return false
  return /inbound_reply_classifications/i.test(message) && /(does not exist|relation|schema cache|could not find)/i.test(message)
}

const DECISIONS = new Set(['accepted', 'modified', 'ignored'])

/** GET — ultime classificazioni */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 20))

  const { data, error } = await supabase
    .from('inbound_reply_classifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error && isMissingTable(error.message)) {
    return NextResponse.json({ items: [], needsMigration: true })
  }
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ items: data ?? [] })
}

/** POST — classifica risposta (suggest-only) o aggiorna decisione utente */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as {
    action?: 'classify' | 'decide'
    classificationId?: string
    userDecision?: string
    modifiedAction?: string
    replySnippet?: string
    outreachLogId?: string
    leadName?: string
    leadWebsite?: string
    originalSubject?: string
  } | null

  const action = body?.action === 'decide' ? 'decide' : 'classify'

  if (action === 'decide') {
    const id = typeof body?.classificationId === 'string' ? body.classificationId.trim() : ''
    const decision = typeof body?.userDecision === 'string' ? body.userDecision.trim() : ''
    if (!id || !DECISIONS.has(decision)) {
      return NextResponse.json({ error: 'Parametri decisione non validi' }, { status: 400 })
    }

    const svc = createServiceRoleClient()
    const patch: Record<string, unknown> = { user_decision: decision }
    if (decision === 'modified' && typeof body?.modifiedAction === 'string' && body.modifiedAction.trim()) {
      patch.suggested_action = body.modifiedAction.trim().slice(0, 400)
    }

    const { data, error } = await svc
      .from('inbound_reply_classifications')
      .update(patch)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('*')
      .maybeSingle()

    if (error && isMissingTable(error.message)) {
      return NextResponse.json({ ok: false, needsMigration: true }, { status: 503 })
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, classification: data })
  }

  const snippet = typeof body?.replySnippet === 'string' ? body.replySnippet.trim() : ''
  if (snippet.length < 5) {
    return NextResponse.json({ error: 'Incolla almeno 5 caratteri della risposta ricevuta' }, { status: 400 })
  }

  const classification = await classifyReplyWithAI(snippet, {
    leadName: body?.leadName,
    leadWebsite: body?.leadWebsite,
    originalSubject: body?.originalSubject,
  })

  const row = {
    user_id: user.id,
    outreach_log_id: body?.outreachLogId || null,
    lead_name: body?.leadName?.trim() || null,
    lead_website: body?.leadWebsite?.trim() || null,
    reply_snippet: snippet.slice(0, 4000),
    intent: classification.intent as ReplyIntent,
    suggested_action: classification.suggested_action,
    follow_up_at: classification.follow_up_at,
    confidence: classification.confidence,
    model: classification.model,
    rationale: classification.rationale,
  }

  const svc = createServiceRoleClient()
  const { data: inserted, error: insertError } = await svc
    .from('inbound_reply_classifications')
    .insert(row)
    .select('*')
    .maybeSingle()

  if (insertError && isMissingTable(insertError.message)) {
    return NextResponse.json({
      classification,
      persisted: false,
      needsMigration: true,
      id: null,
    })
  }
  if (insertError) {
    return NextResponse.json({ error: insertError.message, classification }, { status: 500 })
  }

  try {
    await svc.from('ai_audit_trail').insert(
      buildReplyClassificationAuditRecord({
        userId: user.id,
        intent: classification.intent,
        replySnippet: snippet,
        suggestedAction: classification.suggested_action,
        model: classification.model,
        leadName: body?.leadName,
      }),
    )
  } catch {
    /* best-effort */
  }

  return NextResponse.json({
    id: inserted?.id ?? null,
    classification,
    persisted: Boolean(inserted?.id),
  })
}
