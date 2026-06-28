'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, ExternalLink, Plug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export default function EcosistemaNousPage() {
  const [status, setStatus] = useState<{
    nous?: { adapters: string[]; connected: string[]; layer: string }
    crm_integrations?: Array<{ id: string; type: string; name: string }>
  } | null>(null)

  useEffect(() => {
    void fetch('/api/ecosistema/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {})
  }, [])

  const adapters = status?.nous?.adapters ?? ['hubspot', 'salesforce', 'webhook', 'dynamics', 'vtiger']
  const connected = status?.nous?.connected ?? []

  return (
    <div className="space-y-6">
      <Card className="p-5 border-slate-200">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Plug className="w-5 h-5 text-violet-600" />
          Layer NOUS — Normalizer · Orchestrator · Unified Sync
        </h2>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          Tutti i CRM passano da un unico layer: normalizzazione lead, dispatch eventi, fan-out webhook.
          HubSpot e Salesforce OAuth, Zapier/Make via webhook, Dynamics e vTiger in roadmap adapter.
        </p>
      </Card>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {adapters.map((type) => {
          const isConnected = connected.includes(type)
          return (
            <Card
              key={type}
              className={`p-4 border-2 ${isConnected ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200'}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold capitalize text-slate-900">{type}</span>
                {isConnected ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                ) : (
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">Non collegato</span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-2">
                {type === 'salesforce'
                  ? 'OAuth 2.0 + push Lead API — direzione enterprise Salesforce.'
                  : type === 'hubspot'
                    ? 'Contatti e deal sync bidirezionale.'
                    : type === 'webhook'
                      ? 'Zapier, Make, stack custom.'
                      : 'Adapter base — contattaci per attivazione.'}
              </p>
            </Card>
          )
        })}
      </div>

      {(status?.crm_integrations?.length ?? 0) > 0 && (
        <Card className="p-4 border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800 mb-2">Integrazioni attive</h3>
          <ul className="space-y-2">
            {status!.crm_integrations!.map((c) => (
              <li key={c.id} className="text-sm text-slate-600 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                {c.name} ({c.type})
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap gap-3">
        <Button asChild className="bg-violet-600 hover:bg-violet-700">
          <Link href="/dashboard/integrations/crm">
            Configura CRM / Salesforce OAuth
            <ExternalLink className="w-4 h-4 ml-2" />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard/integrations">Tutte le integrazioni</Link>
        </Button>
      </div>
    </div>
  )
}
