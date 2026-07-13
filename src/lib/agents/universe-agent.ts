/**
 * Fase 7 — Universe Agent: Digital Twin + Agentic Search sul grafo.
 */

import { createServiceRoleClient } from '@/utils/supabase/server'
import { buildDigitalTwin } from '@/lib/universe/digital-twin'
import { executeAgenticUniverseSearch } from '@/lib/universe/agentic-search'
import { getEntityByAlias, getEntityByCanonicalId } from '@/lib/universe/entity-repository'
import { normalizeDomain } from '@/lib/universe/canonical'
import { parseSignalIntentOffline } from '@/lib/signal-intent/parse-semantic'
import { coerceSignalIntent } from '@/lib/signal-intent/parse-heuristic'
import type { SignalIntentSpec } from '@/lib/signal-intent/types'

export type UniverseAgentAction = 'twin' | 'agentic_search' | 'resolve_domain'

export type UniverseAgentInput = {
  action?: UniverseAgentAction
  entity_id?: string
  domain?: string
  user_query?: string
  city?: string
  limit?: number
  signal_intent?: SignalIntentSpec
  userId?: string
}

export async function runUniverseAgent(input: UniverseAgentInput) {
  const action = input.action ?? (input.user_query ? 'agentic_search' : 'twin')
  const sb = createServiceRoleClient()

  if (action === 'agentic_search') {
    const query = String(input.user_query ?? '').trim()
    if (!query && !input.signal_intent) {
      return { ok: false as const, error: 'user_query o signal_intent richiesto' }
    }
    const intent = input.signal_intent
      ? coerceSignalIntent(input.signal_intent)
      : parseSignalIntentOffline(query)
    const result = await executeAgenticUniverseSearch(sb, intent, {
      city: input.city,
      limit: input.limit ?? 50,
    })
    return {
      ok: true as const,
      action,
      intent_summary: result.intent.summary,
      total: result.total,
      results: result.results,
      entities: result.entities.map((e) => ({ id: e.id, name: e.name, city: e.city })),
    }
  }

  if (action === 'resolve_domain') {
    const raw = String(input.domain ?? '').trim()
    if (!raw) return { ok: false as const, error: 'domain richiesto' }
    const domain = normalizeDomain(raw.startsWith('http') ? raw : `https://${raw}`)
    if (!domain) return { ok: false as const, error: 'Dominio non valido' }
    let entity = await getEntityByCanonicalId(sb, domain, 'company')
    if (!entity) entity = await getEntityByAlias(sb, 'domain', domain)
    if (!entity) return { ok: false as const, error: 'Entità non trovata nel grafo', domain }
    const twin = await buildDigitalTwin(sb, entity.id, { userId: input.userId })
    if (!twin) return { ok: false as const, error: 'Twin non disponibile' }
    return { ok: true as const, action, domain, twin }
  }

  const entityId = String(input.entity_id ?? '').trim()
  if (!entityId) return { ok: false as const, error: 'entity_id richiesto' }

  const twin = await buildDigitalTwin(sb, entityId, { userId: input.userId })
  if (!twin) return { ok: false as const, error: 'Entità non trovata' }

  return { ok: true as const, action: 'twin' as const, twin }
}
