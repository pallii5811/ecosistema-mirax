'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, XCircle, Loader2, RefreshCw, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Entry = {
  id: string
  integration_id: string
  lead_website: string | null
  lead_nome: string | null
  status: 'success' | 'error' | string
  error_message: string | null
  created_at: string
}

export default function CrmHistoryPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/sync-history?limit=100', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Errore caricamento')
      setEntries(Array.isArray(data?.entries) ? data.entries : [])
      setTotal(typeof data?.total === 'number' ? data.total : 0)
    } catch (e: any) {
      setError(e?.message || 'Errore')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const exportCsv = () => {
    if (entries.length === 0) return
    const headers = ['Data', 'Lead', 'Sito', 'Stato', 'Errore']
    const rows = entries.map((e) =>
      [
        new Date(e.created_at).toLocaleString('it-IT'),
        e.lead_nome || '',
        e.lead_website || '',
        e.status,
        e.error_message || '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    )
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mirax_crm_history_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const successCount = entries.filter((e) => e.status === 'success').length
  const errorCount = entries.filter((e) => e.status === 'error').length
  const successRate = entries.length > 0 ? Math.round((successCount / entries.length) * 100) : 0

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <Link
          href="/dashboard/integrations/crm"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-violet-600 transition mb-3"
        >
          <ArrowLeft className="w-4 h-4" /> Torna alle integrazioni
        </Link>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Cronologia sync CRM</h1>
            <p className="text-sm text-slate-500 mt-1">
              Ogni invio al CRM (riuscito o fallito) è tracciato qui per audit e diagnostica.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              disabled={loading}
              className="rounded-xl border-slate-200"
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
              Aggiorna
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={loading || entries.length === 0}
              className="rounded-xl border-slate-200"
            >
              <Download className="w-4 h-4 mr-1" />
              Esporta CSV
            </Button>
          </div>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500 mb-1">Totale</div>
          <div className="text-2xl font-bold text-slate-900">{total.toLocaleString('it-IT')}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-medium text-emerald-600 mb-1">Successi</div>
          <div className="text-2xl font-bold text-emerald-700">{successCount.toLocaleString('it-IT')}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-medium text-red-500 mb-1">Errori</div>
          <div className="text-2xl font-bold text-red-600">{errorCount.toLocaleString('it-IT')}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-medium text-violet-600 mb-1">Success rate</div>
          <div className="text-2xl font-bold text-violet-700">{successRate}%</div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
          </div>
        ) : entries.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">
            Nessun invio registrato. Manda il tuo primo lead al CRM dalla tabella risultati per vederlo qui.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Lead</th>
                  <th className="px-4 py-3">Sito</th>
                  <th className="px-4 py-3">Stato</th>
                  <th className="px-4 py-3">Dettagli</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap text-xs">
                      {new Date(e.created_at).toLocaleString('it-IT')}
                    </td>
                    <td className="px-4 py-3 text-slate-900 font-medium">{e.lead_nome || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{e.lead_website || '—'}</td>
                    <td className="px-4 py-3">
                      {e.status === 'success' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 text-xs px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" /> Successo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-600 bg-red-50 border border-red-200 text-xs px-2 py-0.5 rounded-full">
                          <XCircle className="w-3 h-3" /> Errore
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-md">
                      {e.error_message ? <span className="text-red-500">{e.error_message}</span> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
