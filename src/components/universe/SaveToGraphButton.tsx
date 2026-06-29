'use client'

import { useState } from 'react'
import { BookmarkCheck, BookmarkPlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { setUniverseUserContext } from '@/lib/universe/client'
import { cn } from '@/lib/utils'

type Props = {
  entityId: string
  /** Metadati opzionali salvati col contesto (es. query di origine). */
  metadata?: Record<string, unknown>
  className?: string
  compact?: boolean
}

/** Salva un'entità del grafo nel contesto utente (context_type = 'saved'). */
export function SaveToGraphButton({ entityId, metadata, className, compact = false }: Props) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const save = async () => {
    if (state === 'saving' || state === 'saved') return
    setState('saving')
    try {
      await setUniverseUserContext(entityId, 'saved', metadata)
      setState('saved')
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 2500)
    }
  }

  const saved = state === 'saved'

  return (
    <Button
      type="button"
      variant={saved ? 'secondary' : 'outline'}
      size="sm"
      disabled={state === 'saving'}
      onClick={save}
      title={saved ? 'Salvato nel grafo' : 'Salva entità nel grafo'}
      className={cn('h-8 gap-1 text-xs', saved && 'text-emerald-700', className)}
    >
      {state === 'saving' ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : saved ? (
        <BookmarkCheck className="h-3.5 w-3.5" />
      ) : (
        <BookmarkPlus className="h-3.5 w-3.5" />
      )}
      {compact ? null : saved ? 'Salvato' : state === 'error' ? 'Riprova' : 'Salva'}
    </Button>
  )
}
