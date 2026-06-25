import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * Admin endpoint to add credits to the current user.
 * Usage: POST /api/admin/add-credits { "amount": 500 }
 * Protected: only works for authenticated users.
 * TODO: Add admin role check before production.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
    }

    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    if (adminEmails.length > 0 && !adminEmails.includes((user.email || '').toLowerCase())) {
      return NextResponse.json({ error: 'Accesso negato' }, { status: 403 })
    }

    const body = await req.json()
    const amount = typeof body.amount === 'number' && body.amount > 0 ? body.amount : 100

    const { data: profile } = await supabase
      .from('profiles')
      .select('credits')
      .eq('id', user.id)
      .single()

    const currentCredits = typeof profile?.credits === 'number' ? profile.credits : 0
    const newCredits = currentCredits + amount

    const { error } = await supabase
      .from('profiles')
      .update({ credits: newCredits })
      .eq('id', user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ 
      ok: true, 
      previous: currentCredits, 
      added: amount, 
      credits: newCredits 
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
