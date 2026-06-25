'use client'

import { useState } from 'react'
import { CheckCircle, Loader2, Phone, XCircle } from 'lucide-react'
import { trackInteraction } from '@/app/dashboard/scoring/actions'

type Props = {
  leadWebsite: string
  leadNome: string
  currentScore: number
}

export function LeadActionButtons({ leadWebsite, leadNome, currentScore }: Props) {
  const [status, setStatus] = useState<'idle' | 'contacted' | 'converted' | 'rejected'>('idle')
  const [isLoading, setIsLoading] = useState(false)

  const handleAction = async (action: 'contacted' | 'converted' | 'rejected') => {
    const site = typeof leadWebsite === 'string' ? leadWebsite.trim() : ''
    if (!site) return

    setIsLoading(true)
    try {
      await trackInteraction(site, leadNome, action, currentScore)
      setStatus(action)
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) return <Loader2 className="w-4 h-4 animate-spin text-purple-500" />

  if (status === 'converted')
    return (
      <span className="text-xs text-green-600 font-medium flex items-center gap-1">
        <CheckCircle className="w-3 h-3" /> Convertito
      </span>
    )

  if (status === 'rejected')
    return (
      <span className="text-xs text-red-500 font-medium flex items-center gap-1">
        <XCircle className="w-3 h-3" /> Scartato
      </span>
    )

  return (
    <div className="flex items-center gap-1">
      {status === 'idle' ? (
        <button
          type="button"
          onClick={() => handleAction('contacted')}
          className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1 border border-purple-200 rounded px-2 py-0.5 hover:bg-purple-50"
        >
          <Phone className="w-3 h-3" /> Contattato
        </button>
      ) : (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => handleAction('converted')}
            className="text-xs text-green-600 border border-green-200 rounded px-2 py-0.5 hover:bg-green-50"
          >
            ✓ Convertito
          </button>
          <button
            type="button"
            onClick={() => handleAction('rejected')}
            className="text-xs text-red-500 border border-red-200 rounded px-2 py-0.5 hover:bg-red-50"
          >
            ✗ Scartato
          </button>
        </div>
      )}
    </div>
  )
}
