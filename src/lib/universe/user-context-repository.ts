/**
 * Fase 7 — Repository contesto utente privato sul grafo.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { UniverseUserContext } from './types.ts'
import { wrapSupabaseError } from './errors.ts'

export type UserContextType = UniverseUserContext['context_type']

export async function listUserContextForEntity(
  sb: SupabaseClient,
  userId: string,
  entityId: string,
): Promise<UniverseUserContext[]> {
  const { data, error } = await sb
    .from('universe_user_context')
    .select('*')
    .eq('user_id', userId)
    .eq('entity_id', entityId)

  if (error) throw wrapSupabaseError(error)
  return (data ?? []) as UniverseUserContext[]
}

export async function upsertUserContext(
  sb: SupabaseClient,
  input: {
    user_id: string
    entity_id: string
    context_type: UserContextType
    metadata?: Record<string, unknown>
  },
): Promise<UniverseUserContext> {
  const { data, error } = await sb
    .from('universe_user_context')
    .upsert(
      {
        user_id: input.user_id,
        entity_id: input.entity_id,
        context_type: input.context_type,
        metadata: input.metadata ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,entity_id,context_type' },
    )
    .select()
    .single()

  if (error) throw wrapSupabaseError(error)
  return data as UniverseUserContext
}

export async function deleteUserContext(
  sb: SupabaseClient,
  userId: string,
  entityId: string,
  contextType: UserContextType,
): Promise<void> {
  const { error } = await sb
    .from('universe_user_context')
    .delete()
    .eq('user_id', userId)
    .eq('entity_id', entityId)
    .eq('context_type', contextType)

  if (error) throw wrapSupabaseError(error)
}
