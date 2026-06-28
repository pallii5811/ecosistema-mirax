'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Bell,
  Bot,
  Brain,
  Layers,
  Loader2,
  Plug,
  Radar,
  Sparkles,
} from 'lucide-react'
import { Card } from '@/components/ui/card'

type Status = {
  counts: {
    pipeline: number
    monitors: number
    alerts_unread: number
    api_keys: number
    environments: number
    knowledge_objects: number
  }
  pki: { score: number; grade: string } | null
}

const MODULES = [
  {
    href: '/dashboard/ecosistema/agenti',
    icon: Bot,
    title: 'Multi-Agent System',
    desc: 'Search, Audit, Pitch, Outreach, Insights + Orchestrator',
    color: 'violet',
  },
  {
    href: '/dashboard/ecosistema/nous',
    icon: Plug,
    title: 'NOUS / CRM',
    desc: 'HubSpot, Salesforce OAuth, webhook, Dynamics',
    color: 'emerald',
  },
  {
    href: '/dashboard/ecosistema/edat',
    icon: Radar,
    title: 'EDAT',
    desc: 'Monitor lead, re-audit, eventi mirax_events',
    color: 'amber',
  },
  {
    href: '/dashboard/ecosistema/intelligence',
    icon: Brain,
    title: 'Intelligence',
    desc: 'PKI, pattern chiusura, CKBase-lite / SemanticMap',
    color: 'indigo',
  },
]

function StatCard({
  label,
  value,
  href,
}: {
  label: string
  value: string | number
  href?: string
}) {
  const inner = (
    <Card className="p-4 border-slate-200 bg-white hover:border-violet-300 transition-colors h-full">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{value}</div>
    </Card>
  )
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  )
}

export default function EcosistemaOverviewPage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ecosistema/status', { cache: 'no-store' })
      const data = await res.json()
      if (res.ok) setStatus(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    )
  }

  const c = status?.counts
  const hasPipeline = (c?.pipeline ?? 0) > 0

  return (
    <div className="space-y-8">
      {!hasPipeline && (
        <Card className="p-4 border-violet-200 bg-violet-50 flex flex-col sm:flex-row sm:items-center gap-3">
          <Sparkles className="w-8 h-8 text-violet-500 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-violet-900">Configura il Centro Comando</p>
            <p className="text-sm text-violet-700 mt-0.5">
              1) Ricerca lead → 2) Dettaglio → Pipeline → 3) Torna qui per PKI, agenti e CRM.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="text-sm font-semibold text-violet-700 hover:underline shrink-0"
          >
            Inizia da Ricerca →
          </Link>
        </Card>
      )}

      <section>
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Stato account</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Pipeline" value={c?.pipeline ?? 0} href="/dashboard/pipeline" />
          <StatCard label="Monitor EDAT" value={c?.monitors ?? 0} href="/dashboard/ecosistema/edat" />
          <StatCard
            label="PKI"
            value={status?.pki ? `${status.pki.score}` : '—'}
            href="/dashboard/insights"
          />
          <StatCard label="Knowledge" value={c?.knowledge_objects ?? 0} href="/dashboard/environments" />
        </div>
        {(c?.alerts_unread ?? 0) > 0 && (
          <p className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <Bell className="w-4 h-4" />
            {c?.alerts_unread} alert EDAT —{' '}
            <Link href="/dashboard/ecosistema/edat" className="font-semibold underline">
              vedi EDAT
            </Link>
          </p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <Layers className="w-4 h-4" />
          Moduli
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {MODULES.map((m) => (
            <Link key={m.href} href={m.href}>
              <Card className="p-4 border-slate-200 hover:border-violet-300 hover:shadow-sm transition-all h-full group">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-xl bg-violet-100 text-violet-700">
                    <m.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 group-hover:text-violet-700">{m.title}</div>
                    <p className="text-xs text-slate-500 mt-1">{m.desc}</p>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 mt-2">
                      Apri <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        <strong className="text-slate-800">Nota:</strong> Ricerca, liste, outreach e pipeline sono il motore operativo
        quotidiano. Qui trovi integrazioni CRM, monitor EDAT, agenti e intelligence avanzata.
      </section>
    </div>
  )
}
