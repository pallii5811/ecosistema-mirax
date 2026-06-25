import { createClient } from '@/utils/supabase/server'
import { sendToWebhook } from '@/lib/webhook'

type SaveLeadBody = {
  listId?: string
  lead: {
    name?: string
    website?: string
    email?: string
    phone?: string
    city?: string
    category?: string
    score?: number | null
    raw?: unknown
  }
}

export async function POST(req: Request) {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as SaveLeadBody | null

  if (!body?.lead) {
    return Response.json({ error: 'Missing lead' }, { status: 400 })
  }

  const listId = body.listId?.trim()

  if (!listId) {
    return Response.json({ error: 'Missing listId' }, { status: 400 })
  }

  // Ensure list belongs to user
  const { data: listRow, error: listError } = await supabase
    .from('lists')
    .select('id')
    .eq('id', listId)
    .eq('user_id', user.id)
    .single()

  if (listError || !listRow) {
    return Response.json({ error: 'List not found' }, { status: 404 })
  }

  const leadInsert = {
    user_id: user.id,
    name: body.lead.name ?? null,
    website: body.lead.website ?? null,
    email: body.lead.email ?? null,
    phone: body.lead.phone ?? null,
    city: body.lead.city ?? null,
    category: body.lead.category ?? null,
    score: typeof body.lead.score === 'number' ? body.lead.score : null,
    raw: body.lead.raw ?? null,
  }

  const { data: leadRow, error: leadError } = await supabase
    .from('leads')
    .insert(leadInsert)
    .select('id, created_at')
    .single()

  if (leadError || !leadRow) {
    return Response.json({ error: leadError?.message ?? 'Failed to save lead' }, { status: 500 })
  }

  const { error: linkError } = await supabase.from('list_leads').insert({ list_id: listId, lead_id: leadRow.id })

  if (linkError) {
    return Response.json({ error: linkError.message }, { status: 500 })
  }

  const { data: integRow } = await supabase
    .from('user_integrations')
    .select('webhook_url')
    .eq('user_id', user.id)
    .maybeSingle()

  const webhookUrl = integRow?.webhook_url

  let webhook = { sent: false as boolean, ok: false as boolean, status: 0 as number }

  if (webhookUrl) {
    try {
      const payload = {
        event: 'lead_saved',
        listId,
        leadId: leadRow.id,
        createdAt: leadRow.created_at,
        lead: body.lead,
      }

      const res = await sendToWebhook({ webhookUrl, payload })
      webhook = { sent: true, ok: res.ok, status: res.status }
    } catch {
      webhook = { sent: true, ok: false, status: 0 }
    }
  }

  return Response.json({ ok: true, leadId: leadRow.id, webhook })
}
