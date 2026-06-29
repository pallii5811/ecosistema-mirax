'use client'

import Link from 'next/link'
import { ArrowRight, Building2, MapPin } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { UniverseEntitySummary } from '@/lib/universe/client'
import { formatObservationValue, labelObservation } from '@/lib/universe/labels'
import { UniverseEntityBadge } from './UniverseEntityBadge'

type Props = {
  entity: UniverseEntitySummary
}

export function UniverseEntityCard({ entity }: Props) {
  const obs = entity.latest_observations ?? {}
  const obsKeys = Object.keys(obs).slice(0, 4)

  return (
    <Link href={`/dashboard/universe/${entity.id}`} className="block group">
      <Card className="h-full p-4 transition-all duration-200 hover:border-violet-300 hover:shadow-md hover:shadow-violet-100/50">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 shrink-0 text-violet-600" />
              <h3 className="truncate font-semibold text-slate-900 group-hover:text-violet-800">{entity.name}</h3>
            </div>
            {(entity.city || entity.country) && (
              <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                <MapPin className="h-3 w-3" />
                {[entity.city, entity.country].filter(Boolean).join(', ')}
              </p>
            )}
          </div>
          <UniverseEntityBadge type={entity.entity_type} />
        </div>

        {obsKeys.length > 0 ? (
          <dl className="mt-3 grid grid-cols-2 gap-2">
            {obsKeys.map((key) => (
              <div key={key} className="rounded-lg bg-slate-50 px-2 py-1.5">
                <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{labelObservation(key)}</dt>
                <dd className="text-xs font-semibold text-slate-800">{formatObservationValue(obs[key])}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-3 text-xs text-slate-400">Apri per timeline e relazioni</p>
        )}

        <div className="mt-3 flex items-center justify-end text-xs font-medium text-violet-600 opacity-0 transition-opacity group-hover:opacity-100">
          Dettaglio <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </div>
      </Card>
    </Link>
  )
}
