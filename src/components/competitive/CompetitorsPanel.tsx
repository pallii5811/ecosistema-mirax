'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, Loader2, Plus, Trash2, Users } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export type CompetitorRow = {
  id: string
  name: string
  website: string | null
  city: string | null
  category: string | null
  tracked_signals: string[]
  intent_score: number
  growth_rate: number
  digital_maturity: number
  last_scanned_at: string | null
}

type AlertRow = {
  id: string
  title: string
  body: string | null
  signal_type: string
  strength: number
  created_at: string
  competitors?: { name?: string; city?: string } | null
}

type Props = {
  onChanged?: () => void
}

export function CompetitorsPanel({ onChanged }: Props) {
  const [competitors, setCompetitors] = useState<CompetitorRow[]>([])
  const [alerts, setAlerts] = useState<AlertRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [city, setCity] = useState('')
  const [category, setCategory] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cRes, aRes] = await Promise.all([
        fetch('/api/competitors', { cache: 'no-store' }),
        fetch('/api/competitors/alerts?unread=1', { cache: 'no-store' }),
      ])
      const cData = await cRes.json().catch(() => ({}))
      const aData = await aRes.json().catch(() => ({}))
      setCompetitors(Array.isArray(cData.competitors) ? cData.competitors : [])
      setAlerts(Array.isArray(aData.alerts) ? aData.alerts : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const add = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/competitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, website, city, category }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Errore creazione')
      setName('')
      setWebsite('')
      await load()
      onChanged?.()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Errore')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    try {
      await fetch(`/api/competitors/${id}`, { method: 'DELETE' })
      await load()
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  const dismissAlerts = async () => {
    if (!alerts.length) return
    await fetch('/api/competitors/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: alerts.map((a) => a.id) }),
    })
    setAlerts([])
  }

  return (
    <div className="space-y-4">
      {alerts.length > 0 && (
        <Card className="p-4 border-amber-200 bg-amber-50/60">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Bell className="h-5 w-5 text-amber-600 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-amber-900">Alert competitor ({alerts.length})</h3>
                <ul className="mt-2 space-y-2">
                  {alerts.slice(0, 5).map((a) => (
                    <li key={a.id} className="text-xs text-amber-900/90">
                      <span className="font-medium">{a.title}</span>
                      {a.body && <p className="text-amber-800/80 mt-0.5">{a.body}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={dismissAlerts}>
              Segna letti
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Users className="h-4 w-4" /> Traccia competitor
        </h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Nome azienda *"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Sito web"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Città"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
          <input
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Settore / categoria"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </div>
        <Button type="button" className="mt-3 gap-1.5" size="sm" disabled={busy || !name.trim()} onClick={add}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Aggiungi competitor
        </Button>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Competitor tracciati</h3>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Caricamento…
          </div>
        ) : competitors.length === 0 ? (
          <p className="text-sm text-slate-500">Nessun competitor — aggiungine uno per iniziare il tracking.</p>
        ) : (
          <ul className="space-y-2">
            {competitors.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-900 truncate">{c.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Intent {c.intent_score ?? 0} · Growth {c.growth_rate ?? 0} · Maturity {c.digital_maturity ?? 0}
                    {c.city ? ` · ${c.city}` : ''}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  disabled={busy}
                  onClick={() => remove(c.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
