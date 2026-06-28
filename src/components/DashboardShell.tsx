'use client'



import { useEffect, useMemo, useRef, useState } from 'react'

import SniperArea from '@/components/SniperArea'

import ResultsTable from '@/components/ResultsTable'

import { SaveToEnvironmentModal } from '@/components/SaveToEnvironmentModal'

import { SaveAllListModal } from '@/components/SaveAllListModal'

import { useToast } from '@/components/ToastProvider'

import { analyzeSiteAction, expandAndSearch, processSemanticSearchAction, textToFilterSearchAction } from '@/app/dashboard/actions'

import MiraxLogo from '@/components/MiraxLogo'

import { Button } from '@/components/ui/button'

import { Folder, Sparkles, Search, Database, MapPin, Loader2, ListPlus } from 'lucide-react'

import DatabaseSearchSection from '@/components/DatabaseSearchSection'

import HowToUseGuide from '@/components/HowToUseGuide'

import { createClient } from '@/utils/supabase/client'

import { useDashboard } from '@/components/DashboardContext'
import { t } from '@/lib/i18n'

import { countPendingAudits, isAuditPendingLead } from '@/lib/lead-audit-status'
import {
  computeContactVisibilityStats,
  formatContactVisibilityMessage,
  formatSearchProgressMessage,
  hasLeadContact,
  shouldTreatScrapeAsExhausted,
  SCRAPE_PLATEAU_STALE_POLLS,
  SCRAPE_POLL_INTERVAL_MS,
  stalePollsThreshold,
  type ContactVisibilityStats,
} from '@/lib/search-contact-quality'
import { SearchIntelBanner, type SearchCacheMeta } from '@/components/ecosistema/SearchIntelBanner'
import { clampSearchMaxLeads, MAX_LEADS_PER_SEARCH } from '@/lib/search-job-payload'
import { filterLeadsByBusinessSignals } from '@/lib/business-events/filters'
import type { BusinessSignalType } from '@/lib/business-events/types'
import {
  filterLeadsBySignalIntent,
  signalIntentToBusinessFilters,
  describeSignalIntent,
  coerceSignalIntent,
  type SignalIntentSpec,
} from '@/lib/signal-intent'
import { DiscoverySearchWizard } from '@/components/discovery/DiscoverySearchWizard'
import { DiscoveryResultsGrid } from '@/components/discovery/DiscoveryResultsGrid'
import { UiModeToggle } from '@/components/UiModeToggle'
import { LocaleToggle } from '@/components/LocaleToggle'




function _sanitize(v: any): string {
  if (v === null || v === undefined) return ''
  const s = String(v).trim()
  if (s === 'None' || s === 'none' || s === 'null' || s === 'undefined') return ''
  return s
}

const _FAKE_EMAIL_DOMAINS = new Set(['website.com','example.com','email.com','sito.com','domain.com','test.com','yoursite.com','yourdomain.com','tuosito.com','tuodominio.com','sitoweb.com','miosito.com','nomedominio.com','nomesito.com','sample.com','placeholder.com','mail.com'])

// Quality gate: lead must have at least phone OR email
function _hasContactInfo(lead: any): boolean {
  const _ok = (v: any) => {
    if (!v) return false
    const s = String(v).replace(/\s+/g, '').trim()
    return s.length >= 4 && !['N/D','N/A','N.D.','n/d','None','none'].includes(s)
  }
  const hasPhone = _ok(lead?.telefono) || _ok(lead?.phone)
  const hasEmail = _ok(lead?.email) && String(lead?.email || '').includes('@')
  return hasPhone || hasEmail
}

/** Parse "categoria … città" dalla query testuale (auto-scrape). Rimuove "ad"/"a" spurii prima della città. */
function parseCategoryCityFromQuery(rawQuery: string): { category: string; city: string } {
  const words = rawQuery.trim().split(/\s+/).filter(Boolean)
  const primaryCityKw = ['a', 'in', 'nel', 'nella', 'nello', 'negli', 'nelle']
  const fallbackCityKw = ['di']
  const stopWords = ['senza', 'con', 'no', 'non', 'solo', 'cerca', 'vicino', 'zona', 'che', 'hanno', 'e']
  const filterWords = [
    'sito', 'website', 'pixel', 'meta', 'gtm', 'tag', 'manager', 'ssl',
    'google', 'ads', 'instagram', 'ig', 'facebook', 'fb', 'tiktok',
    'dmarc', 'spf', 'spam', 'errori', 'seo', 'html', 'lento', 'veloce',
    'mobile', 'analytics', 'ga4', 'responsive',
  ]
  const stripPrepositionSuffix = (parts: string[]) => {
    const out = [...parts]
    while (out.length > 0 && ['ad', 'a'].includes(out[out.length - 1].toLowerCase())) {
      out.pop()
    }
    return out.join(' ').trim()
  }

  let category = ''
  let city = ''
  let cityIndex = -1
  for (let i = 0; i < words.length; i++) {
    if (primaryCityKw.includes(words[i].toLowerCase()) && i < words.length - 1) {
      cityIndex = i
      break
    }
  }
  if (cityIndex < 0) {
    for (let i = 2; i < words.length; i++) {
      if (fallbackCityKw.includes(words[i].toLowerCase()) && i < words.length - 1) {
        cityIndex = i
        break
      }
    }
  }
  if (cityIndex >= 0) {
    const catWords = words.slice(0, cityIndex)
    const catStopIdx = catWords.findIndex((w) => stopWords.includes(w.toLowerCase()))
    category = catStopIdx >= 0 ? catWords.slice(0, catStopIdx).join(' ') : catWords.join(' ')
    const cityWords = words.slice(cityIndex + 1)
    const stopIndex = cityWords.findIndex(
      (w) => stopWords.includes(w.toLowerCase()) || filterWords.includes(w.toLowerCase()),
    )
    city = stopIndex >= 0 ? cityWords.slice(0, stopIndex).join(' ') : cityWords.join(' ')
  } else if (words.length >= 2) {
    const catStopIdx2 = words.findIndex((w) => stopWords.includes(w.toLowerCase()))
    if (catStopIdx2 > 0) {
      category = words.slice(0, catStopIdx2).join(' ')
      city = 'Milano'
    } else {
      city = words[words.length - 1]
      category = stripPrepositionSuffix(words.slice(0, -1))
    }
  } else {
    category = words[0] || ''
    city = 'Milano'
  }
  return { category: category.trim(), city: city.trim() }
}

function normalizeLeadFields(lead: any): any {
  const audit = lead.audit || {}

  // Sanitize common poison strings from Python backend
  const _s = (k: string) => _sanitize(lead[k])
  const hasItalianFields = _s('azienda') || _s('nome') || _s('sito') || _s('telefono')

  // Sanitize fake/template emails
  const _cleanEmail = (raw: string): string => {
    if (!raw || !raw.includes('@')) return ''
    const domain = raw.split('@')[1]?.toLowerCase()
    if (_FAKE_EMAIL_DOMAINS.has(domain)) return ''
    return raw
  }

  // Try to extract city from address or name
  const _extractCity = (): string => {
    const raw = _s('citta') || _s('city') || _s('location') || ''
    if (raw) return raw
    // Try to get city from address field
    const addr = _s('address') || _s('indirizzo') || ''
    if (addr) {
      // Italian cities often appear after the last comma in address
      const parts = addr.split(',').map((p: string) => p.trim())
      if (parts.length >= 2) {
        const last = parts[parts.length - 1].replace(/\d{5}/g, '').trim()
        if (last && last.length > 2) return last
        const secondLast = parts[parts.length - 2].replace(/\d{5}/g, '').trim()
        if (secondLast && secondLast.length > 2) return secondLast
      }
    }
    return ''
  }

  // Map basic fields from English to Italian if needed
  const base = hasItalianFields ? {
    ...lead,
    azienda: _s('azienda') || _s('nome') || _s('business_name') || _s('name') || '',
    nome: _s('nome') || _s('azienda') || _s('business_name') || _s('name') || '',
    sito: _s('sito') || _s('website') || '',
    telefono: _s('telefono') || _s('phone') || '',
    email: _cleanEmail(_s('email') || ''),
    citta: _extractCity(),
    categoria: _s('categoria') || _s('category') || '',
    instagram: _s('instagram') || '',
  } : {
    ...lead,
    azienda: _s('business_name') || _s('name') || '',
    nome: _s('business_name') || _s('name') || '',
    sito: _s('website') || '',
    telefono: _s('phone') || '',
    email: _cleanEmail(_s('email') || ''),
    citta: _extractCity(),
    categoria: _s('category') || '',
    instagram: _s('instagram') || '',
  }

  const techStackArr = Array.isArray(base.tech_stack)
    ? base.tech_stack
    : Array.isArray(lead.tech_stack)
      ? lead.tech_stack
      : []
  if (isAuditPendingLead({ ...base, tech_stack: techStackArr })) {
    return { ...base, tech_stack: techStackArr, technical_report: base.technical_report ?? {} }
  }

  // Always ensure technical fields are populated (skip placeholder audit state above)
  if (base.tech_stack && base.technical_report && base.meta_pixel !== undefined) return base

  const metaPixel = base.meta_pixel ?? audit.has_facebook_pixel ?? false
  const gtm = base.google_tag_manager ?? audit.has_gtm ?? false
  const ssl = base.ssl ?? audit.has_ssl ?? true
  const googleAds = base.google_ads ?? audit.has_google_ads ?? false
  const mobileResp = audit.is_mobile_responsive ?? true
  const missingIg = audit.missing_instagram ?? false
  const seoDis = audit.seo_disaster ?? false
  const hasDmarc = audit.has_dmarc ?? true
  const htmlErr = audit.html_errors ?? false
  const ga4 = base.google_analytics ?? audit.has_ga4 ?? false

  return {
    ...base,
    meta_pixel: metaPixel,
    google_tag_manager: gtm,
    ssl,
    google_ads: googleAds,
    google_analytics: ga4,
    tech_stack: base.tech_stack ?? (() => {
      const ts: string[] = []
      if (!metaPixel) ts.push('No Pixel')
      if (!gtm) ts.push('No GTM')
      if (ssl === false) ts.push('No SSL')
      if (!googleAds) ts.push('No Google Ads')
      if (!ga4) ts.push('No Analytics')
      if (!mobileResp) ts.push('No Mobile')
      if (missingIg) ts.push('No Instagram')
      return ts
    })(),
    technical_report: base.technical_report ?? {
      seo_disaster: seoDis,
      has_dmarc: hasDmarc,
      has_google_ads: googleAds,
      has_ga4: ga4,
      html_errors: htmlErr,
    },
  }
}

function deduplicateResults(items: unknown[]): unknown[] {

  const seen = new Map<string, unknown>()
  const domainToKey = new Map<string, string>()
  const leadQualityScore = (lead: any): number => {
    if (isAuditPendingLead(lead)) return -500
    const isReal = (v: any) => {
      const s = String(v || '').trim()
      return !!s && !['N/D', 'N/A', 'N.D.', 'n/d', 'none', 'null', '-'].includes(s)
    }
    const phoneDigits = String(lead?.telefono || lead?.phone || '').replace(/\D/g, '')
    const hasPhone = phoneDigits.length >= 8
    const hasEmail = String(lead?.email || '').includes('@')
    const hasAudit = Boolean(lead?.technical_report?.organic_audited || lead?.audit)
    const techStack = Array.isArray(lead?.tech_stack) ? lead.tech_stack : []
    const hasRealTech = techStack.some((x: any) => {
      const s = String(x).toLowerCase()
      return s && !/contatto da verificare|verifica in corso|audit in arrivo|stack in arrivo/i.test(s)
    })
    const tr = lead?.technical_report
    const hasTechnicalReport = tr && typeof tr === 'object' && Object.keys(tr).length > 0
    return (hasPhone ? 100 : 0) + (hasEmail ? 100 : 0) + (hasAudit ? 30 : 0) + (hasRealTech ? 80 : 0) + (hasTechnicalReport ? 10 : 0) + [lead?.sito, lead?.website, lead?.instagram, lead?.rating].filter(isReal).length
  }

  for (const item of items) {

    const obj = item as any

    // Split phone on common separators ( / , ; | ) and use the first valid chunk
    const rawPhone = (obj.telefono || obj.phone || '').toString()
    const phoneParts = rawPhone.split(/[\/,;|]+/)
    let phone = ''
    for (const part of phoneParts) {
      const digits = part.replace(/\D/g, '').replace(/^(39|0039)/, '')
      if (digits.length >= 8) { phone = digits.slice(-9); break }
    }

    const name = (obj.azienda || obj.nome || obj.company || '').toLowerCase().trim().slice(0, 20)

    const rawSite = (obj.sito || obj.website || '').toString().toLowerCase().trim()
    const domain = rawSite.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim()

    // Build primary key: phone > domain > name
    const phoneKey = phone && phone.length >= 8 ? `tel:${phone}` : ''
    const webKey = domain ? `web:${domain}` : ''
    const nameKey = name ? `name:${name}` : ''

    // Check duplicate by domain (catches multiple Maps listings sharing one website)
    if (webKey && domainToKey.has(webKey)) {
      const existingMapKey = domainToKey.get(webKey)!
      const existing = seen.get(existingMapKey) as any
      if (existing) {
        const existingScore = leadQualityScore(existing)
        const newScore = leadQualityScore(obj)
        if (newScore >= existingScore) seen.set(existingMapKey, item)
      }
      continue
    }

    // Check duplicate by phone
    if (phoneKey && seen.has(phoneKey)) {
      const existing = seen.get(phoneKey) as any
      const existingScore = leadQualityScore(existing)
      const newScore = leadQualityScore(obj)
      if (newScore >= existingScore) seen.set(phoneKey, item)
      if (webKey) domainToKey.set(webKey, phoneKey)
      continue
    }

    // New unique lead
    const primaryKey = phoneKey || webKey || nameKey || `uid:${Math.random()}`

    if (!primaryKey || primaryKey === 'tel:' || primaryKey === 'web:' || primaryKey === 'name:') {

      seen.set(`uid:${Math.random()}`, item)

      continue

    }

    seen.set(primaryKey, item)
    if (webKey) domainToKey.set(webKey, primaryKey)

  }
  return Array.from(seen.values())

}



function _isRealEmail(v: any): boolean {
  if (!v || typeof v !== 'string') return false
  const e = v.trim().toLowerCase()
  if (!e || ['n/d','n/a','none','null'].includes(e)) return false
  const atIdx = e.indexOf('@')
  if (atIdx < 1) return false
  const domain = e.slice(atIdx + 1)
  return !_FAKE_EMAIL_DOMAINS.has(domain)
}
function _hasContact(lead: any): boolean {
  return hasLeadContact(lead)
}

function buildTechFilter(q: string): ((l: any) => boolean) | null {
  const filters: Array<(l: any) => boolean> = []
  const ql = q.toLowerCase()
  if (/errori?\s*(seo|html)|seo\s*error|con\s*errori/i.test(ql))
    filters.push((l) => {
      const tr = l.technical_report || {}
      const stack = Array.isArray(l.tech_stack) ? l.tech_stack.join(' ').toLowerCase() : ''
      const htmlErr = tr.html_errors
      const hasHtmlErrors = htmlErr === true || (typeof htmlErr === 'number' && htmlErr > 0)
      return tr.seo_disaster === true || hasHtmlErrors || stack.includes('disastro seo') || stack.includes('seo error')
    })
  if (/senza\s*(meta\s*)?pixel|no\s*pixel/i.test(ql))
    filters.push((l) => l.meta_pixel !== true)
  if (/senza\s*gtm|no\s*gtm|senza\s*tag\s*manager/i.test(ql))
    filters.push((l) => l.google_tag_manager !== true)
  if (/senza\s*ssl|no\s*ssl/i.test(ql))
    filters.push((l) => l.ssl === false)
  if (/senza\s*google\s*ads|no\s*google\s*ads|senza\s*ads/i.test(ql))
    filters.push((l) => l.google_ads !== true && (l.technical_report?.has_google_ads !== true))
  if (/senza\s*instagram|no\s*instagram/i.test(ql))
    filters.push((l) => {
      const ig = (l.instagram || '').trim()
      return !ig || ig === 'N/D'
    })
  if (/senza\s*(google\s*)?analytics|no\s*analytics|senza\s*ga4|no\s*ga4/i.test(ql))
    filters.push((l) => l.google_analytics !== true && (l.technical_report?.has_ga4 !== true))
  if (/sito\s*lento|slow\s*(site|speed)/i.test(ql))
    filters.push((l) => {
      const spd = l.technical_report?.load_speed_s ?? l.technical_report?.load_speed_seconds
      return typeof spd === 'number' && spd > 3
    })
  if (/senza\s*(sito|website)|no\s*(web|website|sito)/i.test(ql))
    filters.push((l) => {
      const s = (l.sito || l.website || '').trim()
      return !s || s === 'N/D' || s === 'N/A' || s === 'N.D.' || s === 'n/d'
    })
  if (/senza\s*facebook|no\s*facebook/i.test(ql))
    filters.push((l) => {
      const fb = (l.facebook || '').trim()
      return !fb || fb === 'N/D'
    })
  if (/senza\s*dmarc|no\s*dmarc/i.test(ql))
    filters.push((l) => l.dmarc !== true && (l.technical_report?.has_dmarc !== true))
  if (/non\s*mobile|no\s*mobile|senza\s*mobile/i.test(ql))
    filters.push((l) => l.mobile_friendly !== true && (l.technical_report?.mobile_friendly !== true))
  if (/senza\s*linkedin|no\s*linkedin/i.test(ql))
    filters.push((l) => {
      const li = (l.linkedin || '').trim()
      return !li || li === 'N/D'
    })
  if (/senza\s*email|no\s*email/i.test(ql))
    filters.push((l) => {
      const em = (l.email || '').trim()
      return !em || em === 'N/D' || em === 'N/A'
    })
  if (/basso\s*rating|rating\s*basso|low\s*rating/i.test(ql))
    filters.push((l) => {
      const rawRating = l.rating ?? l.google_rating ?? l.stelle ?? ''
      const r = parseFloat(typeof rawRating === 'string' ? rawRating.replace(/[^\d.]/g, '') : String(rawRating))
      return !isNaN(r) && r > 0 && r < 4
    })
  if (/poche\s*recensioni|few\s*reviews/i.test(ql))
    filters.push((l) => {
      const n = parseInt(l.reviews_count ?? l.review_count ?? l.reviews ?? l.google_reviews ?? String(l.num_recensioni ?? ''), 10)
      return !isNaN(n) && n >= 0 && n < 10
    })
  if (filters.length === 0) return null
  // Prerequisite: if query needs web-tech info (not "senza sito"), exclude leads without websites
  const needsWebsite = !(/senza\s*(sito|website)|no\s*(web|website|sito)/i.test(ql)) &&
    /errori|seo|pixel|gtm|tag.manager|ssl|google.ads|ads|analytics|ga4|lento|slow|dmarc|mobile/i.test(ql)
  return (lead: any) => {
    if (needsWebsite) {
      const s = (lead.sito || lead.website || '').trim()
      if (!s || s === 'N/D' || s === 'N/A' || s === 'N.D.' || s === 'n/d') return false
    }
    return filters.some(f => f(lead))
  }
}

export default function DashboardShell() {

  const { credits, setCredits, uiMode, setUiMode, locale, setLocale } = useDashboard()
  const { error: toastError, info: toastInfo, success: toastSuccess } = useToast()

  // Keep a ref for credits so polling closures always see latest value
  const creditsRef = useRef(credits)
  /** Lead cap for the active search — fixed at start so display does not shrink as credits are deducted. */
  const searchCreditBudgetRef = useRef(0)
  useEffect(() => { creditsRef.current = credits }, [credits])

  const beginSearchCreditBudget = (overrideMax?: number) => {
    const cap = clampSearchMaxLeads(typeof overrideMax === 'number' ? overrideMax : maxLeads, creditsRef.current)
    searchCreditBudgetRef.current = cap
  }

  const getLeadDisplayCap = () => clampSearchMaxLeads(maxLeads, creditsRef.current)

  const capLeadsForDisplay = <T,>(leads: T[]): T[] => leads.slice(0, getLeadDisplayCap())

  const applySearchResults = (next: unknown[], allowShrink = false) => {
    const len = Array.isArray(next) ? next.length : 0
    if (allowShrink || len >= resultsCountRef.current) {
      setResults(next)
    }
  }

  const applySearchAiDebug = (debug: unknown) => {
    setAiDebug(debug ?? null)
    if (debug && typeof debug === 'object' && (debug as Record<string, unknown>).signal_intent) {
      const intent = coerceSignalIntent((debug as Record<string, unknown>).signal_intent)
      if (intent.required_signals.length) {
        setSignalIntent(intent)
        const autoFilters = signalIntentToBusinessFilters(intent)
        if (autoFilters.length) {
          setBusinessSignalFilters((prev) => [...new Set([...prev, ...autoFilters])])
        }
        return
      }
    }
    setSignalIntent(null)
  }

  // Helper: deduct N credits via API and update state/ref
  const deductCredits = async (amount: number): Promise<number> => {
    if (amount <= 0) return creditsRef.current
    try {
      const res = await fetch('/api/use-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      })
      const data = await res.json()
      if (res.ok && typeof data.credits === 'number') {
        creditsRef.current = data.credits
        setCredits(data.credits)
        return data.credits
      }
    } catch {}
    return creditsRef.current
  }

  const supabase = useMemo(() => createClient(), [])

  const pollRef = useRef<number | null>(null)

  const searchIdRef = useRef<string | null>(null)
  const activeSearchQueryRef = useRef('')



  const [isRestored, setIsRestored] = useState(false)

  const [query, setQuery] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [maxLeads, setMaxLeads] = useState(10)
  const [mergeIntoListId, setMergeIntoListId] = useState<string | null>(null)

  const [isLoading, setIsLoading] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const [results, setResults] = useState<unknown[]>([])

  const [activeFilters, setActiveFilters] = useState<Record<string, unknown> | null>(null)

  const [businessSignalFilters, setBusinessSignalFilters] = useState<BusinessSignalType[]>([])
  const [signalIntent, setSignalIntent] = useState<SignalIntentSpec | null>(null)

  const [aiDebug, setAiDebug] = useState<unknown>(null)

  // Restore from sessionStorage after mount (batched with setIsRestored)
  useEffect(() => {
    try {
      // URL ?q=... pre-fills the search query (used by deep links from Hotlist/Insights)
      const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
      const urlQuery = urlParams?.get('q') || ''
      const updateList = urlParams?.get('updateList') || ''
      const listName = urlParams?.get('listName') || ''

      const savedQuery = sessionStorage.getItem('ckb_query')
      if (listName) setQuery(listName)
      else if (urlQuery) setQuery(urlQuery)
      else if (savedQuery) setQuery(savedQuery)
      if (updateList) setMergeIntoListId(updateList)
      const savedResults = sessionStorage.getItem('ckb_results')
      let restoredCount = 0
      if (savedResults) {
        const parsed = (JSON.parse(savedResults) as any[]).filter(_hasContact)
        restoredCount = parsed.length
        setResults(parsed)
      }
      const savedFilters = sessionStorage.getItem('ckb_filters')
      if (savedFilters) setActiveFilters(JSON.parse(savedFilters))
      const savedBiz = sessionStorage.getItem('ckb_business_signal_filters')
      if (savedBiz) {
        try {
          const parsed = JSON.parse(savedBiz)
          if (Array.isArray(parsed)) {
            const allowed = new Set(['hiring', 'new_location', 'registry_change', 'funding_news', 'site_stale', 'meta_ads_started', 'google_ads_started'])
            setBusinessSignalFilters(parsed.filter((x): x is BusinessSignalType => typeof x === 'string' && allowed.has(x)))
          }
        } catch { /* ignore */ }
      }
      const savedAiDebug = sessionStorage.getItem('ckb_aiDebug')
      if (savedAiDebug) setAiDebug(JSON.parse(savedAiDebug))
      const savedSearchId = sessionStorage.getItem('ckb_searchId')
      if (savedSearchId) { setCurrentSearchId(savedSearchId); searchIdRef.current = savedSearchId }
      const savedMaxLeads = sessionStorage.getItem('ckb_maxLeads')
      const restoredMax = clampSearchMaxLeads(savedMaxLeads ? Number(savedMaxLeads) || 10 : 10)
      if (savedMaxLeads) setMaxLeads(restoredMax)
      if (restoredCount > 0 && restoredCount < restoredMax) {
        setSearchState('searching')
        setSearchExhausted(false)
        setAutoScrapeTriggered(false)
      }
      const savedScrapeJobId = sessionStorage.getItem('ckb_scrapeJobId')
      const resumeJobId = savedScrapeJobId || savedSearchId || null
      if (resumeJobId && restoredCount < restoredMax) {
        setScrapeJobId(resumeJobId)
        setIsScraping(true)
      }
    } catch {}
    setIsRestored(true)
  }, [])

  const [aiAnalyzing, setAiAnalyzing] = useState(false)

  const [pendingJobId, setPendingJobId] = useState<string | null>(null)

  const [searchState, setSearchState] = useState<'idle' | 'searching' | 'pending' | 'done'>('idle')

  const [currentJobId, setCurrentJobId] = useState<string | null>(null)

  const [isScraping, setIsScraping] = useState(false)

  // Persist search state to sessionStorage (only after restore is complete)
  useEffect(() => {
    if (!isRestored) return
    sessionStorage.setItem('ckb_query', query)
  }, [query, isRestored])

  useEffect(() => {
    if (!isRestored) return
    try { sessionStorage.setItem('ckb_results', JSON.stringify(results)) } catch {}
  }, [results, isRestored])

  useEffect(() => {
    if (!isRestored) return
    try { sessionStorage.setItem('ckb_filters', JSON.stringify(activeFilters)) } catch {}
  }, [activeFilters, isRestored])

  useEffect(() => {
    if (!isRestored) return
    try { sessionStorage.setItem('ckb_business_signal_filters', JSON.stringify(businessSignalFilters)) } catch {}
  }, [businessSignalFilters, isRestored])

  useEffect(() => {
    if (!isRestored) return
    try { sessionStorage.setItem('ckb_aiDebug', JSON.stringify(aiDebug)) } catch {}
  }, [aiDebug, isRestored])

  useEffect(() => {
    if (!isRestored) return
    const clamped = clampSearchMaxLeads(maxLeads, credits)
    if (clamped !== maxLeads) setMaxLeads(clamped)
  }, [credits, isRestored])

  const [searchMode, setSearchMode] = useState<'maps' | 'database' | 'ambiente'>('maps')
  const [guideOpen, setGuideOpen] = useState(false)
  const [guideMode, setGuideMode] = useState<'maps' | 'ambiente'>('maps')
  const [autoScrapeTriggered, setAutoScrapeTriggered] = useState(false)
  const [autoScrapeLoading, setAutoScrapeLoading] = useState(false)
  const [searchExhausted, setSearchExhausted] = useState(false)
  const [contactStats, setContactStats] = useState<ContactVisibilityStats | null>(null)
  const [searchCacheMeta, setSearchCacheMeta] = useState<SearchCacheMeta | null>(null)
  const prevQueryRef = useRef('')
  const autoscrapePollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resultsCountRef = useRef(0)
  const resultsArrRef = useRef<unknown[]>([])
  const lastSearchJobIdRef = useRef<string | null>(null)
  const auditProgressAtRef = useRef(Date.now())
  const auditResumeInFlightRef = useRef(false)

  const pendingAuditCount = useMemo(() => countPendingAudits(results), [results])

  useEffect(() => {
    const arr = Array.isArray(results) ? results : []
    resultsCountRef.current = arr.length
    resultsArrRef.current = arr
  }, [results])

  const resetSearchRuntime = (nextQuery: string) => {
    activeSearchQueryRef.current = nextQuery
    searchIdRef.current = null
    resultsArrRef.current = []
    resultsCountRef.current = 0
    setResults([])
    setCurrentSearchId(null)
    setPendingJobId(null)
    setCurrentJobId(null)
    setScrapeJobId(null)
    lastSearchJobIdRef.current = null
    auditProgressAtRef.current = Date.now()
    auditResumeInFlightRef.current = false
    setIsScraping(false)
    setAutoScrapeTriggered(false)
    setAutoScrapeLoading(false)
    setSearchExhausted(false)
    setSearchCacheMeta(null)
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (autoscrapePollRef.current) {
      clearInterval(autoscrapePollRef.current)
      autoscrapePollRef.current = null
    }
    try {
      sessionStorage.removeItem('ckb_results')
      sessionStorage.removeItem('ckb_searchId')
      sessionStorage.removeItem('ckb_scrapeJobId')
    } catch {}
  }

  useEffect(() => {
    if (query !== prevQueryRef.current) {
      prevQueryRef.current = query
      setAutoScrapeTriggered(false)
      setAutoScrapeLoading(false)
      if (autoscrapePollRef.current) {
        clearInterval(autoscrapePollRef.current)
        autoscrapePollRef.current = null
      }
    }
    console.log('[AUTO-SCRAPE-CHECK]', {
      resultsLen: Array.isArray(results) ? results.length : 0,
      maxLeads,
      autoScrapeTriggered,
      isLoading,
      isScraping,
      query: query.slice(0, 30),
      prevQuery: prevQueryRef.current?.slice(0, 30),
    })
    if (!Array.isArray(results) || results.length === 0) {
      setAutoScrapeTriggered(false)
      return
    }
    // Don't auto-scrape if we already have enough leads
    if (results.length >= maxLeads) return
    if (autoScrapeTriggered && prevQueryRef.current === query) return
    if (isLoading) return
    // Don't auto-scrape if the main search already has a scrape job running
    if (isScraping) return
    console.log('[AUTO-SCRAPE] ✅ All checks passed, will trigger in 1.5s')

    const triggerAutoScrape = async () => {
      try {
        setAutoScrapeTriggered(true)
        setAutoScrapeLoading(true)
        searchCreditBudgetRef.current = Math.min(
          maxLeads,
          Math.max(searchCreditBudgetRef.current, resultsCountRef.current + creditsRef.current),
        )

        const { category, city } = parseCategoryCityFromQuery(query)
        if (!category || !city) {
          setAutoScrapeLoading(false)
          return
        }

        // Detect "senza sito" for filtering in auto-scrape polling
        const isNoWebsiteQuery = /senza\s*(sito|website)|no\s*(web|website|sito)|manca\s*(il\s+)?sito|privo\s+di\s+sito/i.test(query)
        const techFilterAuto = buildTechFilter(query)

        // If we already have enough leads, skip auto-scrape
        if (resultsCountRef.current >= maxLeads) {
          setAutoScrapeLoading(false)
          return
        }

        // Helper: trigger one scrape job via /api/trigger-scrape and poll via /api/check-scrape-job
        const runOneScrapeJob = async (offset: number = 0): Promise<boolean> => {
          const needed = maxLeads - resultsCountRef.current
          if (needed <= 0) return true
          const batchSize = Math.max(needed * 2, 40)

          let jobId: string | null = null
          try {
            const scrapeResp = await fetch('/api/trigger-scrape', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ category, city, num_results: batchSize, max_results: maxLeads, offset }),
            })
            if (scrapeResp.ok) {
              const scrapeData = await scrapeResp.json().catch(() => ({}))
              jobId = (scrapeData as any)?.job_id ?? null
            }
            console.log('[AUTO-SCRAPE] trigger:', { jobId, category, city, batchSize, needed })
          } catch (e) {
            console.warn('[AUTO-SCRAPE] trigger error:', e)
          }

          if (!jobId) {
            console.warn('[AUTO-SCRAPE] No jobId returned')
            return false
          }
          lastSearchJobIdRef.current = jobId

          return new Promise<boolean>((resolve) => {
            let pollCount = 0
            const maxPolls = 120
            let stalePolls = 0
            let lastResultCount = 0

            if (autoscrapePollRef.current) clearInterval(autoscrapePollRef.current)
            const pollInterval = setInterval(async () => {
              pollCount++
              if (pollCount >= maxPolls) {
                clearInterval(pollInterval)
                autoscrapePollRef.current = null
                resolve(resultsCountRef.current >= maxLeads)
                return
              }

              try {
                const jobRes = await fetch(`/api/check-scrape-job?job_id=${jobId}`)
                if (!jobRes.ok) return
                const jobData = await jobRes.json()
                const scrapeResults = Array.isArray(jobData.results) ? jobData.results : []

                if (pollCount <= 5 || pollCount % 10 === 0) {
                  console.log(`[AUTO-SCRAPE] poll #${pollCount}: status=${jobData.status} results=${scrapeResults.length} current=${resultsCountRef.current}/${maxLeads}`)
                }

                if (scrapeResults.length > 0) {
                  setContactStats(computeContactVisibilityStats(scrapeResults.map(normalizeLeadFields)))
                  if (scrapeResults.length === lastResultCount) stalePolls++
                  else { stalePolls = 0; lastResultCount = scrapeResults.length }
                }

                if (scrapeResults.length > 0 && creditsRef.current > 0) {
                  const curArr = resultsArrRef.current as any[]
                  const remaining = maxLeads - curArr.length
                  if (remaining <= 0) {
                    clearInterval(pollInterval)
                    autoscrapePollRef.current = null
                    resolve(true)
                    return
                  }
                  let normalized = scrapeResults.map(normalizeLeadFields)
                  if (isNoWebsiteQuery) {
                    normalized = normalized.filter((r: any) => {
                      const s = (r.sito || r.website || '').trim()
                      return !s || s === 'N/D' || s === 'N/A' || s === 'N.D.' || s === 'n/d'
                    })
                  }
                  if (techFilterAuto) normalized = normalized.filter(techFilterAuto)
                  const prevLen = curArr.length
                  const updated = (deduplicateResults([...normalized, ...curArr]) as any[]).filter(_hasContact)
                  const capped = capLeadsForDisplay(updated)
                  const changed =
                    capped.length !== curArr.length ||
                    countPendingAudits(capped) < countPendingAudits(curArr)
                  if (changed) {
                    resultsArrRef.current = capped
                    resultsCountRef.current = capped.length
                    applySearchResults(capped)
                    const actualNewCount = Math.max(0, capped.length - prevLen)
                    if (actualNewCount > 0) deductCredits(actualNewCount)
                  }
                  if (capped.length >= maxLeads) {
                    clearInterval(pollInterval)
                    autoscrapePollRef.current = null
                    resolve(true)
                    return
                  }
                }

                if (jobData.status === 'completed' || jobData.status === 'error' || stalePolls >= SCRAPE_PLATEAU_STALE_POLLS) {
                  console.log(`[AUTO-SCRAPE] done: status=${jobData.status} results=${scrapeResults.length} total=${resultsCountRef.current}/${maxLeads} stale=${stalePolls}`)
                  clearInterval(pollInterval)
                  autoscrapePollRef.current = null
                  if (resultsCountRef.current < maxLeads && scrapeResults.length > 0) {
                    setSearchExhausted(true)
                    setSearchState('done')
                  }
                  resolve(resultsCountRef.current >= maxLeads)
                  return
                }
              } catch (e) {
                console.error('[AUTO-SCRAPE] poll error:', e)
              }
            }, 5000)
            autoscrapePollRef.current = pollInterval
          })
        }

        if (resultsCountRef.current < maxLeads && creditsRef.current > 0) {
          let offset = 0
          let attempts = 0
          const MAX_ATTEMPTS = 50
          while (
            resultsCountRef.current < maxLeads &&
            creditsRef.current > 0 &&
            attempts < MAX_ATTEMPTS
          ) {
            await runOneScrapeJob(offset)
            attempts += 1
            offset += Math.max(40, maxLeads)
          }
        }

        setAutoScrapeLoading(false)
        if (resultsCountRef.current >= maxLeads) {
          setSearchExhausted(false)
          setSearchState('done')
        } else if (resultsCountRef.current > 0) {
          setSearchExhausted(true)
          setSearchState('done')
          setAutoScrapeTriggered(false)
        }
      } catch (e) {
        console.error('auto-scrape error:', e)
      }
    }

    const timer = setTimeout(triggerAutoScrape, 1500)
    return () => {
      clearTimeout(timer)
    }
  }, [results, autoScrapeTriggered, isLoading, isScraping, query, maxLeads])

  // Cleanup poll on unmount only
  useEffect(() => {
    return () => {
      if (autoscrapePollRef.current) {
        clearInterval(autoscrapePollRef.current)
        autoscrapePollRef.current = null
      }
    }
  }, [])

  const [scrapeJobId, setScrapeJobId] = useState<string | null>(null)

  useEffect(() => {
    if (scrapeJobId) lastSearchJobIdRef.current = scrapeJobId
    if (currentJobId) lastSearchJobIdRef.current = currentJobId
  }, [scrapeJobId, currentJobId])

  useEffect(() => {
    if (!isRestored) return
    if (isScraping && scrapeJobId) {
      sessionStorage.setItem('ckb_scrapeJobId', scrapeJobId)
    } else {
      sessionStorage.removeItem('ckb_scrapeJobId')
    }
  }, [isScraping, scrapeJobId, isRestored])

  const [isSaveToEnvOpen, setIsSaveToEnvOpen] = useState(false)

  const [saveToEnvSearchId, setSaveToEnvSearchId] = useState<string | null>(null)

  const [isSaveAllOpen, setIsSaveAllOpen] = useState(false)

  const [currentSearchId, setCurrentSearchId] = useState<string | null>(null)

  useEffect(() => {
    if (!isRestored) return
    if (currentSearchId) sessionStorage.setItem('ckb_searchId', currentSearchId)
  }, [currentSearchId, isRestored])

  // After refresh: re-sync incomplete searches from DB (session may have stale partial results).
  useEffect(() => {
    if (!isRestored) return
    const jobId = scrapeJobId || currentSearchId || currentJobId
    if (!jobId) return
    if (searchState === 'done' && searchExhausted) return

    if (searchCreditBudgetRef.current <= 0) {
      searchCreditBudgetRef.current = Math.min(maxLeads, creditsRef.current)
    }

    let cancelled = false
    const syncFromDb = async () => {
      try {
        const { data } = await supabase.from('searches').select('status, results').eq('id', jobId).single()
        if (cancelled || !data) return
        const parsed = Array.isArray((data as any)?.results)
          ? (data as any).results
          : (() => {
              try { return JSON.parse(((data as any)?.results as any) || '[]') } catch { return [] }
            })()
        if (!Array.isArray(parsed) || parsed.length === 0) return

        setContactStats(computeContactVisibilityStats(parsed.map(normalizeLeadFields)))
        const normalized = (deduplicateResults(parsed.map(normalizeLeadFields)) as any[]).filter(_hasContact)
        const capped = capLeadsForDisplay(normalized)
        if (capped.length > resultsCountRef.current) {
          applySearchResults(capped)
        }
        const status = String((data as any)?.status ?? '').toLowerCase()
        if (status === 'completed' || status === 'error') {
          setIsScraping(false)
          setSearchState('done')
          setSearchExhausted(capped.length < maxLeads)
        } else if (capped.length < maxLeads) {
          setScrapeJobId(jobId)
          setIsScraping(true)
          setSearchState('searching')
        }
      } catch {
        /* ignore */
      }
    }

    void syncFromDb()
    return () => { cancelled = true }
  }, [isRestored, scrapeJobId, currentSearchId, currentJobId, credits, maxLeads, supabase, searchState, searchExhausted])

  const deriveSearchIdFromResults = (items: unknown[]): string | null => {

    try {

      const counts = new Map<string, number>()

      for (const it of Array.isArray(items) ? (items as any[]) : []) {

        const id = typeof (it as any)?.__ckb_search_id === 'string' ? String((it as any).__ckb_search_id) : ''

        if (!id) continue

        counts.set(id, (counts.get(id) || 0) + 1)

      }

      let bestId: string | null = null

      let bestCount = 0

      for (const [id, c] of counts.entries()) {

        if (c > bestCount) {

          bestCount = c

          bestId = id

        }

      }

      return bestId

    } catch {

      return null

    }

  }

  const effectiveSearchId =

    searchIdRef.current ??

    currentSearchId ??

    (Array.isArray(results) ? deriveSearchIdFromResults(results) : null) ??

    scrapeJobId ??

    pendingJobId ??

    currentJobId

  const displayResults = useMemo(() => {
    const base = Array.isArray(results) ? results : []
    const byIntent = filterLeadsBySignalIntent(base, signalIntent)
    return filterLeadsByBusinessSignals(byIntent, businessSignalFilters)
  }, [results, businessSignalFilters, signalIntent])

  const resolveCompletedSearchId = async (filters: any) => {

    try {

      const city = typeof filters?.citta === 'string' ? filters.citta.trim() : typeof filters?.city === 'string' ? filters.city.trim() : ''

      const category =

        typeof filters?.categoria === 'string'

          ? filters.categoria.trim()

          : typeof filters?.category === 'string'

            ? filters.category.trim()

            : ''

      if (!city && !category) return null

      let q = supabase
        .from('searches')
        .select('id, created_at')
        .eq('status', 'completed')

      if (city) q = q.ilike('location', `%${city}%`)

      if (category) q = q.ilike('category', `%${category}%`)

      const { data } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle()

      return (data as any)?.id ? String((data as any).id) : null

    } catch {

      return null

    }

  }



  useEffect(() => {

    return () => {

      if (pollRef.current != null) {

        window.clearInterval(pollRef.current)

        pollRef.current = null

      }

    }

  }, [])



  useEffect(() => {

    if (searchState !== 'pending' || !currentJobId) return

    const expectedQuery = activeSearchQueryRef.current
    const _pollStart1 = Date.now()
    const POLL_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes max

    const interval = window.setInterval(async () => {

      if (activeSearchQueryRef.current !== expectedQuery) {
        window.clearInterval(interval)
        return
      }

      // Timeout: stop polling after 10 min, show whatever we have
      if (Date.now() - _pollStart1 > POLL_TIMEOUT_MS) {
        window.clearInterval(interval)
        setSearchState('done')
        console.log('[poll] timeout reached for currentJobId, stopping')
        return
      }

      try {

        const { data } = await supabase

          .from('searches')

          .select('status, results')

          .eq('id', currentJobId)

          .single()

        if (data?.status === 'completed') {

          window.clearInterval(interval)

          let nextResults =

            typeof (data as any).results === 'string'

              ? JSON.parse((data as any).results)

              : (data as any).results

          let arr = Array.isArray(nextResults) ? nextResults : nextResults ? [nextResults] : []

          // Apply has_website filter from activeFilters (e.g. "senza sito")
          if ((activeFilters as any)?.has_website === false) {
            arr = arr.filter((lead: any) => {
              const s = (typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : '').trim()
              return !s || s === 'N/D' || s === 'N/A' || s === 'N.D.'
            })
          } else if ((activeFilters as any)?.has_website === true) {
            arr = arr.filter((lead: any) => {
              const s = (typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : '').trim()
              return s && s !== 'N/D' && s !== 'N/A' && s !== 'N.D.'
            })
          }

          // Apply tech filter from query (errori seo, senza pixel, etc.)
          const _tf1 = buildTechFilter(expectedQuery || query)
          if (_tf1) arr = arr.map(normalizeLeadFields).filter(_tf1) as any[]

          const jobResults = (deduplicateResults((_tf1 ? arr : arr.map(normalizeLeadFields)) as any[]) as any[]).filter(_hasContact)
          const refinedJob = await refineLeadsBySubtype(jobResults)
          const finalResults = refinedJob.slice(0, maxLeads)
          setResults(finalResults)

          if (finalResults.length >= maxLeads) {
            setSearchExhausted(false)
            setSearchState('done')
          } else {
            setAutoScrapeTriggered(false)
          }

        }

      } catch (e) {

        console.log('[poll] error:', e)

      }

    }, 5000)



    return () => window.clearInterval(interval)

  }, [searchState, currentJobId, supabase, maxLeads])



  useEffect(() => {

    if (!isScraping || !scrapeJobId) return

    const expectedQuery = activeSearchQueryRef.current
    const _pollStart2 = Date.now()
    const POLL_TIMEOUT_MS2 = 10 * 60 * 1000 // 10 minutes max
    let stalePolls = 0
    let lastRawCount = 0
    const plateauThreshold = stalePollsThreshold(SCRAPE_POLL_INTERVAL_MS)

    const interval = window.setInterval(async () => {

      if (activeSearchQueryRef.current !== expectedQuery) {
        window.clearInterval(interval)
        return
      }

      // Timeout: stop polling after 10 min, show whatever we have
      if (Date.now() - _pollStart2 > POLL_TIMEOUT_MS2) {
        window.clearInterval(interval)
        setIsScraping(false)
        setSearchExhausted(true)
        setSearchState('done')
        console.log('[poll] timeout reached for scrapeJobId, stopping')
        const currentResults = resultsArrRef.current || []
        if (currentResults.length > 0) {
          toastSuccess(`Ricerca completata con ${currentResults.length} risultati parziali.`, 'Timeout raggiunto')
        } else {
          toastError('La ricerca ha impiegato troppo tempo. Riprova più tardi.', 'Timeout ricerca')
        }
        return
      }

      try {

        const { data } = await supabase

          .from('searches')

          .select('status, results')

          .eq('id', scrapeJobId)

          .single()

        const parsed = Array.isArray((data as any)?.results) ? (data as any).results : (() => { try { return JSON.parse(((data as any)?.results as any) || '[]') } catch { return [] } })()

        if (Array.isArray(parsed) && parsed.length > 0) {
          setContactStats(computeContactVisibilityStats(parsed.map(normalizeLeadFields)))
          if (parsed.length === lastRawCount) stalePolls += 1
          else {
            stalePolls = 0
            lastRawCount = parsed.length
          }
        }

        const exhausted = shouldTreatScrapeAsExhausted({
          status: data?.status,
          rawResultCount: Array.isArray(parsed) ? parsed.length : 0,
          displayedCount: resultsCountRef.current,
          maxLeads,
          stalePolls,
          maxStalePolls: plateauThreshold,
        })

        // Helper: apply has_website filter + tech filters from query
        const _tf2 = buildTechFilter(expectedQuery || query)
        const applyAllFilters = (leads: any[]) => {
          let out = leads
          if ((activeFilters as any)?.has_website === false) {
            out = out.filter((lead: any) => {
              const s = (typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : '').trim()
              return !s || s === 'N/D' || s === 'N/A' || s === 'N.D.'
            })
          } else if ((activeFilters as any)?.has_website === true) {
            out = out.filter((lead: any) => {
              const s = (typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : '').trim()
              return s && s !== 'N/D' && s !== 'N/A' && s !== 'N.D.'
            })
          }
          if (_tf2) out = out.filter(_tf2)
          return out
        }

        if (data?.status === 'completed') {

          window.clearInterval(interval)

          setIsScraping(false)

          const normalized = deduplicateResults(applyAllFilters((parsed || []).map(normalizeLeadFields))) as any[]
          const jobResults = (normalized as any[]).filter(_hasContact)
          const refinedResults = await refineLeadsBySubtype(jobResults)
          const cappedByCredits = capLeadsForDisplay(refinedResults)
          applySearchResults(cappedByCredits)
          setContactStats(computeContactVisibilityStats((parsed || []).map(normalizeLeadFields)))
          const previousCount = resultsCountRef.current
          const newCount = Math.max(0, cappedByCredits.length - previousCount)
          if (newCount > 0) {
            deductCredits(newCount)
          }

          if (cappedByCredits.length >= maxLeads) {
            setSearchExhausted(false)
            setSearchState('done')
          } else {
            setAutoScrapeTriggered(false)
            setSearchExhausted(true)
            setSearchState('done')
          }

        } else if (exhausted && Array.isArray(parsed) && parsed.length > 0) {

          window.clearInterval(interval)
          setIsScraping(false)
          setSearchExhausted(true)
          setSearchState('done')
          const normalized = deduplicateResults(applyAllFilters(parsed.map(normalizeLeadFields))) as any[]
          const jobResults = normalized.filter(_hasContact)
          const refinedResults = await refineLeadsBySubtype(jobResults)
          const capped = capLeadsForDisplay(refinedResults)
          applySearchResults(capped)
          setContactStats(computeContactVisibilityStats(parsed.map(normalizeLeadFields)))
          toastSuccess(
            `Mercato esaurito per questa categoria — ${capped.length} lead disponibili.`,
            'Ricerca completata',
          )

        } else if (data?.status === 'error') {

          window.clearInterval(interval)
          setIsScraping(false)
          setSearchState('done')
          // Show any partial results if available
          if (Array.isArray(parsed) && parsed.length > 0) {
            const normalized = deduplicateResults(applyAllFilters(parsed.map(normalizeLeadFields))) as any[]
            const jobResults = (normalized as any[]).filter(_hasContact)
            const refinedResults = await refineLeadsBySubtype(jobResults)
            applySearchResults(capLeadsForDisplay(refinedResults), true)
          }
          toastError('La ricerca ha riscontrato un errore. Riprova con una query diversa.', 'Errore ricerca')

        } else if ((data?.status === 'processing' || data?.status === 'pending_user' || data?.status === 'pending') && Array.isArray(parsed) && parsed.length > 0) {

          const normalized = deduplicateResults(applyAllFilters(parsed.map(normalizeLeadFields))) as any[]
          const jobResults = (normalized as any[]).filter(_hasContact)
          const cappedByCredits = capLeadsForDisplay(jobResults)
          applySearchResults(cappedByCredits)
          const previousCount = resultsCountRef.current
          const newCount = Math.max(0, cappedByCredits.length - previousCount)
          if (newCount > 0) {
            deductCredits(newCount)
          }

        }

      } catch (e) {

        console.log('[poll] error:', e)

      }

    }, 3000)



    return () => window.clearInterval(interval)

  }, [isScraping, scrapeJobId, supabase, maxLeads])



  // Dopo "ricerca terminata", continua a sincronizzare gli audit dal DB finché non restano placeholder.
  useEffect(() => {
    const jobId = scrapeJobId || currentJobId || currentSearchId || lastSearchJobIdRef.current
    if (!jobId || pendingAuditCount === 0) return

    const expectedQuery = activeSearchQueryRef.current
    const startedAt = Date.now()
    const AUDIT_SYNC_MS = 15 * 60 * 1000
    const _tf = buildTechFilter(expectedQuery || query)

    const applyAllFilters = (leads: any[]) => {
      let out = leads
      if ((activeFilters as any)?.has_website === false) {
        out = out.filter((lead: any) => {
          const s = (typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : '').trim()
          return !s || s === 'N/D' || s === 'N/A' || s === 'N.D.'
        })
      } else if ((activeFilters as any)?.has_website === true) {
        out = out.filter((lead: any) => {
          const s = (typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : '').trim()
          return s && s !== 'N/D' && s !== 'N/A' && s !== 'N.D.'
        })
      }
      if (_tf) out = out.filter(_tf)
      return out
    }

    const syncAudits = async (): Promise<boolean> => {
      if (activeSearchQueryRef.current !== expectedQuery) return true
      if (Date.now() - startedAt > AUDIT_SYNC_MS) return true

      try {
        const { data } = await supabase.from('searches').select('results').eq('id', jobId).single()
        const parsed = Array.isArray((data as any)?.results)
          ? (data as any).results
          : (() => {
              try { return JSON.parse(((data as any)?.results as any) || '[]') } catch { return [] }
            })()
        if (!Array.isArray(parsed) || parsed.length === 0) return false

        const normalized = deduplicateResults(applyAllFilters(parsed.map(normalizeLeadFields))) as any[]
        const jobResults = normalized.filter(_hasContact)
        const capped = capLeadsForDisplay(jobResults)
        setContactStats(computeContactVisibilityStats(parsed.map(normalizeLeadFields)))
        const pendingBefore = countPendingAudits(resultsArrRef.current || [])
        const pendingAfter = countPendingAudits(capped)
        if (pendingAfter < pendingBefore) {
          auditProgressAtRef.current = Date.now()
          applySearchResults(capped)
        } else if (pendingAfter === 0 && pendingBefore > 0) {
          auditProgressAtRef.current = Date.now()
          applySearchResults(capped)
        }
        return pendingAfter === 0
      } catch {
        return false
      }
    }

    const interval = window.setInterval(async () => {
      const done = await syncAudits()
      if (done) window.clearInterval(interval)
    }, 4000)

    void syncAudits()

    return () => window.clearInterval(interval)
  }, [pendingAuditCount, isScraping, autoScrapeLoading, scrapeJobId, currentJobId, currentSearchId, supabase, maxLeads, query, activeFilters])

  // Se il worker Hetzner si ferma, riprende gli audit mancanti via /api/resume-audits (batch).
  useEffect(() => {
    const jobId = scrapeJobId || currentJobId || currentSearchId || lastSearchJobIdRef.current
    if (!jobId || pendingAuditCount === 0) return

    const runResume = async () => {
      if (auditResumeInFlightRef.current) return
      const stalledMs = Date.now() - auditProgressAtRef.current
      if (stalledMs < 20_000) return

      auditResumeInFlightRef.current = true
      try {
        const res = await fetch('/api/resume-audits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: jobId, batch_size: 3 }),
        })
        if (!res.ok) {
          if (res.status === 404) console.warn('[resume-audits] job non trovato o non accessibile')
          return
        }
        const data = await res.json()
        if (Number(data?.processed) > 0) {
          auditProgressAtRef.current = Date.now()
        }
      } catch {
        // ignore — retry on next interval
      } finally {
        auditResumeInFlightRef.current = false
      }
    }

    const kickoff = window.setTimeout(() => { void runResume() }, 8_000)
    const interval = window.setInterval(() => { void runResume() }, 12_000)

    return () => {
      window.clearTimeout(kickoff)
      window.clearInterval(interval)
    }
  }, [pendingAuditCount, isScraping, autoScrapeLoading, scrapeJobId, currentJobId, currentSearchId])



  useEffect(() => {

    if (currentSearchId) return

    if (!Array.isArray(results) || results.length === 0) return

    const derived = deriveSearchIdFromResults(results)

    if (derived) {

      setCurrentSearchId(derived)

      searchIdRef.current = derived

    }

  }, [currentSearchId, results])



  // Refinement per sotto-tipo basato sul CONTENUTO del sito (es. "frigoristi industriali").
  // Fail-safe: in caso di errore/no-op ritorna i lead invariati. Si attiva solo se la query
  // contiene un qualificatore riconosciuto lato server (altrimenti l'endpoint è un no-op).
  const refineLeadsBySubtype = async (leads: any[]): Promise<any[]> => {
    if (!Array.isArray(leads) || leads.length === 0) return leads
    const q = (activeSearchQueryRef.current || query || '').trim()
    if (!q) return leads
    try {
      const res = await fetch('/api/refine-subtype', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, leads }),
      })
      if (!res.ok) return leads
      const data = await res.json().catch(() => null)
      if (data && data.refined === true && Array.isArray(data.leads)) return data.leads as any[]
      return leads
    } catch {
      return leads
    }
  }

  const runSearch = async (overrideQuery?: string) => {

    setError(null)



    const q = (overrideQuery ?? query).trim()

    if (!q) {

      const msg = 'Scrivi una richiesta per avviare la ricerca.'

      setError(msg)

      toastError(msg, 'Query mancante')

      return

    }



    resetSearchRuntime(q)
    beginSearchCreditBudget()

    setIsLoading(true)

    setAiDebug(null)
    setSignalIntent(null)

    setSearchState('searching')

    toastInfo('Ricerca in corso... sto interrogando il database.', 'Ricerca')



    try {

      const response = await textToFilterSearchAction(q, { maxLeads })



      console.log('[CLIENT] status:', response?.status, 'jobId:', response?.jobId, 'results:', response?.results?.length)



      if (response?.status === 'pending' && response?.jobId) {

        const sid = (response as any)?.searchId ?? response.jobId

        setIsScraping(true)

        setScrapeJobId(response.jobId)

        setCurrentSearchId(sid)

        searchIdRef.current = sid

        return

      }

      const filtered = Array.isArray(response?.results) ? response.results : []

      const filters = (response as any)?.filters

      const ai_debug = (response as any)?.ai_debug

      const status = (response as any)?.status

      const jobId = (response as any)?.jobId

      const responseSearchId = (response as any)?.searchId

      const sid = typeof responseSearchId === 'string' && responseSearchId ? responseSearchId : typeof jobId === 'string' && jobId ? jobId : null



      if (status === 'pending' && typeof jobId === 'string' && jobId) {

        setIsScraping(true)

        setScrapeJobId(jobId)

        setPendingJobId(jobId)

        setCurrentSearchId(sid)

        searchIdRef.current = sid

        setActiveFilters(filters && typeof filters === 'object' ? (filters as Record<string, unknown>) : null)

        applySearchAiDebug(ai_debug ?? null)

        toastInfo('Sto analizzando in tempo reale... attendere 2-3 minuti', 'Ricerca')



        return

      }



      setPendingJobId(null)

      let displayResults = await refineLeadsBySubtype((deduplicateResults(filtered) as any[]).filter(_hasContact))
      const _tfRun = buildTechFilter(q)
      if (_tfRun) displayResults = displayResults.filter(_tfRun)
      displayResults = displayResults.slice(0, maxLeads)
      setResults(displayResults)

      setActiveFilters(filters && typeof filters === 'object' ? (filters as Record<string, unknown>) : null)

      applySearchAiDebug(ai_debug ?? null)

      if (typeof jobId === 'string' && jobId) {
        lastSearchJobIdRef.current = jobId
      }

      if (sid) {

        setCurrentSearchId(sid)

        searchIdRef.current = sid

      } else {

        const resolved = await resolveCompletedSearchId(filters)

        setCurrentSearchId(resolved)

        searchIdRef.current = resolved

      }

      const cacheMeta = (response as { cache_meta?: SearchCacheMeta })?.cache_meta ?? null
      if (cacheMeta) setSearchCacheMeta(cacheMeta)

      if (displayResults.length >= maxLeads) {
        setSearchExhausted(false)
        setSearchState('done')
        toastSuccess(`Trovati ${displayResults.length} risultati.`, 'Ricerca completata')
      } else {
        if (typeof jobId === 'string' && jobId && cacheMeta?.needs_more_scrape) {
          setScrapeJobId(jobId)
          setIsScraping(true)
          searchIdRef.current = sid ?? jobId
          setCurrentSearchId(sid ?? jobId)
        }
        setSearchState('searching')
        const fromDb = cacheMeta?.db_with_contact ?? 0
        toastInfo(
          fromDb > 0
            ? `${fromDb} lead dal database — continuo verso ${maxLeads}…`
            : `Trovati ${displayResults.length} risultati. Continuo la ricerca verso ${maxLeads}…`,
          'Ricerca in corso',
        )
      }

    } catch (err) {

      console.log('[DEBUG ERROR]', err)

      const message = err instanceof Error ? err.message : 'Errore durante la ricerca'

      setError(message)

      toastError(message, 'Errore')

    } finally {

      setIsLoading(false)

    }

  }



  const handleAnalyzeSite = async () => {
    let u = urlInput.trim()
    if (!u) {
      toastError('Inserisci un URL da analizzare', 'URL mancante')
      return
    }
    // Auto-prepend https:// if missing
    if (!u.startsWith('http://') && !u.startsWith('https://')) {
      u = `https://${u}`
    }
    setIsLoading(true)
    setResults([])
    setSearchState('searching')
    toastInfo('Analisi del sito in corso... potrebbe richiedere fino a 2 minuti.', 'Analisi sito')
    try {
      const res = await fetch('/api/analyze-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u }),
      })
      const data = await res.json()
      if (data.success && data.lead) {
        const normalized = normalizeLeadFields(data.lead)
        setResults([normalized])
        setSearchState('done')
        toastSuccess('Analisi completata!', 'Analisi sito')
      } else {
        toastError(data.error || 'Impossibile analizzare il sito. Verifica l\'URL e riprova.', 'Errore analisi')
        setSearchState('done')
      }
    } catch (e: any) {
      console.error('[analyze site] error:', e)
      toastError('Errore di rete durante l\'analisi. Riprova.', 'Errore')
      setSearchState('done')
    } finally {
      setIsLoading(false)
    }
  }



  const processSemanticSearch = async (overrideQuery?: string) => {

    const q = (overrideQuery ?? query).trim()

    if (!q) {

      await runSearch(overrideQuery)

      return

    }



    setError(null)

    // Check credits before searching
    if (credits <= 0) {
      toastError('Hai esaurito i crediti. Effettua l\'upgrade per continuare.', 'Crediti esauriti')
      return
    }

    const effectiveMax = Math.min(maxLeads, credits)

    resetSearchRuntime(q)
    searchCreditBudgetRef.current = effectiveMax

    setIsLoading(true)

    setAiAnalyzing(true)

    setAiDebug(null)
    setSignalIntent(null)



    try {

      const response = await processSemanticSearchAction(q, { maxLeads })



      console.log('[CLIENT] status:', (response as any)?.status, 'jobId:', (response as any)?.jobId, 'results:', (response as any)?.results?.length)



      if ((response as any)?.status === 'pending' && (response as any)?.jobId) {

        const sid = (response as any)?.searchId ?? (response as any).jobId

        setIsScraping(true)

        setScrapeJobId((response as any).jobId)

        setCurrentSearchId(sid)

        searchIdRef.current = sid

        return

      }

      const semanticSid = typeof (response as any)?.searchId === 'string' && (response as any).searchId ? (response as any).searchId : null



      const { results: rawFiltered, filters, ai_debug } = response as any
      const cacheMeta = (response as { cache_meta?: SearchCacheMeta })?.cache_meta ?? null
      if (cacheMeta) setSearchCacheMeta(cacheMeta)

      // If semantic search returned 0 results and no pending job, fall back to runSearch
      // which will find any pending/processing job in Supabase and start polling
      if ((!rawFiltered || rawFiltered.length === 0) && (response as any)?.status !== 'pending') {
        console.log('[semantic] 0 results, no pending → fallback to runSearch')
        throw new Error('semantic_empty_fallback')
      }

      // Apply ALL filters before charging credits: deduplicate → contacts → tech filters → has_website → cap
      const deduplicated = deduplicateResults(Array.isArray(rawFiltered) ? rawFiltered : [])
      let filtered = (deduplicated as any[]).map(normalizeLeadFields).filter(_hasContact)
      // Apply tech filters (senza pixel, senza gtm, errori seo, etc.)
      const _tfSemantic = buildTechFilter(query)
      if (_tfSemantic) filtered = filtered.filter(_tfSemantic)
      // Apply has_website filter from activeFilters
      if ((activeFilters as any)?.has_website === false) {
        filtered = filtered.filter((lead: any) => {
          const s = (typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : '').trim()
          return !s || s === 'N/D' || s === 'N/A' || s === 'N.D.'
        })
      } else if ((activeFilters as any)?.has_website === true) {
        filtered = filtered.filter((lead: any) => {
          const s = (typeof lead?.sito === 'string' ? lead.sito : typeof lead?.website === 'string' ? lead.website : '').trim()
          return s && s !== 'N/D' && s !== 'N/A' && s !== 'N.D.'
        })
      }
      filtered = await refineLeadsBySubtype(filtered)
      const capped = filtered.slice(0, effectiveMax)
      const leadsToCharge = capped.length

      // Deduct credits based on actual displayed leads (after contact filter)
      if (leadsToCharge > 0) {
        const creditRes = await fetch('/api/use-credits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: leadsToCharge }),
        })
        const creditData = await creditRes.json()
        if (creditRes.ok && typeof creditData.credits === 'number') {
          setCredits(creditData.credits)
        }
      }

      setResults(capped)

      setActiveFilters(filters && typeof filters === 'object' ? (filters as Record<string, unknown>) : null)

      applySearchAiDebug(ai_debug ?? null)

      const semanticJobId = typeof (response as any)?.jobId === 'string' ? (response as any).jobId : null
      if (semanticJobId) {
        lastSearchJobIdRef.current = semanticJobId
      }

      if (semanticSid) {

        setCurrentSearchId(semanticSid)

        searchIdRef.current = semanticSid

      } else {

        const resolved = await resolveCompletedSearchId(filters)

        setCurrentSearchId(resolved)

        searchIdRef.current = resolved

      }

      if (capped.length >= effectiveMax) {
        setSearchExhausted(false)
        setSearchState('done')
        toastSuccess(`Trovati ${capped.length} lead (${capped.length} crediti usati).`, 'Ricerca completata')
      } else {
        if (semanticJobId && cacheMeta?.needs_more_scrape) {
          setScrapeJobId(semanticJobId)
          setIsScraping(true)
        }
        setSearchState('searching')
        const fromDb = cacheMeta?.db_with_contact ?? 0
        toastInfo(
          fromDb > 0
            ? `${fromDb} lead dal database — continuo verso ${effectiveMax}…`
            : `Trovati ${capped.length} lead. Continuo la ricerca verso ${effectiveMax}…`,
          'Ricerca in corso',
        )
      }

    } catch {

      await runSearch(q)

    } finally {

      setAiAnalyzing(false)

      setIsLoading(false)

    }

  }



  const handleExpandedSearchClick = async () => {

    const q = query.trim()

    if (!q) return

    setIsLoading(true)

    setError(null)

    try {

      const res = await expandAndSearch(q)

      const next = Array.isArray(res?.results) ? res.results : []

      const allFiltered = (deduplicateResults(next) as any[]).filter(_hasContact)
      const filtered = allFiltered.slice(0, maxLeads)

      // Deduct credits based on actual displayed leads
      const leadsToCharge = filtered.length
      if (leadsToCharge > 0) {
        const creditRes = await fetch('/api/use-credits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: leadsToCharge }),
        })
        const creditData = await creditRes.json()
        if (creditRes.ok && typeof creditData.credits === 'number') {
          setCredits(creditData.credits)
        }
      }

      setResults(filtered)

      setSearchState('done')

    } catch (e) {

      console.log('[expanded] error:', e)

    } finally {

      setIsLoading(false)

    }

  }


  return (
    <>
      {/* ── Section title ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-violet-600" />
          <h2 className="text-lg sm:text-xl font-bold text-slate-800">
            {uiMode === 'discovery' ? t(locale, 'discovery_title') : t(locale, 'search_title')}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <LocaleToggle locale={locale} onChange={setLocale} compact className="sm:hidden" />
          <UiModeToggle mode={uiMode} onChange={setUiMode} className="sm:hidden" />
        </div>
      </div>

      {/* ── Database Search Mode ── */}
      {searchMode === 'database' && <DatabaseSearchSection />}

      {/* ── Maps Search Mode (+ Shared Results Render) ── */}
      {searchMode !== 'database' && (
      <>

      {(searchMode === 'maps' || searchMode === 'ambiente') && uiMode === 'expert' && (
      <div className="mb-3 px-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            { label: 'senza Pixel', tip: 'No Meta Pixel / retargeting' },
            { label: 'senza Google Ads', tip: 'Non fanno pubblicità su Google' },
            { label: 'senza sito', tip: 'Non hanno un sito web' },
            { label: 'errori SEO', tip: 'Errori nel codice del sito' },
            { label: 'senza SSL', tip: 'Sito non sicuro (no HTTPS)' },
            { label: 'senza Instagram', tip: 'Nessun profilo Instagram' },
            { label: 'senza Facebook', tip: 'Nessuna pagina Facebook' },
            { label: 'senza LinkedIn', tip: 'Nessun profilo LinkedIn' },
            { label: 'sito lento', tip: 'Sito con caricamento lento' },
            { label: 'senza GTM', tip: 'No Google Tag Manager' },
            { label: 'senza Analytics', tip: 'No Google Analytics' },
            { label: 'senza DMARC', tip: 'Email a rischio spam' },
            { label: 'non mobile', tip: 'Sito non mobile-friendly' },
            { label: 'senza email', tip: 'Nessuna email trovata' },
            { label: 'basso rating', tip: 'Rating Google < 4 stelle' },
            { label: 'poche recensioni', tip: 'Meno di 10 recensioni Google' },
          ].map((f) => (
            <button
              key={f.label}
              type="button"
              title={f.tip}
              disabled={isLoading}
              onClick={() => {
                const current = query.trim()
                const kw = f.label.toLowerCase()
                if (current.toLowerCase().includes(kw)) return
                setQuery(current ? `${current} ${f.label}` : f.label)
              }}
              className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-all cursor-pointer disabled:opacity-50 ${
                query.toLowerCase().includes(f.label.toLowerCase())
                  ? 'bg-violet-100 border-violet-300 text-violet-700'
                  : 'bg-white border-slate-200 text-slate-500 hover:border-violet-300 hover:text-violet-600 hover:bg-violet-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      )}

      {(searchMode === 'maps' || searchMode === 'ambiente') && uiMode === 'expert' && (
      <SniperArea
        query={query}
        onQueryChange={setQuery}
        onStart={processSemanticSearch}
        isLoading={isLoading}
        error={error}
        aiDebug={aiDebug}
        maxLeads={clampSearchMaxLeads(maxLeads, credits)}
        onMaxLeadsChange={(v) => setMaxLeads(clampSearchMaxLeads(v, credits))}
        credits={credits}
        businessSignalFilters={businessSignalFilters}
        onBusinessSignalFiltersChange={setBusinessSignalFilters}
      />
      )}

      {(searchMode === 'maps' || searchMode === 'ambiente') && uiMode === 'discovery' && (
      <DiscoverySearchWizard
        onSearch={async (builtQuery) => {
          setQuery(builtQuery)
          await processSemanticSearch(builtQuery)
        }}
        isLoading={isLoading}
        error={error}
        credits={credits}
        maxLeads={clampSearchMaxLeads(maxLeads, credits)}
        onMaxLeadsChange={(v) => setMaxLeads(clampSearchMaxLeads(v, credits))}
      />
      )}

      {signalIntent?.required_signals?.length ? (
        <div className="mb-3 mx-1 rounded-xl border border-violet-200 bg-violet-50/80 px-4 py-2.5 text-sm text-violet-900">
          <span className="font-semibold">Intent segnali: </span>
          {describeSignalIntent(signalIntent)}
          {displayResults.length !== (Array.isArray(results) ? results.length : 0) ? (
            <span className="text-violet-700">
              {' '}· {displayResults.length} lead su {Array.isArray(results) ? results.length : 0} matchano i segnali richiesti
            </span>
          ) : null}
        </div>
      ) : null}

      {(searchMode === 'maps' || searchMode === 'ambiente') && uiMode === 'expert' && (
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center px-1 mb-2">
        <input
          type="text"
          placeholder="Oppure incolla URL sito (es. www.crystalweb.it)"
          title="Incolla l'indirizzo di un sito web per analizzarlo: scoprirai tecnologie usate, errori SEO, velocità e opportunità commerciali."
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          className="flex-1 px-4 py-2.5 text-[14px] text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400 placeholder:text-slate-400"
        />
        <button
          onClick={handleAnalyzeSite}
          title="Analizza un singolo sito web: audit tecnico completo con SEO, velocità, tecnologie e problemi rilevati."
          className="px-5 py-2.5 text-[14px] bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-semibold whitespace-nowrap"
        >
          Analizza sito
        </button>
      </div>
      )}

      {aiAnalyzing ? (
        <div className="mb-4 flex items-center gap-2 text-xs text-slate-600">
          <span className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-slate-700 animate-spin" />
          <span>L'AI sta ragionando, potrebbe volerci qualche secondo…</span>
        </div>
      ) : null}

      {pendingJobId ? (
        <div className="mb-4 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800">
          Sto analizzando in tempo reale... attendere 2-3 minuti
        </div>
      ) : null}

      {searchState === 'pending' ? (
        <div className="flex flex-col items-center gap-3 p-8 bg-violet-50 border border-violet-200 rounded-2xl mx-4">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
            <p className="text-violet-700 font-semibold text-sm">Analisi in corso — risultati tra 2-3 minuti</p>
          </div>
          <div className="w-full max-w-sm bg-violet-200 rounded-full h-2.5 overflow-hidden">
            <div className="bg-violet-600 h-2.5 rounded-full" style={{ animation: 'progressFill 180s ease-in-out forwards', width: '5%' }} />
          </div>
          <p className="text-[11px] text-violet-500">Stiamo analizzando siti web, social e tecnologie di ogni azienda.</p>
        </div>
      ) : null}

      {isLoading && (
        <div className="mb-4 mx-4 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50 px-5 py-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-5 w-5 rounded-full border-[2.5px] border-violet-300 border-t-violet-600 animate-spin flex-shrink-0" />
            <div>
              <p className="text-[15px] font-bold text-violet-800">Scraping in tempo reale...</p>
              <p className="text-[13px] text-violet-500 mt-0.5">
                {results.length > 0
                  ? `${results.length} lead trovati finora — la ricerca continua`
                  : 'Stiamo cercando aziende e analizzando i loro dati'}
              </p>
            </div>
          </div>
          <div className="w-full bg-violet-200/60 rounded-full h-2 overflow-hidden">
            <div className="bg-gradient-to-r from-violet-500 to-fuchsia-500 h-2 rounded-full animate-pulse" style={{ width: results.length > 0 ? '70%' : '30%', transition: 'width 2s ease-in-out' }} />
          </div>
        </div>
      )}

      {!isLoading && results.length === 0 ? (
        isScraping ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <h3 className="text-2xl font-bold text-slate-800 mb-3">Stiamo trovando i tuoi lead...</h3>
            <p className="text-slate-600 text-[15px] mb-2 max-w-sm leading-relaxed">
              L&apos;intelligenza artificiale sta analizzando centinaia di aziende per trovare quelle più in linea con la tua ricerca.
            </p>
            <p className="text-slate-800 text-[15px] font-semibold mb-6">
              Tempo stimato: 5-15 minuti. Non chiudere la pagina.
            </p>

            {/* Animated loading ring around M logo */}
            <div className="relative" style={{ width: 100, height: 100 }}>
              {/* Spinning gradient ring */}
              <svg className="absolute inset-0 animate-[miraxSpin_1.5s_linear_infinite]" width="100" height="100" viewBox="0 0 100 100">
                <defs>
                  <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#536FFC" />
                    <stop offset="50%" stopColor="#7AA2F4" />
                    <stop offset="100%" stopColor="#A485E4" />
                  </linearGradient>
                </defs>
                <circle cx="50" cy="50" r="46" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                <circle cx="50" cy="50" r="46" fill="none" stroke="url(#ringGrad)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="217" strokeDashoffset="60" />
                <line x1="50" y1="8" x2="50" y2="18" stroke="#94a3b8" strokeWidth="2" />
                <line x1="50" y1="82" x2="50" y2="92" stroke="#94a3b8" strokeWidth="2" />
                <line x1="8" y1="50" x2="18" y2="50" stroke="#94a3b8" strokeWidth="2" />
                <line x1="82" y1="50" x2="92" y2="50" stroke="#94a3b8" strokeWidth="2" />
                <circle cx="50" cy="50" r="3" fill="#7c3aed" />
              </svg>
              {/* M logo — centered 72px */}
              <div
                className="absolute drop-shadow-lg rounded-2xl"
                style={{
                  width: 72,
                  height: 72,
                  top: 14,
                  left: 14,
                  backgroundImage: 'url(/mirax-m.svg)',
                  backgroundSize: 'contain',
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'center',
                }}
              />
            </div>

            <div className="flex flex-col gap-2 items-center">
              <p className="text-[12px] text-slate-500 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Ricerca aziende nel database...
              </p>
              <p className="text-[12px] text-slate-400 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-violet-300 animate-[miraxDot_2s_ease-in-out_infinite_0.5s]" />
                Analisi siti web e tecnologie
              </p>
              <p className="text-[12px] text-slate-400 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-slate-300 animate-[miraxDot_2s_ease-in-out_infinite_1s]" />
                Calcolo opportunità e punteggi
              </p>
            </div>
            <style>{`
              @keyframes searchGlow {
                0%, 100% { opacity: 0.4; transform: scale(0.98); }
                50% { opacity: 1; transform: scale(1.02); }
              }
              @keyframes miraxSpin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
              }
              @keyframes miraxPulse {
                0%, 100% { opacity: 0.2; transform: scale(1); }
                50% { opacity: 0.5; transform: scale(1.08); }
              }
              @keyframes miraxDot {
                0%, 100% { opacity: 0.3; }
                50% { opacity: 1; }
              }
            `}</style>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center px-4">
            <button
              type="button"
              onClick={() => { setGuideMode('maps'); setGuideOpen(true) }}
              className="group flex items-center gap-3 px-8 py-4 rounded-2xl text-white text-lg font-bold shadow-xl hover:scale-105 transition-all duration-200 bg-gradient-to-r from-violet-600 to-indigo-600 shadow-violet-500/25 hover:shadow-violet-500/40"
            >
              <Search className="w-6 h-6" />
              Scopri come funziona
            </button>
          </div>
        )
      ) : (
        <>
          {Array.isArray(results) && results.length > 0 ? (
            <>
              {searchCacheMeta ? (
                <SearchIntelBanner meta={searchCacheMeta} displayed={results.length} maxLeads={maxLeads} />
              ) : null}

              {contactStats && formatContactVisibilityMessage(contactStats) && !isScraping && !autoScrapeLoading ? (
                <div className="mx-4 mb-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700">
                  {formatContactVisibilityMessage(contactStats)}
                </div>
              ) : null}

              {contactStats && contactStats.withContact > results.length ? (
                <div className="mx-4 mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
                  <strong>{contactStats.withContact - results.length}</strong> lead con contatto sono pronti ma non visibili
                  — hai <strong>{credits}</strong> credit{credits === 1 ? 'o' : 'i'} rimanenti
                  (1 credito = 1 lead). Ricarica o fai upgrade per vederli tutti.
                </div>
              ) : null}

              {(isScraping || autoScrapeLoading || (searchState === 'searching' && results.length < Math.min(maxLeads, searchCreditBudgetRef.current || maxLeads) && !searchExhausted)) && (
                <div className="flex items-center gap-3 bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 mb-3 mx-4">
                  <div className="relative h-10 w-10 flex-shrink-0">
                    <Loader2 className="h-10 w-10 text-violet-600 animate-spin" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[15px] font-semibold text-violet-700">
                      {formatSearchProgressMessage(
                        contactStats,
                        results.length,
                        clampSearchMaxLeads(maxLeads, credits),
                      )}
                    </p>
                    <p className="text-[13px] text-violet-500 mt-0.5">
                      Nuovi risultati appariranno automaticamente. Puoi già consultare i lead trovati.
                    </p>
                    <div className="mt-2 bg-violet-200 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-1.5 rounded-full bg-violet-500 transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.round((results.length / Math.max(clampSearchMaxLeads(maxLeads, credits), 1)) * 100))}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {!isScraping && !autoScrapeLoading && searchState === 'done' && results.length > 0 && pendingAuditCount > 0 && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mb-3 mx-4 text-sm text-amber-900 font-medium">
                  <Loader2 className="w-4 h-4 animate-spin flex-shrink-0 text-amber-600" />
                  Audit siti in corso — {results.length - pendingAuditCount}/{results.length} lead analizzati. I dati si aggiornano automaticamente.
                </div>
              )}

              {!isScraping && !autoScrapeLoading && searchState === 'done' && results.length > 0 && pendingAuditCount === 0 && (results.length >= maxLeads || searchExhausted) && (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 mb-3 mx-4 text-sm text-emerald-800 font-medium">
                  <svg width="16" height="16" viewBox="0 0 16 16" className="flex-shrink-0">
                    <circle cx="8" cy="8" r="6.5" fill="none" stroke="#059669" strokeWidth="1.3" />
                    <path d="M5 8l2 2 4-4" fill="none" stroke="#059669" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {results.length >= maxLeads
                    ? `Ricerca completata — ${results.length} lead pronti`
                    : `Ricerca terminata — ${results.length} lead trovati (massimo disponibile per questa categoria)`}
                </div>
              )}

              {/* Ricerca Ambiente button — visible after results loaded */}
              <div className="mx-4 mb-4 bg-gradient-to-r from-fuchsia-50 to-violet-50 border border-fuchsia-200 rounded-2xl p-5">
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <div className="flex-1 text-center sm:text-left">
                    <h3 className="text-base font-bold text-slate-800 flex items-center gap-2 justify-center sm:justify-start">
                      <Sparkles className="w-5 h-5 text-fuchsia-600" />
                      Ricerca Ambiente
                    </h3>
                    <p className="text-[13px] text-slate-500 mt-1">
                      Ambiente è lo spazio contestuale dove le ricerche singole si relazionano tra loro creando una mappa semantica in grado di permettere al ricercatore di crearsi dei tips mirati ed in relazione fra loro dall&apos;alto e univoco Value.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchMode('ambiente')
                      handleExpandedSearchClick()
                    }}
                    disabled={isLoading}
                    className="flex-shrink-0 flex items-center gap-2 bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-700 hover:to-violet-700 text-white font-bold px-7 py-3.5 rounded-xl text-[15px] shadow-lg shadow-fuchsia-500/25 hover:shadow-xl transition-all duration-200 hover:scale-[1.03] disabled:opacity-50 disabled:scale-100"
                  >
                    <Sparkles className="w-5 h-5" />
                    Avvia Ricerca Ambiente
                  </button>
                </div>
              </div>

              {/* BIG primary CTA — Save the whole list (creates list + optional environment) */}
              <div className="mb-4 flex flex-col items-center gap-2 px-4">
                <Button
                  onClick={() => {
                    if (!Array.isArray(results) || results.length === 0) {
                      toastError('Nessun lead da salvare', 'Lista')
                      return
                    }
                    setIsSaveAllOpen(true)
                  }}
                  title={mergeIntoListId ? 'Aggiungi questi lead alla lista esistente (senza duplicati).' : 'Salva TUTTI i lead in una nuova lista. Potrai anche collegarla a un ambiente.'}
                  className="flex items-center gap-3 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white font-bold px-10 py-4 rounded-2xl text-lg shadow-xl shadow-violet-500/30 hover:shadow-2xl transition-all hover:scale-[1.02]"
                >
                  <ListPlus className="w-6 h-6" />
                  {mergeIntoListId ? 'Aggiorna la lista' : 'Salva tutta la lista'}
                </Button>
                <p className="text-[12px] text-slate-400">
                  {mergeIntoListId
                    ? `Aggiungi questi ${results.length} lead alla lista esistente — i duplicati vengono ignorati.`
                    : `Crea una lista con questi ${results.length} lead — potrai poi assegnarla a un ambiente.`}
                </p>
              </div>
            </>
          ) : null}

          {uiMode === 'discovery' ? (
          <DiscoveryResultsGrid
            query={query}
            results={displayResults}
            isLoading={isLoading}
            isScraping={isScraping || autoScrapeLoading}
            searchId={effectiveSearchId}
            totalUnfilteredCount={Array.isArray(results) ? results.length : 0}
          />
          ) : (
          <ResultsTable
            query={query}
            results={displayResults}
            isLoading={isLoading}
            isScraping={isScraping || autoScrapeLoading}
            searchId={effectiveSearchId}
            filters={activeFilters}
            aiDebug={aiDebug}
            totalUnfilteredCount={Array.isArray(results) ? results.length : 0}
          />
          )}

          {/* BIG primary CTA — repeated BELOW the results for easy access after scrolling */}
          {searchState === 'done' && Array.isArray(results) && results.length > 0 ? (
            <div className="mt-6 mb-10 flex flex-col items-center gap-2 px-4">
              <Button
                onClick={() => setIsSaveAllOpen(true)}
                title="Salva TUTTI i lead in una nuova lista. Potrai anche collegarla a un ambiente."
                className="flex items-center gap-3 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white font-bold px-10 py-4 rounded-2xl text-lg shadow-xl shadow-violet-500/30 hover:shadow-2xl transition-all hover:scale-[1.02]"
              >
                <ListPlus className="w-6 h-6" />
                Salva tutta la lista
              </Button>
              <p className="text-[12px] text-slate-400">
                {results.length} lead pronti — non perderli, salvali ora.
              </p>
            </div>
          ) : null}
        </>
      )}

      </>
      )}

      <HowToUseGuide
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        mode={guideMode}
      />

      <SaveToEnvironmentModal
        open={isSaveToEnvOpen}
        onClose={() => {
          setIsSaveToEnvOpen(false)
          setSaveToEnvSearchId(null)
        }}
        searchId={saveToEnvSearchId}
      />

      <SaveAllListModal
        open={isSaveAllOpen}
        onClose={() => setIsSaveAllOpen(false)}
        leads={results}
        defaultName={query}
        mergeIntoListId={mergeIntoListId}
      />
    </>
  )

}
