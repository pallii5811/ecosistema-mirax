'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type UniverseAlert = {
  id: string
  title: string
  body: string | null
  payload: Record<string, unknown>
  is_read: boolean
  created_at: string
}

export function UniverseAlertsPanel() {
  const [alerts, setAlerts] = useState<UniverseAlert[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/universe/alerts?limit=15', { cache: 'no-store' })
      if (!res.ok) return
      const body = await res.json()
      setAlerts(body.alerts ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const markRead = async (id: string) => {
    await fetch('/api/universe/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alert_id: id }),
    })
    setAlerts((prev) => prev.filter((a) => a.id !== id))
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Caricamento alert…
      </div>
    )
  }

  if (!alerts.length) {
    return (
      <Card className="border-dashed p-4 text-sm text-slate-600">
        <p className="flex items-center gap-2 font-medium text-slate-800">
          <Bell className="h-4 w-4 text-violet-600" />
          Nessun alert grafo
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Salva aziende nel Digital Twin o attiva monitor lead — riceverai alert su assunzioni, gare, cambi sito e
          altri eventi del grafo.
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-violet-600">
        <Bell className="h-3.5 w-3.5" />
        Alert Knowledge Graph ({alerts.length})
      </p>
      <ul className="space-y-2 max-h-64 overflow-y-auto">
        {alerts.map((alert) => {
          const entityId = typeof alert.payload?.entity_id === 'string' ? alert.payload.entity_id : null
          return (
            <li key={alert.id} className="rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2.5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {entityId ? (
                    <Link
                      href={`/dashboard/universe/${entityId}`}
                      className="font-semibold text-violet-900 hover:underline line-clamp-2"
                    >
                      {alert.title}
                    </Link>
                  ) : (
                    <p className="font-semibold text-violet-900 line-clamp-2">{alert.title}</p>
                  )}
                  {alert.body ? <p className="mt-0.5 text-xs text-slate-600 line-clamp-2">{alert.body}</p> : null}
                  <time className="mt-1 block text-[10px] text-slate-400">
                    {new Date(alert.created_at).toLocaleString('it-IT')}
                  </time>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 shrink-0"
                  title="Segna come letto"
                  onClick={() => void markRead(alert.id)}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
