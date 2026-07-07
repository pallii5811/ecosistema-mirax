'use client'

import { useCallback, useEffect, useState } from 'react'
import { BookmarkCheck, BookmarkPlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getUniverseUserContext, setUniverseUserContext, removeUniverseUserContext } from '@/lib/universe/client'
import { cn } from '@/lib/utils'

type Props = {
  entityId: string
  /** Metadati opzionali salvati col contesto (es. query di origine). */
  metadata?: Record<string, unknown>
  className?: string
  compact?: boolean
}

/** Salva/rimuove un'entità del grafo nel contesto utente (context_type = 'saved').
 *  Riflette lo stato persistente caricato dal server.
 */
export function SaveToGraphButton({ entityId, metadata, className, compact = false }: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'saved' | 'error'>('idle')

  const load = useCallback(async () => {
    try {
      const res = await getUniverseUserContext(entityId)
      const isSaved = (res.contexts ?? []).some((c) => c.context_type === 'saved')
      setState(isSaved ? 'saved' : 'idle')
    } catch {
      setState('idle')
    }
  }, [entityId])

  useEffect(() => {
    load()
  }, [load])

  const toggle = async () => {
    if (state === 'loading') return
    const willSave = state !== 'saved'
    setState('loading')
    try {
      if (willSave) {
        await setUniverseUserContext(entityId, 'saved', metadata)
        setState('saved')
      } else {
        await removeUniverseUserContext(entityId, 'saved')
        setState('idle')
      }
    } catch {
      setState('error')
      setTimeout(() => setState('saved'), 2500)
    }
  }

  const isSaved = state === 'saved'
  const label = state === 'loading' ? 'Salvataggio…' : isSaved ? 'Salvato nel grafo' : 'Salva entità nel grafo'

  return (
    <Button
      type="button"
      variant={isSaved ? 'secondary' : 'outline'}
      size="sm"
      disabled={state === 'loading'}
      onClick={toggle}
      aria-pressed={isSaved}
      aria-label={label}
      title={label}
      className={cn('h-8 gap-1 text-xs', isSaved && 'text-emerald-700', className)}
    >
      {state === 'loading' ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isSaved ? (
        <BookmarkCheck className="h-3.5 w-3.5" />
      ) : (
        <BookmarkPlus className="h-3.5 w-3.5" />
      )}
      {compact ? null : state === 'error' ? 'Riprova' : isSaved ? 'Salvato' : 'Salva'}
    </Button>
  )
}
