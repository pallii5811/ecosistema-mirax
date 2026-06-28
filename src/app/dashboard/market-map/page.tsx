'use client'

import { useCallback, useEffect, useState } from 'react'
import { Map, RefreshCw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MarketMap } from '@/components/market-map'
import { CompetitorsPanel } from '@/components/competitive/CompetitorsPanel'
import type { MarketMapPoint } from '@/lib/competitive/market-metrics'

export default function MarketMapPage() {
  const [points, setPoints] = useState<MarketMapPoint[]>([])
  const [meta, setMeta] = useState<{ categories: string[]; cities: string[]; total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('')
  const [city, setCity] = useState('')
  const [minIntent, setMinIntent] = useState(0)

  const loadMap = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (category) qs.set('category', category)
      if (city) qs.set('city', city)
      if (minIntent > 0) qs.set('minIntent', String(minIntent))
      const res = await fetch(`/api/competitors/market-map?${qs}`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      setPoints(Array.isArray(data.points) ? data.points : [])
      setMeta(data.meta ?? null)
    } finally {
      setLoading(false)
    }
  }, [category, city, minIntent])

  useEffect(() => {
    loadMap()
  }, [loadMap])

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Map className="h-7 w-7 text-violet-600" />
            Market Map
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Competitive intelligence: posiziona lead e competitor su maturità digitale vs crescita.
            Colore = Intent Score, dimensione = fatturato stimato.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={loadMap}>
          <RefreshCw className="h-4 w-4" /> Aggiorna
        </Button>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-xs text-slate-500">
            Settore
            <input
              list="mm-categories"
              className="mt-1 block w-44 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="es. edile"
            />
            <datalist id="mm-categories">
              {(meta?.categories ?? []).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="text-xs text-slate-500">
            Località
            <input
              list="mm-cities"
              className="mt-1 block w-44 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="es. Milano"
            />
            <datalist id="mm-cities">
              {(meta?.cities ?? []).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="text-xs text-slate-500">
            Intent minimo
            <input
              type="range"
              min={0}
              max={80}
              step={10}
              className="mt-2 block w-40"
              value={minIntent}
              onChange={(e) => setMinIntent(Number(e.target.value))}
            />
            <span className="text-sm font-medium text-slate-700">{minIntent}</span>
          </label>
          {meta && (
            <span className="text-xs text-slate-400 pb-1">
              {meta.total} punti · {meta.categories?.length ?? 0} settori
            </span>
          )}
        </div>

        <div className="mt-4">
          <MarketMap points={points} loading={loading} />
        </div>
      </Card>

      <CompetitorsPanel onChanged={loadMap} />
    </div>
  )
}
