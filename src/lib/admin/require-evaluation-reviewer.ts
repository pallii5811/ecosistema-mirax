import { createClient } from '@/utils/supabase/server'

export async function requireEvaluationReviewer() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.id || !user.email) return { ok: false as const, status: 401, error: 'Non autenticato' }
  const configured = String(process.env.EVALUATION_REVIEWER_EMAILS || process.env.ADMIN_EMAILS || '')
    .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
  if (configured.length === 0) {
    return { ok: false as const, status: 503, error: 'Reviewer allowlist non configurata' }
  }
  if (!configured.includes(user.email.toLowerCase())) {
    return { ok: false as const, status: 403, error: 'Accesso negato' }
  }
  return { ok: true as const, user }
}
