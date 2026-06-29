'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, Search } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { searchUniverseEntities } from '@/lib/universe/client'
import type { UniverseEntitySummary } from '@/lib/universe/client'
import type { EntityType } from '@/lib/universe/types'
import { ENTITY_TYPE_LABELS } from '@/lib/universe/labels'
import { UniverseEntityCard } from '@/components/universe/UniverseEntityCard'
import { UniverseEmptyState } from '@/components/universe/UniverseEmptyState'

const ENTITY_TYPES = Object.keys(ENTITY_TYPE_LABELS) as EntityType[]

export function UniverseExplorerPanel() {
  const [entities, setEntities] = useState<UniverseEntitySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [entityType, setEntityType] = useState<EntityType | ''>('company')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await searchUniverseEntities({
        entity_type: entityType || undefined,
        city: city.trim() || undefined,
        name_contains: name.trim() || undefined,
        limit: 48,
        with_latest_observations: true,
      })
      setEntities(data.entities ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore ricerca')
      setEntities([])
    } finally {
      setLoading(false)
    }
  }, [city, entityType, name])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[200px] flex-1 text-xs text-slate-500">
            Nome azienda
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
                placeholder="es. edil costruzioni"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && load()}
              />
            </div>
          </label>
          <label className="w-40 text-xs text-slate-500">
            Città
            <input
              className="mt-1 block w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="es. Roma"
            />
          </label>
          <label className="w-44 text-xs text-slate-500">
            Tipo entità
            <select
              className="mt-1 block w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm bg-white"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as EntityType | '')}
            >
              <option value="">Tutti</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ENTITY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" onClick={load} disabled={loading} variant="outline">
            Filtra
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={load} disabled={loading} className="gap-1">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </Card>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
      ) : null}

      {loading && entities.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin text-violet-600" />
          Caricamento entità…
        </div>
      ) : null}

      {!loading && entities.length === 0 && !error ? <UniverseEmptyState onRetry={load} /> : null}

      {entities.length > 0 ? (
        <>
          <p className="text-sm text-slate-500">
            <span className="font-semibold text-slate-800">{entities.length}</span> entità
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {entities.map((e) => (
              <UniverseEntityCard key={e.id} entity={e} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
