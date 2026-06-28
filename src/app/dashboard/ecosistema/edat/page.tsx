'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, Radar, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type Monitor = {
  id: string
  search_id: string
  lead_index: number
  created_at: string
  last_checked_at?: string | null
  next_check_at?: string | null
}

type Alert = {
  id: string
  title: string
  message: string
  is_read: boolean
  created_at: string
  alert_type?: string
}

export default function EcosistemaEdatPage() {
  const [monitors, setMonitors] = useState<Monitor[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    void fetch('/api/ecosistema/edat', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setMonitors(d.monitors ?? [])
        setAlerts(d.alerts ?? [])
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="space-y-6">
      <Card className="p-5 border-amber-200 bg-amber-50/40">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Radar className="w-5 h-5 text-amber-600" />
          EDAT — Event Driven Action Time
        </h2>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          Monitora un lead dalla scheda dettaglio (🔔 Monitora). Il cron notturno ri-audita i siti, genera alert e
          alimenta le azioni in Smart Insights. Eventi su outreach, pipeline e sequenze email finiscono in{' '}
          <code className="text-xs bg-white px-1 rounded">mirax_events</code>.
        </p>
        <Button size="sm" variant="outline" className="mt-3" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Aggiorna
        </Button>
      </Card>

      <section>
        <h3 className="text-sm font-semibold text-slate-800 mb-3">
          Lead monitorati ({monitors.length})
        </h3>
        {monitors.length === 0 ? (
          <Card className="p-6 text-center border-dashed border-slate-300">
            <p className="text-sm text-slate-500">Nessun monitor attivo.</p>
            <Button asChild size="sm" className="mt-3" variant="outline">
              <Link href="/dashboard">Vai a Ricerca → Dettaglio lead → Monitora</Link>
            </Button>
          </Card>
        ) : (
          <div className="space-y-2">
            {monitors.map((m) => (
              <Card key={m.id} className="p-3 border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <span className="font-medium text-slate-800">Lead #{m.lead_index + 1}</span>
                  <span className="text-slate-400 mx-2">·</span>
                  <span className="text-xs text-slate-500 font-mono">{m.search_id.slice(0, 8)}…</span>
                </div>
                <Link
                  href={`/dashboard/lead/${m.search_id}/${m.lead_index}`}
                  className="text-xs font-medium text-violet-600 hover:underline"
                >
                  Apri lead
                </Link>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <Bell className="w-4 h-4" />
          Alert recenti ({alerts.filter((a) => !a.is_read).length} non letti)
        </h3>
        {alerts.length === 0 ? (
          <p className="text-sm text-slate-500">Nessun alert. I monitor genereranno notifiche al prossimo re-audit.</p>
        ) : (
          <div className="space-y-2">
            {alerts.map((a) => (
              <Card
                key={a.id}
                className={`p-3 border-slate-200 ${!a.is_read ? 'border-l-4 border-l-amber-400' : ''}`}
              >
                <div className="font-medium text-sm text-slate-900">{a.title}</div>
                <p className="text-xs text-slate-600 mt-1">{a.message}</p>
                <p className="text-[10px] text-slate-400 mt-1">{new Date(a.created_at).toLocaleString('it-IT')}</p>
              </Card>
            ))}
          </div>
        )}
        <Link href="/dashboard/insights" className="inline-block mt-3 text-sm text-violet-600 font-medium hover:underline">
          Azioni EDAT in Smart Insights →
        </Link>
      </section>
    </div>
  )
}
