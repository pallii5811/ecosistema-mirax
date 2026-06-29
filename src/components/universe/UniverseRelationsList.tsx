'use client'

import Link from 'next/link'
import type { RelatedEntity } from '@/lib/universe/types'
import { labelRelationship } from '@/lib/universe/labels'
import { UniverseEntityBadge } from './UniverseEntityBadge'

type Props = {
  related: RelatedEntity[]
  limit?: number
}

export function UniverseRelationsList({ related, limit = 24 }: Props) {
  const rows = related.slice(0, limit)
  if (!rows.length) {
    return <p className="text-sm text-slate-500">Nessuna relazione nel grafo per questa entità.</p>
  }

  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
      {rows.map((r) => (
        <li key={r.relationship_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50/80">
          <div className="min-w-0 flex-1">
            <Link
              href={`/dashboard/universe/${r.related_entity_id}`}
              className="font-medium text-slate-900 hover:text-violet-700"
            >
              {r.related_entity_name}
            </Link>
            <p className="text-xs text-slate-500">{labelRelationship(r.relationship_type)}</p>
          </div>
          <UniverseEntityBadge type={r.related_entity_type} />
        </li>
      ))}
    </ul>
  )
}
