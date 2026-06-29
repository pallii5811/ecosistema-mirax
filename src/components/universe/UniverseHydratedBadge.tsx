'use client'

import Link from 'next/link'
import { Network } from 'lucide-react'

type Props = {
  lead: Record<string, unknown>
  compact?: boolean
}

/** Badge Fase 6 — lead collegato a entità nel Knowledge Graph. */
export function UniverseHydratedBadge({ lead, compact = false }: Props) {
  const entityId =
    typeof lead.universe_entity_id === 'string'
      ? lead.universe_entity_id
      : typeof lead.entity_id === 'string'
        ? lead.entity_id
        : null

  if (!entityId) return null

  const fields = Array.isArray(lead.universe_hydrated_fields) ? lead.universe_hydrated_fields.length : 0
  const title =
    fields > 0
      ? `Dati arricchiti dal grafo (${fields} campi) · entità ${entityId.slice(0, 8)}…`
      : `Collegato al Knowledge Graph · ${entityId.slice(0, 8)}…`

  return (
    <Link
      href={`/dashboard/universe/${entityId}`}
      title={title}
      className="inline-flex items-center gap-0.5 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide leading-none text-violet-800 hover:bg-violet-100 transition-colors"
    >
      <Network className="h-2.5 w-2.5" />
      {compact ? 'Grafo' : 'Knowledge Graph'}
    </Link>
  )
}
