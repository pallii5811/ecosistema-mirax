import { NextRequest } from 'next/server'
import { apiError, apiResponse, authenticateApiKey } from '@/lib/api-auth'
import { createServiceRoleClient } from '@/utils/supabase/server'
import { classifyReplyWithAI } from '@/lib/outreach-reply-classifier'
import { buildReplyClassificationAuditRecord } from '@/lib/ai-act-audit'

/** POST /api/v1/classify-reply — Jarvis / automazioni: classifica risposta inbound */
export async function POST(req: NextRequest) {
  const { userId, error } = await authenticateApiKey(req)
  if (error || !userId) return apiError(error || 'Unauthorized', 401)

  const body = (await req.json().catch(() => null)) as {
    replySnippet?: string
    leadName?: string
    leadWebsite?: string
  } | null

  const snippet = typeof body?.replySnippet === 'string' ? body.replySnippet.trim() : ''
  if (snippet.length < 5) return apiError('replySnippet richiesto (min 5 caratteri)')

  const classification = await classifyReplyWithAI(snippet, {
    leadName: body?.leadName,
    leadWebsite: body?.leadWebsite,
  })

  const svc = createServiceRoleClient()
  const row = {
    user_id: userId,
    reply_snippet: snippet.slice(0, 4000),
    lead_name: body?.leadName?.trim() || null,
    lead_website: body?.leadWebsite?.trim() || null,
    intent: classification.intent,
    suggested_action: classification.suggested_action,
    follow_up_at: classification.follow_up_at,
    confidence: classification.confidence,
    model: classification.model,
    rationale: classification.rationale,
  }

  const { data: inserted, error: insErr } = await svc
    .from('inbound_reply_classifications')
    .insert(row)
    .select('id')
    .maybeSingle()

  if (!insErr) {
    try {
      await svc.from('ai_audit_trail').insert(
        buildReplyClassificationAuditRecord({
          userId,
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
  }

  return apiResponse({
    id: inserted?.id ?? null,
    classification,
    persisted: Boolean(inserted?.id),
    human_in_the_loop: true,
    automated_send: false,
  })
}
