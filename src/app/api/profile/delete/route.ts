import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

/**
 * POST /api/profile/delete
 * Eliminazione definitiva dell'account utente — conformità GDPR (right to erasure).
 *
 * Pre-condizioni:
 *  - L'utente deve essere autenticato.
 *  - L'utente deve confermare con la stringa 'ELIMINA' nel body (anti-tap).
 *
 * Sequenza (best-effort, se uno step fallisce continuiamo a eliminare gli altri):
 *  1. Cancella dati applicativi dell'utente (lead_pipeline, lists, environments, crm_integrations, ecc.)
 *  2. Cancella l'utente dall'auth Supabase (richiede SERVICE_ROLE_KEY)
 *
 * Body: { confirm: 'ELIMINA' }
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Non autenticato' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { confirm?: string } | null
  if (body?.confirm !== 'ELIMINA') {
    return NextResponse.json({ ok: false, error: 'Conferma richiesta' }, { status: 400 })
  }

  const userId = user.id
  const cleanupErrors: string[] = []

  // 1) Cancella dati applicativi (RLS-friendly, l'utente cancella i propri record)
  const tablesToCleanup = [
    'lead_pipeline',
    'lead_interactions',
    'lists',
    'environments',
    'crm_integrations',
    'crm_sync_log',
    'searches',
  ]

  for (const table of tablesToCleanup) {
    try {
      const { error } = await supabase.from(table).delete().eq('user_id', userId)
      if (error) cleanupErrors.push(`${table}: ${error.message}`)
    } catch (e: any) {
      cleanupErrors.push(`${table}: ${e?.message || 'unknown'}`)
    }
  }

  // 2) Cancella l'utente dall'auth (richiede service role key)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL

  if (!serviceRoleKey || !supabaseUrl) {
    // Senza service role non possiamo cancellare l'auth user, ma i dati app sono comunque cancellati.
    // L'utente non potrà più loggarsi davvero solo dopo eliminazione auth — lo segnaliamo.
    return NextResponse.json({
      ok: false,
      error:
        'Dati applicativi cancellati, ma l\'eliminazione dell\'account auth richiede intervento del supporto (SUPABASE_SERVICE_ROLE_KEY non configurata).',
      cleanupErrors,
    })
  }

  try {
    const admin = createAdminClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: delErr } = await admin.auth.admin.deleteUser(userId)
    if (delErr) {
      return NextResponse.json(
        {
          ok: false,
          error: `Dati cancellati ma auth.deleteUser fallito: ${delErr.message}`,
          cleanupErrors,
        },
        { status: 500 }
      )
    }
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: `Errore eliminazione auth: ${e?.message || 'unknown'}`,
        cleanupErrors,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, cleanupErrors: cleanupErrors.length > 0 ? cleanupErrors : undefined })
}
