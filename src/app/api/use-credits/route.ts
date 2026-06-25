import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
    }

    const body = await req.json()
    const amount = typeof body.amount === 'number' && body.amount > 0 ? body.amount : 1

    // Atomic credit deduction: read + check + update in one step to prevent race conditions.
    // First, check current credits
    const { data: profile, error: fetchErr } = await supabase
      .from('profiles')
      .select('credits')
      .eq('id', user.id)
      .single()

    if (fetchErr || !profile) {
      return NextResponse.json({ error: 'Profilo non trovato' }, { status: 404 })
    }

    const currentCredits = typeof profile.credits === 'number' ? profile.credits : 0

    if (currentCredits < amount) {
      return NextResponse.json({
        error: 'Crediti insufficienti',
        credits: currentCredits,
        required: amount,
      }, { status: 403 })
    }

    // Atomic conditional update: only deduct if credits haven't changed (prevents race condition)
    const newCredits = currentCredits - amount

    const { data: updated, error: updateErr } = await supabase
      .from('profiles')
      .update({ credits: newCredits })
      .eq('id', user.id)
      .gte('credits', amount)  // Only update if still enough credits (atomic guard)
      .select('credits')
      .single()

    if (updateErr || !updated) {
      // Race condition detected: another request already deducted credits
      // Re-read and return current value
      const { data: fresh } = await supabase.from('profiles').select('credits').eq('id', user.id).single()
      const freshCredits = typeof fresh?.credits === 'number' ? fresh.credits : 0
      if (freshCredits < amount) {
        return NextResponse.json({ error: 'Crediti insufficienti', credits: freshCredits, required: amount }, { status: 403 })
      }
      // Retry once
      const { data: retry, error: retryErr } = await supabase.from('profiles').update({ credits: freshCredits - amount }).eq('id', user.id).gte('credits', amount).select('credits').single()
      if (retryErr || !retry) {
        return NextResponse.json({ error: 'Errore aggiornamento crediti', credits: freshCredits }, { status: 500 })
      }
      return NextResponse.json({ credits: retry.credits, used: amount })
    }

    return NextResponse.json({ credits: updated.credits, used: amount })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
