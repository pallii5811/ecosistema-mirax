import { createClient } from '@/utils/supabase/server'

export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { data, error } = await supabase
      .from('user_integrations')
      .select('webhook_url')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) {
      console.log('[webhook] query error (table may not exist):', error.message)
      return Response.json({ webhookUrl: '' })
    }

    return Response.json({ webhookUrl: data?.webhook_url ?? '' })
  } catch {
    return Response.json({ webhookUrl: '' })
  }
}

export async function PUT(req: Request) {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as { webhookUrl?: string } | null
  const webhookUrl = body?.webhookUrl?.trim() ?? ''

  if (webhookUrl && !/^https?:\/\//i.test(webhookUrl)) {
    return Response.json({ error: 'Invalid webhook URL' }, { status: 400 })
  }

  const { error } = await supabase
    .from('user_integrations')
    .upsert(
      {
        user_id: user.id,
        webhook_url: webhookUrl || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
