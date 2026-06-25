"use client"

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowUpRight,
  CheckSquare,
  Download,
  Eye,
  ListPlus,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Radar,
  RefreshCw,
  Send,
  ShieldCheck,
  Square,
  Star,
  Tag,
  Trash2,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { OutreachLauncher } from '@/components/OutreachLauncher'
import { useOutreachStatus } from '@/hooks/useOutreachStatus'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'

type Lead = {
  id: string
  name: string | null
  website: string | null
  email: string | null
  phone: string | null
  city: string | null
  category: string | null
  score: number | null
  raw: Record<string, unknown> | null
  created_at: string
}

// Extract opportunity badges (no pixel, no gtm, no ssl, etc.) from the stored `raw` payload.
function getOpportunityBadges(raw: Record<string, unknown> | null | undefined) {
  if (!raw || typeof raw !== 'object') return [] as Array<{ label: string; tone: 'critical' | 'warn' | 'info' }>

  const obj = raw as any
  const techStack = Array.isArray(obj.tech_stack) ? obj.tech_stack.filter((v: unknown) => typeof v === 'string') : []
  const stackStr = (techStack as string[]).join(' ').toLowerCase()
  const report = obj.technical_report && typeof obj.technical_report === 'object' ? obj.technical_report : null

  const site = typeof obj.sito === 'string' ? obj.sito : typeof obj.website === 'string' ? obj.website : ''
  const metaPixel = obj.meta_pixel
  const gtm = obj.google_tag_manager
  const ssl = obj.ssl
  const isClaimed = obj.is_claimed
  const instagram = typeof obj.instagram === 'string' ? obj.instagram : ''
  const facebook = typeof obj.facebook === 'string' ? obj.facebook : ''
  const mobileFriendly = obj.mobile_friendly ?? obj.is_mobile_friendly ?? report?.mobile_friendly
  const loadSpeed =
    typeof report?.load_speed_s === 'number'
      ? report.load_speed_s
      : typeof report?.load_speed_seconds === 'number'
        ? report.load_speed_seconds
        : null

  const out: Array<{ label: string; tone: 'critical' | 'warn' | 'info' }> = []
  if (!site?.trim() || stackStr.includes('no website')) out.push({ label: 'Senza sito', tone: 'critical' })
  if (metaPixel !== true || stackStr.includes('no pixel') || stackStr.includes('missing fb pixel')) out.push({ label: 'No Pixel', tone: 'critical' })
  if (gtm !== true || stackStr.includes('no gtm') || stackStr.includes('missing gtm')) out.push({ label: 'No GTM', tone: 'critical' })
  if (report?.has_google_ads === false || stackStr.includes('no google ads') || stackStr.includes('no ads')) out.push({ label: 'No Google Ads', tone: 'critical' })
  if (report?.has_ga4 === false || stackStr.includes('no ga4') || stackStr.includes('no analytics')) out.push({ label: 'No GA4', tone: 'critical' })
  if (ssl === false || stackStr.includes('no ssl') || stackStr.includes('missing ssl')) out.push({ label: 'No SSL', tone: 'warn' })
  if (mobileFriendly === false || stackStr.includes('no mobile') || stackStr.includes('not mobile friendly')) out.push({ label: 'No Mobile', tone: 'warn' })
  if (typeof loadSpeed === 'number' && loadSpeed > 3) out.push({ label: `Lento ${loadSpeed.toFixed(1)}s`, tone: 'warn' })
  if (report?.seo_disaster === true || stackStr.includes('disastro seo')) out.push({ label: 'Errori SEO', tone: 'critical' })
  if (report?.has_dmarc === false || report?.has_spf === false) out.push({ label: 'Rischio Spam', tone: 'critical' })
  if (isClaimed === false) out.push({ label: 'Profilo non rivendicato', tone: 'warn' })
  if (!instagram.trim()) out.push({ label: 'No Instagram', tone: 'info' })
  if (!facebook.trim()) out.push({ label: 'No Facebook', tone: 'info' })

  return out
}

function toneClass(tone: 'critical' | 'warn' | 'info') {
  if (tone === 'critical') return 'bg-red-100 text-red-700 border-red-200'
  if (tone === 'warn') return 'bg-amber-100 text-amber-800 border-amber-200'
  return 'bg-slate-100 text-slate-700 border-slate-200'
}

type DomainList = {
  id: string
  name: string
  description: string | null
  created_at: string
  leadsCount?: number
  avgScore?: number
}

function StatPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-50 text-slate-500 border border-slate-200">
        {icon}
      </div>
      <div>
        <div className="text-[11px] font-semibold tracking-wide text-slate-500">{label}</div>
        <div className="text-lg font-semibold text-slate-900 leading-tight tabular-nums">{value}</div>
      </div>
    </div>
  )
}

function scoreTone(score: number) {
  if (score >= 85) return 'bg-emerald-500'
  if (score >= 65) return 'bg-amber-500'
  return 'bg-slate-300'
}

type ActiveCRM = { id: string; type: string; name?: string } | null

function isEmailString(s: string | null | undefined) {
  if (!s) return false
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(s)
}

export default function LeadsPage() {
  const outreach = useOutreachStatus()
  const [lists, setLists] = useState<DomainList[]>([])
  const [totalLeads, setTotalLeads] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewListId, setViewListId] = useState<string | null>(null)
  const [viewListName, setViewListName] = useState('')
  const [viewLeads, setViewLeads] = useState<Lead[]>([])
  const [viewLoading, setViewLoading] = useState(false)

  // Bulk CRM sync state
  const [activeCRM, setActiveCRM] = useState<ActiveCRM>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [sendingBulk, setSendingBulk] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ success: number; failed: number; total: number } | null>(null)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [deletingListId, setDeletingListId] = useState<string | null>(null)

  const openListView = useCallback(async (listId: string, listName: string) => {
    setViewListId(listId)
    setViewListName(listName)
    setViewLeads([])
    setSelectedIds(new Set())
    setBulkResult(null)
    setBulkError(null)
    setViewLoading(true)
    try {
      const [leadsRes, crmRes] = await Promise.all([
        fetch(`/api/lists/${listId}/leads`, { cache: 'no-store' }),
        fetch('/api/crm/active', { cache: 'no-store' }),
      ])
      const leadsData = await leadsRes.json().catch(() => null)
      const crmData = await crmRes.json().catch(() => null)
      setViewLeads(Array.isArray(leadsData?.leads) ? leadsData.leads : [])
      setActiveCRM(crmData?.integration || null)
    } catch {
      /* */
    }
    setViewLoading(false)
  }, [])

  const toggleSelect = useCallback((leadId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(leadId)) next.delete(leadId)
      else next.add(leadId)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === viewLeads.length) return new Set()
      return new Set(viewLeads.map((l) => l.id))
    })
  }, [viewLeads])

  const sendBulkToCRM = useCallback(async () => {
    if (!activeCRM || selectedIds.size === 0) return
    setSendingBulk(true)
    setBulkResult(null)
    setBulkError(null)
    try {
      const chosen = viewLeads.filter((l) => selectedIds.has(l.id))
      // HubSpot/webhook bulk limit = 100
      const chunks: Lead[][] = []
      for (let i = 0; i < chosen.length; i += 100) chunks.push(chosen.slice(i, i + 100))

      let totalSuccess = 0
      let totalFailed = 0
      let totalCount = 0

      for (const chunk of chunks) {
        const payload = chunk.map((l) => ({
          nome: l.name,
          sito: l.website,
          email: l.email,
          telefono: l.phone,
          citta: l.city,
          categoria: l.category,
          score: l.score,
          ...((l.raw && typeof l.raw === 'object') ? l.raw : {}),
        }))

        const res = await fetch('/api/crm/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ integrationId: activeCRM.id, leads: payload }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || 'Errore invio bulk')
        }
        totalSuccess += typeof data?.success === 'number' ? data.success : 0
        totalFailed += typeof data?.failed === 'number' ? data.failed : 0
        totalCount += typeof data?.total === 'number' ? data.total : 0
      }

      setBulkResult({ success: totalSuccess, failed: totalFailed, total: totalCount })
      if (totalSuccess > 0) setSelectedIds(new Set())
    } catch (e: any) {
      setBulkError(e?.message || 'Errore di rete')
    } finally {
      setSendingBulk(false)
    }
  }, [activeCRM, selectedIds, viewLeads])

  const renameList = useCallback(async (listId: string, currentName: string) => {
    const nextName = window.prompt('Nuovo nome della lista:', currentName)?.trim()
    if (!nextName || nextName === currentName) return

    try {
      const res = await fetch(`/api/lists/${listId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Errore durante la rinomina della lista.')
      }
      setLists((prev) => prev.map((l) => (l.id === listId ? { ...l, name: nextName } : l)))
      if (viewListId === listId) setViewListName(nextName)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore durante la rinomina.')
    }
  }, [viewListId])

  const deleteList = useCallback(async (listId: string, listName: string) => {
    const confirmed = window.confirm(
      `Eliminare la lista "${listName}"?\n\nI lead restano nel tuo account se presenti in altre liste.`
    )
    if (!confirmed) return

    setDeletingListId(listId)
    setError(null)
    try {
      const res = await fetch(`/api/lists/${listId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Errore durante l\'eliminazione della lista.')
      }

      setLists((prev) => {
        const removed = prev.find((l) => l.id === listId)
        const removedCount = removed?.leadsCount
        if (typeof removedCount === 'number') {
          setTotalLeads((total) => Math.max(0, total - removedCount))
        }
        return prev.filter((l) => l.id !== listId)
      })

      if (viewListId === listId) {
        setViewListId(null)
        setViewListName('')
        setViewLeads([])
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Errore durante l\'eliminazione.'
      setError(raw)
    } finally {
      setDeletingListId(null)
    }
  }, [viewListId])

  const exportCsv = useCallback(async (listId: string, listName: string) => {
    try {
      const res = await fetch(`/api/lists/${listId}/leads`, { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      const leads: Lead[] = Array.isArray(data?.leads) ? data.leads : []
      if (leads.length === 0) { alert('Nessun lead da esportare.'); return }
      const headers = ['Nome', 'Email', 'Telefono', 'Sito', 'Città', 'Categoria', 'Score']
      const rows = leads.map(l => [
        l.name || '', l.email || '', l.phone || '', l.website || '',
        l.city || '', l.category || '', l.score ?? ''
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      const csv = [headers.join(','), ...rows].join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${listName.replace(/[^a-zA-Z0-9]/g, '_')}_leads.csv`
      a.click(); URL.revokeObjectURL(url)
    } catch { alert('Errore durante l\'esportazione.') }
  }, [])

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      setError(null)

      try {
        const res = await fetch('/api/lists/stats', { cache: 'no-store' })
        const data = (await res.json().catch(() => null)) as { lists?: DomainList[]; totalLeads?: number; error?: string } | null

        if (!res.ok) {
          throw new Error(data?.error || 'Impossibile caricare le liste.')
        }

        setLists(Array.isArray(data?.lists) ? data!.lists! : [])
        setTotalLeads(typeof data?.totalLeads === 'number' ? data!.totalLeads! : 0)
      } catch (e) {
        const raw = e instanceof Error ? e.message : 'Errore durante il caricamento.'
        setError(raw)
      } finally {
        setLoading(false)
      }
    }

    run()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const listId = params.get('list')
    if (!listId || lists.length === 0) return
    const match = lists.find((l) => l.id === listId)
    if (match) openListView(match.id, match.name)
  }, [lists, openListView])

  const activeLists = lists.length

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xl md:text-2xl font-semibold tracking-tight text-slate-900">Le mie liste</div>
          <div className="mt-1 text-sm text-slate-600">
            Organizza il tuo territorio. Ogni lista è un modulo del tuo ecosistema di vendita automatizzato.
          </div>
        </div>

        <Button
          type="button"
          className="h-10 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm transition-colors"
          onClick={() => {
            window.location.href = '/dashboard'
          }}
        >
          <ListPlus className="mr-2 h-4 w-4" strokeWidth={1.75} />
          Crea nuova lista
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatPill icon={<Users className="h-5 w-5" />} label="Totale Lead Salvati" value={totalLeads.toLocaleString('it-IT')} />
        <StatPill icon={<Radar className="h-5 w-5" />} label="Liste Attive" value={activeLists.toLocaleString('it-IT')} />
        <StatPill
          icon={<ShieldCheck className="h-5 w-5" />}
          label="Email Verificate"
          value="—"
        />
      </div>

      {error ? (
        <Card className="rounded-lg border border-red-200 bg-red-50 p-5">
          <div className="text-sm font-semibold text-red-700">{error}</div>
        </Card>
      ) : null}

      {loading ? (
        <Card className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="text-sm text-slate-500">Caricamento liste…</div>
        </Card>
      ) : null}

      {!loading && lists.length === 0 ? (
        <Card className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-10">
          <div className="relative mx-auto flex max-w-xl flex-col items-center text-center">
            <div className="relative mb-6">
              <div className="h-16 w-16 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center">
                <Radar className="h-7 w-7 text-slate-400" strokeWidth={1.75} />
              </div>
            </div>
            <div className="text-xl font-semibold text-slate-900">Ancora nessuna lista salvata</div>
            <div className="mt-2 text-sm text-slate-500">
              Inizia una scansione e salva i tuoi primi lead per vederli apparire qui.
            </div>

            <Button asChild className="mt-6 h-10 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-medium">
              <Link href="/dashboard">
                Vai alla ricerca <ArrowUpRight className="ml-2 h-4 w-4" strokeWidth={1.75} />
              </Link>
            </Button>
          </div>
        </Card>
      ) : !loading ? (
        <div className="space-y-3">
          {lists.map((list) => (
            <Card
              key={list.id}
              className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white p-5 transition-colors duration-150 hover:border-slate-300"
            >
              <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="truncate text-base font-semibold text-slate-900">{list.name}</div>
                    {list.description ? (
                      <Badge className="bg-slate-100 text-slate-600 border border-slate-200">{list.description}</Badge>
                    ) : null}
                    <div className="ml-auto md:ml-0 flex items-center">
                      <div className="flex h-8 min-w-8 px-2 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700 tabular-nums">
                        {typeof list.leadsCount === 'number' ? list.leadsCount : '—'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-[11px] font-semibold tracking-wide text-slate-500">Media Nexa Score</div>
                      <div className="mt-2 flex items-center gap-3">
                        <Progress value={list.avgScore ?? 0} className="h-2 bg-slate-200" />
                        <div className="text-xs font-semibold text-slate-700 w-10 text-right tabular-nums">{typeof list.avgScore === 'number' && list.avgScore > 0 ? list.avgScore : '—'}</div>
                      </div>
                      <div className={`mt-2 h-1 w-full rounded-full ${scoreTone(list.avgScore ?? 0)} opacity-70`} />
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 md:col-span-2">
                      <div className="text-[11px] font-semibold tracking-wide text-slate-500">
                        Creato: {new Date(list.created_at).toLocaleDateString('it-IT')}
                      </div>
                      <div className="mt-2 text-xs text-slate-400">
                        Azioni rapide: visualizza, esporta o invia la lista direttamente alle integrazioni attive.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 md:pl-6">
                  <button
                    type="button"
                    className="h-9 px-3 rounded-md border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors text-xs font-semibold inline-flex items-center gap-1.5"
                    title="Aggiorna lista con una nuova ricerca"
                    onClick={() => {
                      window.location.href = `/dashboard?updateList=${encodeURIComponent(list.id)}&listName=${encodeURIComponent(list.name)}`
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Aggiorna
                  </button>
                  <button
                    type="button"
                    className="h-9 w-9 rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                    title="Rinomina lista"
                    onClick={() => renameList(list.id, list.name)}
                  >
                    <Pencil className="mx-auto h-4 w-4" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    className="h-9 w-9 rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                    title="Visualizza lead"
                    onClick={() => openListView(list.id, list.name)}
                  >
                    <Eye className="mx-auto h-4 w-4" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    className="h-9 w-9 rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                    title="Esporta CSV"
                    onClick={() => exportCsv(list.id, list.name)}
                  >
                    <Download className="mx-auto h-4 w-4" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    className="h-9 w-9 rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                    title="Integrazioni"
                    onClick={() => { window.location.href = '/dashboard/integrations' }}
                  >
                    <Zap className="mx-auto h-4 w-4" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    className="h-9 w-9 rounded-md border border-red-200 bg-white text-red-500 hover:bg-red-50 hover:text-red-700 transition-colors disabled:opacity-50"
                    title="Elimina lista"
                    disabled={deletingListId === list.id}
                    onClick={() => deleteList(list.id, list.name)}
                  >
                    {deletingListId === list.id ? (
                      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mx-auto h-4 w-4" strokeWidth={1.75} />
                    )}
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {viewListId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm p-4"
          onClick={() => setViewListId(null)}
        >
          <div
            className="relative w-full max-w-5xl max-h-[88vh] overflow-hidden rounded-lg bg-white shadow-xl border border-slate-200 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-base font-semibold text-slate-900 truncate">{viewListName}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {viewLoading
                    ? 'Caricamento…'
                    : selectedIds.size > 0
                      ? `${selectedIds.size} di ${viewLeads.length} selezionati`
                      : `${viewLeads.length} lead nella lista`}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {viewLeads.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-white border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                    title={selectedIds.size === viewLeads.length ? 'Deseleziona tutti' : 'Seleziona tutti'}
                  >
                    {selectedIds.size === viewLeads.length && viewLeads.length > 0 ? (
                      <CheckSquare className="h-4 w-4 text-slate-900" strokeWidth={1.75} />
                    ) : (
                      <Square className="h-4 w-4" strokeWidth={1.75} />
                    )}
                    {selectedIds.size === viewLeads.length && viewLeads.length > 0 ? 'Deseleziona tutti' : 'Seleziona tutti'}
                  </button>
                )}
                {activeCRM && selectedIds.size > 0 && (
                  <button
                    type="button"
                    onClick={sendBulkToCRM}
                    disabled={sendingBulk}
                    className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium shadow-sm disabled:opacity-50 transition-colors"
                    title={`Invia ${selectedIds.size} lead al CRM (${activeCRM.type})`}
                  >
                    {sendingBulk ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" strokeWidth={1.75} />}
                    Invia {selectedIds.size} al CRM
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => exportCsv(viewListId!, viewListName)}
                  className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-white border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  title="Esporta CSV"
                >
                  <Download className="h-4 w-4" strokeWidth={1.75} />
                  Esporta CSV
                </button>
                <button
                  type="button"
                  onClick={() => setViewListId(null)}
                  className="h-9 w-9 rounded-md bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center transition-colors"
                  title="Chiudi"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {(bulkResult || bulkError) && (
              <div className="px-6 py-3 border-b border-slate-200 bg-slate-50">
                {bulkError && (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {bulkError}
                  </div>
                )}
                {bulkResult && (
                  <div
                    className={`text-sm rounded-lg px-3 py-2 border ${
                      bulkResult.failed === 0
                        ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                        : 'text-amber-700 bg-amber-50 border-amber-200'
                    }`}
                  >
                    Invio completato: <strong>{bulkResult.success}</strong> riusciti su {bulkResult.total}.
                    {bulkResult.failed > 0 ? ` ${bulkResult.failed} falliti (vedi cronologia).` : ''}
                  </div>
                )}
              </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
              {viewLoading ? (
                <div className="text-sm text-slate-500 text-center py-10">Caricamento lead…</div>
              ) : viewLeads.length === 0 ? (
                <div className="text-sm text-slate-500 text-center py-10">Nessun lead in questa lista.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {viewLeads.map((lead) => {
                    const badges = getOpportunityBadges(lead.raw)
                    const website = lead.website || ''
                    const href = website ? (website.startsWith('http') ? website : `https://${website}`) : ''
                    const raw = (lead.raw || {}) as any
                    const instagram = typeof raw.instagram === 'string' ? raw.instagram : ''
                    const facebook = typeof raw.facebook === 'string' ? raw.facebook : ''
                    const rating = typeof raw.rating === 'number' ? raw.rating : null
                    const selected = selectedIds.has(lead.id)

                    return (
                        <div
                        key={lead.id}
                        className={`relative rounded-lg bg-white border p-5 transition-colors ${
                          selected ? 'border-slate-900 ring-1 ring-slate-200' : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {/* Header card */}
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <button
                            type="button"
                            onClick={() => toggleSelect(lead.id)}
                            className="flex-shrink-0 mt-0.5"
                            title={selected ? 'Deseleziona' : 'Seleziona'}
                          >
                            {selected ? (
                              <CheckSquare className="h-5 w-5 text-slate-900" strokeWidth={1.75} />
                            ) : (
                              <Square className="h-5 w-5 text-slate-300 hover:text-slate-600" strokeWidth={1.75} />
                            )}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-slate-900 truncate">{lead.name || '—'}</div>
                            {href ? (
                              <a
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-slate-500 hover:text-slate-900 truncate block transition-colors"
                              >
                                {website}
                              </a>
                            ) : null}
                          </div>
                          {typeof lead.score === 'number' && (
                            <div
                              className={`shrink-0 inline-flex items-center justify-center h-9 min-w-9 px-2 rounded-md text-sm font-semibold tabular-nums border ${
                                lead.score >= 70
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : lead.score >= 40
                                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                                    : 'bg-red-50 text-red-700 border-red-200'
                              }`}
                              title="Opportunity Score"
                            >
                              {lead.score}
                            </div>
                          )}
                        </div>

                        {/* Meta pills */}
                        <div className="flex flex-wrap items-center gap-1.5 mb-3">
                          {lead.city && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                              <MapPin className="h-3 w-3" strokeWidth={1.75} /> {lead.city}
                            </span>
                          )}
                          {lead.category && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                              <Tag className="h-3 w-3" strokeWidth={1.75} />
                              {lead.category}
                            </span>
                          )}
                          {rating !== null && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200">
                              <Star className="h-3 w-3" strokeWidth={1.75} /> {rating.toFixed(1)}
                            </span>
                          )}
                        </div>

                        {/* Contacts */}
                        <div className="space-y-1.5 text-sm mb-3">
                          {lead.email ? (
                            <div className="flex items-center gap-2 text-slate-700">
                              <Mail className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.75} />
                              <a href={`mailto:${lead.email}`} className="text-slate-800 hover:text-slate-900 truncate transition-colors">
                                {lead.email}
                              </a>
                            </div>
                          ) : null}
                          {lead.phone ? (
                            <div className="flex items-center gap-2 text-slate-700">
                              <Phone className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.75} />
                              <a href={`tel:${lead.phone}`} className="text-slate-800 hover:text-slate-900 font-mono text-xs transition-colors">
                                {lead.phone}
                              </a>
                            </div>
                          ) : null}
                          {(instagram || facebook) && (
                            <div className="flex items-center gap-3 text-xs pt-1">
                              {instagram && (
                                <a
                                  href={instagram.startsWith('http') ? instagram : `https://${instagram}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-slate-600 hover:text-slate-900 hover:underline"
                                >
                                  Instagram
                                </a>
                              )}
                              {facebook && (
                                <a
                                  href={facebook.startsWith('http') ? facebook : `https://${facebook}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-slate-600 hover:text-slate-900 hover:underline"
                                >
                                  Facebook
                                </a>
                              )}
                            </div>
                          )}
                          {!lead.email && !lead.phone && !instagram && !facebook ? (
                            <div className="text-xs text-slate-400 italic">Nessun contatto salvato</div>
                          ) : null}
                        </div>

                        {/* Outreach multi-canale */}
                        <div className="mb-3 space-y-1.5">
                          {outreach.enabled && outreach.isContacted(lead.website, lead.name) && (
                            <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600">
                              <ShieldCheck className="h-3.5 w-3.5" />
                              {(() => {
                                const oc = outreach.getOutcome(lead.website, lead.name)
                                if (oc === 'interested') return 'Già contattato · Interessato'
                                if (oc === 'not_interested') return 'Già contattato · Non interessato'
                                if (oc === 'no_answer') return 'Già contattato · Nessuna risposta'
                                return 'Già contattato'
                              })()}
                            </div>
                          )}
                          <OutreachLauncher
                            nome={lead.name || ''}
                            citta={lead.city || ''}
                            categoria={lead.category || ''}
                            sito={lead.website || ''}
                            email={lead.email || ''}
                            telefono={lead.phone || ''}
                            leadId={lead.id}
                            problems={badges.map((b) => b.label)}
                            lastContactedAt={outreach.getLastContact(lead.website, lead.name)}
                            onLogged={outreach.reload}
                            variant="primary"
                            className="w-full justify-center"
                          />
                        </div>

                        {/* Opportunity badges */}
                        {badges.length > 0 && (
                          <div className="pt-3 border-t border-slate-100">
                            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                              Opportunità ({badges.length})
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {badges.map((b, i) => (
                                <span
                                  key={`${b.label}-${i}`}
                                  className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${toneClass(b.tone)}`}
                                >
                                  {b.label}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
