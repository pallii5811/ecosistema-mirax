'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { BookmarkPlus, Copy, Flame, Gauge, Mail, MessageCircle, Sparkles, Star } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { generatePitchAction } from '@/app/dashboard/actions'
import { LeadEnrichmentPanel } from '@/components/LeadEnrichmentPanel'
import SitePreviewPanel from '@/components/SitePreviewPanel'
import { LeadActionButtons } from '@/components/LeadActionButtons'
import { InviaCRMButton } from '@/components/InviaCRMButton'
import { analyzeBuyingSignals } from '@/utils/buyingSignals'
import type { BuyingSignalSummary } from '@/utils/buyingSignals'
import { MiraxLogo } from '@/components/MiraxLogo'
import { analyzeMiraxSignals } from '@/lib/mirax-signals'
import { BusinessSignalBadge } from '@/components/BusinessSignalBadge'
import { IntentScoreBadge } from '@/components/IntentScoreBadge'
import { calculateIntentScoreFromLead } from '@/lib/scoring/intent-score'
import { LeadComplianceBadge } from '@/components/LeadComplianceBadge'
import { UniverseHydratedBadge } from '@/components/universe/UniverseHydratedBadge'
import { MarketingInvestorBadge } from '@/components/MarketingInvestorBadge'
import type { SignalIntentSpec } from '@/lib/signal-intent/types'
import { intentCellForLead, showIntentDataColumn, intentColumnTitle } from '@/lib/signal-intent/intent-cell'
import { isSignalFocusedIntent, signalFilterButtonLabel } from '@/lib/signal-intent/lead-visibility'
import { leadMatchesSignalIntent } from '@/lib/signal-intent/match-lead'
import { isAuditPendingLead } from '@/lib/lead-audit-status'
import { leadRowKey, leadStableKey } from '@/components/dashboard/lead-utils'
import { computeFreshnessScore, freshnessLabel } from '@/lib/lead-object'

type LeadRecord = Record<string, unknown>

function asRecord(value: unknown): LeadRecord | null {
  return value && typeof value === 'object' ? value as LeadRecord : null
}

function readFirstString(obj: LeadRecord, keys: string[]) {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function calcOpportunityScore(obj: Record<string, unknown>): number {
  let score = 0
  const stack = Array.isArray(obj.tech_stack)
    ? obj.tech_stack.filter((v) => typeof v === 'string').join(' ').toLowerCase()
    : ''
  const tr = asRecord(obj.technical_report)

  if (obj.meta_pixel !== true || stack.includes('no pixel') || stack.includes('missing fb pixel')) score += 25

  if ((!obj.sito && !obj.website) || stack.includes('no website')) score += 30

  if (!obj.instagram) score += 15

  if (tr?.seo_disaster === true || stack.includes('disastro seo')) score += 20

  if (tr?.has_dmarc === false || stack.includes('no dmarc')) score += 10

  return Math.min(score, 100)
}

/** Rule-based opportunity score — see docs/SCORE_AI_RULES.md */
function FreshnessBadge({ lead }: { lead: Record<string, unknown> }) {
  const score =
    typeof lead.freshness_score === 'number' && Number.isFinite(lead.freshness_score)
      ? Math.round(lead.freshness_score)
      : computeFreshnessScore(lead.last_audited_at)
  const label = freshnessLabel(score)
  const tone =
    score >= 80 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
    score >= 50 ? 'bg-sky-50 text-sky-700 border-sky-200' :
    score > 0 ? 'bg-amber-50 text-amber-700 border-amber-200' :
    'bg-zinc-100 text-zinc-500 border-zinc-200'

  return (
    <span
      title={`Freshness ${score}/100 — ${label}`}
      className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide leading-none ${tone}`}
    >
      <Gauge className="h-2.5 w-2.5" />
      {score}
    </span>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const variant = score >= 61 ? 'hot' : score >= 31 ? 'warm' : 'ok'

  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-[15px] font-bold tabular-nums leading-none ${
        variant === 'hot' ? 'text-zinc-900' : variant === 'warm' ? 'text-zinc-700' : 'text-zinc-400'
      }`}>{score}</span>
      <span className={`text-[8px] font-semibold leading-none uppercase tracking-wider px-1.5 py-0.5 rounded ${
        variant === 'hot'
          ? 'bg-zinc-900 text-white'
          : variant === 'warm'
            ? 'bg-zinc-200 text-zinc-600'
            : 'bg-zinc-100 text-zinc-400'
      }`}>{variant === 'hot' ? 'HOT' : variant === 'warm' ? 'WARM' : 'OK'}</span>
    </div>
  )
}

function BuyingBadge({ summary, compact = false }: { summary: BuyingSignalSummary | undefined; compact?: boolean }) {
  if (!summary || (summary.label !== 'caldo' && summary.label !== 'caldissimo')) return null
  const isTop = summary.label === 'caldissimo'
  const tone = isTop
    ? 'bg-rose-600 text-white border-rose-600'
    : 'bg-orange-100 text-orange-700 border-orange-300'
  const title = `Segnali d'acquisto: ${summary.label} (${summary.score}/100). ${summary.primaryReason}`
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide leading-none ${tone}`}
    >
      <Flame className={`h-3 w-3 ${isTop ? 'text-white' : 'text-orange-500'}`} />
      {compact ? summary.label : `${summary.label} · ${summary.signals.length} segnali`}
    </span>
  )
}

type ResultsTableProps = {
  query: string
  results: unknown[]
  isLoading: boolean
  isScraping?: boolean
  searchId?: string | null
  filters?: Record<string, unknown> | null
  aiDebug?: unknown
  totalUnfilteredCount?: number
  missingSignals?: boolean
  hasActiveBusinessFilter?: boolean
  onClearBusinessFilters?: () => void
  signalIntent?: SignalIntentSpec | null
}

type UserList = {
  id: string
  name: string
}

const ResultsTable = ({
  query,
  results,
  isLoading,
  isScraping,
  searchId,
  filters,
  aiDebug,
  totalUnfilteredCount,
  missingSignals = false,
  hasActiveBusinessFilter = false,
  onClearBusinessFilters,
  signalIntent = null,
}: ResultsTableProps) => {
  const showIntentColumn = showIntentDataColumn(signalIntent)
  const intentColTitle = intentColumnTitle(signalIntent)
  const focusedSignalQuery = Boolean(signalIntent?.required_signals?.length)
  const signalFocused = isSignalFocusedIntent(signalIntent)
  const signalFilterLabel = signalFilterButtonLabel(signalIntent)
  const [activeCRM, setActiveCRM] = useState<{ id: string; type: string; name?: string } | null>(null)
  const [pitchOpen, setPitchOpen] = useState(false)
  const [pitchLoading, setPitchLoading] = useState(false)
  const [pitchError, setPitchError] = useState<string | null>(null)
  const [pitchLead, setPitchLead] = useState<Record<string, unknown> | null>(null)
  const [pitchSubject, setPitchSubject] = useState('')
  const [pitchBody, setPitchBody] = useState('')
  const [selectedCompanyForAudit, setSelectedCompanyForAudit] = useState<Record<string, unknown> | null>(null)
  const [sortByScore, setSortByScore] = useState(false)
  const [sortAlpha, setSortAlpha] = useState<'none' | 'az' | 'za'>('none')
  const [sortBySignals, setSortBySignals] = useState(false)
  const [hotOnly, setHotOnly] = useState(false)
  const [previewSite, setPreviewSite] = useState<{ url: string; name: string } | null>(null)

  useEffect(() => {
    setHotOnly(false)
  }, [searchId, query])

  // Durante streaming: mai filtrare righe via "Solo caldi/investimenti" — causa sparizioni.
  useEffect(() => {
    if (isScraping) setHotOnly(false)
  }, [isScraping])

  const [saveOpen, setSaveOpen] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [listsLoading, setListsLoading] = useState(false)
  const [lists, setLists] = useState<UserList[]>([])
  const [selectedListId, setSelectedListId] = useState('')
  const [newListName, setNewListName] = useState('')
  const [newListDescription, setNewListDescription] = useState('')
  const [saveLead, setSaveLead] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch('/api/crm/active', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('active crm failed'))))
      .then((d) => {
        if (cancelled) return
        setActiveCRM(d?.integration || null)
      })
      .catch(() => {
        if (cancelled) return
        setActiveCRM(null)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const auditData = useMemo(() => {
    const obj = selectedCompanyForAudit
    if (!obj) return null

    const nome = (() => {
      return readFirstString(obj, ['nome', 'azienda', 'company', 'name']) || 'Azienda'
    })()

    const techStackRaw = obj.tech_stack ?? obj.techStack
    const techStack = Array.isArray(techStackRaw) ? techStackRaw.filter((v: unknown) => typeof v === 'string') : ([] as string[])
    const stackStr = techStack.join(' ').toLowerCase()
    const technicalReport = asRecord(obj.technical_report)

    const errorDetailsRaw = technicalReport?.error_details
    const errorDetails = Array.isArray(errorDetailsRaw)
      ? (errorDetailsRaw as unknown[]).filter((v) => typeof v === 'string').map((s) => s.trim()).filter(Boolean)
      : ([] as string[])

    const sitoRaw = obj.sito ?? obj.website ?? obj.url
    const sito = typeof sitoRaw === 'string' ? sitoRaw.trim() : ''
    const href = sito ? (sito.startsWith('http') ? sito : `https://${sito}`) : ''
    const isHttps = href.startsWith('https://')

    const metaPixel = obj.meta_pixel
    const gtm = obj.google_tag_manager
    const ssl = obj.ssl
    const isClaimed = obj.is_claimed
    const mobileFriendlyRaw = obj.mobile_friendly ?? obj.is_mobile_friendly ?? technicalReport?.mobile_friendly

    const missingPixel = metaPixel !== true || stackStr.includes('missing fb pixel') || stackStr.includes('no pixel')
    const missingGTM = gtm !== true || stackStr.includes('missing gtm') || stackStr.includes('no gtm')
    const missingGoogleAds = technicalReport?.has_google_ads === false || stackStr.includes('missing google ads') || stackStr.includes('no google ads') || stackStr.includes('no ads')
    const missingSSL =
      ssl === false ||
      stackStr.includes('no ssl') ||
      stackStr.includes('missing ssl') ||
      stackStr.includes('ssl error') ||
      (!!href && href.startsWith('http://'))
    const missingSite = !sito || stackStr.includes('no website')
    const missingMobile = mobileFriendlyRaw === false || stackStr.includes('missing mobile') || stackStr.includes('no mobile') || stackStr.includes('not mobile friendly')
    const unclaimedMaps = isClaimed === false
    const missingEmailAuth =
      technicalReport?.has_dmarc === false ||
      technicalReport?.has_spf === false ||
      stackStr.includes('missing dmarc') ||
      stackStr.includes('missing spf') ||
      stackStr.includes('no dmarc') ||
      stackStr.includes('no spf')

    const htmlErrorsRaw = obj.html_errors ?? obj.htmlErrors
    const htmlErrors = Array.isArray(htmlErrorsRaw) ? htmlErrorsRaw.filter((v: unknown) => typeof v === 'string') : ([] as string[])
    const htmlErrorsCount = htmlErrors.length

    const loadSpeedRaw =
      technicalReport?.load_speed_s ??
      technicalReport?.load_speed_seconds ??
      obj.load_speed_s ??
      obj.load_speed_seconds
    const loadSpeedSeconds =
      typeof loadSpeedRaw === 'number' ? loadSpeedRaw : typeof loadSpeedRaw === 'string' ? Number(loadSpeedRaw) : null
    const isSlow = typeof loadSpeedSeconds === 'number' && Number.isFinite(loadSpeedSeconds) ? loadSpeedSeconds > 3 : false

    const techBadges: Array<{ label: string }> = []
    if (stackStr.includes('wordpress')) techBadges.push({ label: 'WORDPRESS' })
    if (stackStr.includes('shopify')) techBadges.push({ label: 'SHOPIFY' })
    if (stackStr.includes('prestashop') || stackStr.includes('presta')) techBadges.push({ label: 'PRESTASHOP' })
    if (stackStr.includes('wix')) techBadges.push({ label: 'WIX' })
    if (stackStr.includes('woocommerce') || stackStr.includes('woo commerce') || stackStr.includes('woo-commerce')) techBadges.push({ label: 'WOOCOMMERCE' })

    const problemBadges: Array<{ label: string; tone: 'critical' | 'warn' }> = []
    if (missingPixel) problemBadges.push({ label: 'NO PIXEL', tone: 'critical' })
    if (missingGTM) problemBadges.push({ label: 'NO GTM', tone: 'critical' })
    if (missingGoogleAds) problemBadges.push({ label: 'NO GOOGLE ADS', tone: 'critical' })
    if (missingEmailAuth) problemBadges.push({ label: 'DMARC/SPF MANCANTE', tone: 'critical' })
    if (missingSite) problemBadges.push({ label: 'NO WEBSITE', tone: 'warn' })
    if (missingSSL) problemBadges.push({ label: 'NO SSL', tone: 'warn' })
    if (missingMobile) problemBadges.push({ label: 'NON MOBILE-FRIENDLY', tone: 'warn' })
    if (unclaimedMaps) problemBadges.push({ label: 'PROFILO NON RIVENDICATO', tone: 'warn' })
    if (htmlErrorsCount > 0) problemBadges.push({ label: `ERRORI HTML (${htmlErrorsCount})`, tone: 'warn' })
    if (isSlow) problemBadges.push({ label: `SITO LENTO (${loadSpeedSeconds?.toFixed?.(1) ?? loadSpeedSeconds}s)`, tone: 'warn' })

    const stackBadges: Array<{ label: string; tone: 'tech' | 'ok' }> = []
    if (!missingSSL && (ssl === true || isHttps)) stackBadges.push({ label: 'SSL OK', tone: 'ok' })
    techBadges.forEach((t) => stackBadges.push({ label: t.label, tone: 'tech' }))

    return {
      nome,
      errorDetails,
      problemBadges,
      stackBadges,
    }
  }, [selectedCompanyForAudit])

  const requestedIssues = useMemo(() => {
    const out = new Set<string>()

    const d = asRecord(aiDebug)
    const tf = asRecord(d?.technical_filters)
    if (tf) {
      if (tf.seo_errors === true) out.add('seo')
      if (tf.no_pixel === true) out.add('pixel')
      if (tf.no_gtm === true) out.add('gtm')
      if (tf.no_google_ads === true) out.add('google_ads')
      if (tf.no_ssl === true) out.add('ssl')
      if (tf.no_website === true) out.add('site')
      if (tf.no_mobile === true) out.add('mobile')
      if (tf.spam_risk === true) out.add('spam')
      if (tf.unclaimed_maps === true) out.add('maps')
      if (tf.code_errors === true) out.add('html')
      if (tf.slow_speed === true) out.add('speed')
      if (tf.no_instagram === true) out.add('no_instagram')
      if (tf.no_facebook === true) out.add('no_facebook')
      if (tf.no_tiktok === true) out.add('no_tiktok')

      const techTerms = Array.isArray(tf.tech_terms) ? tf.tech_terms.filter((v: unknown) => typeof v === 'string').map((s: string) => s.trim()).filter(Boolean) : []
      if (techTerms.length > 0) out.add('tech')
    }

    // fallback su legacy filters
    const legacyTermsRaw = filters?.tech_mancanti
    const legacyTerms = Array.isArray(legacyTermsRaw)
      ? legacyTermsRaw
          .filter((v: unknown) => typeof v === 'string')
          .map((s: string) => s.toLowerCase().trim())
      : []
    if (legacyTerms.includes('pixel')) out.add('pixel')
    if (legacyTerms.includes('gtm') || legacyTerms.includes('tag manager')) out.add('gtm')
    if (legacyTerms.includes('ssl')) out.add('ssl')

    const needsHtmlErrorsRaw = filters?.needs_html_errors
    if (needsHtmlErrorsRaw === true) out.add('seo')

    const hasWebsiteRaw = filters?.has_website
    if (hasWebsiteRaw === false) out.add('site')

    return out
  }, [aiDebug, filters])

  const mailtoHref = useMemo(() => {
    if (!pitchSubject || !pitchBody) return null
    const emailRaw = pitchLead && typeof pitchLead.email === 'string' ? pitchLead.email : ''
    const to = emailRaw.trim() ? emailRaw.trim() : ''
    const subject = encodeURIComponent(pitchSubject)
    const body = encodeURIComponent(pitchBody)
    return `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`
  }, [pitchBody, pitchLead, pitchSubject])

  // Buying Signal Summary per ogni lead (chiave stabile — non usare riferimento oggetto).
  const buyingByItem = useMemo(() => {
    const map = new Map<string, BuyingSignalSummary>()
    for (const item of results) {
      try {
        const obj = asRecord(item) || {}
        map.set(leadStableKey(obj), analyzeBuyingSignals(obj))
      } catch {
        // un lead malformato non deve mai rompere la tabella
      }
    }
    return map
  }, [results])

  const miraxByItem = useMemo(() => {
    const map = new Map<string, ReturnType<typeof analyzeMiraxSignals>>()
    for (const item of results) {
      try {
        const obj = asRecord(item) || {}
        map.set(leadStableKey(obj), analyzeMiraxSignals(obj))
      } catch {
        /* ignore */
      }
    }
    return map
  }, [results])

  const intentByItem = useMemo(() => {
    const map = new Map<string, ReturnType<typeof calculateIntentScoreFromLead>>()
    for (const item of results) {
      try {
        const obj = asRecord(item) || {}
        map.set(leadStableKey(obj), calculateIntentScoreFromLead(item))
      } catch {
        /* ignore */
      }
    }
    return map
  }, [results])

  const leadKey = (item: unknown, rowIdx = 0) => leadRowKey(item, rowIdx)

  const getBuyingScore = (item: unknown) => {
    const obj = asRecord(item)
    if (!obj) return 0
    return buyingByItem.get(leadStableKey(obj))?.score ?? 0
  }

  const getMirax = (item: unknown) => {
    const obj = asRecord(item)
    if (!obj) return undefined
    return miraxByItem.get(leadStableKey(obj))
  }

  const getIntent = (item: unknown) => {
    const obj = asRecord(item)
    if (!obj) return undefined
    return intentByItem.get(leadStableKey(obj))
  }

  const signalMatchCount = useMemo(() => {
    if (!focusedSignalQuery || !signalIntent) return 0
    return results.filter((it) => leadMatchesSignalIntent(it, signalIntent)).length
  }, [results, signalIntent, focusedSignalQuery])

  const hotCount = useMemo(() => {
    if (signalFocused && signalIntent) return signalMatchCount
    return results.filter((it) => getBuyingScore(it) >= 60).length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, buyingByItem, signalFocused, signalMatchCount])

  const displayResults = useMemo(() => {
    let sorted = [...results]
    const filterHot = hotOnly && !isScraping
    if (filterHot) {
      if (signalFocused && signalIntent) {
        sorted = sorted.filter((it) => leadMatchesSignalIntent(it, signalIntent))
      } else {
        sorted = sorted.filter((it) => (buyingByItem.get(leadStableKey(asRecord(it) || {}))?.score ?? 0) >= 60)
      }
    }
    if (sortBySignals) {
      sorted.sort((a, b) => (getBuyingScore(b) - getBuyingScore(a)))
    } else if (sortByScore) {
      sorted.sort((a, b) => calcOpportunityScore(asRecord(b) || {}) - calcOpportunityScore(asRecord(a) || {}))
    }
    if (sortAlpha !== 'none') {
      const getName = (x: unknown) => readFirstString(asRecord(x) || {}, ['nome', 'azienda', 'company', 'name']).toLowerCase()
      sorted.sort((a, b) => {
        const na = getName(a)
        const nb = getName(b)
        return sortAlpha === 'az' ? na.localeCompare(nb, 'it') : nb.localeCompare(na, 'it')
      })
    }
    return sorted
  }, [results, sortByScore, sortAlpha, sortBySignals, hotOnly, buyingByItem, signalFocused, signalIntent, isScraping])

  const exportCsv = () => {
    const rows = displayResults.map((item) => {
      const obj = asRecord(item) || {}
      const score = calcOpportunityScore(obj)
      const stack = Array.isArray(obj.tech_stack) ? obj.tech_stack.filter((v) => typeof v === 'string').join(' | ') : ''
      return [
        readFirstString(obj, ['azienda', 'nome']),
        readFirstString(obj, ['telefono', 'phone']),
        readFirstString(obj, ['email']),
        readFirstString(obj, ['sito', 'website']),
        readFirstString(obj, ['citta', 'city']),
        readFirstString(obj, ['categoria', 'category']),
        obj.rating ?? '',
        readFirstString(obj, ['instagram']),
        readFirstString(obj, ['facebook']),
        stack,
        score,
      ]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(',')
    })
    const headers = ['Azienda', 'Telefono', 'Email', 'Sito', 'Città', 'Categoria', 'Rating', 'Instagram', 'Facebook', 'Opportunità', 'Score']
    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clientsniper_leads_${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const renderNd = (value: string) => {
    const v = typeof value === 'string' ? value.trim() : ''
    if (!v) return <span className="text-sm text-gray-900">N/D</span>
    return <span className="text-sm text-gray-900 font-mono">{value}</span>
  }

  const openPitch = async (lead: unknown) => {
    const obj = lead && typeof lead === 'object' ? (lead as Record<string, unknown>) : null
    setPitchLead(obj)
    setPitchSubject('')
    setPitchBody('')
    setPitchError(null)
    setPitchOpen(true)
    setPitchLoading(true)

    try {
      const nome = typeof obj?.nome === 'string' ? obj.nome : typeof obj?.azienda === 'string' ? (obj.azienda as string) : ''
      const sito = typeof obj?.sito === 'string' ? obj.sito : typeof obj?.website === 'string' ? (obj.website as string) : ''
      const citta = typeof obj?.citta === 'string' ? obj.citta : ''
      const categoria = typeof obj?.categoria === 'string' ? obj.categoria : ''
      const email = typeof obj?.email === 'string' ? obj.email : ''
      const rating = typeof obj?.rating === 'number' ? (obj.rating as number) : null
      const page_speed = typeof obj?.page_speed === 'number' ? (obj.page_speed as number) : null
      const tech_stack = Array.isArray(obj?.tech_stack) ? (obj?.tech_stack as unknown[]).filter((v) => typeof v === 'string') as string[] : []
      const html_errors = Array.isArray(obj?.html_errors) ? (obj?.html_errors as unknown[]).filter((v) => typeof v === 'string') as string[] : []

      const { subject, body } = await generatePitchAction({
        nome,
        sito,
        citta,
        categoria,
        email,
        rating,
        tech_stack,
        html_errors,
        page_speed,
      })

      setPitchSubject(subject)
      setPitchBody(body)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Errore durante la generazione del pitch'
      setPitchError(message)
    } finally {
      setPitchLoading(false)
    }
  }

  const openSave = async (lead: unknown) => {
    const obj = lead && typeof lead === 'object' ? (lead as Record<string, unknown>) : null
    setSaveLead(obj)
    setSaveError(null)
    setSaveSuccess(null)
    setNewListName('')
    setNewListDescription('')
    setSelectedListId('')
    setSaveOpen(true)

    setListsLoading(true)
    try {
      const res = await fetch('/api/lists', { cache: 'no-store' })
      const data = (await res.json().catch(() => null)) as { lists?: UserList[]; error?: string } | null
      if (!res.ok) throw new Error(data?.error || 'Impossibile caricare le liste.')
      const loaded = Array.isArray(data?.lists) ? data!.lists! : []
      setLists(loaded)
      if (loaded.length > 0) {
        setSelectedListId(loaded[0].id)
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Errore liste.'
      setSaveError(raw)
    } finally {
      setListsLoading(false)
    }
  }

  const handleCreateList = async () => {
    const name = newListName.trim()
    if (!name) {
      setSaveError('Inserisci un nome lista.')
      return
    }

    setSaveError(null)
    setSaveLoading(true)

    try {
      const res = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: newListDescription.trim() || undefined }),
      })
      const data = (await res.json().catch(() => null)) as { list?: UserList; error?: string } | null
      if (!res.ok || !data?.list) throw new Error(data?.error || 'Impossibile creare la lista.')

      setLists((prev) => [data.list as UserList, ...prev])
      setSelectedListId((data.list as UserList).id)
      setNewListName('')
      setNewListDescription('')
      setSaveSuccess('Lista creata.')
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Errore creazione lista.'
      setSaveError(raw)
    } finally {
      setSaveLoading(false)
    }
  }

  const handleSaveLead = async () => {
    if (!saveLead) return
    if (!selectedListId) {
      setSaveError('Seleziona una lista.')
      return
    }

    const leadPayload = {
      name: renderLeadString(saveLead, ['nome', 'azienda', 'company', 'name']),
      website: renderLeadString(saveLead, ['sito', 'website', 'url']),
      email: renderLeadString(saveLead, ['email', 'mail']),
      phone: renderLeadString(saveLead, ['telefono', 'phone']),
      city: renderLeadString(saveLead, ['citta', 'city']),
      category: renderLeadString(saveLead, ['categoria', 'category']),
      score: calcOpportunityScore(saveLead),
      raw: saveLead,
    }

    setSaveError(null)
    setSaveSuccess(null)
    setSaveLoading(true)

    try {
      const res = await fetch('/api/leads/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listId: selectedListId, lead: leadPayload }),
      })

      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; webhook?: { sent: boolean; ok: boolean } }
        | null

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Errore durante il salvataggio.')
      }

      const webhookMsg = data.webhook?.sent
        ? data.webhook.ok
          ? ' Dati inviati al Webhook!'
          : ' Webhook configurato ma invio fallito.'
        : ''

      setSaveSuccess(`Salvato in lista.${webhookMsg}`)
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Errore salvataggio.'
      setSaveError(raw)
    } finally {
      setSaveLoading(false)
    }
  }

  const copyPitch = async () => {
    const text = pitchSubject && pitchBody ? `Oggetto: ${pitchSubject}\n\n${pitchBody}` : ''
    if (!text) return

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }

    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', 'true')
    el.style.position = 'absolute'
    el.style.left = '-9999px'
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
  }

  const getSpeedBadge = (score: number | null) => {
    if (typeof score !== 'number') {
      return (
        <Badge variant="secondary" className="bg-slate-100 text-slate-600 border border-slate-200 text-[10px] px-1.5 py-0.5 leading-none">
          N/D
        </Badge>
      )
    }

    if (score < 40) {
      return (
        <Badge variant="secondary" className="bg-red-900 text-white font-bold text-[10px] px-1.5 py-0.5 leading-none">
          LENTO
        </Badge>
      )
    }

    if (score < 70) {
      return (
        <Badge variant="secondary" className="bg-amber-100 text-amber-800 border border-amber-200 text-[10px] px-1.5 py-0.5 leading-none">
          MEDIO
        </Badge>
      )
    }

    return (
      <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-200 text-[10px] px-1.5 py-0.5 leading-none">
        VELOCE
      </Badge>
    )
  }

  const skeletonRows = Array.from({ length: 8 }).map((_, idx) => (
    <tr key={idx} className="animate-pulse">
      <td className="px-2 py-3 align-top">
        <div className="h-4 w-3/4 rounded bg-slate-200" />
        <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
      </td>
      <td className="px-2 py-3 align-top">
        <div className="h-8 w-10 rounded bg-slate-200 mx-auto" />
      </td>
      <td className="px-2 py-3 align-top">
        <div className="h-3 w-3/4 rounded bg-slate-200" />
        <div className="mt-2 h-3 w-2/3 rounded bg-slate-100" />
      </td>
      <td className="px-2 py-3 align-top">
        <div className="h-3 w-2/3 rounded bg-slate-200" />
        <div className="mt-2 h-3 w-1/3 rounded bg-slate-100" />
      </td>
      <td className="px-2 py-3 align-top">
        <div className="h-3 w-2/3 rounded bg-slate-200" />
      </td>
      <td className="px-2 py-3 align-top">
        <div className="h-3 w-2/3 rounded bg-slate-200" />
      </td>
      <td className="px-2 py-3 align-top">
        <div className="h-3 w-2/3 rounded bg-slate-200" />
      </td>
      <td className="px-2 py-3 align-top">
        <div className="h-3 w-2/3 rounded bg-slate-200" />
      </td>
      <td className="px-2 py-3 align-top">
        <div className="h-9 w-20 rounded bg-slate-200 mx-auto" />
      </td>
    </tr>
  ))

  const renderLeadString = (obj: Record<string, unknown>, keys: string[]) => {
    for (const k of keys) {
      const v = obj[k]
      if (typeof v === 'string' && v.trim()) return v
    }
    return ''
  }

  const renderLeadNumber = (obj: Record<string, unknown>, keys: string[]) => {
    for (const k of keys) {
      const v = obj[k]
      if (typeof v === 'number' && Number.isFinite(v)) return v
    }
    return null
  }

  const extractItalianPhones = (input: string) => {
    const raw = typeof input === 'string' ? input : ''
    const normalized = raw.replace(/\(0\)/g, '').replace(/\s+/g, ' ').trim()
    const candidates = normalized
      .split(/[,/;|]/)
      .map((p) => p.trim())
      .filter(Boolean)

    const cleanToDigits = (s: string) => s.replace(/[^\d+]/g, '')
    const normalize39 = (s: string) => {
      let d = cleanToDigits(s)
      if (d.startsWith('00')) d = `+${d.slice(2)}`
      if (d.startsWith('+')) d = d.slice(1)
      d = d.replace(/\D/g, '')
      if (d.startsWith('39') && d.length > 10) d = d.slice(2)
      return d
    }

    const isMobile = (digits: string) => /^3\d{8,10}$/.test(digits)
    const isLandline = (digits: string) => /^0\d{7,10}$/.test(digits)

    const mobiles: string[] = []
    const landlines: string[] = []

    for (const c of candidates) {
      const digits = normalize39(c)
      if (!digits) continue
      if (isMobile(digits)) {
        if (!mobiles.includes(digits)) mobiles.push(digits)
      } else if (isLandline(digits)) {
        if (!landlines.includes(digits)) landlines.push(digits)
      }
    }

    return {
      mobile: mobiles[0] ?? null,
      landline: landlines[0] ?? null,
    }
  }

  function isValidItalianPhone(phone: string): boolean {
    if (!phone) return false

    // Rimuovi spazi, trattini, punti, parentesi
    const cleaned = phone.replace(/[\s\-\.\(\)]/g, '')

    // Rimuovi prefisso internazionale se presente
    const normalized = cleaned
      .replace(/^\+39/, '')
      .replace(/^0039/, '')

    // Lunghezza valida: 9-10 cifre
    if (normalized.length < 9 || normalized.length > 11) return false

    // Solo cifre
    if (!/^\d+$/.test(normalized)) return false

    // Cellulari italiani: iniziano con 3, 10 cifre
    if (normalized.startsWith('3') && normalized.length === 10) return true

    // Fissi italiani: iniziano con 0, 9-11 cifre
    if (normalized.startsWith('0') && normalized.length >= 9) return true

    // Numeri brevi speciali (es. 800xxx)
    if (normalized.startsWith('8') && normalized.length >= 9) return true

    return false
  }

  function formatPhone(phone: string): string {
    const cleaned = phone.replace(/[\s\-\.\(\)]/g, '')
    const normalized = cleaned.replace(/^\+39/, '').replace(/^0039/, '')

    // Cellulare: 347 704 8785
    if (normalized.startsWith('3') && normalized.length === 10) {
      return `${normalized.slice(0, 3)} ${normalized.slice(3, 6)} ${normalized.slice(6)}`
    }
    return phone // fisso: lascia com'è
  }

  const formatWhatsAppLink = (rawPhone: string) => {
    const phones = extractItalianPhones(rawPhone)
    if (!phones.mobile) return null
    const digitsOnly = phones.mobile.replace(/\D/g, '')
    if (!digitsOnly) return null
    const withPrefix = digitsOnly.startsWith('39') ? digitsOnly : `39${digitsOnly}`
    return `https://wa.me/${withPrefix}`
  }

  const getDetailedOpportunityProblems = (obj: Record<string, unknown>) => {
    const techStackRaw = obj.tech_stack ?? obj.techStack
    const techStack = Array.isArray(techStackRaw) ? techStackRaw.filter((v) => typeof v === 'string') : []
    const stackStr = techStack.join(' ').toLowerCase()

    const technicalReport = asRecord(obj.technical_report)
    if (isAuditPendingLead(obj)) {
      return [{ key: 'audit_pending', label: 'Audit in arrivo', className: 'bg-amber-50 text-amber-700 border-amber-200' }]
    }
    const errorDetailsRaw = technicalReport?.error_details
    const errorDetails = Array.isArray(errorDetailsRaw)
      ? (errorDetailsRaw as unknown[]).filter((v) => typeof v === 'string').map((s) => s.trim()).filter(Boolean)
      : []

    const sito = renderLeadString(obj, ['sito', 'website', 'url'])
    const missingSite = !sito || stackStr.includes('no website')

    const metaPixel = obj.meta_pixel
    const gtm = obj.google_tag_manager
    const ssl = obj.ssl
    const isClaimed = obj.is_claimed

    const instagramUrl = renderLeadString(obj, ['instagram', 'ig', 'instagram_url', 'instagramUrl'])
    const facebookUrl = renderLeadString(obj, ['facebook', 'fb', 'facebook_url', 'facebookUrl'])

    const hasInstagram = !!instagramUrl
    const hasFacebook = !!facebookUrl

    const hasSeoErrors = technicalReport?.seo_disaster === true || stackStr.includes('disastro seo')

    const loadSpeedRaw =
      technicalReport?.load_speed_s ??
      technicalReport?.load_speed_seconds ??
      obj.load_speed_s ??
      obj.load_speed_seconds
    const loadSpeedSeconds = typeof loadSpeedRaw === 'number' ? loadSpeedRaw : typeof loadSpeedRaw === 'string' ? Number(loadSpeedRaw) : null
    const isSlow = typeof loadSpeedSeconds === 'number' && Number.isFinite(loadSpeedSeconds) ? loadSpeedSeconds > 3 : false

    const missingPixel = metaPixel !== true || stackStr.includes('missing fb pixel') || stackStr.includes('no pixel')
    const missingGTM = gtm !== true || stackStr.includes('missing gtm') || stackStr.includes('no gtm')
    const missingGoogleAds =
      technicalReport?.has_google_ads === false ||
      stackStr.includes('missing google ads') ||
      stackStr.includes('no google ads') ||
      stackStr.includes('no ads')
    const missingAnalytics = !stackStr.includes('ga4') && !stackStr.includes('analytics')
    const missingSSL =
      ssl === false ||
      stackStr.includes('no ssl') ||
      stackStr.includes('missing ssl') ||
      stackStr.includes('ssl error')

    const mobileFriendlyRaw = obj.mobile_friendly ?? obj.is_mobile_friendly ?? technicalReport?.mobile_friendly
    const missingMobile =
      mobileFriendlyRaw === false ||
      stackStr.includes('missing mobile') ||
      stackStr.includes('no mobile') ||
      stackStr.includes('not mobile friendly')

    const missingDmarc = !stackStr.includes('dmarc')
    const missingSpf = !stackStr.includes('spf')
    const missingEmailAuth =
      missingDmarc ||
      missingSpf ||
      technicalReport?.has_dmarc === false ||
      technicalReport?.has_spf === false ||
      stackStr.includes('missing dmarc') ||
      stackStr.includes('missing spf') ||
      stackStr.includes('no dmarc') ||
      stackStr.includes('no spf')

    const unclaimedMaps = isClaimed === false

    const activeProblems: Array<{ key: string; label: string; className: string }> = []
    if (missingSite) activeProblems.push({ key: 'no_website', label: 'Senza Sito', className: 'bg-red-100 text-red-800 border-red-200' })
    if (unclaimedMaps) activeProblems.push({ key: 'unclaimed_maps', label: 'Scheda Non Rivendicata', className: 'bg-red-100 text-red-800 border-red-200' })
    if (missingPixel) activeProblems.push({ key: 'no_pixel', label: 'No Pixel', className: 'bg-red-100 text-red-800 border-red-200' })
    if (missingGTM) activeProblems.push({ key: 'no_gtm', label: 'No GTM', className: 'bg-red-100 text-red-800 border-red-200' })
    if (!hasInstagram) activeProblems.push({ key: 'no_instagram', label: 'No Instagram', className: 'bg-slate-100 text-slate-800 border-slate-200' })
    if (!hasFacebook) activeProblems.push({ key: 'no_facebook', label: 'No Facebook', className: 'bg-slate-100 text-slate-800 border-slate-200' })
    if (isSlow) activeProblems.push({ key: 'slow_speed', label: 'Sito Lento', className: 'bg-amber-100 text-amber-900 border-amber-200' })
    if (hasSeoErrors || errorDetails.length > 0) activeProblems.push({ key: 'seo_errors', label: 'Errori SEO', className: 'bg-red-100 text-red-800 border-red-200' })
    if (missingAnalytics) activeProblems.push({ key: 'no_ga4', label: 'No GA4', className: 'bg-red-100 text-red-800 border-red-200' })
    if (missingGoogleAds) activeProblems.push({ key: 'no_google_ads', label: 'No Google Ads', className: 'bg-red-100 text-red-800 border-red-200' })
    if (missingMobile) activeProblems.push({ key: 'no_mobile', label: 'No Mobile', className: 'bg-amber-100 text-amber-900 border-amber-200' })
    if (missingSSL) activeProblems.push({ key: 'no_ssl', label: 'No SSL', className: 'bg-amber-100 text-amber-900 border-amber-200' })
    if (missingEmailAuth || technicalReport?.dmarc_ok === false) activeProblems.push({ key: 'spam_risk', label: 'Rischio Spam', className: 'bg-red-100 text-red-800 border-red-200' })

    return activeProblems.filter((p, i, arr) => arr.findIndex((x) => x.key === p.key) === i)
  }

  const renderOpportunities = (
    obj: Record<string, unknown>,
    opts?: {
      maxVisible?: number
      showMoreButton?: boolean
    }
  ) => {
    const chipBase = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border'

    const techStackRaw = obj.tech_stack
    const tech_stack = Array.isArray(techStackRaw) ? (techStackRaw as unknown[]).filter((v) => typeof v === 'string') as string[] : []
    const stackStr = tech_stack.join(' ').toLowerCase()
    const technicalReport = asRecord(obj.technical_report)

    if (isAuditPendingLead(obj)) {
      return (
        <span className={`${chipBase} bg-amber-50 text-amber-700 border-amber-200`}>
          Audit in arrivo
        </span>
      )
    }

    const sito = renderLeadString(obj, ['sito', 'website', 'url'])
    const meta_pixel = obj.meta_pixel
    const google_tag_manager = obj.google_tag_manager
    const ssl = obj.ssl
    const googleAds = obj.google_ads
    const googleAnalytics = obj.google_analytics
    const instagram = renderLeadString(obj, ['instagram', 'ig'])
    const facebook = renderLeadString(obj, ['facebook', 'fb'])
    const mobileFriendlyRaw = obj.mobile_friendly ?? obj.is_mobile_friendly ?? technicalReport?.mobile_friendly
    const loadSpeedRaw = technicalReport?.load_speed_s ?? technicalReport?.load_speed_seconds ?? obj.load_speed_s ?? obj.load_speed_seconds
    const loadSpeedSeconds = typeof loadSpeedRaw === 'number' ? loadSpeedRaw : typeof loadSpeedRaw === 'string' ? Number(loadSpeedRaw) : null

    const hasNoWebsite = !sito?.trim() || stackStr.includes('no website')
    const hasNoPixel = meta_pixel !== true || stackStr.includes('missing fb pixel') || stackStr.includes('no pixel')
    const hasNoGtm = google_tag_manager !== true || stackStr.includes('missing gtm') || stackStr.includes('no gtm')
    const hasNoSsl =
      ssl === false ||
      stackStr.includes('no ssl') ||
      stackStr.includes('missing ssl') ||
      stackStr.includes('ssl error')
    const hasSeoErrors = technicalReport?.seo_disaster === true || stackStr.includes('disastro seo')
    const hasNoGoogleAds = googleAds === false || technicalReport?.has_google_ads === false || stackStr.includes('no google ads') || stackStr.includes('no ads')
    const hasNoGa4 = googleAnalytics === false || technicalReport?.has_ga4 === false || stackStr.includes('no analytics') || stackStr.includes('no ga4')
    const hasNoInstagram = !instagram?.trim() || stackStr.includes('no instagram')
    const hasNoFacebook = !facebook?.trim() || stackStr.includes('no facebook')
    const hasNoMobile = mobileFriendlyRaw === false || stackStr.includes('no mobile') || stackStr.includes('not mobile friendly')
    const isSlow = typeof loadSpeedSeconds === 'number' && Number.isFinite(loadSpeedSeconds) && loadSpeedSeconds > 3
    const hasSpamRisk = technicalReport?.has_dmarc === false || technicalReport?.has_spf === false || stackStr.includes('no dmarc') || stackStr.includes('no spf')

    const badges: Array<{ key: string; label: string; className: string }> = []
    if (hasNoGoogleAds) badges.push({ key: 'no_google_ads', label: 'No Google Ads', className: `${chipBase} bg-blue-100 text-blue-700 border-blue-200` })
    if (hasNoPixel) badges.push({ key: 'no_pixel', label: 'No Pixel', className: `${chipBase} bg-red-100 text-red-700 border-red-200` })
    if (hasNoGtm) badges.push({ key: 'no_gtm', label: 'No GTM', className: `${chipBase} bg-orange-100 text-orange-700 border-orange-200` })
    if (hasNoGa4) badges.push({ key: 'no_ga4', label: 'No GA4', className: `${chipBase} bg-red-100 text-red-800 border-red-200` })
    if (hasNoSsl) badges.push({ key: 'no_ssl', label: 'No SSL', className: `${chipBase} bg-yellow-100 text-yellow-700 border-yellow-200` })
    if (hasNoInstagram) badges.push({ key: 'no_instagram', label: 'No Instagram', className: `${chipBase} bg-slate-100 text-slate-800 border-slate-200` })
    if (hasNoFacebook) badges.push({ key: 'no_facebook', label: 'No Facebook', className: `${chipBase} bg-slate-100 text-slate-800 border-slate-200` })
    if (hasNoMobile) badges.push({ key: 'no_mobile', label: 'No Mobile', className: `${chipBase} bg-amber-100 text-amber-900 border-amber-200` })
    if (isSlow) badges.push({ key: 'slow_speed', label: 'Sito Lento', className: `${chipBase} bg-amber-100 text-amber-900 border-amber-200` })
    if (hasSeoErrors) badges.push({ key: 'seo_errors', label: 'Errori SEO', className: `${chipBase} bg-red-50 text-red-600 border-red-200` })
    if (hasSpamRisk) badges.push({ key: 'spam_risk', label: 'Rischio Spam', className: `${chipBase} bg-red-100 text-red-800 border-red-200` })
    if (hasNoWebsite) badges.push({ key: 'no_website', label: 'Senza Sito', className: `${chipBase} bg-gray-100 text-gray-700 border-gray-200` })

    if (badges.length === 0) return <span className="text-[11px] text-gray-500">—</span>

    // Sort: badges matching the search query appear first
    const queryMatchOrder: Record<string, RegExp> = {
      seo_errors: /errori?\s*(seo|html)|seo\s*error/i,
      no_pixel: /senza\s*(meta\s*)?pixel|no\s*pixel/i,
      no_gtm: /senza\s*gtm|no\s*gtm|senza\s*tag\s*manager/i,
      no_ssl: /senza\s*ssl|no\s*ssl/i,
      no_google_ads: /senza\s*google\s*ads|no\s*google\s*ads|senza\s*ads/i,
      no_ga4: /senza\s*(google\s*)?analytics|no\s*analytics|senza\s*ga4|no\s*ga4/i,
      no_instagram: /senza\s*instagram|no\s*instagram|senza\s*ig\b/i,
      no_facebook: /senza\s*facebook|no\s*facebook|senza\s*fb\b/i,
      no_mobile: /non\s*mobile|no\s*mobile|senza\s*mobile/i,
      slow_speed: /sito\s*lento|slow\s*(site|speed)/i,
      spam_risk: /senza\s*dmarc|no\s*dmarc|rischio\s*spam/i,
      no_website: /senza\s*sito|no\s*website/i,
    }
    badges.sort((a, b) => {
      const aMatch = queryMatchOrder[a.key]?.test(query) ? 1 : 0
      const bMatch = queryMatchOrder[b.key]?.test(query) ? 1 : 0
      return bMatch - aMatch
    })

    const maxVisible = typeof opts?.maxVisible === 'number' ? Math.max(0, opts.maxVisible) : badges.length
    const visible = badges.slice(0, maxVisible)
    const othersCount = Math.max(0, badges.length - visible.length)

    return (
      <div className="flex flex-wrap gap-1">
        {visible.map((b) => (
          <span key={b.key} className={b.className} title={b.label}>
            {b.label}
          </span>
        ))}

        {opts?.showMoreButton && othersCount > 0 ? (
          <button
            type="button"
            onClick={() => setSelectedCompanyForAudit(obj)}
            className="text-xs font-semibold text-purple-600 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5 hover:bg-purple-100 flex-shrink-0"
          >
            + altri {othersCount}
          </button>
        ) : null}
      </div>
    )
  }
  void renderOpportunities

  return (
    <>
    {previewSite && (
      <SitePreviewPanel
        url={previewSite.url}
        siteName={previewSite.name}
        onClose={() => setPreviewSite(null)}
      />
    )}
    <Card className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
      {missingSignals && hasActiveBusinessFilter && totalUnfilteredCount ? (
        <div className="mx-6 mt-5 mb-0 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <span className="font-semibold">Verifica hiring in corso…</span>
          {' '}I lead sotto sono candidati dalla discovery territoriale. Il dato che hai chiesto (assunzioni Python) è nella colonna{' '}
          <strong className="text-violet-800">ASSUNZIONI</strong> — separata da Pixel/SEO (audit sito).
          {onClearBusinessFilters ? (
            <button
              type="button"
              onClick={onClearBusinessFilters}
              className="ml-2 underline font-medium text-amber-900"
            >
              Rimuovi filtro business
            </button>
          ) : null}
        </div>
      ) : showIntentColumn ? (
        <div className="mx-6 mt-5 mb-0 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
          <span className="font-semibold">Arricchimento attivo.</span>
          {' '}Colonna <strong>{intentColTitle.toUpperCase()}</strong>: viola = corrisponde alla richiesta · giallo = analisi in corso · grigio = nessuna evidenza. Usa{' '}
          <strong>Solo con segnale</strong> per filtrare solo i match confermati.
        </div>
      ) : null}
      <div className="px-6 py-5 border-b border-zinc-100">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Risultati della Ricerca</h3>
            <p className="text-sm text-zinc-500 mt-0.5">
              {isLoading
                ? 'Ricerca in corso…'
                : signalFocused
                  ? isScraping
                    ? `${results.length} aziende · ${signalMatchCount} con segnale confermato · analisi in corso`
                    : `${results.length} aziende · ${signalMatchCount} con segnale confermato`
                  : missingSignals && hasActiveBusinessFilter && totalUnfilteredCount
                    ? `${results.length} candidati — verifica segnale per "${query || '—'}"`
                    : totalUnfilteredCount && totalUnfilteredCount !== results.length
                      ? `${results.length} di ${totalUnfilteredCount} risultati (filtro business attivo) per "${query || '—'}"`
                      : `${results.length} risultati per "${query || '—'}"`}
            </p>
          </div>
          <div className="flex items-center space-x-2">
            {isLoading ? (
              <Badge variant="secondary" className="bg-zinc-100 text-zinc-500 border border-zinc-200 text-xs gap-2">
                <span className="inline-flex animate-spin">
                  <MiraxLogo size={16} showWordmark={false} />
                </span>
                Loading
              </Badge>
            ) : null}
          </div>
        </div>

        {isScraping ? (
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50/70 px-4 py-3">
            <div className="animate-spin rounded-full p-1">
              <MiraxLogo size={28} showWordmark={false} />
            </div>
            <div>
              <p className="text-sm font-semibold text-violet-900">Analisi in tempo reale</p>
              <p className="text-xs text-violet-700">
                MIRAX arricchisce le agenzie trovate: la colonna ASSUNZIONI si aggiorna (giallo → viola o grigio). Il totale non scende.
              </p>
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setSortByScore((v) => !v)}
            title="Ordina per opportunità di vendita: mostra prima le aziende con più problemi da risolvere"
            className={`text-xs px-4 py-2 rounded-lg border font-semibold transition-all ${sortByScore
              ? 'bg-zinc-900 text-white border-zinc-900'
              : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'
            }`}
          >
            {sortByScore ? '↕ Per Opportunità' : '↕ Ordina per opportunità'}
          </button>

          <button
            type="button"
            onClick={() => {
              setSortAlpha(v => v === 'none' ? 'az' : v === 'az' ? 'za' : 'none')
              if (sortAlpha === 'none') setSortByScore(false)
            }}
            title="Ordina i risultati in ordine alfabetico (A→Z o Z→A)"
            className={`text-xs px-4 py-2 rounded-lg border font-semibold transition-all ${sortAlpha !== 'none'
              ? 'bg-zinc-900 text-white border-zinc-900'
              : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'
            }`}
          >
            {sortAlpha === 'az' ? 'A → Z' : sortAlpha === 'za' ? 'Z → A' : 'Ordine Alfabetico'}
          </button>

          <button
            type="button"
            onClick={() => {
              setSortBySignals((v) => !v)
              if (!sortBySignals) {
                setSortByScore(false)
                setSortAlpha('none')
              }
            }}
            title="Ordina per segnali d'acquisto: mette in cima i lead con i problemi piu forti e quantificabili da vendere"
            className={`text-xs px-4 py-2 rounded-lg border font-semibold transition-all ${sortBySignals
              ? 'bg-rose-600 text-white border-rose-600'
              : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'
            }`}
          >
            ↕ Per Segnali d&apos;Acquisto
          </button>

          <button
            type="button"
            onClick={() => setHotOnly((v) => !v)}
            title={
              signalFocused
                ? `Mostra solo le aziende con ${signalFilterLabel.replace('Solo con ', '')} confermato`
                : "Mostra solo i lead caldi/caldissimi: quelli con i segnali d'acquisto piu forti da chiamare subito"
            }
            className={`flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg border font-semibold transition-all ${hotOnly
              ? 'bg-rose-600 text-white border-rose-600'
              : 'bg-white text-rose-600 border-rose-200 hover:border-rose-400'
            }`}
          >
            <Flame className={`h-3.5 w-3.5 ${hotOnly ? 'text-white' : 'text-rose-500'}`} />
            {signalFocused ? signalFilterLabel : 'Solo caldi'}
            {hotCount > 0 ? ` (${hotCount})` : ''}
          </button>

          <button
            type="button"
            onClick={exportCsv}
            title="Scarica tutti i risultati in formato CSV per usarli in Excel o Google Sheets"
            className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg border border-zinc-200 bg-white text-zinc-600 font-semibold hover:border-zinc-400 transition-all"
          >
            ↓ Esporta CSV
          </button>
        </div>
      </div>

      <div className="w-full pb-4">
        <div className="md:hidden px-4 py-4 space-y-3">
          {isLoading ? <div className="text-sm text-slate-500">Caricamento…</div> : null}
          {!isLoading
            ? displayResults.map((item, rowIdx) => {
                const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
                const name = renderLeadString(obj, ['nome', 'azienda', 'company', 'name']) || 'N/D'
                const sito = renderLeadString(obj, ['sito', 'website', 'url'])
                const href = sito ? (sito.startsWith('http') ? sito : `https://${sito}`) : ''
                const telefono = renderLeadString(obj, ['telefono', 'phone'])
                const email = renderLeadString(obj, ['email', 'mail'])
                const citta = renderLeadString(obj, ['citta', 'city'])
                const categoria = renderLeadString(obj, ['categoria', 'category'])
                const score = calcOpportunityScore(obj)
                const { mobile, landline } = extractItalianPhones(telefono)
                const validMobile = mobile && isValidItalianPhone(mobile) ? mobile : null
                const validLandline = landline && isValidItalianPhone(landline) ? landline : null
                const waHref = validMobile ? formatWhatsAppLink(validMobile) : null

                return (
                  <div
                    key={leadKey(item, rowIdx)}
                    className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 truncate">{name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          {citta ? <span className="rounded-full bg-slate-50 border border-slate-200 px-2 py-0.5">{citta}</span> : null}
                          {categoria ? <span className="rounded-full bg-slate-50 border border-slate-200 px-2 py-0.5">{categoria}</span> : null}
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        {focusedSignalQuery ? (
                          (() => {
                            const cell = intentCellForLead(obj, signalIntent)
                            if (!cell) return null
                            return (
                              <div className="flex flex-col items-end gap-1 max-w-[140px]">
                                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cell.className}`}>
                                  {cell.label}
                                </span>
                                {cell.detail ? (
                                  <span className="text-[9px] text-violet-800 text-right line-clamp-2" title={cell.detail}>
                                    {cell.detail}
                                  </span>
                                ) : null}
                              </div>
                            )
                          })()
                        ) : (
                          <>
                            <IntentScoreBadge breakdown={getIntent(item) ?? { score: 0, basePoints: 0, recentMultiplier: 1, strengthMultiplier: 1, relationshipMultiplier: 1, contributors: [], signalTypes: [] }} compact />
                            <ScoreBadge score={score} />
                            <BuyingBadge summary={buyingByItem.get(leadStableKey(obj))} compact />
                            <BusinessSignalBadge signals={getMirax(item)?.businessSignals ?? []} compact />
                            {(getMirax(item)?.intentSignals?.length ?? 0) > 0 ? (
                              <MarketingInvestorBadge compact />
                            ) : null}
                            <LeadComplianceBadge status="unknown" compact />
                            <UniverseHydratedBadge lead={obj} compact />
                          </>
                        )}
                      </div>
                    </div>

                    {href ? (
                      <button
                        type="button"
                        onClick={() => setPreviewSite({ url: href, name: name })}
                        className="mt-2 block text-xs text-violet-700 hover:underline truncate text-left cursor-pointer"
                        title={`Apri anteprima: ${sito}`}
                      >
                        {sito}
                      </button>
                    ) : null}

                    {sito ? <LeadEnrichmentPanel website={sito} leadName={name} lead={obj} /> : null}

                    <div className="mt-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {validMobile ? (
                          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                            <span className="h-2 w-2 rounded-full bg-emerald-400" />
                            <span className="font-mono text-slate-900">{formatPhone(validMobile)}</span>
                            {waHref ? (
                              <a
                                href={waHref}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600"
                                title="Apri WhatsApp"
                              >
                                <MessageCircle className="h-4 w-4" />
                              </a>
                            ) : null}
                          </div>
                        ) : null}

                        {validLandline ? (
                          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                            <span className="h-2 w-2 rounded-full bg-slate-300" />
                            <span className="font-mono text-slate-600">{validLandline}</span>
                          </div>
                        ) : null}

                        {!validMobile && !validLandline ? (
                          <span className="text-xs text-gray-400 italic">N/D</span>
                        ) : null}
                      </div>

                      {(() => {
                        const opportunita = getDetailedOpportunityProblems(obj)
                        if (opportunita.length === 0) return null

                        return (
                          <div className="flex flex-wrap gap-1 mt-2 items-center">
                            {opportunita.slice(0, 2).map((chip, i) => (
                              <span key={`${chip.key}-${i}`} className={`text-xs font-medium px-2 py-0.5 rounded-full border ${chip.className}`}>
                                {chip.label}
                              </span>
                            ))}
                            {opportunita.length > 2 ? (
                              <button
                                type="button"
                                onClick={() => setSelectedCompanyForAudit(obj)}
                                className="text-xs font-semibold text-purple-600 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5 hover:bg-purple-100 flex-shrink-0"
                              >
                                + altri {opportunita.length - 2}
                              </button>
                            ) : null}
                          </div>
                        )
                      })()}

                      <div className="flex items-center gap-2 text-xs text-slate-600">
                        <Mail className="h-4 w-4 text-slate-400" />
                        {email ? (
                          <span className="truncate">{email}</span>
                        ) : isScraping ? (
                          <span className="text-xs text-amber-500 italic animate-pulse">In arrivo...</span>
                        ) : (
                          <span className="text-xs text-gray-400">N/D</span>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col items-stretch gap-1.5">
                      <Link href={`/dashboard/lead/${searchId || '__local__'}/${results.indexOf(item)}`} onClick={() => { try { sessionStorage.setItem('ckb_active_lead', JSON.stringify(item)) } catch {} }}>
                        <button title="Apri la scheda completa del lead: dati aziendali, audit tecnico, contatti e opportunità commerciali." className="w-full flex items-center 
                          justify-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-white font-semibold 
                          text-sm rounded-xl px-4 py-2.5 transition-colors">
                          Dettaglio Lead
                        </button>
                      </Link>
                      <Button
                        size="sm"
                        type="button"
                        onClick={() => openPitch(item)}
                        title="Genera automaticamente un'email di vendita personalizzata per questo lead usando l'AI."
                        className="w-full bg-violet-600 hover:bg-violet-700 text-white font-semibold text-sm rounded-lg px-4 py-2 transition-colors"
                      >
                        <Sparkles className="h-4 w-4" />
                        Genera Pitch
                      </Button>

                      <div className="flex items-center">
                        <InviaCRMButton lead={obj} integrationId={activeCRM?.id ?? null} integrationType={activeCRM?.type ?? null} />
                      </div>

                      <div className="flex items-center">
                        <LeadActionButtons leadWebsite={href || sito || ''} leadNome={name} currentScore={score} />
                      </div>

                      <Button
                        size="sm"
                        type="button"
                        onClick={() => openSave(item)}
                        variant="outline"
                        title="Salva questo lead in una delle tue liste per contattarlo dopo o esportarlo."
                        className="w-full border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 text-sm rounded-lg px-3 py-2 flex items-center gap-1.5 transition-colors"
                      >
                        <BookmarkPlus className="h-4 w-4" />
                        Salva
                      </Button>
                    </div>
                  </div>
                )
              })
            : null}
        </div>

        <div className="hidden md:block">
          <table className="w-full table-fixed text-left text-xs">
            <thead className="sticky top-0 z-10 bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="w-[18%] px-3 py-3 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Nome</th>
                <th className="w-[7%] px-2 py-3 text-center text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Score</th>
                <th className="w-[18%] px-3 py-3 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Contatti</th>
                <th className="w-[10%] px-2 py-3 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Città</th>
                <th className={`${showIntentColumn ? 'w-[10%]' : 'w-[12%]'} px-2 py-3 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-widest`}>Categoria</th>
                {showIntentColumn ? (
                  <th className="w-[14%] px-2 py-3 text-left text-[10px] font-semibold text-violet-700 uppercase tracking-widest bg-violet-50/80">
                    {intentColTitle}
                  </th>
                ) : null}
                <th className={`${showIntentColumn ? 'w-[18%]' : 'w-[24%]'} px-2 py-3 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-widest`}>Opportunità</th>
                <th className="w-[8%] px-2 py-3 text-center text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Rating</th>
                <th className="w-[6%] px-2 py-3 text-center text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Speed</th>
                <th className="min-w-[220px] w-[220px] px-2 py-3 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {isLoading && !isScraping ? skeletonRows : null}

              {!isLoading || isScraping
                ? displayResults.map((item, rowIdx) => (
                    <tr key={leadKey(item, rowIdx)} className={`bg-white hover:bg-zinc-50 transition-colors duration-100 group`}>
                      <td className="px-2 py-3 overflow-hidden align-top">
                        <div className="flex flex-col gap-1 w-full">
                          {(() => {
                            const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
                            const name = renderLeadString(obj, ['nome', 'azienda', 'company', 'name'])
                            const label = name ? name : 'N/D'
                            const href = searchId ? `/dashboard/lead/${searchId}/${rowIdx}` : null
                            return href ? (
                              <div className="flex items-center gap-2">
                                <Link
                                  href={href}
                                  className="font-semibold truncate text-[14px] text-gray-900 hover:text-violet-700 transition-colors"
                                  title={label}
                                >
                                  {label}
                                </Link>
                              </div>
                            ) : (
                              <span className="font-semibold truncate w-full text-[14px] text-gray-900" title={label}>
                                {label}
                              </span>
                            )
                          })()}
                          {(() => {
                            const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
                            const sito = renderLeadString(obj, ['sito', 'website', 'url'])
                            if (!sito) return <span className="text-[11px] text-gray-500">Sito N/D</span>
                            const href = sito.startsWith('http') ? sito : `https://${sito}`
                            return (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setPreviewSite({ url: href, name: renderLeadString(obj, ['nome', 'azienda', 'company', 'name']) || sito })}
                                  className="text-xs text-purple-600 underline underline-offset-2 truncate text-left cursor-pointer"
                                  title={`Apri anteprima: ${sito}`}
                                >
                                  {sito}
                                </button>

                                <div className="mt-1">
                                  <LeadEnrichmentPanel
                                    website={sito}
                                    leadName={renderLeadString(obj, ['nome', 'azienda', 'company', 'name']) || 'N/D'}
                                    lead={obj}
                                  />
                                </div>
                              </>
                            )
                          })()}
                        </div>
                      </td>

                      <td className="px-2 py-3 align-top">
                        <div className="flex flex-col items-center gap-1">
                          {focusedSignalQuery ? (
                            (() => {
                              const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
                              const cell = intentCellForLead(obj, signalIntent)
                              if (!cell) {
                                return <span className="text-[11px] text-gray-400">—</span>
                              }
                              return (
                                <div className="flex flex-col items-center gap-1 min-w-0 max-w-[120px]">
                                  <span
                                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold text-center leading-tight ${cell.className}`}
                                    title={cell.detail || cell.label}
                                  >
                                    {cell.label}
                                  </span>
                                  {cell.detail ? (
                                    <span
                                      className="text-[9px] text-violet-800 text-center line-clamp-2 leading-snug"
                                      title={cell.detail}
                                    >
                                      {cell.detail}
                                    </span>
                                  ) : null}
                                </div>
                              )
                            })()
                          ) : (
                            <>
                              <IntentScoreBadge breakdown={getIntent(item) ?? { score: 0, basePoints: 0, recentMultiplier: 1, strengthMultiplier: 1, relationshipMultiplier: 1, contributors: [], signalTypes: [] }} compact />
                              <ScoreBadge score={calcOpportunityScore(item as Record<string, unknown>)} />
                              <FreshnessBadge lead={item as Record<string, unknown>} />
                              <BuyingBadge summary={buyingByItem.get(leadStableKey(asRecord(item) || {}))} compact />
                              <BusinessSignalBadge signals={getMirax(item)?.businessSignals ?? []} compact />
                              {(getMirax(item)?.intentSignals?.length ?? 0) > 0 ? (
                                <MarketingInvestorBadge compact />
                              ) : null}
                              <LeadComplianceBadge status="unknown" compact />
                              <UniverseHydratedBadge lead={item as Record<string, unknown>} compact />
                            </>
                          )}
                        </div>
                      </td>

                      <td className="px-2 py-3 overflow-hidden align-top">
                        <div className="flex flex-col gap-1.5 w-full">
                          {(() => {
                            const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
                            const telefono = renderLeadString(obj, ['telefono', 'phone'])
                            const email = renderLeadString(obj, ['email', 'mail'])
                            const { mobile, landline } = extractItalianPhones(telefono)
                            const validMobile = mobile && isValidItalianPhone(mobile) ? mobile : null
                            const validLandline = landline && isValidItalianPhone(landline) ? landline : null
                            const waHref = validMobile ? `https://wa.me/39${validMobile.replace(/\D/g, '')}` : null
                            return (
                              <>
                                {validMobile ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                                    <span className="font-mono text-xs font-semibold text-slate-900">{formatPhone(validMobile)}</span>
                                    {waHref ? (
                                      <a
                                        href={waHref}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-600 hover:bg-emerald-100 transition-colors"
                                        title="Apri WhatsApp"
                                      >
                                        <MessageCircle className="h-3.5 w-3.5" />
                                      </a>
                                    ) : null}
                                  </div>
                                ) : null}

                                {validLandline ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full bg-slate-300 shrink-0" />
                                    <span className="font-mono text-xs text-slate-500">{validLandline}</span>
                                  </div>
                                ) : null}

                                {!validMobile && !validLandline ? (
                                  <span className="text-xs text-slate-400 italic">N/D</span>
                                ) : null}

                                <div className="truncate w-full text-gray-500" title={email ? email : 'Email in estrazione...'}>
                                  ✉️ {email ? renderNd(email) : isScraping ? <span className="text-xs text-amber-500 italic animate-pulse">In arrivo...</span> : <span className="text-sm text-gray-900">N/D</span>}
                                </div>
                              </>
                            )
                          })()}
                        </div>
                      </td>

                      <td className="px-2 py-3 overflow-hidden align-top">
                        {(() => {
                          const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
                          const citta = renderLeadString(obj, ['citta', 'city'])
                          return <span className="text-xs text-gray-700 truncate">{citta ? citta : '—'}</span>
                        })()}
                      </td>

                      <td className="px-2 py-3 overflow-hidden align-top">
                        {(() => {
                          const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
                          const categoria = renderLeadString(obj, ['categoria', 'category'])
                          return <span className="text-xs text-gray-700 truncate">{categoria ? categoria : '—'}</span>
                        })()}
                      </td>

                      {showIntentColumn ? (
                        <td className="px-2 py-3 overflow-hidden align-top bg-violet-50/30">
                          {(() => {
                            const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
                            const cell = intentCellForLead(obj, signalIntent)
                            if (!cell) return <span className="text-[11px] text-gray-400">—</span>
                            const chipBase = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border max-w-full'
                            return (
                              <div className="flex flex-col gap-1 min-w-0">
                                <span className={`${chipBase} ${cell.className} truncate`} title={cell.label}>
                                  {cell.label}
                                </span>
                                {cell.detail ? (
                                  <span className="text-[10px] text-violet-800 truncate" title={cell.detail}>
                                    {cell.detail}
                                  </span>
                                ) : null}
                              </div>
                            )
                          })()}
                        </td>
                      ) : null}

                      <td className="px-2 py-3 overflow-hidden align-top">
                        {(() => {
                          const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
                          const techStackRaw = obj.tech_stack ?? obj.techStack
                          const techStack = Array.isArray(techStackRaw) ? techStackRaw.filter((v) => typeof v === 'string') : []
                          const stackStr = techStack.join(' ').toLowerCase()

                          const sito = renderLeadString(obj, ['sito', 'website', 'url'])
                          const missingSite = !sito || stackStr.includes('no website')

                          const technicalReport = asRecord(obj.technical_report)
                          if (isAuditPendingLead(obj)) {
                            return (
                              <div className="flex flex-wrap gap-1 items-center min-w-0">
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                                  Audit in arrivo
                                </span>
                              </div>
                            )
                          }
                          const hasSeoErrors = technicalReport?.seo_disaster === true || stackStr.includes('disastro seo')
                          const errorDetailsRaw = technicalReport?.error_details
                          const errorDetails = Array.isArray(errorDetailsRaw)
                            ? (errorDetailsRaw as unknown[]).filter((v) => typeof v === 'string').map((s) => s.trim()).filter(Boolean)
                            : []

                          const metaPixel = obj.meta_pixel
                          const gtm = obj.google_tag_manager
                          const ssl = obj.ssl
                          const isClaimed = obj.is_claimed
                          const instagramUrl = renderLeadString(obj, ['instagram', 'ig', 'instagram_url', 'instagramUrl'])
                          const facebookUrl = renderLeadString(obj, ['facebook', 'fb', 'facebook_url', 'facebookUrl'])

                          const hasInstagram = !!instagramUrl
                          const hasFacebook = !!facebookUrl

                          const loadSpeedRaw =
                            technicalReport?.load_speed_s ??
                            technicalReport?.load_speed_seconds ??
                            obj.load_speed_s ??
                            obj.load_speed_seconds
                          const loadSpeedSeconds =
                            typeof loadSpeedRaw === 'number'
                              ? loadSpeedRaw
                              : typeof loadSpeedRaw === 'string'
                                ? Number(loadSpeedRaw)
                                : null
                          const isSlow = typeof loadSpeedSeconds === 'number' && Number.isFinite(loadSpeedSeconds) ? loadSpeedSeconds > 3 : false

                          const missingPixel = metaPixel !== true || stackStr.includes('missing fb pixel') || stackStr.includes('no pixel')
                          const missingGTM = gtm !== true || stackStr.includes('missing gtm') || stackStr.includes('no gtm')
                          const missingGoogleAds = technicalReport?.has_google_ads === false || stackStr.includes('missing google ads') || stackStr.includes('no google ads') || stackStr.includes('no ads')
                          const missingAnalytics = !stackStr.includes('ga4') && !stackStr.includes('analytics')
                          const missingSSL =
                            ssl === false ||
                            stackStr.includes('no ssl') ||
                            stackStr.includes('missing ssl') ||
                            stackStr.includes('ssl error')
                          const mobileFriendlyRaw = obj.mobile_friendly ?? obj.is_mobile_friendly ?? technicalReport?.mobile_friendly
                          const missingMobile =
                            mobileFriendlyRaw === false ||
                            stackStr.includes('missing mobile') ||
                            stackStr.includes('no mobile') ||
                            stackStr.includes('not mobile friendly')

                          const missingDmarc = !stackStr.includes('dmarc')

                          const missingSpf = !stackStr.includes('spf')
                          const missingEmailAuth =
                            missingDmarc ||
                            missingSpf ||
                            technicalReport?.has_dmarc === false ||
                            technicalReport?.has_spf === false ||
                            stackStr.includes('missing dmarc') ||
                            stackStr.includes('missing spf') ||
                            stackStr.includes('no dmarc') ||
                            stackStr.includes('no spf')

                          const unclaimedMaps = isClaimed === false

                          const missingIg = !hasInstagram
                          const missingFb = !hasFacebook

                          const techBadges: Array<{ key: string; label: string }> = []
                          const addTech = (key: string, label: string) => {
                            if (!techBadges.some((t) => t.key === key)) techBadges.push({ key, label })
                          }
                          if (stackStr.includes('wordpress')) addTech('wp', 'WordPress')
                          if (stackStr.includes('shopify')) addTech('shopify', 'Shopify')
                          if (stackStr.includes('prestashop') || stackStr.includes('presta')) addTech('prestashop', 'Prestashop')
                          if (stackStr.includes('wix')) addTech('wix', 'Wix')
                          if (stackStr.includes('woocommerce') || stackStr.includes('woo commerce') || stackStr.includes('woo-commerce')) addTech('woocommerce', 'WooCommerce')

                          const activeProblems: Array<{ key: string; label: string; className: string }> = []

                          // Collect all problems (order here does NOT define primary badge).
                          // Primary badge is selected later with absolute priority.
                          if (missingSite) activeProblems.push({ key: 'no_website', label: 'Senza Sito', className: 'bg-zinc-900 text-white border-zinc-900' })
                          if (unclaimedMaps) activeProblems.push({ key: 'unclaimed_maps', label: 'Scheda Non Rivendicata', className: 'bg-zinc-900 text-white border-zinc-900' })
                          if (missingPixel) activeProblems.push({ key: 'no_pixel', label: 'No Pixel', className: 'bg-zinc-900 text-white border-zinc-900' })
                          if (missingGTM) activeProblems.push({ key: 'no_gtm', label: 'No GTM', className: 'bg-zinc-900 text-white border-zinc-900' })
                          if (missingIg) activeProblems.push({ key: 'no_instagram', label: 'No Instagram', className: 'bg-zinc-100 text-zinc-600 border-zinc-200' })
                          if (missingFb) activeProblems.push({ key: 'no_facebook', label: 'No Facebook', className: 'bg-zinc-100 text-zinc-600 border-zinc-200' })
                          if (isSlow) activeProblems.push({ key: 'slow_speed', label: 'Sito Lento', className: 'bg-zinc-200 text-zinc-700 border-zinc-300' })
                          if (hasSeoErrors || (Array.isArray(errorDetails) && errorDetails.length > 0)) {
                            activeProblems.push({ key: 'seo_errors', label: 'Errori SEO', className: 'bg-zinc-900 text-white border-zinc-900' })
                          }

                          // Keep other existing signals available for the audit modal / counting, but not necessarily primary.
                          if (missingAnalytics) activeProblems.push({ key: 'no_ga4', label: 'No GA4', className: 'bg-zinc-900 text-white border-zinc-900' })
                          if (missingGoogleAds) activeProblems.push({ key: 'no_google_ads', label: 'No Google Ads', className: 'bg-zinc-900 text-white border-zinc-900' })
                          if (missingMobile) activeProblems.push({ key: 'no_mobile', label: 'No Mobile', className: 'bg-zinc-200 text-zinc-700 border-zinc-300' })
                          if (missingSSL) activeProblems.push({ key: 'no_ssl', label: 'No SSL', className: 'bg-zinc-200 text-zinc-700 border-zinc-300' })
                          if (missingEmailAuth || technicalReport?.dmarc_ok === false) {
                            activeProblems.push({ key: 'spam_risk', label: 'Rischio Spam', className: 'bg-zinc-900 text-white border-zinc-900' })
                          }

                          const uniqueProblems = activeProblems.filter((p, i, arr) => arr.findIndex((x) => x.key === p.key) === i)

                          const requested = requestedIssues
                          const visibleTone = 'bg-zinc-900 text-white border-zinc-900'

                          const requestedKeys: string[] = []
                          const qLower = String(query || '').toLowerCase()
                          const wantsGoogleAds =
                            qLower.includes('google ads') ||
                            qLower.includes('ads su google') ||
                            qLower.includes('senza ads') ||
                            qLower.includes('no ads')
                          if (requested?.has('maps')) requestedKeys.push('unclaimed_maps')
                          if (requested?.has('pixel')) requestedKeys.push('no_pixel')
                          if (requested?.has('gtm')) requestedKeys.push('no_gtm')
                          if (wantsGoogleAds || requested?.has('google_ads')) requestedKeys.push('no_google_ads')
                          if (requested?.has('no_instagram')) requestedKeys.push('no_instagram')
                          if (requested?.has('no_facebook')) requestedKeys.push('no_facebook')
                          if (requested?.has('speed')) requestedKeys.push('slow_speed')
                          if (requested?.has('seo') || requested?.has('html') || /errori?\s*(seo|html)|seo\s*error/i.test(query)) requestedKeys.push('seo_errors')
                          // Direct query fallbacks for ALL badge types
                          if (/senza\s*(meta\s*)?pixel|no\s*pixel/i.test(query) && !requestedKeys.includes('no_pixel')) requestedKeys.push('no_pixel')
                          if (/senza\s*gtm|no\s*gtm|senza\s*tag\s*manager/i.test(query) && !requestedKeys.includes('no_gtm')) requestedKeys.push('no_gtm')
                          if (/senza\s*ssl|no\s*ssl/i.test(query) && !requestedKeys.includes('no_ssl')) requestedKeys.push('no_ssl')
                          if (/senza\s*instagram|no\s*instagram|senza\s*ig\b/i.test(query) && !requestedKeys.includes('no_instagram')) requestedKeys.push('no_instagram')
                          if (/senza\s*facebook|no\s*facebook|senza\s*fb\b/i.test(query) && !requestedKeys.includes('no_facebook')) requestedKeys.push('no_facebook')
                          if (/sito\s*lento|slow\s*(site|speed)/i.test(query) && !requestedKeys.includes('slow_speed')) requestedKeys.push('slow_speed')
                          if (/senza\s*dmarc|no\s*dmarc|rischio\s*spam/i.test(query) && !requestedKeys.includes('spam_risk')) requestedKeys.push('spam_risk')
                          if (/non\s*mobile|no\s*mobile|senza\s*mobile/i.test(query) && !requestedKeys.includes('no_mobile')) requestedKeys.push('no_mobile')
                          if (/senza\s*(google\s*)?analytics|no\s*analytics|senza\s*ga4|no\s*ga4/i.test(query) && !requestedKeys.includes('no_ga4')) requestedKeys.push('no_ga4')
                          if (/senza\s*sito|no\s*website/i.test(query) && !requestedKeys.includes('no_website')) requestedKeys.push('no_website')

                          const visibleBadges: Array<{ key: string; label: string; className: string }> = []
                          const addVisible = (p: { key: string; label: string; className: string }) => {
                            if (!visibleBadges.some((x) => x.key === p.key)) visibleBadges.push({ ...p, className: visibleTone })
                          }

                          // PRIMA: mostra badge che matchano la query dell'utente (es. "Errori SEO")
                          if (requestedKeys.length > 0) {
                            for (const k of requestedKeys) {
                              const p = uniqueProblems.find((x) => x.key === k)
                              if (p) addVisible(p)
                            }
                          }

                          // Regola: "Senza Sito" deve comparire se presente (dopo il badge richiesto).
                          const noSiteProblem = uniqueProblems.find((p) => p.key === 'no_website')
                          if (noSiteProblem) addVisible(noSiteProblem)

                          // Fallback: ricerca generica (nessun filtro specifico) => mostra un solo problema più grave.
                          if (visibleBadges.length === 0) {
                            const priorityOrder = [
                              'seo_errors',
                              'no_website',
                              'unclaimed_maps',
                              'no_pixel',
                              'no_gtm',
                              ...(wantsGoogleAds ? (['no_google_ads'] as const) : []),
                              'no_instagram',
                              'no_facebook',
                              'slow_speed',
                              ...(!wantsGoogleAds ? (['no_google_ads'] as const) : []),
                            ]
                            const primary = priorityOrder
                              .map((k) => uniqueProblems.find((p) => p.key === k))
                              .find(Boolean)
                            const first = primary ?? uniqueProblems[0]
                            if (!first) return <span className="text-[11px] text-gray-500">—</span>
                            addVisible(first)
                          }

                          const othersCount = uniqueProblems.filter((p) => !visibleBadges.some((v) => v.key === p.key)).length
                          const remainingOpportunities = uniqueProblems
                            .filter((p) => !visibleBadges.some((v) => v.key === p.key))
                            .map((p) => p.label)

                          return (
                            <div className="flex flex-wrap items-center gap-1">
                              {visibleBadges.map((b) => {
                                const chipBase = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border'

                                const tone =
                                  b.key === 'no_pixel'
                                    ? 'bg-red-100 text-red-700 border-red-200'
                                    : b.key === 'no_gtm'
                                      ? 'bg-orange-100 text-orange-700 border-orange-200'
                                      : b.key === 'no_ssl'
                                        ? 'bg-yellow-100 text-yellow-700 border-yellow-200'
                                        : b.key === 'seo_errors'
                                          ? 'bg-red-50 text-red-600 border-red-200'
                                          : b.key === 'no_google_ads'
                                            ? 'bg-blue-100 text-blue-700 border-blue-200'
                                            : 'bg-gray-100 text-gray-700 border-gray-200'

                                return (
                                  <button
                                    key={b.key}
                                    type="button"
                                    onClick={() => {
                                      if (b.key === 'seo_errors') setSelectedCompanyForAudit(obj)
                                    }}
                                    className={`${chipBase} ${tone} ${b.key === 'seo_errors' ? 'hover:brightness-95' : ''}`}
                                  >
                                    {b.label}
                                  </button>
                                )
                              })}

                              {othersCount > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setSelectedCompanyForAudit(obj)}
                                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200/60"
                                >
                                  <span title={remainingOpportunities.join(', ')} className="cursor-help underline decoration-dotted">
                                    + altri {othersCount}
                                  </span>
                                </button>
                              ) : null}
                            </div>
                          )
                        })()}
                      </td>

                      <td className="px-2 py-3 overflow-hidden align-top">
                        <div className="flex items-center justify-center">
                          {(() => {
                            const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
                            const rating = renderLeadNumber(obj, ['rating', 'google_rating', 'reputation_rating'])
                            if (typeof rating === 'number' && rating > 0) {
                              return (
                                <div className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5">
                                  <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                                  <span className="text-xs text-slate-900 tabular-nums">{rating.toFixed(1)}</span>
                                </div>
                              )
                            }

                            return (
                              <Badge variant="secondary" className="bg-slate-100 text-slate-600 border border-slate-200 text-[10px] px-1.5 py-0.5 leading-none">
                                N/D
                              </Badge>
                            )
                          })()}
                        </div>

                        <div className="mt-1 flex items-center justify-center">
                          {(() => {
                            const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
                            const tr = asRecord(obj.technical_report)
                            const raw = tr?.load_speed_seconds ?? tr?.load_speed_s ?? obj.load_speed_seconds ?? obj.load_speed_s
                            const seconds = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : null
                            if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return <span className="text-[10px] text-slate-400">—</span>

                            const tone = seconds < 2 ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : seconds <= 4 ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-rose-700 bg-rose-50 border-rose-200'

                            return (
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone}`}>
                                {seconds.toFixed(1)}s
                              </span>
                            )
                          })()}
                        </div>
                      </td>

                      <td className="px-2 py-3 overflow-hidden align-top">
                        <div className="flex items-center justify-center gap-2">
                          <Gauge className="h-4 w-4 text-slate-500" />
                          {(() => {
                            const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
                            const pageSpeed = renderLeadNumber(obj, ['page_speed', 'pageSpeed', 'pagespeed'])
                            return (
                              <>
                                <span className="text-xs tabular-nums text-slate-900">{typeof pageSpeed === 'number' ? pageSpeed : '—'}</span>
                                {getSpeedBadge(pageSpeed)}
                              </>
                            )
                          })()}
                        </div>
                      </td>

                      <td className="min-w-[220px] w-[220px] px-2 py-3 overflow-visible align-top">
                        <div className="flex flex-col items-stretch gap-1.5">
                          <Link href={`/dashboard/lead/${searchId || '__local__'}/${results.indexOf(item)}`} onClick={() => { try { sessionStorage.setItem('ckb_active_lead', JSON.stringify(item)) } catch {} }}>
                            <Button
                              size="sm"
                              type="button"
                              title="Apri la scheda completa del lead: dati aziendali, audit tecnico, contatti e opportunità commerciali."
                              className="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-semibold text-xs rounded-lg px-3 py-2 transition-colors"
                            >
                              Dettaglio Lead
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            type="button"
                            onClick={() => openPitch(item)}
                            title="Genera automaticamente un'email di vendita personalizzata per questo lead usando l'AI."
                            className="w-full bg-violet-600 hover:bg-violet-700 text-white font-semibold text-xs rounded-lg px-3 py-2 transition-colors"
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            Genera Pitch
                          </Button>

                          {(() => {
                            const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
                            return (
                              <div className="flex items-center">
                                <InviaCRMButton lead={obj} integrationId={activeCRM?.id ?? null} integrationType={activeCRM?.type ?? null} />
                              </div>
                            )
                          })()}

                          {(() => {
                            const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
                            const sito = renderLeadString(obj, ['sito', 'website', 'url'])
                            const name = renderLeadString(obj, ['nome', 'azienda', 'company', 'name']) || 'N/D'
                            const score = calcOpportunityScore(obj)
                            return (
                              <div className="flex items-center">
                                <LeadActionButtons leadWebsite={sito || ''} leadNome={name} currentScore={score} />
                              </div>
                            )
                          })()}

                          <Button
                            size="sm"
                            type="button"
                            onClick={() => openSave(item)}
                            variant="outline"
                            title="Salva questo lead in una delle tue liste per contattarlo dopo o esportarlo."
                            className="w-full border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 text-xs rounded-lg px-3 py-1.5 flex items-center gap-1.5 transition-colors"
                          >
                            <BookmarkPlus className="h-3.5 w-3.5" />
                            Salva
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog
        open={pitchOpen}
        onOpenChange={(open) => {
          setPitchOpen(open)
          if (!open) {
            setPitchLead(null)
            setPitchSubject('')
            setPitchBody('')
            setPitchError(null)
            setPitchLoading(false)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pitch Commerciale</DialogTitle>
            <DialogDescription>
              {pitchLead && typeof pitchLead.nome === 'string' && pitchLead.nome.trim() ? (pitchLead.nome as string) : 'Lead selezionato'}
              {pitchLead && typeof pitchLead.citta === 'string' && pitchLead.citta.trim() ? ` · ${pitchLead.citta}` : ''}
              {pitchLead && typeof pitchLead.categoria === 'string' && pitchLead.categoria.trim() ? ` · ${pitchLead.categoria}` : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-4 space-y-4">
            {pitchLoading ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-3 text-slate-700">
                  <div className="w-5 h-5 rounded-full border-2 border-slate-300 border-t-slate-700 animate-spin" />
                  <span className="text-sm">Sto scrivendo una mail personalizzata…</span>
                </div>
              </div>
            ) : pitchError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{pitchError}</div>
            ) : pitchSubject && pitchBody ? (
              <div className="rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-4 py-3">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Oggetto</div>
                  <div className="mt-1 text-sm text-slate-900 font-medium">{pitchSubject}</div>
                </div>
                <div className="px-4 py-3">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Corpo</div>
                  <pre className="mt-2 whitespace-pre-wrap text-sm text-slate-900 font-sans">{pitchBody}</pre>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                Nessun contenuto disponibile.
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPitchOpen(false)}>
              Chiudi
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pitchLoading || !pitchSubject || !pitchBody}
              onClick={async () => {
                try {
                  await copyPitch()
                } catch {
                  // ignore
                }
              }}
            >
              <Copy className="h-4 w-4" />
              Copia testo
            </Button>
            <Button type="button" disabled={pitchLoading || !mailtoHref} asChild>
              <a href={mailtoHref ?? undefined}>
                <Mail className="h-4 w-4" />
                Apri nel client mail
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={saveOpen}
        onOpenChange={(open) => {
          setSaveOpen(open)
          if (!open) {
            setSaveLead(null)
            setSaveError(null)
            setSaveSuccess(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Salva in Lista</DialogTitle>
            <DialogDescription>
              Scegli dove archiviare questo lead. Se hai un webhook attivo, MIRAX invierà i dati in automatico.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-4 space-y-4">
            {saveError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{saveError}</div>
            ) : null}

            {saveSuccess ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{saveSuccess}</div>
            ) : null}

            <div className="space-y-2">
              <div className="text-sm font-semibold text-slate-900">Lista</div>
              <div className="relative">
                <select
                  value={selectedListId}
                  onChange={(e) => setSelectedListId(e.target.value)}
                  disabled={listsLoading || saveLoading || lists.length === 0}
                  className="w-full h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
                >
                  {lists.length === 0 ? <option value="">Nessuna lista</option> : null}
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              {listsLoading ? <div className="text-xs text-slate-500">Caricamento liste…</div> : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">Crea nuova lista</div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="Nome lista"
                  className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  disabled={saveLoading}
                />
                <input
                  value={newListDescription}
                  onChange={(e) => setNewListDescription(e.target.value)}
                  placeholder="Descrizione (opzionale)"
                  className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  disabled={saveLoading}
                />
              </div>
              <div className="mt-3">
                <Button type="button" variant="outline" onClick={handleCreateList} disabled={saveLoading}>
                  Crea lista
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSaveOpen(false)} disabled={saveLoading}>
              Chiudi
            </Button>
            <Button
              type="button"
              onClick={handleSaveLead}
              disabled={saveLoading || !selectedListId}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {saveLoading ? 'Salvataggio…' : 'Salva Lead'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {auditData ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <button
            type="button"
            aria-label="Chiudi"
            onClick={() => setSelectedCompanyForAudit(null)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="relative w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Analisi Tecnica</div>
                <div className="mt-1 text-lg font-bold text-slate-900">{auditData.nome}</div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCompanyForAudit(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              >
                ×
              </button>
            </div>

            <div className="px-5 py-4 space-y-5">
              <div>
                <div className="text-sm font-semibold text-slate-900">Errori SEO</div>
                {auditData.errorDetails.length > 0 ? (
                  <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                    <ul className="list-disc pl-5 space-y-1">
                      {auditData.errorDetails.slice(0, 30).map((d, idx) => (
                        <li key={idx} className="break-words">{d}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">Nessun dettaglio SEO disponibile.</div>
                )}
              </div>

              <div>
                <div className="text-sm font-semibold text-slate-900">Mancanze e Problemi (Priorità)</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {auditData.problemBadges.length > 0 ? (
                    auditData.problemBadges.map((b, idx) => (
                      <span
                        key={`${b.label}-${idx}`}
                        className="inline-flex items-center px-2 py-1 rounded border text-[11px] font-semibold leading-none bg-red-100 text-red-800 border-red-200"
                      >
                        {b.label}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-slate-600">Nessuna mancanza rilevata.</span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold text-slate-900">Stack Tecnologico (Presente)</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {auditData.stackBadges.length > 0 ? (
                    auditData.stackBadges.map((b, idx) => {
                      const cls = b.tone === 'ok' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-blue-50 text-blue-700 border-blue-200'
                      return (
                        <span key={`${b.label}-${idx}`} className={`inline-flex items-center px-2 py-1 rounded border text-[11px] font-semibold leading-none ${cls}`}>
                          {b.label}
                        </span>
                      )
                    })
                  ) : (
                    <span className="text-sm text-slate-600">Stack non disponibile.</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
    </>
  )
}

export default ResultsTable
