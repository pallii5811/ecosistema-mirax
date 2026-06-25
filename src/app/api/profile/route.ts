import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'

const DEFAULT_CREDITS = 10

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, company, credits, plan_type')
      .eq('id', user.id)
      .single()

    // If profile doesn't exist, create it automatically (service role bypasses RLS)
    if (!profile) {
      try {
        const adminDb = createServiceRoleClient()
        const newProfile = {
          id: user.id,
          email: user.email || '',
          full_name: '',
          company: '',
          credits: DEFAULT_CREDITS,
          plan_type: 'free',
        }
        await adminDb.from('profiles').upsert(newProfile, { onConflict: 'id' })
      } catch {
        // Service role key not available — skip DB insert
      }

      return NextResponse.json({
        email: user.email,
        full_name: '',
        company: '',
        credits: DEFAULT_CREDITS,
        plan_type: 'free',
      })
    }

    return NextResponse.json({
      email: user.email,
      full_name: profile?.full_name || '',
      company: profile?.company || '',
      credits: typeof profile?.credits === 'number' ? profile.credits : 0,
      plan_type: profile?.plan_type || 'free',
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

    const body = await req.json()
    const updates: Record<string, string> = {}

    if (typeof body.full_name === 'string') updates.full_name = body.full_name.trim()
    if (typeof body.company === 'string') updates.company = body.company.trim()

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nessun campo da aggiornare' }, { status: 400 })
    }

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, ...updates })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
