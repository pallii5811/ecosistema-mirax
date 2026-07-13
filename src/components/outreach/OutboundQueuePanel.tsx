'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Loader2, Mail, Sparkles, XCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ToastProvider'

export type OutboundQueueItem = {
  id: string
  lead_name: string | null
  lead_website: string | null
  lead_email: string | null
  trigger_signal_type: string
  sequence_key: string
  intent_score: number | null
  variants: Array<{ label: string; subject: string; body: string }>
  selected_variant: string | null
  subject: string
  body: string
  status: string
  created_at: string
}

type Props = {
  senderEmail?: string
  senderName?: string
}

export function OutboundQueuePanel({ senderEmail = '', senderName = '' }: Props) {
  const [items, setItems] = useState<OutboundQueueItem[]>([])
  const { success: toastSuccess, error: toastError } = useToast()
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [fromEmail, setFromEmail] = useState(senderEmail)
  const [fromName, setFromName] = useState(senderName)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/outbound/queue?status=pending_approval', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      const list = Array.isArray(data.items) ? data.items : []
      setItems(list)
      const sel: Record<string, string> = {}
      for (const it of list) {
        sel[it.id] = it.selected_variant || 'A'
      }
      setSelected(sel)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const approve = async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/outbound/queue/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedVariant: selected[id] || 'A',
          senderEmail: fromEmail,
          senderName: fromName,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Approvazione fallita')
      await load()
      toastSuccess('Proposta approvata e messa in invio', 'Outbound')
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Errore approvazione', 'Outbound')
    } finally {
      setBusyId(null)
    }
  }

  const reject = async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/outbound/queue/${id}/reject`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Rifiuto fallito')
      await load()
      toastSuccess('Proposta rifiutata', 'Outbound')
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Errore', 'Outbound')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Carico coda outbound…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-violet-100 bg-violet-50/50 p-3">
        <div>
          <label className="text-[10px] font-semibold uppercase text-slate-500">Mittente email</label>
          <input
            type="email"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            className="mt-0.5 block w-56 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            placeholder="tu@azienda.it"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase text-slate-500">Nome mittente</label>
          <input
            type="text"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            className="mt-0.5 block w-40 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
          />
        </div>
        <p className="text-xs text-violet-800 flex items-center gap-1">
          <Sparkles className="h-3.5 w-3.5" /> HITL: nessun invio senza Approva
        </p>
      </div>

      {items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">
          Nessuna email in coda. Genera una proposta da un lead con segnale hiring/gara/hot.
        </Card>
      ) : (
        items.map((item) => {
          const variants = Array.isArray(item.variants) ? item.variants : []
          const variantKey = selected[item.id] || 'A'
          const active =
            variants.find((v) => String(v.label).toUpperCase() === variantKey) ||
            ({ subject: item.subject, body: item.body } as { subject: string; body: string })

          return (
            <Card key={item.id} className="p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">{item.lead_name || 'Lead'}</p>
                  <p className="text-xs text-slate-500">
                    {item.trigger_signal_type} · {item.sequence_key} · Intent {item.intent_score ?? 0}
                  </p>
                </div>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                  In attesa approvazione
                </span>
              </div>

              {variants.length > 1 ? (
                <div className="flex gap-2">
                  {variants.map((v) => (
                    <button
                      key={v.label}
                      type="button"
                      onClick={() => setSelected((s) => ({ ...s, [item.id]: v.label }))}
                      className={`rounded-lg border px-2 py-1 text-xs font-semibold ${
                        variantKey === v.label
                          ? 'border-violet-400 bg-violet-50 text-violet-800'
                          : 'border-slate-200 text-slate-600'
                      }`}
                    >
                      Variante {v.label}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-sm">
                <p className="font-medium text-slate-800 flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" /> {active.subject}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-slate-600 text-xs leading-relaxed">{active.body}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={busyId === item.id}
                  onClick={() => approve(item.id)}
                >
                  {busyId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Approva e schedula
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === item.id}
                  onClick={() => reject(item.id)}
                >
                  <XCircle className="h-4 w-4" /> Rifiuta
                </Button>
              </div>
            </Card>
          )
        })
      )}
    </div>
  )
}

export default OutboundQueuePanel
