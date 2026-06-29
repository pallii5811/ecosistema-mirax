'use client'

import { Network, Search } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

type Props = {
  variant?: 'empty' | 'disabled' | 'not-found'
  onRetry?: () => void
}

export function UniverseEmptyState({ variant = 'empty', onRetry }: Props) {
  const copy =
    variant === 'disabled'
      ? {
          title: 'Knowledge Graph in preparazione',
          body: 'Il grafo commerciale si popola automaticamente dalle ricerche MIRAX quando Universe è attivo su worker e Vercel (UNIVERSE_ENABLED=1).',
        }
      : variant === 'not-found'
        ? {
            title: 'Entità non nel grafo',
            body: 'Questo lead non è ancora stato indicizzato. Esegui una nuova ricerca o attendi il prossimo sync sidecar.',
          }
        : {
            title: 'Grafo ancora vuoto',
            body: 'Nessuna entità trovata. Avvia una ricerca Maps con Universe attivo: audit, segnali business e enrichment alimentano il grafo in background.',
          }

  return (
    <Card className="border-dashed border-slate-200 bg-slate-50/80 p-10 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
        {variant === 'not-found' ? <Search className="h-7 w-7" /> : <Network className="h-7 w-7" />}
      </div>
      <h3 className="text-lg font-semibold text-slate-900">{copy.title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">{copy.body}</p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" className="mt-5" onClick={onRetry}>
          Riprova
        </Button>
      ) : null}
    </Card>
  )
}
