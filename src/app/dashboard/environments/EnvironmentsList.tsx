'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Environment } from '@/types/environments'
import { Folder, Plus, MoreHorizontal, Trash2, Users, TrendingUp, Mail, Phone, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CreateEnvironmentModal } from './CreateEnvironmentModal'
import { deleteEnvironment, updateEnvironment } from './actions'
import { useToast } from '@/components/ToastProvider'

type Props = {
  environments: Environment[]
}

export function EnvironmentsList({ environments }: Props) {
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [envList, setEnvList] = useState(environments)
  const { success: toastSuccess, error: toastError } = useToast()

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Sei sicuro di voler eliminare l'ambiente "${name}"?`)) return

    const result = await deleteEnvironment(id)
    if (result.success) {
      setEnvList((prev) => prev.filter((e) => e.id !== id))
      toastSuccess('Ambiente eliminato')
    } else {
      toastError(result.error || "Errore durante l'eliminazione")
    }
  }

  const handleEdit = async (id: string, currentName: string) => {
    const nextName = window.prompt('Nuovo nome Ambiente:', currentName)?.trim()
    if (!nextName || nextName === currentName) return

    const result = await updateEnvironment({ id, name: nextName })
    if (result.success && result.environment) {
      setEnvList((prev) => prev.map((e) => (e.id === id ? { ...e, name: nextName } : e)))
      toastSuccess('Ambiente aggiornato')
    } else {
      toastError(result.error || 'Errore durante la modifica')
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="border border-dashed border-slate-300 rounded-lg p-6 hover:border-slate-400 hover:bg-slate-50/70 transition-colors group flex flex-col items-center justify-center min-h-[200px]"
        >
          <div className="w-10 h-10 rounded-md bg-white border border-slate-200 flex items-center justify-center transition-colors">
            <Plus className="w-5 h-5 text-slate-500" strokeWidth={1.75} />
          </div>
          <span className="mt-3 text-sm font-medium text-slate-600 group-hover:text-slate-900">
            Nuovo ambiente
          </span>
        </button>

        {envList.map((env) => (
          <div
            key={env.id}
            className="bg-white border border-slate-200 rounded-lg p-5 hover:border-slate-300 transition-colors relative group"
          >
            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400 hover:text-slate-900 hover:bg-slate-50">
                    <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleEdit(env.id, env.name)}>
                    <Pencil className="mr-2 h-4 w-4" strokeWidth={1.75} />
                    Modifica
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(env.id, env.name)}>
                    <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.75} />
                    Elimina
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <Link href={`/dashboard/environments/${env.id}`}>
              <div className="flex items-start gap-3 mb-4">
                <div
                  className="w-10 h-10 rounded-md flex items-center justify-center border border-slate-200 bg-slate-50"
                >
                  <Folder className="w-5 h-5 text-slate-500" strokeWidth={1.75} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-slate-900 truncate">{env.name}</h3>
                  {env.description && <p className="text-sm text-slate-500 truncate">{env.description}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Users className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
                  <span className="text-slate-600 tabular-nums">{env.stats?.total_leads || 0} lead</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <TrendingUp className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
                  <span className="text-slate-600 tabular-nums">Score: {env.stats?.avg_score || 0}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
                  <span className="text-slate-600 tabular-nums">{env.stats?.leads_with_email || 0} email</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
                  <span className="text-slate-600 tabular-nums">{env.stats?.leads_with_phone || 0} tel</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Aggiornato {new Date(env.updated_at).toLocaleDateString('it-IT')}
                </span>
                <span
                  className="text-xs font-medium px-2 py-1 rounded-md bg-slate-100 text-slate-600 border border-slate-200 tabular-nums"
                >
                  {env.search_ids?.length || 0} ricerche
                </span>
              </div>
            </Link>
          </div>
        ))}
      </div>

      {envList.length === 0 && (
        <div className="text-center py-12">
          <Folder className="w-10 h-10 text-slate-300 mx-auto mb-4" strokeWidth={1.75} />
          <h3 className="text-base font-semibold text-slate-900">Nessun ambiente</h3>
          <p className="text-slate-500 mt-1">Crea il tuo primo ambiente per organizzare i lead</p>
        </div>
      )}

      <CreateEnvironmentModal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={(env) => {
          setEnvList((prev) => [env, ...prev])
          setIsCreateOpen(false)
        }}
      />
    </>
  )
}
