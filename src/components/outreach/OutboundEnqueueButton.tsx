'use client'

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ToastProvider'

type LeadPayload = {
  id?: string
  name?: string | null
  website?: string | null
  email?: string | null
  city?: string | null
  category?: string | null
  score?: number | null
  raw?: Record<string, unknown> | null
}

type Props = {
  lead: LeadPayload
  onEnqueued?: () => void
}

export function OutboundEnqueueButton({ lead, onEnqueued }: Props) {
  const [busy, setBusy] = useState(false)
  const { success: toastSuccess, error: toastError } = useToast()

  const enqueue = async () => {
    setBusy(true)
    try {
      const raw = lead.raw || {}
      const res = await fetch('/api/outbound/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead: {
            name: lead.name,
            website: lead.website,
            email: lead.email,
            city: lead.city,
            category: lead.category,
            score: lead.score,
            business_signals: Array.isArray(raw.business_signals) ? raw.business_signals : [],
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Impossibile generare proposta outbound')
      onEnqueued?.()
      toastSuccess(`Proposta in coda: ${data.sequence?.name || data.sequence?.key || 'sequenza'}`, 'Outbound')
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Errore generazione proposta', 'Outbound')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={enqueue}
      className="gap-1.5 border-amber-200 text-amber-800 hover:bg-amber-50"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
      Genera proposta
    </Button>
  )
}
