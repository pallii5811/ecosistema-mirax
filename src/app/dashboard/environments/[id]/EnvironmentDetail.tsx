'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Environment, EnvironmentListSummary } from '@/types/environments'
import {
  ArrowLeft,
  Download,
  RefreshCw,
  Users,
  Mail,
  Phone,
  TrendingUp,
  Globe,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { recalculateEnvironmentStats } from '../actions'
import { useToast } from '@/components/ToastProvider'
import { SemanticMap } from './SemanticMap'

type Props = {
  environment: Environment
  initialLeads: any[]
  childLists?: EnvironmentListSummary[]
}

export function EnvironmentDetail({ environment, initialLeads, childLists = [] }: Props) {
  const [leads] = useState(initialLeads)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [stats, setStats] = useState(environment.stats)
  const { success: toastSuccess, error: toastError } = useToast()

  const handleRefreshStats = async () => {
    setIsRefreshing(true)
    const result = await recalculateEnvironmentStats(environment.id)
    setIsRefreshing(false)

    if (result.success && result.stats) {
      setStats(result.stats)
      toastSuccess('Statistiche aggiornate')
    } else {
      toastError(result.error || 'Errore aggiornamento')
    }
  }

  const exportCSV = () => {
    if (leads.length === 0) {
      toastError('Nessun lead da esportare')
      return
    }

    const headers = ['Nome', 'Sito', 'Email', 'Telefono', 'Città', 'Categoria', 'Score']
    const rows = leads.map((l) => [
      l.nome || '',
      l.sito || '',
      l.email || '',
      l.telefono || '',
      l.citta || '',
      l.categoria || '',
      l.score || '',
    ])

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${environment.name.replace(/\s+/g, '_')}_leads.csv`
    link.click()

    toastSuccess('CSV scaricato')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/environments">
          <Button variant="ghost" size="sm" className="text-slate-500 hover:text-slate-900 hover:bg-slate-50">
            <ArrowLeft className="w-4 h-4 mr-2" strokeWidth={1.75} />
            Indietro
          </Button>
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-lg flex items-center justify-center border border-slate-200 bg-white"
          >
            <Users className="w-6 h-6 text-slate-500" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-slate-900">{environment.name}</h1>
            {environment.description && <p className="text-sm text-slate-500 mt-1">{environment.description}</p>}
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRefreshStats} disabled={isRefreshing} className="rounded-md border-slate-200">
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} strokeWidth={1.75} />
            Aggiorna Stats
          </Button>
          <Button onClick={exportCSV} className="rounded-md bg-slate-900 hover:bg-slate-800 text-white">
            <Download className="w-4 h-4 mr-2" strokeWidth={1.75} />
            Esporta CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center gap-2 text-slate-600 text-sm font-semibold mb-2">
            <Users className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
            Lead Totali
          </div>
          <div className="text-2xl font-semibold text-slate-900 tabular-nums">{stats?.total_leads || 0}</div>
          <p className="text-[11px] text-slate-400 mt-1">Numero di aziende in questo ambiente</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center gap-2 text-slate-600 text-sm font-semibold mb-2">
            <TrendingUp className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
            Score Medio
          </div>
          <div className="text-2xl font-semibold text-slate-900 tabular-nums">{stats?.avg_score || 0}<span className="text-base font-medium text-slate-400">/100</span></div>
          <p className="text-[11px] text-slate-400 mt-1">Opportunità media di vendita</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center gap-2 text-slate-600 text-sm font-semibold mb-2">
            <Mail className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
            Con Email
          </div>
          <div className="text-2xl font-semibold text-slate-900 tabular-nums">{stats?.leads_with_email || 0}</div>
          <p className="text-[11px] text-slate-400 mt-1">Lead contattabili via email</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center gap-2 text-slate-600 text-sm font-semibold mb-2">
            <AlertCircle className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
            Senza Pixel
          </div>
          <div className="text-2xl font-semibold text-slate-900 tabular-nums">{stats?.leads_no_pixel || 0}</div>
          <p className="text-[11px] text-slate-400 mt-1">Aziende senza tracking (potenziali clienti)</p>
        </div>
      </div>

      {childLists.length > 0 && (
        <SemanticMap
          envName={environment.name}
          envColor={environment.color}
          totalLeads={stats?.total_leads ?? leads.length}
          lists={childLists}
        />
      )}

      {childLists.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">Sotto-ricerche in questo Ambiente</h2>
          <p className="text-xs text-slate-500 mb-4">
            Ogni lista salvata qui rappresenta una ricerca correlata (es. stessa categoria, città diverse).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {childLists.map((list) => (
              <Link
                key={list.id}
                href={`/dashboard/leads?list=${list.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 hover:border-violet-300 hover:bg-violet-50/40 transition-colors no-underline"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate">{list.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {new Date(list.created_at).toLocaleDateString('it-IT')}
                  </div>
                </div>
                <span className="text-sm font-semibold text-violet-700 tabular-nums">{list.leadsCount} lead</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left p-4 font-semibold text-slate-500 text-xs uppercase tracking-wider">Nome</th>
                <th className="text-left p-4 font-semibold text-slate-500 text-xs uppercase tracking-wider">Contatti</th>
                <th className="text-left p-4 font-semibold text-slate-500 text-xs uppercase tracking-wider">Città</th>
                <th className="text-left p-4 font-semibold text-slate-500 text-xs uppercase tracking-wider">Categoria</th>
                <th className="text-left p-4 font-semibold text-slate-500 text-xs uppercase tracking-wider">Score</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead, idx) => (
                <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50/70 transition-colors">
                  <td className="p-4">
                    <div className="font-medium text-slate-900">{lead.nome}</div>
                    {lead.sito ? (
                      <a
                        href={lead.sito}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-slate-500 hover:text-slate-900 flex items-center gap-1 transition-colors"
                      >
                        <Globe className="w-3 h-3" strokeWidth={1.75} />
                        {(() => {
                          try {
                            return new URL(lead.sito).hostname
                          } catch {
                            return String(lead.sito)
                          }
                        })()}
                      </a>
                    ) : null}
                  </td>
                  <td className="p-4">
                    {lead.email ? (
                      <div className="flex items-center gap-1 text-sm text-slate-700">
                        <Mail className="w-3 h-3 text-slate-400" strokeWidth={1.75} />
                        {lead.email}
                      </div>
                    ) : null}
                    {lead.telefono ? (
                      <div className="flex items-center gap-1 text-sm text-slate-700">
                        <Phone className="w-3 h-3 text-slate-400" strokeWidth={1.75} />
                        {lead.telefono}
                      </div>
                    ) : null}
                  </td>
                  <td className="p-4 text-sm text-slate-700">{lead.citta || '-'}</td>
                  <td className="p-4 text-sm text-slate-700">{lead.categoria || '-'}</td>
                  <td className="p-4">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border tabular-nums ${
                        (lead.score || 0) >= 70
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : (lead.score || 0) >= 40
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                    >
                      {lead.score || 0}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {leads.length === 0 && (
          <div className="p-12 text-center">
            <Users className="w-10 h-10 text-slate-300 mx-auto mb-4" strokeWidth={1.75} />
            <h3 className="text-base font-semibold text-slate-900">Nessun lead</h3>
            <p className="text-slate-500 mt-1">Aggiungi ricerche a questo ambiente per vedere i lead</p>
          </div>
        )}
      </div>
    </div>
  )
}
