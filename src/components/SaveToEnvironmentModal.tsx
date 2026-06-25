'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Folder, Plus } from 'lucide-react'
import {
  addSearchesToEnvironment,
  createEnvironment,
  getEnvironments,
} from '@/app/dashboard/environments/actions'
import type { Environment } from '@/types/environments'
import { useToast } from '@/components/ToastProvider'

type Props = {
  open: boolean
  onClose: () => void
  searchId: string | null
}

export function SaveToEnvironmentModal({ open, onClose, searchId }: Props) {
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(null)
  const [newEnvName, setNewEnvName] = useState('')
  const [showNewEnv, setShowNewEnv] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  const { error: toastError } = useToast()

  useEffect(() => {
    if (!open) return

    setSuccessMsg('')
    setSelectedEnvId(null)
    setShowNewEnv(false)
    setNewEnvName('')

    setIsLoading(true)
    getEnvironments()
      .then((envs) => {
        setEnvironments(Array.isArray(envs) ? envs : [])
      })
      .catch(() => {
        setEnvironments([])
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [open])

  const handleSave = async () => {
    if (!searchId) {
      toastError('Nessuna ricerca selezionata da salvare', 'Ambienti')
      return
    }

    setIsSaving(true)

    try {
      if (showNewEnv && newEnvName.trim()) {
        const name = newEnvName.trim()
        const result = await createEnvironment({ name, search_ids: [searchId] })
        if (result.success) {
          setSuccessMsg(`Salvato in "${name}"!`)
        } else {
          toastError(result.error || 'Errore durante il salvataggio', 'Ambienti')
        }
      } else if (selectedEnvId) {
        const result = await addSearchesToEnvironment(selectedEnvId, [searchId])
        const envName = environments.find((e) => e.id === selectedEnvId)?.name || ''
        if (result.success) {
          setSuccessMsg(`Salvato in "${envName}"!`)
        } else {
          toastError(result.error || 'Errore durante il salvataggio', 'Ambienti')
        }
      }
    } finally {
      setIsSaving(false)
    }

    if (!successMsg) {
      // If we didn't set successMsg synchronously, don't auto-close.
      return
    }

    window.setTimeout(() => {
      setSuccessMsg('')
      onClose()
    }, 1500)
  }

  useEffect(() => {
    if (!successMsg) return
    const t = window.setTimeout(() => {
      setSuccessMsg('')
      onClose()
    }, 1500)
    return () => window.clearTimeout(t)
  }, [successMsg, onClose])

  const disableSave = isSaving || (!selectedEnvId && !(showNewEnv && newEnvName.trim()))

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Salva i lead in una cartella</DialogTitle>
          <p className="text-sm text-slate-500 mt-1">Scegli dove salvare questi lead per ritrovarli facilmente, esportarli o contattarli in seguito.</p>
        </DialogHeader>

        {successMsg ? (
          <div className="py-8 text-center text-emerald-600 font-medium">{successMsg}</div>
        ) : (
          <div className="space-y-4 mt-4 px-6 pb-6">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
              </div>
            ) : (
              <>
                {environments.length > 0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {environments.map((env) => (
                      <button
                        key={env.id}
                        type="button"
                        onClick={() => {
                          setSelectedEnvId(env.id)
                          setShowNewEnv(false)
                        }}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                          selectedEnvId === env.id
                            ? 'border-purple-500 bg-purple-50'
                            : 'border-gray-200 hover:border-purple-300'
                        }`}
                      >
                        <Folder className="w-4 h-4" style={{ color: env.color }} />
                        <span className="font-medium text-sm">{env.name}</span>
                        <span className="ml-auto text-xs text-gray-400">{env.stats?.total_leads || 0} lead</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-600">Nessun ambiente trovato.</div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setShowNewEnv(true)
                    setSelectedEnvId(null)
                  }}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 border-dashed transition-all ${
                    showNewEnv ? 'border-purple-500 bg-purple-50' : 'border-gray-300 hover:border-purple-400'
                  }`}
                >
                  <Plus className="w-4 h-4 text-purple-600" />
                  <span className="text-sm font-medium text-gray-700">Crea nuova cartella</span>
                </button>

                {showNewEnv ? (
                  <div>
                    <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Nome della cartella</label>
                    <input
                      type="text"
                      placeholder="Es. Clienti Milano, Ristoranti Roma..."
                      value={newEnvName}
                      onChange={(e) => setNewEnvName(e.target.value)}
                      className="w-full border-2 border-purple-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder:text-slate-400"
                      autoFocus
                    />
                    <p className="text-[10px] text-slate-400 mt-1">Scegli un nome che ti aiuti a riconoscere questa lista.</p>
                  </div>
                ) : null}

                <div className="flex gap-3 pt-2">
                  <Button variant="outline" onClick={onClose} className="flex-1">
                    Annulla
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={disableSave}
                    className="flex-1 bg-purple-600 hover:bg-purple-700 font-bold text-sm py-2.5"
                  >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salva i lead'}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
