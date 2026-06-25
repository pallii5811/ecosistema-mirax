'use client'

import { useState } from 'react'
import type { Environment } from '@/types/environments'
import { createEnvironment } from './actions'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'
import { useToast } from '@/components/ToastProvider'

const COLORS = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#6366F1', '#14B8A6']

type Props = {
  open: boolean
  onClose: () => void
  onCreated: (env: Environment) => void
}

export function CreateEnvironmentModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [isLoading, setIsLoading] = useState(false)
  const { success: toastSuccess, error: toastError } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      toastError("Inserisci un nome per l'ambiente")
      return
    }

    setIsLoading(true)
    const result = await createEnvironment({
      name: name.trim(),
      description: description.trim() || undefined,
      color,
    })
    setIsLoading(false)

    if (result.success && result.environment) {
      toastSuccess('Ambiente creato!')
      onCreated(result.environment)
      setName('')
      setDescription('')
      setColor(COLORS[0])
    } else {
      toastError(result.error || 'Errore durante la creazione')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent className="rounded-lg border border-slate-200">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-slate-900">Crea nuovo ambiente</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4 px-6 pb-6">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-xs font-semibold text-slate-600">Nome *</Label>
            <Input
              id="name"
              placeholder="Es: Agenzie Comunicazione Milano"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isLoading}
              className="rounded-lg border-slate-200 focus-visible:ring-1 focus-visible:ring-slate-900"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-xs font-semibold text-slate-600">Descrizione</Label>
            <Textarea
              id="description"
              placeholder="Descrizione opzionale..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isLoading}
              rows={3}
              className="rounded-lg border-slate-200 focus-visible:ring-1 focus-visible:ring-slate-900"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold text-slate-600">Colore</Label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-md border border-slate-200 transition-transform ${
                    color === c ? 'ring-2 ring-offset-2 ring-slate-400 scale-105' : ''
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading} className="flex-1 rounded-md border-slate-200">
              Annulla
            </Button>
            <Button type="submit" disabled={isLoading} className="flex-1 rounded-md bg-slate-900 hover:bg-slate-800 text-white">
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creazione...
                </>
              ) : (
                'Crea ambiente'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
