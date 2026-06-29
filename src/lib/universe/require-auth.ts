import { createClient } from '@/utils/supabase/server'

export async function requireUniverseAuth(): Promise<
  { ok: true; userId: string } | { ok: false; status: number; error: string }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, status: 401, error: 'Non autenticato' }
  }
  return { ok: true, userId: user.id }
}
