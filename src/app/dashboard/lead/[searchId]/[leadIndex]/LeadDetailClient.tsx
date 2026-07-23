'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  Copy,
  ExternalLink,
  Facebook,
  Instagram,
  Linkedin,
  Mail,
  Minus,
  Sparkles,
  Star,
  Smartphone,
  Megaphone,
  Target,
  TrendingUp,
  Building2,
  Video,
  Check,
  Loader2,
  Phone,
  Shield,
  Users,
  Briefcase,
  MapPin,
  Globe,
  Lock,
} from 'lucide-react'
import { calcOpportunityScore } from '@/components/ResultsTable'
import { generatePitchAction } from '@/app/dashboard/actions'
import { trackInteraction } from '@/app/dashboard/scoring/actions'
import { useDashboard } from '@/components/DashboardContext'
import { OutreachLauncher } from '@/components/OutreachLauncher'
import { useOutreachStatus } from '@/hooks/useOutreachStatus'
import FreeIntelPanel from './FreeIntelPanel'
import { UniverseLeadPanel } from '@/components/universe/UniverseLeadPanel'

type LeadDetailClientProps = {
  lead: any | null
  searchId: string
  leadIndex: number
  category?: string | null
  location?: string | null
}

function getScoreVariant(score: number): { label: 'COLD' | 'WARM' | 'HOT'; className: string } {
  if (score >= 70) return { label: 'HOT', className: 'bg-rose-600 text-white' }
  if (score >= 40) return { label: 'WARM', className: 'bg-amber-500 text-white' }
  return { label: 'COLD', className: 'bg-slate-200 text-slate-800' }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function toHref(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  return s.startsWith('http') ? s : `https://${s}`
}

function daysSince(raw: string | null): number | null {
  if (!raw) return null
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) return null
  return Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24))
}

function formatFollowers(n: number | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '—'
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

export default function LeadDetailClient({ lead: leadProp, searchId, leadIndex, category, location }: LeadDetailClientProps) {
  const { setCredits } = useDashboard()
  const outreach = useOutreachStatus()
  // Fallback: read from sessionStorage if lead was not provided by the server
  const [sessionLead, setSessionLead] = useState<any>(null)
  useEffect(() => {
    try {
      // Primary bulletproof method: the clicked lead
      const activeRaw = sessionStorage.getItem('ckb_active_lead')
      if (activeRaw) {
        setSessionLead(JSON.parse(activeRaw))
        // Non rimuoviamo subito altrimenti un refresh della pagina lo perderebbe
        return
      }

      if (leadProp) {
        // Usa i dati passati dal server
        return
      }

      // Fallback
      const raw = sessionStorage.getItem('ckb_results')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed[leadIndex]) {
          setSessionLead(parsed[leadIndex])
        }
      }
    } catch {}
  }, [leadProp, leadIndex])

  // Se c'è sessionLead (ovvero abbiamo preso ckb_active_lead o letto dallo storage), usa quello. Altrimenti usa leadProp.
  const lead = sessionLead || leadProp

  const score = useMemo(() => {
    try {
      return calcOpportunityScore(lead && typeof lead === 'object' ? (lead as any) : {})
    } catch {
      return 0
    }
  }, [lead])

  const scoreMeta = useMemo(() => getScoreVariant(score), [score])

  // Derived values — safe to compute even when lead is null (all default to '')
  const nome = isNonEmptyString(lead?.nome) ? lead.nome : isNonEmptyString(lead?.azienda) ? lead.azienda : ''
  const citta = isNonEmptyString(lead?.citta) ? lead.citta : isNonEmptyString(lead?.city) ? lead.city : ''
  const categoria = isNonEmptyString(lead?.categoria) ? lead.categoria : isNonEmptyString(lead?.category) ? lead.category : ''

  const telefono = isNonEmptyString(lead?.telefono) ? lead.telefono : isNonEmptyString(lead?.phone) ? lead.phone : ''
  const email = isNonEmptyString(lead?.email) ? lead.email : ''
  const sitoRaw = isNonEmptyString(lead?.sito) ? lead.sito : isNonEmptyString(lead?.website) ? lead.website : isNonEmptyString(lead?.url) ? lead.url : ''
  const sitoHref = sitoRaw ? toHref(sitoRaw) : ''
  const indirizzo = isNonEmptyString(lead?.indirizzo)
    ? lead.indirizzo
    : isNonEmptyString(lead?.address)
      ? lead.address
      : isNonEmptyString(lead?.via)
        ? lead.via
        : ''
  const techStack: string[] = Array.isArray(lead?.tech_stack)
    ? (lead.tech_stack as unknown[]).filter((v) => typeof v === 'string')
    : Array.isArray(lead?.techStack)
      ? (lead.techStack as unknown[]).filter((v) => typeof v === 'string')
      : []

  const stackStr = techStack.join(' ').toLowerCase()
  const technicalReport = lead?.technical_report && typeof lead.technical_report === 'object' ? (lead.technical_report as any) : null

  const hasWebsite =
    Boolean(sitoHref) &&
    !['n/d', 'n/a', 'n.d.'].includes(sitoRaw.trim().toLowerCase()) &&
    !stackStr.includes('no website')

  const sslOk = hasWebsite && (lead?.ssl === true || (typeof sitoHref === 'string' && sitoHref.startsWith('https://')))
  const hasPixel = hasWebsite && lead?.meta_pixel === true && !stackStr.includes('no pixel') && !stackStr.includes('missing fb pixel')
  const hasGtm = hasWebsite && lead?.google_tag_manager === true && !stackStr.includes('no gtm') && !stackStr.includes('missing gtm')
  const hasGoogleAds =
    hasWebsite &&
    (technicalReport?.has_google_ads === true || lead?.google_ads === true) &&
    !stackStr.includes('no google ads') &&
    !stackStr.includes('missing google ads') &&
    !stackStr.includes('no ads')

  const loadSpeedRaw =
    technicalReport?.load_speed_s ??
    technicalReport?.load_speed_seconds ??
    lead?.load_speed_s ??
    lead?.load_speed_seconds

  const loadSpeedSeconds = typeof loadSpeedRaw === 'number' ? loadSpeedRaw : typeof loadSpeedRaw === 'string' ? Number(loadSpeedRaw) : null

  const speedTone =
    typeof loadSpeedSeconds === 'number' && Number.isFinite(loadSpeedSeconds)
      ? loadSpeedSeconds < 2
        ? 'text-emerald-600'
        : loadSpeedSeconds <= 4
          ? 'text-amber-600'
          : 'text-rose-600'
      : 'text-slate-500'

  const seoErrors: string[] = Array.isArray(lead?.html_errors)
    ? (lead.html_errors as unknown[]).filter((v) => typeof v === 'string')
    : Array.isArray(lead?.htmlErrors)
      ? (lead.htmlErrors as unknown[]).filter((v) => typeof v === 'string')
      : []

  const opportunityItems = useMemo(() => {
    if (!lead) return []
    const out: string[] = []
    if (!sslOk) out.push('SSL non attivo')
    if (!hasPixel) out.push('Meta Pixel assente')
    if (!hasGtm) out.push('Google Tag Manager assente')
    if (!hasGoogleAds) out.push('Google Ads assente')
    if (typeof loadSpeedSeconds === 'number' && Number.isFinite(loadSpeedSeconds) && loadSpeedSeconds > 3) out.push('Sito lento')
    if (seoErrors.length > 0) out.push('Errori SEO/HTML presenti')
    if (techStack.length > 0) out.push('Tech stack identificato')
    return out
  }, [lead, hasGoogleAds, hasGtm, hasPixel, loadSpeedSeconds, seoErrors.length, sslOk, techStack.length])

  const [reviews, setReviews] = useState<any>(null)
  const [social, setSocial] = useState<any>(null)
  const [ads, setAds] = useState<any>(null)
  const [competitors, setCompetitors] = useState<any>(null)
  const [trends, setTrends] = useState<any>(null)
  const [registry, setRegistry] = useState<any>(null)
  const [loadingReviews, setLoadingReviews] = useState(true)
  const [loadingSocial, setLoadingSocial] = useState(true)
  const [loadingAds, setLoadingAds] = useState(true)
  const [loadingCompetitors, setLoadingCompetitors] = useState(true)
  const [loadingTrends, setLoadingTrends] = useState(true)
  const [loadingRegistry, setLoadingRegistry] = useState(true)
  const [clayData, setClayData] = useState<any>(null)
  const [loadingClay, setLoadingClay] = useState(true)
  const displayTelefono = telefono || clayData?.bestPhone || clayData?.mobilePhone || clayData?.allPhones?.[0]?.number || ''
  const displayEmail = email || clayData?.bestEmail || clayData?.allEmails?.[0]?.email || clayData?.pecEmail || ''
  const displayIndirizzo = indirizzo || clayData?.sedeLegale || ''
  const [companyUnlock, setCompanyUnlock] = useState<any>(null)
  const [ownerUnlock, setOwnerUnlock] = useState<any>(null)
  const [unlockLoading, setUnlockLoading] = useState<'company' | 'owner' | null>(null)
  const [unlockError, setUnlockError] = useState<string | null>(null)

  const [monitorStatus, setMonitorStatus] = useState<'idle' | 'saving' | 'monitored' | 'error'>('idle')
  const [monitorError, setMonitorError] = useState<string | null>(null)

  const [pitchLoading, setPitchLoading] = useState(false)
  const [pitchResult, setPitchResult] = useState<{ subject: string; body: string } | null>(null)
  const [pitchError, setPitchError] = useState<string | null>(null)
  const [showPitchModal, setShowPitchModal] = useState(false)

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const [coldEmail, setColdEmail] = useState('')

  const hasContactOrSocialData = (data: any) => Boolean(
    data?.bestEmail ||
    data?.bestPhone ||
    data?.mobilePhone ||
    data?.pecEmail ||
    (Array.isArray(data?.allEmails) && data.allEmails.length > 0) ||
    (Array.isArray(data?.allPhones) && data.allPhones.length > 0) ||
    data?.linkedinCompany ||
    data?.linkedinPerson ||
    data?.facebook ||
    data?.instagram ||
    data?.tiktok ||
    data?.youtube ||
    data?.twitter
  )

  useEffect(() => {
    if (!lead) return
    const name = encodeURIComponent(lead?.nome || lead?.azienda || '')
    const city = encodeURIComponent(lead?.citta || lead?.city || '')
    const website = encodeURIComponent(lead?.sito || lead?.website || lead?.url || '')
    const cat = encodeURIComponent(category || lead?.categoria || lead?.category || '')

    // Generatore di chiave univoca per questo specifico lead
    const leadId = String((lead?.nome || lead?.azienda || '') + (lead?.sito || lead?.website || '')).replace(/[^a-zA-Z0-9]/g, '').toLowerCase()

    const fetchWithCache = async (key: string, url: string, options?: RequestInit) => {
      const fullKey = `ckb_cache_${leadId}_${key}`
      try {
        const cached = sessionStorage.getItem(fullKey)
        if (cached) return JSON.parse(cached)
      } catch {}
      
      const r = await fetch(url, options)
      const d = await r.json()
      
      try { sessionStorage.setItem(fullKey, JSON.stringify(d)) } catch {}
      return d
    }

    setLoadingReviews(true)
    setLoadingSocial(true)
    setLoadingAds(true)
    setLoadingCompetitors(true)
    setLoadingTrends(true)
    setLoadingRegistry(true)

    fetchWithCache('reviews', '/api/lead-reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead: {
          ...lead,
          nome: lead?.nome || lead?.azienda || lead?.business_name || '',
          citta: lead?.citta || lead?.city || location || '',
        },
      }),
    })
      .then((d) => setReviews(d))
      .catch(() => setReviews(null))
      .finally(() => setLoadingReviews(false))

    fetchWithCache('social', '/api/lead-social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead }),
    })
      .then((d) => setSocial(d))
      .catch(() => setSocial(null))
      .finally(() => setLoadingSocial(false))

    const techReport = (lead?.technical_report && typeof lead.technical_report === 'object') ? lead.technical_report as Record<string, unknown> : {}
    const metaPixelFlag = (lead?.meta_pixel === true || lead?.has_pixel === true || techReport?.has_facebook_pixel === true) ? '1' : '0'
    const googleAdsTagFlag = (lead?.google_ads === true || techReport?.has_google_ads === true) ? '1' : '0'
    fetchWithCache('ads', `/api/lead-ads?name=${name}&website=${website}&city=${city}&category=${cat}&metaPixel=${metaPixelFlag}&googleAdsTag=${googleAdsTagFlag}`)
      .then((d) => setAds(d))
      .catch(() => setAds(null))
      .finally(() => setLoadingAds(false))

    fetchWithCache('competitors', '/api/lead-competitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead: {
          ...lead,
          categoria: lead?.categoria || lead?.category || category || '',
          citta: lead?.citta || lead?.city || location || '',
        },
      }),
    })
      .then((d) => setCompetitors(d))
      .catch(() => setCompetitors(null))
      .finally(() => setLoadingCompetitors(false))

    fetchWithCache('trends', `/api/lead-trends?category=${cat}&city=${city}`)
      .then((d) => setTrends(d))
      .catch(() => setTrends(null))
      .finally(() => setLoadingTrends(false))

    fetchWithCache('registry', '/api/lead-registry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead: {
          ...lead,
          categoria: lead?.categoria || lead?.category || category || '',
          citta: lead?.citta || lead?.city || location || '',
          indirizzo: lead?.indirizzo || lead?.address || lead?.via || '',
        },
      }),
    })
      .then((d) => setRegistry(d))
      .catch(() => setRegistry(null))
      .finally(() => setLoadingRegistry(false))

    // Clay-style enrichment (all sources)
    const clayLeadPayload = {
      nome: lead?.nome || lead?.azienda || lead?.business_name || '',
      sito: lead?.sito || lead?.website || lead?.url || '',
      telefono: lead?.telefono || lead?.phone || '',
      email: lead?.email || '',
      citta: lead?.citta || lead?.city || location || '',
      categoria: lead?.categoria || lead?.category || category || '',
      indirizzo: lead?.indirizzo || lead?.address || lead?.via || '',
    }
    setLoadingClay(true)
    fetchWithCache('clay', '/api/enrich-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead: clayLeadPayload }),
    })
      .then(async (d) => {
        setClayData(d)
        if (sitoRaw && !hasContactOrSocialData(d)) {
          const res = await fetch('/api/enrich-lead?refresh=1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lead: clayLeadPayload, forceRefresh: true }),
          })
          const fresh = await res.json().catch(() => null)
          if (fresh && !fresh.error) {
            setClayData(fresh)
            try { sessionStorage.setItem(`ckb_cache_${leadId}_clay`, JSON.stringify(fresh)) } catch {}
          }
        }
      })
      .catch(() => setClayData(null))
      .finally(() => setLoadingClay(false))
  }, [lead, category])

  useEffect(() => {
    const baseName = nome || 'Ciao'
    setColdEmail(
      `Oggetto: Una proposta per ${baseName}\n\nCiao ${baseName},\n\nHo notato alcune opportunità sul vostro sito e credo si possa migliorare rapidamente performance e tracciamenti.\n\nSe ti va, posso mandarti un audit rapido (gratuito) con 3 interventi prioritari.\n\nTi interessa parlarne?\n\nGrazie,\n[Il tuo nome]`
    )
  }, [nome])

  if (!lead) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-slate-500">Caricamento dettaglio lead...</p>
      </div>
    )
  }

  const copyToClipboard = async (text?: string) => {
    try {
      await navigator.clipboard.writeText(text || coldEmail)
    } catch {
      // ignore
    }
  }

  const onGeneraPitch = async () => {
    setPitchLoading(true)
    setPitchError(null)
    try {
      const result = await generatePitchAction({
        nome: nome || '',
        sito: sitoRaw || '',
        citta: citta || '',
        categoria: categoria || '',
        email: email || '',
        rating: lead?.rating ?? null,
        tech_stack: techStack,
        html_errors: seoErrors,
        page_speed: loadSpeedSeconds,
      })
      setPitchResult(result)
      setShowPitchModal(true)
    } catch (e) {
      setPitchError(e instanceof Error ? e.message : 'Errore generazione pitch')
    } finally {
      setPitchLoading(false)
    }
  }

  const onSalva = async () => {
    setSaveStatus('saving')
    try {
      const existing = JSON.parse(sessionStorage.getItem('ckb_saved_leads') || '[]')
      const alreadySaved = existing.some((l: any) => (l?.nome === nome && l?.sito === sitoRaw))
      if (!alreadySaved) {
        existing.push({ ...lead, saved_at: new Date().toISOString() })
        sessionStorage.setItem('ckb_saved_leads', JSON.stringify(existing))
      }
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }

  const onMonitorLead = async () => {
    try {
    setMonitorError(null)
    setMonitorStatus('saving')
    setMonitorError(null)

    const res = await fetch('/api/monitor-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        searchId,
        leadIndex,
        leadName: nome,
        leadWebsite: sitoRaw,
        leadCity: citta || location || '',
        leadCategory: categoria || category || '',
      }),
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as any

    if (data?.id || data?.monitor?.id || data?.success === true) {
      setMonitorStatus('monitored')
      return
    }

    setMonitorStatus('error')
    setMonitorError('Risposta non valida')
  } catch (e) {
    setMonitorStatus('error')
    setMonitorError(e instanceof Error ? e.message : 'Errore')
  }

  }

  const unlockBusinessData = async (type: 'company' | 'owner') => {
    if (!lead || unlockLoading) return
    setUnlockLoading(type)
    setUnlockError(null)
    try {
      const res = await fetch('/api/business-data-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          lead: {
            ...lead,
            partita_iva: lead?.partita_iva || lead?.partitaIva || clayData?.partitaIva || registry?.partita_iva || '',
            nome: nome || lead?.nome || lead?.azienda || '',
            citta: citta || lead?.citta || lead?.city || '',
            sito: sitoRaw || lead?.sito || lead?.website || '',
            indirizzo: indirizzo || lead?.indirizzo || lead?.address || '',
          },
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Impossibile sbloccare i dati richiesti.')
      }
      if (typeof data.credits === 'number') setCredits(data.credits)
      if (type === 'company') setCompanyUnlock(data)
      else setOwnerUnlock(data)
    } catch (e) {
      setUnlockError(e instanceof Error ? e.message : 'Errore durante lo sblocco.')
    } finally {
      setUnlockLoading(null)
    }
  }

  const formatEuro = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-[1280px] mx-auto">

      {/* Header */}
      <div className="flex flex-col gap-4 mb-6 md:flex-row md:items-start md:justify-between">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
            <h1 style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 'clamp(1.4rem, 3vw, 1.8rem)',
              fontWeight: 700, color: '#0F172A',
              letterSpacing: '-0.02em', margin: 0,
            }}>
              {nome || 'Lead'}
            </h1>
            <span style={{
              fontSize: 10, fontWeight: 700,
              padding: '3px 10px', borderRadius: 6,
              background: '#f4f4f5',
              color: '#52525b',
              letterSpacing: '0.05em',
              fontFamily: 'Inter, sans-serif',
              border: '1px solid #e4e4e7',
            }}>
              {scoreMeta.label}
            </span>
          </div>
          <div style={{ fontSize: 14, color: '#64748B', fontFamily: 'DM Sans, sans-serif' }}>
            {citta || location || '—'}
            <span style={{ margin: '0 8px', color: '#CBD5E1' }}>•</span>
            {categoria || category || '—'}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={onGeneraPitch}
            disabled={pitchLoading}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: pitchLoading ? '#a78bfa' : '#7c3aed', color: 'white',
              fontSize: 13, fontWeight: 600,
              padding: '9px 18px', borderRadius: 8,
              border: 'none', cursor: pitchLoading ? 'wait' : 'pointer',
              fontFamily: 'Inter, sans-serif',
            }}>
            {pitchLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {pitchLoading ? 'Generando...' : 'Genera Pitch'}
          </button>

          {monitorStatus === 'monitored' ? (
            <button disabled style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: '#F0FDF4', color: '#16A34A',
              fontSize: 13, fontWeight: 600,
              padding: '9px 18px', borderRadius: 8,
              border: '1px solid #BBF7D0', cursor: 'default',
              fontFamily: 'Inter, sans-serif',
            }}>
              Monitorato ✓
            </button>
          ) : (
            <button
              onClick={onMonitorLead}
              disabled={monitorStatus === 'saving'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'white', color: '#475569',
                fontSize: 13, fontWeight: 600,
                padding: '9px 18px', borderRadius: 8,
                border: '1px solid #E2E8F0', cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
              }}>
              🔔 Monitora
            </button>
          )}

          <OutreachLauncher
            nome={nome}
            citta={citta || location || ''}
            categoria={categoria || category || ''}
            sito={sitoRaw}
            email={displayEmail}
            telefono={displayTelefono}
            problems={opportunityItems}
            pitchSubject={pitchResult?.subject}
            pitchBody={pitchResult?.body}
            lastContactedAt={outreach.getLastContact(sitoRaw, nome)}
            onLogged={outreach.reload}
            onContacted={() => {
              if (sitoRaw) {
                void trackInteraction(sitoRaw, nome, 'contacted', typeof score === 'number' ? score : 0)
              }
            }}
          />

          <button
            onClick={onSalva}
            disabled={saveStatus === 'saving' || saveStatus === 'saved'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: saveStatus === 'saved' ? '#F0FDF4' : 'white',
              color: saveStatus === 'saved' ? '#16A34A' : '#475569',
              fontSize: 13, fontWeight: 600,
              padding: '9px 18px', borderRadius: 8,
              border: `1px solid ${saveStatus === 'saved' ? '#BBF7D0' : '#E2E8F0'}`,
              cursor: saveStatus === 'saved' ? 'default' : 'pointer',
              fontFamily: 'Inter, sans-serif',
            }}>
            {saveStatus === 'saved' ? <Check size={14} /> : <BookmarkPlus size={14} />}
            {saveStatus === 'saved' ? 'Salvato' : saveStatus === 'saving' ? 'Salvataggio...' : 'Salva'}
          </button>

          <Link href="/dashboard" style={{
            display: 'inline-flex', alignItems: 'center',
            fontSize: 13, fontWeight: 500,
            color: '#94A3B8', textDecoration: 'none',
            fontFamily: 'Inter, sans-serif',
            padding: '9px 14px',
          }}>
            ← Torna
          </Link>
        </div>
      </div>

      {monitorStatus === 'error' && (
        <div style={{
          background: '#FEF2F2', border: '1px solid #FECACA',
          borderRadius: 10, padding: '10px 16px',
          fontSize: 13, color: '#DC2626',
          fontFamily: 'Inter, sans-serif',
          marginBottom: 16,
        }}>
          Errore monitor: {monitorError || 'impossibile salvare'}
        </div>
      )}

      {(() => {
        const acceptance = lead?._lead_acceptance && typeof lead._lead_acceptance === 'object' ? lead._lead_acceptance : null
        const grounding = lead?.semantic_grounding?.grounded_evidence?.[0]
        const verdict = grounding?.verdict || grounding?.interpretation || {}
        const sourceUrl = String(lead?.source_url || verdict?.source_url || '').trim()
        const excerpt = String(lead?.evidence_excerpt || verdict?.evidence_excerpt || verdict?.excerpt || '').trim()
        const whyNow = String(lead?.why_now || acceptance?.why_now || '').trim()
        const whyFit = String(lead?.why_fit || acceptance?.why_fit || '').trim()
        const claimType = String(
          lead?.claim_type ||
          lead?.evidence_claim_type ||
          verdict?.evidence_claim_type ||
          acceptance?.intent_strength ||
          '',
        ).trim()
        // Keep event_date / source_published_at / observed_at strictly separate — no cross-fallback.
        const eventDate = String(lead?.event_date || verdict?.event_date || '').trim()
        const sourcePublishedAt = String(
          lead?.source_published_at || verdict?.source_published_at || '',
        ).trim()
        const observedAt = String(lead?.observed_at || '').trim()
        const marketScope = String(
          lead?.market_scope_status || lead?.market_scope_state || acceptance?.market_scope_status || '',
        ).trim()
        const canonicalId = String(
          lead?.canonical_lead_id || lead?.search_candidate_id || lead?.candidate_id || '',
        ).trim()
        if (!sourceUrl && !excerpt && !whyNow && !canonicalId) return null
        return (
          <div style={{
            background: 'white', border: '1px solid #e4e4e7',
            borderRadius: 12, padding: '20px 24px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            marginBottom: 16,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: '#94A3B8',
              textTransform: 'uppercase', letterSpacing: '0.1em',
              fontFamily: 'Inter, sans-serif', marginBottom: 12,
            }}>
              Evidenza commerciale
            </div>
            <div style={{ display: 'grid', gap: 10, fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#0F172A' }}>
              {canonicalId ? <div><span style={{ color: '#94A3B8' }}>Lead ID: </span><span className="font-mono text-xs">{canonicalId}</span></div> : null}
              {sourceUrl ? (
                <div>
                  <span style={{ color: '#94A3B8' }}>Fonte: </span>
                  <a href={sourceUrl} target="_blank" rel="noreferrer" style={{ color: '#6366F1', wordBreak: 'break-all' }}>{sourceUrl}</a>
                </div>
              ) : null}
              {excerpt ? <div><span style={{ color: '#94A3B8' }}>Excerpt: </span>{excerpt}</div> : null}
              {whyNow ? <div><span style={{ color: '#94A3B8' }}>Why now: </span>{whyNow}</div> : null}
              {whyFit ? <div><span style={{ color: '#94A3B8' }}>Why fit: </span>{whyFit}</div> : null}
              {eventDate ? <div><span style={{ color: '#94A3B8' }}>Data evento: </span>{eventDate}</div> : null}
              {sourcePublishedAt ? <div><span style={{ color: '#94A3B8' }}>Fonte pubblicata il: </span>{sourcePublishedAt}</div> : null}
              {observedAt ? <div><span style={{ color: '#94A3B8' }}>Osservato il: </span>{observedAt}</div> : null}
              {(claimType || marketScope) ? (
                <div style={{ color: '#64748B', fontSize: 12 }}>
                  {[claimType && `Claim: ${claimType}`, marketScope && `Market scope: ${marketScope}`]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              ) : null}
            </div>
          </div>
        )
      })()}

      {/* Top 3 card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">

        {/* Contatti */}
        <div style={{
          background: 'white', border: '1px solid #e4e4e7',
          borderRadius: 12, padding: '24px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: '#94A3B8',
            textTransform: 'uppercase', letterSpacing: '0.1em',
            fontFamily: 'Inter, sans-serif', marginBottom: 16,
          }}>
            Contatti
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              { label: 'Telefono', value: displayTelefono || '—' },
              { label: 'Email', value: displayEmail || '—' },
              { label: 'Sito', value: sitoRaw || '—', href: sitoHref },
              { label: 'Indirizzo', value: displayIndirizzo || '—' },
            ].map(({ label, value, href }) => (
              <div key={label} style={{
                display: 'flex', alignItems: 'flex-start',
                justifyContent: 'space-between', gap: 12,
                padding: '10px 0',
                borderBottom: '1px solid #F8FAFC',
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, color: '#94A3B8',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  fontFamily: 'Inter, sans-serif', flexShrink: 0,
                }}>
                  {label}
                </span>
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer" style={{
                    fontSize: 13, fontWeight: 500, color: '#6366F1',
                    wordBreak: 'break-all', textAlign: 'right',
                    fontFamily: 'Inter, sans-serif',
                  }}>
                    {value}
                  </a>
                ) : (
                  <span style={{
                    fontSize: 13, fontWeight: 500, color: '#0F172A',
                    wordBreak: 'break-all', textAlign: 'right',
                    fontFamily: 'Inter, sans-serif',
                  }}>
                    {value}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Analisi Tecnica */}
        <div style={{
          background: 'white', border: '1px solid #e4e4e7',
          borderRadius: 12, padding: '24px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: '#94A3B8',
            textTransform: 'uppercase', letterSpacing: '0.1em',
            fontFamily: 'Inter, sans-serif', marginBottom: 16,
          }}>
            Analisi Tecnica
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              { label: 'SSL', ok: sslOk },
              { label: 'Meta Pixel', ok: hasPixel },
              { label: 'Google Tag Manager', ok: hasGtm },
              { label: 'Google Ads', ok: hasGoogleAds },
            ].map(({ label, ok }) => (
              <div key={label} style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 0',
                borderBottom: '1px solid #F8FAFC',
              }}>
                <span style={{
                  fontSize: 13, fontWeight: 500, color: '#334155',
                  fontFamily: 'Inter, sans-serif',
                }}>
                  {label}
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  padding: '3px 10px', borderRadius: 999,
                  background: ok ? '#F0FDF4' : '#FEF2F2',
                  color: ok ? '#16A34A' : '#DC2626',
                  border: `1px solid ${ok ? '#BBF7D0' : '#FECACA'}`,
                  fontFamily: 'Inter, sans-serif',
                }}>
                  {ok ? '✓ Attivo' : '✗ Assente'}
                </span>
              </div>
            ))}
            <div style={{
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', padding: '10px 0',
            }}>
              <span style={{
                fontSize: 13, fontWeight: 500, color: '#334155',
                fontFamily: 'Inter, sans-serif',
              }}>
                Velocità
              </span>
              <span style={{
                fontSize: 13, fontWeight: 700,
                color: typeof loadSpeedSeconds === 'number' && Number.isFinite(loadSpeedSeconds)
                  ? loadSpeedSeconds < 2 ? '#16A34A' : loadSpeedSeconds <= 4 ? '#D97706' : '#DC2626'
                  : '#94A3B8',
                fontFamily: 'Inter, sans-serif',
              }}>
                {typeof loadSpeedSeconds === 'number' && Number.isFinite(loadSpeedSeconds)
                  ? `${loadSpeedSeconds.toFixed(1)}s` : '—'}
              </span>
            </div>
          </div>

          {techStack.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: '#475569',
                marginBottom: 8, fontFamily: 'Inter, sans-serif',
              }}>
                Tech Stack
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {techStack.map((t, idx) => (
                  <span key={`${t}-${idx}`} style={{
                    fontSize: 10, fontWeight: 600,
                    padding: '2px 8px', borderRadius: 4,
                    background: t.includes('MISSING') || t.includes('NO ')
                      ? '#FEF2F2' : t.includes('SSL') || t.includes('MOBILE')
                      ? '#F0FDF4' : '#F8FAFC',
                    color: t.includes('MISSING') || t.includes('NO ')
                      ? '#DC2626' : t.includes('SSL') || t.includes('MOBILE')
                      ? '#16A34A' : '#475569',
                    border: '1px solid',
                    borderColor: t.includes('MISSING') || t.includes('NO ')
                      ? '#FECACA' : t.includes('SSL') || t.includes('MOBILE')
                      ? '#BBF7D0' : '#E2E8F0',
                    fontFamily: 'Inter, sans-serif',
                  }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {seoErrors.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: '#475569',
                marginBottom: 8, fontFamily: 'Inter, sans-serif',
              }}>
                Errori SEO
              </div>
              <ul style={{ paddingLeft: 16, margin: 0 }}>
                {seoErrors.slice(0, 8).map((e, idx) => (
                  <li key={idx} style={{
                    fontSize: 12, color: '#64748B',
                    fontFamily: 'Inter, sans-serif',
                    marginBottom: 4, wordBreak: 'break-word',
                  }}>
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Score */}
        <div style={{
          background: 'white', border: '1px solid #e4e4e7',
          borderRadius: 12, padding: '24px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: '#94A3B8',
            textTransform: 'uppercase', letterSpacing: '0.1em',
            fontFamily: 'Inter, sans-serif', marginBottom: 16,
          }}>
            Score & Opportunità
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 10,
              background: '#fafafa',
              border: '1px solid #e4e4e7',
              display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexShrink: 0,
            }}>
              <span style={{
                fontSize: 20, fontWeight: 700, color: '#18181b',
                fontFamily: 'Inter, sans-serif',
              }}>
                {score}
              </span>
            </div>
            <div>
              <div style={{
                fontSize: 12, fontWeight: 600,
                color: score >= 70 ? '#18181b' : score >= 40 ? '#52525b' : '#a1a1aa',
                fontFamily: 'Inter, sans-serif',
                textTransform: 'uppercase' as const,
                letterSpacing: '0.05em',
              }}>
                {score >= 70 ? 'HOT' : score >= 40 ? 'WARM' : 'COLD'}
              </div>
              <div style={{
                fontSize: 11, color: '#a1a1aa',
                fontFamily: 'Inter, sans-serif',
              }}>
                Score {score}/100
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-xs font-semibold text-slate-700 mb-2">Opportunità</div>
            {opportunityItems.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {opportunityItems.map((o, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="mt-0.5 w-5 h-5 rounded-full 
                      bg-violet-100 border border-violet-200 
                      flex items-center justify-center 
                      text-violet-600 text-xs font-black shrink-0">
                      !
                    </span>
                    <span className="text-slate-800">{o}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-sm text-slate-500">—</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Clay Enrichment Data ── */}
      {loadingClay ? (
        <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 p-6 flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
          <div>
            <p className="text-sm font-semibold text-blue-700">Arricchimento dati in corso...</p>
            <p className="text-xs text-blue-500">Stiamo raccogliendo tutti i dati disponibili per questo lead.</p>
          </div>
        </div>
      ) : clayData && !clayData.error ? (
        <div className="mb-6 space-y-4">
          {/* Quality bar — niente fonti esposte */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <span className="text-[10px] text-slate-400">
              Qualità dati: <strong className={clayData.enrichmentQuality >= 60 ? 'text-emerald-600' : clayData.enrichmentQuality >= 30 ? 'text-amber-600' : 'text-slate-500'}>{clayData.enrichmentQuality}/100</strong>
            </span>
          </div>

          {/* Card: Tutti i Contatti — IN PRIMO PIANO (la prima cosa che si vede) */}
          <div className="grid grid-cols-1 gap-4">

            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <Phone className="w-4 h-4 text-emerald-500" />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tutti i Contatti</span>
              </div>
              <div className="space-y-2">
                {/* Best email */}
                {clayData.bestEmail && (
                  <a href={`mailto:${clayData.bestEmail}`} className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-800 font-medium">
                    <Mail className="w-3.5 h-3.5" />
                    <span className="truncate">{clayData.bestEmail}</span>
                    {clayData.allEmails?.find((e: any) => e.email === clayData.bestEmail && e.verified) && (
                      <span className="text-[8px] bg-green-100 text-green-700 px-1 rounded font-bold">✓</span>
                    )}
                  </a>
                )}
                {/* PEC */}
                {clayData.pecEmail && clayData.pecEmail !== clayData.bestEmail && (
                  <a href={`mailto:${clayData.pecEmail}`} className="flex items-center gap-2 text-xs text-purple-600 hover:text-purple-800">
                    <Mail className="w-3.5 h-3.5" />
                    <span className="truncate">{clayData.pecEmail}</span>
                    <span className="text-[8px] bg-purple-100 text-purple-700 px-1 rounded font-bold">PEC</span>
                  </a>
                )}
                {/* All other emails */}
                {clayData.allEmails?.filter((e: any) => e.email !== clayData.bestEmail && e.email !== clayData.pecEmail).slice(0, 3).map((e: any, i: number) => (
                  <a key={i} href={`mailto:${e.email}`} className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-800">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    <span className="truncate">{e.email}</span>
                    <span className="text-[8px] bg-slate-100 text-slate-500 px-1 rounded">{e.type}</span>
                  </a>
                ))}
                {/* Divider */}
                {(clayData.allEmails?.length > 0) && <div className="border-t border-slate-100 my-1" />}
                {/* Phones — only REAL verified numbers: Maps + Apollo + original lead phone */}
                {(() => {
                  // P.IVA (italiana = 11 cifre) da escludere dai telefoni
                  const pivaDigits = (clayData.partitaIva || '').replace(/\D/g, '')
                  // Strict Italian phone validation
                  const isRealItPhone = (n: string) => {
                    const d = n.replace(/\D/g, '')
                    // Strip country code 39 if present
                    const local = d.startsWith('39') && d.length > 10 ? d.slice(2) : d
                    if (local.length < 9 || local.length > 11) return false
                    if (/^(\d)\1{5,}$/.test(local)) return false
                    // Escludi P.IVA: se le 11 cifre sono identiche, NON è un telefono
                    if (pivaDigits.length === 11 && d === pivaDigits) return false
                    // P.IVA italiana inizia tipicamente con cifra qualsiasi e ha 11 cifre,
                    // ma i nostri telefoni fissi al massimo arrivano a 11 cifre con il prefisso 0.
                    // Se il numero non inizia con 3 (mobile) o 0 (fisso), non è un numero valido.
                    // Mobile: 3[0-9]x (MUST be exactly 10 digits)
                    if (/^3[0-9]\d{8}$/.test(local)) return true
                    // Landline: 0[1-9]x (9-11 digits — e.g. 02-2390248 = 9 digits is valid Milan)
                    if (/^0[1-9]\d{6,9}$/.test(local)) return true
                    return false
                  }
                  // Niente label di fonte: il cliente non deve sapere DA DOVE vengono i dati.

                  // Build phone list: lead original phone FIRST, then Maps/Apollo only
                  const phones: { number: string; source: string; type: string }[] = []
                  const seen = new Set<string>()
                  const addPhone = (num: string, src: string, type: string) => {
                    if (!num || !isRealItPhone(num)) return
                    const key = num.replace(/\D/g, '').slice(-9)
                    if (seen.has(key)) return
                    seen.add(key)
                    phones.push({ number: num, source: src, type })
                  }

                  // 1. Original lead phone(s) from Maps — split by / or ,
                  const origPhone = telefono || ''
                  origPhone.split(/[\/,;]+/).forEach((p: string) => {
                    const cleaned = p.trim()
                    if (cleaned) addPhone(cleaned, 'lead', cleaned.replace(/\D/g, '').startsWith('3') ? 'mobile' : 'landline')
                  })

                  // 2. All enrichment sources (Maps, Apollo, website) — now with proper validation
                  for (const p of (clayData.allPhones || [])) {
                    addPhone(p.number, p.source, p.type || 'unknown')
                  }

                  if (phones.length === 0) return null

                  return phones.slice(0, 4).map((p, i) => {
                    const d = p.number.replace(/\D/g, '')
                    const local = d.startsWith('39') && d.length > 10 ? d.slice(2) : d
                    const isMobile = /^3[0-9]/.test(local)
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <a href={`tel:${p.number}`} className={`flex items-center gap-2 text-xs ${isMobile ? 'text-emerald-600 hover:text-emerald-800 font-medium' : 'text-slate-600'}`}>
                          <Phone className={`w-3.5 h-3.5 ${isMobile ? '' : 'text-slate-400'}`} />
                          {p.number}
                        </a>
                        <span className={`text-[8px] px-1 rounded ${isMobile ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{isMobile ? 'mobile' : 'fisso'}</span>
                        {isMobile && (
                          <a href={`https://wa.me/${d.startsWith('39') ? d : '39' + local}`} target="_blank" rel="noreferrer" className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold no-underline hover:bg-green-200">WA</a>
                        )}
                      </div>
                    )
                  })
                })()}
                {/* Social links */}
                <div className="border-t border-slate-100 my-1" />
                <div className="flex flex-wrap gap-2">
                  {clayData.linkedinCompany && (
                    <a href={clayData.linkedinCompany} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-600 bg-sky-50 border border-sky-200 px-2 py-1 rounded-lg no-underline hover:bg-sky-100">
                      <Linkedin className="w-3 h-3" /> LinkedIn
                    </a>
                  )}
                  {clayData.facebook && (
                    <a href={clayData.facebook} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-1 rounded-lg no-underline hover:bg-blue-100">
                      <Facebook className="w-3 h-3" /> Facebook
                    </a>
                  )}
                  {clayData.instagram && (
                    <a href={clayData.instagram} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-pink-600 bg-pink-50 border border-pink-200 px-2 py-1 rounded-lg no-underline hover:bg-pink-100">
                      <Instagram className="w-3 h-3" /> {clayData.instagramHandle || 'Instagram'}
                    </a>
                  )}
                  {clayData.tiktok && (
                    <a href={clayData.tiktok} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-700 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg no-underline hover:bg-slate-100">
                      <Video className="w-3 h-3" /> TikTok
                    </a>
                  )}
                  {clayData.youtube && (
                    <a href={clayData.youtube} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded-lg no-underline hover:bg-red-100">
                      <Video className="w-3 h-3" /> YouTube
                    </a>
                  )}
                </div>
              </div>
            </div>

          </div>

        </div>
      ) : null}

      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-slate-700" />
              <h2 className="text-base font-bold text-slate-900">Dati aziendali avanzati</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Bilanci, dipendenti, RAL media, costo personale, PEC, titolari e soci.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => unlockBusinessData('company')}
              disabled={unlockLoading !== null}
              className="bg-slate-900 hover:bg-slate-800 text-white rounded-lg"
            >
              {unlockLoading === 'company' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              Sblocca profilo aziendale · 15 crediti
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => unlockBusinessData('owner')}
              disabled={unlockLoading !== null}
              className="rounded-lg"
            >
              {unlockLoading === 'owner' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              Sblocca nome titolare · 4 crediti
            </Button>
          </div>
        </div>

        {unlockError ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {unlockError}
          </div>
        ) : null}

        {companyUnlock?.company ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-emerald-950">{companyUnlock.company.ragione_sociale || nome}</div>
                <div className="text-xs text-emerald-700">P.IVA {companyUnlock.piva}</div>
              </div>
              {companyUnlock.fromPreviousUnlock ? (
                <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-emerald-700 border border-emerald-200">Già sbloccato</span>
              ) : null}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div><span className="block text-[10px] font-bold uppercase text-emerald-700">Fatturato</span><span className="font-semibold text-slate-900">{formatEuro(companyUnlock.company.fatturato)}{companyUnlock.company.fatturato_anno ? ` (${companyUnlock.company.fatturato_anno})` : ''}</span></div>
              <div><span className="block text-[10px] font-bold uppercase text-emerald-700">Dipendenti</span><span className="font-semibold text-slate-900">{companyUnlock.company.dipendenti ?? '—'}</span></div>
              <div><span className="block text-[10px] font-bold uppercase text-emerald-700">RAL media</span><span className="font-semibold text-slate-900">{formatEuro(companyUnlock.company.ral_medio)}</span></div>
              <div><span className="block text-[10px] font-bold uppercase text-emerald-700">Costo personale</span><span className="font-semibold text-slate-900">{formatEuro(companyUnlock.company.costo_personale)}</span></div>
              <div><span className="block text-[10px] font-bold uppercase text-emerald-700">Capitale sociale</span><span className="font-semibold text-slate-900">{formatEuro(companyUnlock.company.capitale_sociale)}</span></div>
              <div><span className="block text-[10px] font-bold uppercase text-emerald-700">PEC</span><span className="font-semibold text-slate-900 break-all">{companyUnlock.company.pec || '—'}</span></div>
              <div><span className="block text-[10px] font-bold uppercase text-emerald-700">Forma giuridica</span><span className="font-semibold text-slate-900">{companyUnlock.company.forma_giuridica || '—'}</span></div>
              <div><span className="block text-[10px] font-bold uppercase text-emerald-700">ATECO</span><span className="font-semibold text-slate-900">{companyUnlock.company.codice_ateco || '—'}</span></div>
              <div><span className="block text-[10px] font-bold uppercase text-emerald-700">Stato</span><span className="font-semibold text-slate-900">{companyUnlock.company.stato_attivita || '—'}</span></div>
            </div>
            {companyUnlock.company.sede_legale ? (
              <div className="mt-3 rounded-lg bg-white/70 border border-emerald-100 px-3 py-2 text-xs text-slate-700">
                <span className="font-bold text-emerald-700">Sede legale:</span> {companyUnlock.company.sede_legale}
              </div>
            ) : null}
            {Array.isArray(companyUnlock.company.storico_bilanci) && companyUnlock.company.storico_bilanci.length > 0 ? (
              <div className="mt-3 overflow-hidden rounded-lg border border-emerald-100 bg-white/80">
                <div className="border-b border-emerald-100 px-3 py-2 text-[10px] font-bold uppercase text-emerald-700">Storico bilanci</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-emerald-50 text-emerald-800">
                      <tr>
                        <th className="px-3 py-2 text-left font-bold">Anno</th>
                        <th className="px-3 py-2 text-left font-bold">Fatturato</th>
                        <th className="px-3 py-2 text-left font-bold">Utile</th>
                        <th className="px-3 py-2 text-left font-bold">Dipendenti</th>
                        <th className="px-3 py-2 text-left font-bold">Costo personale</th>
                        <th className="px-3 py-2 text-left font-bold">Patrimonio netto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {companyUnlock.company.storico_bilanci.slice(0, 7).map((b: any) => (
                        <tr key={b.anno} className="border-t border-emerald-50">
                          <td className="px-3 py-2 font-semibold text-slate-900">{b.anno}</td>
                          <td className="px-3 py-2 text-slate-700">{formatEuro(b.fatturato)}</td>
                          <td className="px-3 py-2 text-slate-700">{formatEuro(b.utile)}</td>
                          <td className="px-3 py-2 text-slate-700">{b.dipendenti ?? '—'}</td>
                          <td className="px-3 py-2 text-slate-700">{formatEuro(b.costo_personale)}</td>
                          <td className="px-3 py-2 text-slate-700">{formatEuro(b.patrimonio_netto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-lg bg-white/70 border border-emerald-100 px-3 py-2 text-xs text-slate-500">
                Storico bilanci non disponibile per questa azienda.
              </div>
            )}
          </div>
        ) : null}

        {ownerUnlock?.owner ? (
          <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/70 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-violet-950">Titolare / soci ufficiali</div>
                <div className="text-xs text-violet-700">P.IVA {ownerUnlock.piva}</div>
              </div>
              {ownerUnlock.fromPreviousUnlock ? (
                <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-violet-700 border border-violet-200">Già sbloccato</span>
              ) : null}
            </div>
            {ownerUnlock.owner.titolare_best ? (
              <div className="rounded-lg bg-white border border-violet-100 p-3 mb-3">
                <span className="block text-[10px] font-bold uppercase text-violet-700">Titolare migliore</span>
                <span className="font-bold text-slate-900">{ownerUnlock.owner.titolare_best.nomeCompleto}</span>
                <span className="ml-2 text-xs text-slate-500">{ownerUnlock.owner.titolare_best.ruolo}</span>
              </div>
            ) : null}
            <div className="space-y-2">
              {(ownerUnlock.owner.shareholders || []).slice(0, 8).map((s: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between gap-3 rounded-lg bg-white/80 border border-violet-100 px-3 py-2 text-sm">
                  <span className="font-semibold text-slate-900">
                    {s.isCompany ? s.ragione_sociale_socio || 'Socio azienda' : `${s.nome || ''} ${s.cognome || ''}`.trim()}
                  </span>
                  <span className="text-xs text-violet-700 font-semibold">{typeof s.percentShare === 'number' ? `${s.percentShare}%` : 'Socio'}</span>
                </div>
              ))}
              {(!ownerUnlock.owner.shareholders || ownerUnlock.owner.shareholders.length === 0) && (
                <div className="text-sm text-slate-500">Nessun socio persona fisica disponibile.</div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mb-6">
        <FreeIntelPanel
          website={sitoRaw || null}
          lead={lead}
          activeMetaAds={ads?.facebookAds?.apiVerified && typeof ads?.facebookAds?.activeAdsFound === 'number' ? ads.facebookAds.activeAdsFound : null}
        />
      </div>

      <div className="mb-6">
        <UniverseLeadPanel website={sitoRaw || null} leadName={nome || null} />
      </div>

      {/* Analisi AI */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{
            fontSize: 15, fontWeight: 700, color: '#0F172A',
            fontFamily: 'Inter, sans-serif', margin: '0 0 4px',
          }}>
            Analisi AI
          </h2>
          <p style={{
            fontSize: 13, color: '#94A3B8',
            fontFamily: 'Inter, sans-serif', margin: 0,
          }}>
            Recensioni, social, ads, competitor, trend e profilo aziendale
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Recensioni */}
          <div style={{
            background: 'white', border: '1px solid #e4e4e7',
            borderRadius: 12, padding: '24px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: '#f4f4f5', border: '1px solid #e4e4e7',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Star size={16} color="#D97706" />
              </div>
              <h3 style={{
                fontSize: 14, fontWeight: 700, color: '#0F172A',
                fontFamily: 'Inter, sans-serif', margin: 0,
              }}>
                Recensioni Google
              </h3>
            </div>
            {loadingReviews ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[1,2].map(i => <div key={i} style={{ height: 14, background: '#F1F5F9', borderRadius: 6 }} />)}
              </div>
            ) : Array.isArray(reviews?.reviews) ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 24, fontWeight: 700, color: '#0F172A', fontFamily: 'Syne, sans-serif' }}>
                    {reviews.rating ?? 0}
                  </span>
                  <span style={{ color: '#F59E0B', fontSize: 16 }}>★</span>
                  <span style={{ fontSize: 13, color: '#94A3B8', fontFamily: 'DM Sans, sans-serif' }}>
                    ({reviews.total ?? 0} recensioni)
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(reviews.reviews || []).slice(0, 5).map((r: any, i: number) => (
                    <div key={i} style={{
                      padding: '10px 12px', background: '#F8FAFC',
                      borderRadius: 10, border: '1px solid #F1F5F9',
                    }}>
                      <div style={{ fontSize: 11, color: '#F59E0B', marginBottom: 4 }}>
                        {typeof r?.stars === 'number' ? `${'★'.repeat(r.stars)}` : ''}
                      </div>
                      <div style={{ fontSize: 13, color: '#475569', fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}>
                        {r?.text || ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: '#94A3B8', fontFamily: 'DM Sans, sans-serif' }}>
                Nessuna recensione disponibile
              </p>
            )}
          </div>

          {/* Social — mostrato PRIMA per user-friendliness */}
          <div style={{
            background: 'white', border: '1px solid #e4e4e7',
            borderRadius: 12, padding: '24px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            order: -1,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: '#f4f4f5', border: '1px solid #e4e4e7',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Smartphone size={16} color="#3B82F6" />
              </div>
              <h3 style={{
                fontSize: 14, fontWeight: 700, color: '#0F172A',
                fontFamily: 'Inter, sans-serif', margin: 0,
              }}>
                Presenza Social
              </h3>
            </div>
            {loadingSocial ? (
              <div className="animate-pulse space-y-2">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-4 bg-gray-200 rounded w-1/2" />
              </div>
            ) : social ? (
              <div className="space-y-4">
                {/* Instagram */}
                {social.instagram ? (
                  <div className="p-4 rounded-xl border border-zinc-200 bg-white">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Instagram className="w-4 h-4 text-pink-500" />
                        <span className="text-sm font-bold text-slate-800">Instagram</span>
                        {social.instagram.is_verified && <span className="text-blue-500 text-xs">✓</span>}
                        {social.instagram.is_business && <span className="bg-purple-100 text-purple-700 text-[10px] px-1.5 py-0.5 rounded-full font-semibold">Business</span>}
                      </div>
                      <a href={social.instagram.url} target="_blank" rel="noopener noreferrer" className="text-pink-500 hover:text-pink-700">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                    {social.instagram.full_name && <p className="text-xs text-slate-600 mb-2">@{social.instagram.username} · {social.instagram.full_name}</p>}
                    {social.instagram.error ? (
                      <p className="text-xs text-amber-600">Profilo trovato ma dati limitati (profilo privato o restrizioni)</p>
                    ) : (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          {social.instagram.followers_display && (
                            <div className="text-center p-2 bg-white/70 rounded-lg">
                              <p className="text-base font-bold text-slate-900">{social.instagram.followers_display}</p>
                              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Follower</p>
                            </div>
                          )}
                          {social.instagram.following_display && (
                            <div className="text-center p-2 bg-white/70 rounded-lg">
                              <p className="text-base font-bold text-slate-900">{social.instagram.following_display}</p>
                              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Seguiti</p>
                            </div>
                          )}
                          {social.instagram.posts_display && (
                            <div className="text-center p-2 bg-white/70 rounded-lg">
                              <p className="text-base font-bold text-slate-900">{social.instagram.posts_display}</p>
                              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Post</p>
                            </div>
                          )}
                        </div>
                        {(social.instagram.engagement_display || social.instagram.avg_likes_display || social.instagram.last_post_date) && (
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            {social.instagram.engagement_display && (
                              <div className="text-center p-2 bg-white/70 rounded-lg">
                                <p className="text-base font-bold text-emerald-600">{social.instagram.engagement_display}</p>
                                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Engagement</p>
                              </div>
                            )}
                            {social.instagram.avg_likes_display && (
                              <div className="text-center p-2 bg-white/70 rounded-lg">
                                <p className="text-base font-bold text-slate-900">{social.instagram.avg_likes_display}</p>
                                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Like/post</p>
                              </div>
                            )}
                            {social.instagram.avg_comments_display && (
                              <div className="text-center p-2 bg-white/70 rounded-lg">
                                <p className="text-base font-bold text-slate-900">{social.instagram.avg_comments_display}</p>
                                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Commenti/post</p>
                              </div>
                            )}
                          </div>
                        )}
                        {(social.instagram.last_post_date || social.instagram.posting_frequency) && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {social.instagram.last_post_date && (
                              <span className={`text-[11px] px-2 py-1 rounded-full font-medium ${
                                (social.instagram.last_post_days_ago ?? 999) <= 7 ? 'bg-emerald-100 text-emerald-700' :
                                (social.instagram.last_post_days_ago ?? 999) <= 30 ? 'bg-amber-100 text-amber-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                Ultimo post: {social.instagram.last_post_date}
                                {social.instagram.last_post_days_ago !== undefined && ` (${social.instagram.last_post_days_ago}g fa)`}
                              </span>
                            )}
                            {social.instagram.posting_frequency && (
                              <span className="text-[11px] px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">
                                Frequenza: {social.instagram.posting_frequency}
                              </span>
                            )}
                            {social.instagram.category && (
                              <span className="text-[11px] px-2 py-1 rounded-full bg-purple-100 text-purple-700 font-medium">
                                {social.instagram.category}
                              </span>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Instagram className="w-4 h-4 text-slate-400" />
                      <span className="text-sm font-medium text-slate-500">Instagram</span>
                    </div>
                    <span className="text-xs bg-slate-200 text-slate-500 px-2.5 py-1 rounded-full">Non trovato</span>
                  </div>
                )}

                {/* TikTok */}
                {social.tiktok ? (
                  <div className="p-4 rounded-xl border border-zinc-200 bg-white">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Video className="w-4 h-4 text-slate-800" />
                        <span className="text-sm font-bold text-slate-800">TikTok</span>
                        {social.tiktok.is_verified && <span className="text-blue-500 text-xs">✓</span>}
                      </div>
                      <a href={social.tiktok.url} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-slate-700">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                    {social.tiktok.nickname && <p className="text-xs text-slate-600 mb-2">@{social.tiktok.username} · {social.tiktok.nickname}</p>}
                    {social.tiktok.error ? (
                      <p className="text-xs text-amber-600">Profilo trovato ma dati limitati</p>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {social.tiktok.followers_display && (
                          <div className="text-center p-2 bg-white/70 rounded-lg">
                            <p className="text-base font-bold text-slate-900">{social.tiktok.followers_display}</p>
                            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Follower</p>
                          </div>
                        )}
                        {social.tiktok.likes_display && (
                          <div className="text-center p-2 bg-white/70 rounded-lg">
                            <p className="text-base font-bold text-slate-900">{social.tiktok.likes_display}</p>
                            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Like</p>
                          </div>
                        )}
                        {social.tiktok.video_count_display && (
                          <div className="text-center p-2 bg-white/70 rounded-lg">
                            <p className="text-base font-bold text-slate-900">{social.tiktok.video_count_display}</p>
                            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Video</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Video className="w-4 h-4 text-slate-400" />
                      <span className="text-sm font-medium text-slate-500">TikTok</span>
                    </div>
                    <span className="text-xs bg-slate-200 text-slate-500 px-2.5 py-1 rounded-full">Non trovato</span>
                  </div>
                )}

                {/* Digital Maturity Score */}
                {social.digital_score && (
                  <div className={`p-4 rounded-xl border border-zinc-200 bg-white`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-bold text-slate-800">Punteggio Digitale</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-2xl font-black ${
                          social.digital_score.score >= 80 ? 'text-emerald-600' :
                          social.digital_score.score >= 60 ? 'text-blue-600' :
                          social.digital_score.score >= 40 ? 'text-amber-600' :
                          social.digital_score.score >= 20 ? 'text-orange-600' : 'text-red-600'
                        }`}>{social.digital_score.score}</span>
                        <span className="text-[10px] text-slate-500">/100</span>
                      </div>
                    </div>
                    <span className={`inline-block text-[11px] px-2.5 py-1 rounded-full font-bold mb-3 ${
                      social.digital_score.score >= 80 ? 'bg-emerald-200 text-emerald-800' :
                      social.digital_score.score >= 60 ? 'bg-blue-200 text-blue-800' :
                      social.digital_score.score >= 40 ? 'bg-amber-200 text-amber-800' :
                      social.digital_score.score >= 20 ? 'bg-orange-200 text-orange-800' : 'bg-red-200 text-red-800'
                    }`}>{social.digital_score.level}</span>
                    <div className="space-y-1.5 mb-3">
                      {social.digital_score.breakdown?.map((b: any, i: number) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-600 w-28 truncate">{b.area}</span>
                          <div className="flex-1 h-2 bg-white/60 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${
                              b.score / b.max >= 0.7 ? 'bg-emerald-400' : b.score / b.max >= 0.4 ? 'bg-amber-400' : 'bg-red-400'
                            }`} style={{ width: `${Math.round(b.score / b.max * 100)}%` }} />
                          </div>
                          <span className="text-[10px] text-slate-500 w-10 text-right">{b.score}/{b.max}</span>
                        </div>
                      ))}
                    </div>
                    {social.digital_score.opportunities?.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Opportunità di vendita</p>
                        <div className="flex flex-wrap gap-1">
                          {social.digital_score.opportunities.map((o: string, i: number) => (
                            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-white/70 text-slate-700 border border-slate-200">{o}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* LinkedIn */}
                {social.linkedin && !social.linkedin.error ? (
                  <div className="p-4 rounded-xl border border-zinc-200 bg-white">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Linkedin className="w-4 h-4 text-sky-600" />
                        <span className="text-sm font-bold text-slate-800">LinkedIn</span>
                      </div>
                      <a href={social.linkedin.url} target="_blank" rel="noopener noreferrer" className="text-sky-500 hover:text-sky-700">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                    {social.linkedin.company_name && <p className="text-xs text-slate-600 mb-2">{social.linkedin.company_name}</p>}
                    <div className="flex flex-wrap gap-2">
                      {social.linkedin.followers_display && (
                        <span className="text-[11px] px-2 py-1 rounded-full bg-white/70 text-slate-700 font-medium border border-sky-100">
                          {social.linkedin.followers_display} follower
                        </span>
                      )}
                      {social.linkedin.industry && (
                        <span className="text-[11px] px-2 py-1 rounded-full bg-sky-100 text-sky-700 font-medium">
                          {social.linkedin.industry}
                        </span>
                      )}
                    </div>
                    {social.linkedin.description && <p className="text-[11px] text-slate-500 mt-2 line-clamp-2">{social.linkedin.description}</p>}
                  </div>
                ) : social.social_links?.linkedin ? (
                  <a href={social.social_links.linkedin} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sky-50 border border-sky-200 text-sky-700 text-xs font-medium hover:bg-sky-100 transition-colors w-fit">
                    <Linkedin className="w-3 h-3" /> LinkedIn
                  </a>
                ) : null}

                {/* Facebook */}
                {social.facebook && !social.facebook.error ? (
                  <div className="p-3 rounded-xl border border-blue-200 bg-blue-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Facebook className="w-4 h-4 text-blue-600" />
                      <div>
                        <span className="text-sm font-bold text-slate-800">{social.facebook.page_name || 'Facebook'}</span>
                        {social.facebook.likes_display && (
                          <span className="ml-2 text-[11px] text-blue-600 font-medium">{social.facebook.likes_display} like</span>
                        )}
                      </div>
                    </div>
                    <a href={social.facebook.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                ) : social.social_links?.facebook ? (
                  <a href={social.social_links.facebook} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors w-fit">
                    <Facebook className="w-3 h-3" /> Facebook
                  </a>
                ) : null}

                {/* YouTube */}
                {social.social_links?.youtube && (
                  <a href={social.social_links.youtube} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs font-medium hover:bg-red-100 transition-colors w-fit">
                    <Video className="w-3 h-3" /> YouTube
                  </a>
                )}

                {/* Website Quality Score */}
                {social.website_score && (
                  <div className="p-4 rounded-xl border border-zinc-200 bg-white">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-bold text-slate-800">Qualità Sito Web</span>
                      <span className={`text-lg font-black ${
                        social.website_score.score >= 70 ? 'text-emerald-600' :
                        social.website_score.score >= 40 ? 'text-amber-600' : 'text-red-600'
                      }`}>{social.website_score.score}/100</span>
                    </div>
                    {social.website_score.strengths?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {social.website_score.strengths.map((s: string, i: number) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">{s}</span>
                        ))}
                      </div>
                    )}
                    {social.website_score.issues?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {social.website_score.issues.slice(0, 6).map((s: string, i: number) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">{s}</span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex gap-3 text-[10px] text-slate-400">
                      <span>{social.website_score.page_size_kb}KB</span>
                      <span>{social.website_score.image_count} img</span>
                      <span>{social.website_score.external_scripts_count} script</span>
                    </div>
                  </div>
                )}

                {/* Domain Age */}
                {social.domain_info && social.domain_info.first_seen && (
                  <div className="flex flex-wrap gap-2">
                    <span className="text-[11px] px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700 font-medium border border-indigo-200">
                      Online dal {social.domain_info.first_seen}
                      {social.domain_info.domain_age_years && ` (${social.domain_info.domain_age_years} anni)`}
                    </span>
                    {social.domain_info.snapshots && (
                      <span className="text-[11px] px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium">
                        {social.domain_info.snapshots} snapshot Wayback
                      </span>
                    )}
                  </div>
                )}

                {/* Tech & Pixel Detection */}
                {social.tech && (
                  <div className="mt-2 pt-3 border-t border-slate-100">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Pixel & Tecnologie rilevate</p>
                    <div className="flex flex-wrap gap-1.5">
                      {social.tech.tiktok_pixel && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-900 text-white text-[10px] font-semibold">TikTok Pixel ✓</span>
                      )}
                      {social.tech.meta_pixel && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-800 text-white text-[10px] font-semibold">Meta Pixel ✓</span>
                      )}
                      {social.tech.google_analytics && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-800 text-white text-[10px] font-semibold">Google Analytics ✓</span>
                      )}
                      {social.tech.google_tag_manager && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-800 text-white text-[10px] font-semibold">GTM ✓</span>
                      )}
                      {social.tech.google_ads && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-800 text-white text-[10px] font-semibold">Google Ads ✓</span>
                      )}
                      {social.tech.hotjar && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-700 text-white text-[10px] font-semibold">Hotjar ✓</span>
                      )}
                      {social.tech.microsoft_clarity && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-700 text-white text-[10px] font-semibold">Clarity ✓</span>
                      )}
                      {social.tech.hubspot && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-700 text-white text-[10px] font-semibold">HubSpot ✓</span>
                      )}
                      {social.tech.mailchimp && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-700 text-white text-[10px] font-semibold">Mailchimp ✓</span>
                      )}
                      {social.tech.cms && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-indigo-100 text-indigo-800 text-[10px] font-bold border border-indigo-200">{social.tech.cms}</span>
                      )}
                      {social.tech.has_ecommerce && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold border border-emerald-200">E-commerce ✓</span>
                      )}
                      {social.tech.has_ssl === false && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-100 text-red-700 text-[10px] font-bold border border-red-200">No SSL ⚠</span>
                      )}
                      {social.tech.has_cookie_banner === false && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-100 text-amber-700 text-[10px] font-bold border border-amber-200">No Cookie Banner ⚠</span>
                      )}
                      {social.tech.has_privacy_policy === false && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-100 text-amber-700 text-[10px] font-bold border border-amber-200">No Privacy Policy ⚠</span>
                      )}
                      {!social.tech.tiktok_pixel && !social.tech.meta_pixel && !social.tech.google_analytics && !social.tech.google_tag_manager && !social.tech.google_ads && !social.tech.hotjar && !social.tech.microsoft_clarity && !social.tech.hubspot && !social.tech.mailchimp && !social.tech.cms && !social.tech.has_ecommerce && (
                        <span className="text-xs text-slate-400">Nessun pixel o tool di marketing rilevato</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-400 text-sm">Dati social non disponibili</p>
            )}
          </div>

          <div className="bg-white rounded-2xl border 
            border-slate-200 p-6 shadow-sm 
            hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-xl 
                bg-zinc-100 border border-zinc-200 
                flex items-center justify-center">
                <Megaphone className="w-4 h-4 text-orange-500" />
              </div>
              <h3 className="font-bold text-base text-slate-900">
                Attività Pubblicitaria
              </h3>
            </div>
            {loadingAds ? (
              <div className="animate-pulse space-y-2">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-4 bg-gray-200 rounded w-1/2" />
              </div>
            ) : ads ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div
                    className={`p-3 rounded-lg border ${ads.facebookAds?.pixelOnSite ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}
                  >
                    <p className="text-sm font-medium text-slate-900">Meta Pixel</p>
                    <p className={`text-xs ${ads.facebookAds?.pixelOnSite ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {ads.facebookAds?.pixelOnSite ? 'Rilevato sul sito' : 'Non rilevato sul sito'}
                    </p>
                  </div>
                  <div
                    className={`p-3 rounded-lg border ${ads.googleAds?.tagOnSite ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}
                  >
                    <p className="text-sm font-medium text-slate-900">Google Ads</p>
                    <p className={`text-xs ${ads.googleAds?.tagOnSite ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {ads.googleAds?.tagOnSite ? 'Tag conversione rilevato' : 'Tag non rilevato'}
                    </p>
                  </div>
                </div>

                {ads.facebookAds?.apiVerified && typeof ads.facebookAds?.activeAdsFound === 'number' && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                    <p className="text-xs text-blue-800">
                      <span className="font-semibold">{ads.facebookAds.activeAdsFound}</span> inserzioni attive trovate nella Libreria Inserzioni Meta (fonte ufficiale).
                    </p>
                  </div>
                )}

                {ads.facebookAds?.libraryUrl && (
                  <a
                    href={ads.facebookAds.libraryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-900 underline"
                  >
                    Verifica le inserzioni attive nella Libreria Inserzioni Meta →
                  </a>
                )}

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  La presenza di pixel/tag sul sito indica che questa azienda è predisposta per fare advertising. Per la conferma certa delle campagne attive usa il link verificabile qui sopra.
                </p>

                {ads.opportunities?.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-purple-700 mb-1">Spunti commerciali (AI)</p>
                    <div className="flex flex-wrap gap-1">
                      {ads.opportunities.map((o: string, i: number) => (
                        <span key={i} className="bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded-full">
                          {o}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-400 text-sm">Dati pubblicitari non disponibili</p>
            )}
          </div>

          <div className="bg-white rounded-2xl border 
            border-slate-200 p-6 shadow-sm 
            hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-xl 
                bg-zinc-100 border border-zinc-200 
                flex items-center justify-center">
                <Target className="w-4 h-4 text-red-500" />
              </div>
              <h3 className="font-bold text-base text-slate-900">
                Competitor Locali
              </h3>
            </div>
            {loadingCompetitors ? (
              <div className="animate-pulse space-y-2">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-4 bg-gray-200 rounded w-1/2" />
              </div>
            ) : Array.isArray(competitors?.competitors) && competitors.competitors.length > 0 ? (
              <div className="space-y-3">
                {(competitors.competitors || []).length > 0 ? (
                  <div className="space-y-2">
                    {(competitors.competitors || []).slice(0, 8).map((c: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                        <span className="text-sm font-medium text-slate-900">{c?.name || '—'}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-yellow-600">★ {typeof c?.rating === 'number' ? c.rating : '—'}</span>
                          <span className="text-xs text-gray-600">({typeof c?.reviews_count === 'number' ? c.reviews_count : 0})</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">Nessun competitor trovato</p>
                )}
              </div>
            ) : (
              <p className="text-gray-400 text-sm">Dati competitor non disponibili</p>
            )}
          </div>

        </div>
      </div>

      {/* Pitch Modal */}
      {showPitchModal && pitchResult && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          padding: 16,
        }} onClick={() => setShowPitchModal(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white', borderRadius: 16,
              maxWidth: 640, width: '100%',
              maxHeight: '80vh', overflow: 'auto',
              padding: 24, boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            }}>
            <h3 style={{
              fontSize: 16, fontWeight: 700, color: '#0F172A',
              fontFamily: 'Inter, sans-serif', margin: '0 0 4px',
            }}>
              Pitch Commerciale
            </h3>
            <p style={{ fontSize: 12, color: '#a1a1aa', margin: '0 0 16px', fontFamily: 'Inter, sans-serif' }}>
              {nome} · {citta} · {categoria}
            </p>

            <div style={{
              background: '#F8FAFC', borderRadius: 10,
              padding: 16, marginBottom: 12,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Oggetto
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#18181b', fontFamily: 'Inter, sans-serif' }}>
                {pitchResult.subject}
              </div>
            </div>

            <div style={{
              background: '#F8FAFC', borderRadius: 10,
              padding: 16, marginBottom: 20,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Corpo
              </div>
              <div style={{ fontSize: 13, color: '#334155', fontFamily: 'Inter, sans-serif', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                {pitchResult.body}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => setShowPitchModal(false)}
                style={{
                  padding: '10px 20px', borderRadius: 8,
                  background: '#F1F5F9', color: '#475569',
                  fontSize: 13, fontWeight: 600,
                  border: '1px solid #E2E8F0', cursor: 'pointer',
                  fontFamily: 'Inter, sans-serif',
                }}>
                Chiudi
              </button>
              <button
                onClick={() => copyToClipboard(`${pitchResult.subject}\n\n${pitchResult.body}`)}
                style={{
                  padding: '10px 20px', borderRadius: 8,
                  background: 'white', color: '#475569',
                  fontSize: 13, fontWeight: 600,
                  border: '1px solid #E2E8F0', cursor: 'pointer',
                  fontFamily: 'Inter, sans-serif',
                }}>
                📋 Copia testo
              </button>
              {email && (
                <button
                  onClick={() => {
                    window.open(`mailto:${email}?subject=${encodeURIComponent(pitchResult.subject)}&body=${encodeURIComponent(pitchResult.body)}`, '_blank')
                  }}
                  style={{
                    padding: '10px 20px', borderRadius: 8,
                    background: '#7c3aed', color: 'white',
                    fontSize: 13, fontWeight: 600,
                    border: 'none', cursor: 'pointer',
                    fontFamily: 'Inter, sans-serif',
                    boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
                  }}>
                  ✉️ Apri nel client mail
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
