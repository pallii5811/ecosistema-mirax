'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Loader2, Webhook, XCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type WebhookDelivery = {
  id: string
  event_id: string | null
  entity_id: string | null
  status: 'success' | 'error'
  response_code: number | null
  error_message: string | null
  created_at: string
}

export function UniverseWebhookDeliveriesPanel() {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/universe/webhooks/deliveries?limit=12', { cache: 'no-store' })
      if (!res.ok) return
      const body = await res.json()
      setDeliveries(body.deliveries ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Caricamento webhook…
      </div>
    )
  }

  if (!deliveries.length) {
    return (
      <Card className="border-dashed p-4 text-sm text-slate-600">
        <p className="flex items-center gap-2 font-medium text-slate-800">
          <Webhook className="h-4 w-4 text-violet-600" />
          Nessuna consegna webhook
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Configura un webhook in{' '}
          <Link href="/dashboard/integrations" className="text-violet-700 hover:underline">
            Integrazioni
          </Link>{' '}
          e attiva <code className="text-[10px] bg-slate-100 px-1 rounded">UNIVERSE_WEBHOOKS_ENABLED=1</code> — gli
          eventi del grafo verranno inviati in tempo reale a Zapier, Make o il tuo endpoint.
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-violet-600">
          <Webhook className="h-3.5 w-3.5" />
          Webhook outbound ({deliveries.length})
        </p>
        <button type="button" onClick={() => void load()} className="text-[11px] text-violet-600 hover:underline">
          Aggiorna
        </button>
      </div>
      <ul className="space-y-2 max-h-48 overflow-y-auto">
        {deliveries.map((d) => {
          const ok = d.status === 'success'
          return (
            <li
              key={d.id}
              className={cn(
                'rounded-lg border px-3 py-2 text-xs',
                ok ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/50',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 font-semibold text-slate-800">
                  {ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-rose-600" />
                  )}
                  {ok ? 'Consegnato' : 'Errore'}
                  {d.response_code ? ` · HTTP ${d.response_code}` : null}
                </span>
                <time className="text-[10px] text-slate-400">
                  {new Date(d.created_at).toLocaleString('it-IT')}
                </time>
              </div>
              {d.entity_id ? (
                <Link
                  href={`/dashboard/universe/${d.entity_id}`}
                  className="mt-1 block text-violet-700 hover:underline truncate"
                >
                  Entità grafo →
                </Link>
              ) : null}
              {d.error_message ? (
                <p className="mt-0.5 text-[10px] text-rose-700 line-clamp-2">{d.error_message}</p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
