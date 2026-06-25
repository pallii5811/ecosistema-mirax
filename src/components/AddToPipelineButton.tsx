'use client'

import { useState } from 'react'
import { Kanban, Loader2, CheckCircle } from 'lucide-react'

type Props = {
  leadName: string
  leadWebsite?: string
  leadPhone?: string
  leadEmail?: string
  leadCity?: string
  leadCategory?: string
  leadScore?: number
  size?: 'sm' | 'md'
}

export function AddToPipelineButton({
  leadName, leadWebsite, leadPhone, leadEmail, leadCity, leadCategory, leadScore, size = 'sm',
}: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  const handleAdd = async () => {
    if (status === 'done' || status === 'loading') return
    setStatus('loading')
    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_name: leadName,
          lead_website: leadWebsite || null,
          lead_phone: leadPhone || null,
          lead_email: leadEmail || null,
          lead_city: leadCity || null,
          lead_category: leadCategory || null,
          lead_score: leadScore || 0,
          stage: 'nuovo',
          deal_value: 0,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        if (d?.error?.includes('duplicate') || d?.error?.includes('unique')) {
          setStatus('done')
          return
        }
        throw new Error(d?.error || 'Errore')
      }
      setStatus('done')
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 2000)
    }
  }

  if (status === 'done') {
    return (
      <span className={`inline-flex items-center gap-1 text-emerald-600 font-medium ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>
        <CheckCircle className="w-3 h-3" /> In Pipeline
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={handleAdd}
      disabled={status === 'loading'}
      className={`inline-flex items-center gap-1 font-medium border rounded-lg transition hover:opacity-80 disabled:opacity-50 ${
        size === 'sm'
          ? 'text-[11px] px-2 py-0.5 border-violet-200 text-violet-600 bg-violet-50 hover:bg-violet-100'
          : 'text-sm px-3 py-1.5 border-violet-300 text-violet-700 bg-violet-50 hover:bg-violet-100'
      }`}
    >
      {status === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Kanban className="w-3 h-3" />}
      {status === 'error' ? 'Errore' : '+ Pipeline'}
    </button>
  )
}
