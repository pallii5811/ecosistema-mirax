import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import { emitMiraxEvent } from '@/lib/events/emit'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as any
  const searchId = body?.searchId
  const leadIndex = body?.leadIndex
  const leadName = body?.leadName
  const leadWebsite = body?.leadWebsite
  const leadCity = body?.leadCity
  const leadCategory = body?.leadCategory

  if (!searchId || typeof leadIndex !== 'number' || !leadName) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  try {
    const { data: existing, error: existingError } = await supabase
      .from('lead_monitors')
      .select('id')
      .eq('user_id', user.id)
      .eq('search_id', searchId)
      .eq('lead_index', leadIndex)
      .maybeSingle()

    if (existingError) {
      if (/relation .* does not exist|lead_monitors/i.test(existingError.message)) {
        return NextResponse.json(
          { error: 'Funzionalità monitor non ancora disponibile. Esegui migration EDAT su Supabase dev.' },
          { status: 503 },
        )
      }
      return NextResponse.json({ error: existingError.message }, { status: 500 })
    }

    if (existing?.id) {
      return NextResponse.json({ message: 'Già monitorato', id: existing.id })
    }

    const { data, error } = await supabase
      .from('lead_monitors')
      .insert({
        user_id: user.id,
        search_id: searchId,
        lead_index: leadIndex,
        lead_name: leadName,
        lead_website: leadWebsite,
        lead_city: leadCity,
        lead_category: leadCategory,
        last_checked_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: 'Impossibile salvare il monitor' }, { status: 500 })
    }

    try {
      const service = createServiceRoleClient()
      await emitMiraxEvent(service, {
        userId: user.id,
        eventType: 'lead.monitored',
        payload: {
          search_id: searchId,
          lead_index: leadIndex,
          lead_name: leadName,
          website: leadWebsite,
        },
      })
    } catch {
      /* non-blocking */
    }

    return NextResponse.json({ success: true, monitor: data })
  } catch (e) {
    console.error('[monitor-lead] unexpected error:', e)
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 })
  }
}
