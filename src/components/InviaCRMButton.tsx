'use client'

import { useState } from 'react'
import { CheckCircle, Loader2, Send } from 'lucide-react'

type Props = {
  lead: any
  integrationId: string | null
  integrationType: string | null
}

export function InviaCRMButton({ lead, integrationId, integrationType }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  if (!integrationId || !integrationType) return null

  const handleSend = async () => {
    setStatus('loading')
    try {
      const endpoint = integrationType === 'hubspot' ? '/api/crm/hubspot' : '/api/crm/webhook'

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead, integrationId }),
      })

      setStatus(res.ok ? 'done' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'loading') return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />

  if (status === 'done') return <CheckCircle className="w-4 h-4 text-green-500" />

  return (
    <button
      type="button"
      onClick={handleSend}
      className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-2 py-0.5 hover:bg-blue-50"
      title={status === 'error' ? 'Errore invio' : 'Invia al CRM'}
    >
      <Send className="w-3 h-3" />
      CRM
    </button>
  )
}
