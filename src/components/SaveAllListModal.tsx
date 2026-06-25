'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Folder, Plus, CheckCircle2, ListPlus } from 'lucide-react'
import { getEnvironments } from '@/app/dashboard/environments/actions'
import type { Environment } from '@/types/environments'
import { useToast } from '@/components/ToastProvider'

type Props = {
  open: boolean
  onClose: () => void
  /** The full, currently visible results list to save. */
  leads: unknown[]
  /** Optional search query, used as default list name suggestion. */
  defaultName?: string
  /** When set, new leads are appended to this existing list. */
  mergeIntoListId?: string | null
}

type Step = 'name' | 'environment' | 'done'

function compactLeadForSave(lead: unknown) {
  const obj = lead && typeof lead === 'object' ? (lead as Record<string, unknown>) : {}
  const report = obj.technical_report && typeof obj.technical_report === 'object' ? (obj.technical_report as Record<string, unknown>) : null

  return {
    name: obj.name ?? obj.nome ?? obj.azienda ?? obj.company ?? null,
    website: obj.website ?? obj.sito ?? obj.url ?? null,
    email: obj.email ?? obj.mail ?? null,
    phone: obj.phone ?? obj.telefono ?? null,
    city: obj.city ?? obj.citta ?? null,
    category: obj.category ?? obj.categoria ?? null,
    score: obj.score ?? obj.opportunity_score ?? null,
    rating: obj.rating ?? null,
    instagram: obj.instagram ?? obj.ig ?? obj.instagram_url ?? obj.instagramUrl ?? null,
    facebook: obj.facebook ?? obj.fb ?? obj.facebook_url ?? obj.facebookUrl ?? null,
    tech_stack: Array.isArray(obj.tech_stack) ? obj.tech_stack.slice(0, 30) : [],
    meta_pixel: obj.meta_pixel ?? null,
    google_tag_manager: obj.google_tag_manager ?? null,
    ssl: obj.ssl ?? null,
    is_claimed: obj.is_claimed ?? null,
    mobile_friendly: obj.mobile_friendly ?? obj.is_mobile_friendly ?? null,
    technical_report: report
      ? {
          mobile_friendly: report.mobile_friendly ?? null,
          load_speed_s: report.load_speed_s ?? null,
          load_speed_seconds: report.load_speed_seconds ?? null,
          has_google_ads: report.has_google_ads ?? null,
          has_ga4: report.has_ga4 ?? null,
          seo_disaster: report.seo_disaster ?? null,
          has_dmarc: report.has_dmarc ?? null,
          has_spf: report.has_spf ?? null,
        }
      : null,
  }
}

export function SaveAllListModal({ open, onClose, leads, defaultName, mergeIntoListId }: Props) {
  const [step, setStep] = useState<Step>('name')
  const [listName, setListName] = useState('')
  const [description, setDescription] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const [createdListId, setCreatedListId] = useState<string | null>(null)

  const [environments, setEnvironments] = useState<Environment[]>([])
  const [isLoadingEnvs, setIsLoadingEnvs] = useState(false)
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(null)
  const [newEnvName, setNewEnvName] = useState('')
  const [showNewEnv, setShowNewEnv] = useState(false)
  const [isAttaching, setIsAttaching] = useState(false)
  const [attachedEnvName, setAttachedEnvName] = useState<string | null>(null)

  const { error: toastError, success: toastSuccess } = useToast()

  // Reset on open/close.
  useEffect(() => {
    if (!open) return
    setStep('name')
    setListName(defaultName?.trim() || '')
    setDescription('')
    setCreatedListId(null)
    setSelectedEnvId(null)
    setNewEnvName('')
    setShowNewEnv(false)
    setAttachedEnvName(null)
  }, [open, defaultName])

  // Load environments when entering env step.
  useEffect(() => {
    if (step !== 'environment') return
    setIsLoadingEnvs(true)
    getEnvironments()
      .then((envs) => setEnvironments(Array.isArray(envs) ? envs : []))
      .catch(() => setEnvironments([]))
      .finally(() => setIsLoadingEnvs(false))
  }, [step])

  const handleCreateList = async () => {
    const name = listName.trim()
    if (!name) {
      toastError('Inserisci un nome per la lista', 'Lista')
      return
    }
    if (!Array.isArray(leads) || leads.length === 0) {
      toastError('Nessun lead da salvare', 'Lista')
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch('/api/lists/bulk-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description.trim() || undefined,
          leads: leads.map(compactLeadForSave),
          mergeIntoListId: mergeIntoListId || undefined,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Errore creazione lista')
      }
      setCreatedListId(data.listId)
      const added = typeof data.leadsAdded === 'number' ? data.leadsAdded : data.leadsInserted
      const verb = data.merged ? 'aggiornata' : 'creata'
      toastSuccess(`Lista "${name}" ${verb} — ${added} lead aggiunti`, 'Lista salvata')
      setStep('environment')
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Errore sconosciuto', 'Lista')
    } finally {
      setIsSaving(false)
    }
  }

  const handleAttachEnvironment = async () => {
    if (!createdListId) return

    const useExisting = !showNewEnv && selectedEnvId
    const useNew = showNewEnv && newEnvName.trim()
    if (!useExisting && !useNew) {
      toastError('Scegli un ambiente o creane uno nuovo', 'Ambiente')
      return
    }

    setIsAttaching(true)
    try {
      // We reuse the bulk-save endpoint isn't needed here — we just want to attach.
      // Simpler: PATCH /api/lists/:id with environmentId. For now, reuse bulk-save logic by creating
      // a dedicated tiny endpoint: /api/lists/:id/environment. (Implemented below.)
      const body: Record<string, unknown> = {}
      if (useExisting) body.environmentId = selectedEnvId
      if (useNew) body.environmentName = newEnvName.trim()

      const res = await fetch(`/api/lists/${createdListId}/environment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Errore collegamento ambiente')
      }

      const envName = (useNew ? newEnvName.trim() : environments.find((e) => e.id === selectedEnvId)?.name) || ''
      setAttachedEnvName(envName)
      toastSuccess(`Lista collegata all'ambiente "${envName}"`, 'Ambiente')
      setStep('done')
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Errore sconosciuto', 'Ambiente')
    } finally {
      setIsAttaching(false)
    }
  }

  const handleSkipEnvironment = () => {
    setStep('done')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent>
        {/* Step 1 — name the list */}
        {step === 'name' && (
          <>
            <DialogHeader>
              <DialogTitle>
                <span className="flex items-center gap-2">
                  <ListPlus className="w-5 h-5 text-violet-600" />
                  Salva tutta la lista
                </span>
              </DialogTitle>
              <DialogDescription>
                Stai salvando <strong>{leads.length}</strong> lead.
                {mergeIntoListId
                  ? <> I nuovi lead verranno <strong>aggiunti alla lista esistente</strong> (senza duplicati).</>
                  : <> Dai un nome alla lista — se esiste già una lista con lo stesso nome, verrà <strong>aggiornata</strong> automaticamente.</>}
              </DialogDescription>
            </DialogHeader>

            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">
                  Nome lista
                </label>
                <input
                  type="text"
                  value={listName}
                  onChange={(e) => setListName(e.target.value)}
                  placeholder="Es. Ristoranti Milano"
                  className="w-full border-2 border-violet-300 rounded-lg px-3 py-2.5 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder:text-slate-400"
                  autoFocus
                  disabled={isSaving}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isSaving) handleCreateList()
                  }}
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">
                  Descrizione (opzionale)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Es. Ricerca del 24/04, categoria ristorazione"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300 placeholder:text-slate-400"
                  disabled={isSaving}
                />
              </div>
            </div>

            <div className="flex gap-3 px-6 pb-6">
              <Button variant="outline" onClick={onClose} className="flex-1" disabled={isSaving}>
                Annulla
              </Button>
              <Button
                onClick={handleCreateList}
                disabled={isSaving || !listName.trim()}
                className="flex-1 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white font-bold"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Crea lista'}
              </Button>
            </div>
          </>
        )}

        {/* Step 2 — (optional) attach to environment */}
        {step === 'environment' && (
          <>
            <DialogHeader>
              <DialogTitle>
                <span className="flex items-center gap-2">
                  <Folder className="w-5 h-5 text-fuchsia-600" />
                  Salva anche in un Ambiente?
                </span>
              </DialogTitle>
              <DialogDescription>
                Vuoi raggruppare questa lista dentro un <strong>Ambiente</strong>? (es. <em>Eventi</em> → PR, catering, location).
                Puoi anche farlo dopo da <strong>Le mie Liste</strong>.
              </DialogDescription>
            </DialogHeader>

            <div className="px-6 py-4 space-y-3">
              {isLoadingEnvs ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-violet-600" />
                </div>
              ) : (
                <>
                  {environments.length > 0 && (
                    <div className="space-y-2 max-h-52 overflow-y-auto">
                      {environments.map((env) => (
                        <button
                          key={env.id}
                          type="button"
                          onClick={() => {
                            setSelectedEnvId(env.id)
                            setShowNewEnv(false)
                          }}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left text-slate-900 ${
                            selectedEnvId === env.id
                              ? 'border-violet-500 bg-violet-50'
                              : 'border-gray-200 hover:border-violet-300 bg-white'
                          }`}
                          disabled={isAttaching}
                        >
                          <Folder className="w-4 h-4" style={{ color: env.color }} />
                          <span className="font-medium text-sm text-slate-900">{env.name}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setShowNewEnv(true)
                      setSelectedEnvId(null)
                    }}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 border-dashed transition-all ${
                      showNewEnv ? 'border-violet-500 bg-violet-50' : 'border-gray-300 hover:border-violet-400'
                    }`}
                    disabled={isAttaching}
                  >
                    <Plus className="w-4 h-4 text-violet-600" />
                    <span className="text-sm font-medium text-gray-700">Crea nuovo ambiente</span>
                  </button>

                  {showNewEnv && (
                    <div>
                      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">
                        Nome ambiente
                      </label>
                      <input
                        type="text"
                        placeholder="Es. Ristorazione, Comunicazione..."
                        value={newEnvName}
                        onChange={(e) => setNewEnvName(e.target.value)}
                        className="w-full border-2 border-violet-300 rounded-lg px-3 py-2.5 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder:text-slate-400"
                        autoFocus
                        disabled={isAttaching}
                      />
                      <p className="text-[10px] text-slate-400 mt-1">
                        L'Ambiente apparirà nella sidebar sotto <strong>Ambiente</strong>.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex gap-3 px-6 pb-6">
              <Button
                variant="outline"
                onClick={handleSkipEnvironment}
                className="flex-1"
                disabled={isAttaching}
              >
                Salta — salva solo la lista
              </Button>
              <Button
                onClick={handleAttachEnvironment}
                disabled={
                  isAttaching ||
                  (!selectedEnvId && !(showNewEnv && newEnvName.trim()))
                }
                className="flex-1 bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-700 hover:to-violet-700 text-white font-bold"
              >
                {isAttaching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salva in ambiente'}
              </Button>
            </div>
          </>
        )}

        {/* Step 3 — done */}
        {step === 'done' && (
          <>
            <DialogHeader>
              <DialogTitle>
                <span className="flex items-center gap-2 text-emerald-700">
                  <CheckCircle2 className="w-5 h-5" />
                  Fatto!
                </span>
              </DialogTitle>
              <DialogDescription>
                Lista <strong>{listName}</strong> salvata{attachedEnvName ? (
                  <> nell'ambiente <strong>{attachedEnvName}</strong></>
                ) : null}.
              </DialogDescription>
            </DialogHeader>

            <div className="px-6 py-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                Trovi la tua lista nella sezione <strong>Le mie Liste</strong>.
                {attachedEnvName && (
                  <> L'Ambiente <strong>{attachedEnvName}</strong> è ora visibile nella sidebar sotto <strong>Ambiente</strong>.</>
                )}
              </div>
            </div>

            <div className="flex gap-3 px-6 pb-6">
              <Button variant="outline" onClick={onClose} className="flex-1">
                Chiudi
              </Button>
              <Link href="/dashboard/leads" className="flex-1 no-underline">
                <Button className="w-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white font-bold">
                  Vai alle mie liste
                </Button>
              </Link>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
