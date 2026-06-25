'use client'

import { useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Boxes,
  Check,
  CheckCircle2,
  Copy,
  Gauge,
  Globe,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  Shield,
  ShoppingBag,
  Target,
  TrendingDown,
  Zap,
} from 'lucide-react'
import type {
  FreeIntel,
  PageSpeedResult,
  SalesTrigger,
  WebsiteAuditResult,
} from '@/lib/free-enrichment'
import { analyzeBuyingSignals, buildPitchMessage } from '@/utils/buyingSignals'
import type { BuyingSignalAudit } from '@/utils/buyingSignals'

function readLeadString(lead: unknown, keys: string[]): string {
  if (!lead || typeof lead !== 'object') return ''
  const obj = lead as Record<string, unknown>
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

type Props = {
  website: string | null
  lead?: unknown
  /** Inserzioni Meta attive verificate via API ufficiale (Ad Library); null = non verificato. */
  activeMetaAds?: number | null
}

function toBuyingSignalAudit(intel: FreeIntel): BuyingSignalAudit {
  const a = intel.audit
  const ps = intel.performance
  return {
    metaPixel: a?.pixels.metaPixel,
    googleAds: a?.pixels.googleAds,
    googleAnalytics: a?.pixels.googleAnalytics,
    googleTagManager: a?.pixels.googleTagManager,
    contactFormCount: a?.contactFormCount,
    hasNewsletterForm: a?.hasNewsletterForm,
    hasWhatsappButton: a?.hasWhatsappButton,
    hasClickablePhone: a?.hasClickablePhone,
    hasClickableEmail: a?.hasClickableEmail,
    performanceScore: ps?.performance ?? null,
    lcpMs: ps?.lcpMs ?? null,
    securityGrade: intel.security?.grade ?? null,
    domainExpiresInDays: intel.domain?.expiresInDays ?? null,
  }
}

const BS_SEVERITY_STYLE: Record<'critical' | 'high' | 'medium', { card: string; badge: string }> = {
  critical: { card: 'border-rose-200 bg-rose-50', badge: 'bg-rose-100 text-rose-700 border-rose-200' },
  high: { card: 'border-amber-200 bg-amber-50', badge: 'bg-amber-100 text-amber-700 border-amber-200' },
  medium: { card: 'border-sky-200 bg-sky-50', badge: 'bg-sky-100 text-sky-700 border-sky-200' },
}

const BS_LABEL_STYLE: Record<'freddo' | 'interessante' | 'caldo' | 'caldissimo', string> = {
  caldissimo: 'bg-rose-50 border-rose-200 text-rose-700',
  caldo: 'bg-orange-50 border-orange-200 text-orange-700',
  interessante: 'bg-amber-50 border-amber-200 text-amber-700',
  freddo: 'bg-slate-50 border-slate-200 text-slate-600',
}

const SEVERITY_STYLE: Record<SalesTrigger['severity'], { dot: string; label: string }> = {
  critical: { dot: 'bg-rose-500', label: 'Critico' },
  high: { dot: 'bg-amber-500', label: 'Alto' },
  medium: { dot: 'bg-sky-500', label: 'Medio' },
  info: { dot: 'bg-slate-400', label: 'Info' },
}

const SECURITY_GRADE_STYLE: Record<string, string> = {
  A: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  B: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  C: 'text-amber-700 bg-amber-50 border-amber-200',
  D: 'text-amber-700 bg-amber-50 border-amber-200',
  F: 'text-rose-700 bg-rose-50 border-rose-200',
}

function scoreColor(score: number | null): string {
  if (score == null) return 'text-slate-400'
  if (score >= 90) return 'text-emerald-600'
  if (score >= 50) return 'text-amber-600'
  return 'text-rose-600'
}

function scoreRing(score: number | null): string {
  if (score == null) return 'border-slate-200'
  if (score >= 90) return 'border-emerald-200'
  if (score >= 50) return 'border-amber-200'
  return 'border-rose-200'
}

function fmtMs(v: number | null): string {
  if (v == null) return '—'
  if (v < 1000) return `${v} ms`
  return `${(v / 1000).toFixed(1)} s`
}

function formatProvider(p: string | null): string {
  switch (p) {
    case 'google_workspace':
      return 'Google Workspace'
    case 'microsoft_365':
      return 'Microsoft 365'
    case 'aruba':
      return 'Aruba'
    case 'zoho':
      return 'Zoho Mail'
    case 'register_it':
      return 'Register.it'
    case 'libero':
      return 'Libero'
    case 'other':
      return 'Altro provider'
    default:
      return '—'
  }
}

type ToolItem = { label: string; on: boolean }

function flatPixels(audit: WebsiteAuditResult): ToolItem[] {
  return [
    { label: 'Meta Pixel', on: audit.pixels.metaPixel },
    { label: 'Google Analytics', on: audit.pixels.googleAnalytics },
    { label: 'Google Ads', on: audit.pixels.googleAds },
    { label: 'Google Tag Manager', on: audit.pixels.googleTagManager },
    { label: 'TikTok Pixel', on: audit.pixels.tiktokPixel },
    { label: 'LinkedIn Insight', on: audit.pixels.linkedinInsight },
    { label: 'Pinterest Tag', on: audit.pixels.pinterestTag },
    { label: 'Twitter/X Pixel', on: audit.pixels.twitterPixel },
    { label: 'Reddit Pixel', on: audit.pixels.redditPixel },
    { label: 'Snapchat Pixel', on: audit.pixels.snapchatPixel },
    { label: 'Microsoft UET', on: audit.pixels.microsoftUet },
    { label: 'Quora Pixel', on: audit.pixels.quoraPixel },
  ]
}

function flatStack(audit: WebsiteAuditResult): { group: string; items: ToolItem[] }[] {
  const e = audit.emailMarketing
  const c = audit.crm
  const lc = audit.liveChat
  const b = audit.booking
  const ab = audit.abTesting
  const hm = audit.heatmap
  const ec = audit.ecommerce
  return [
    {
      group: 'Email Marketing',
      items: [
        { label: 'Mailchimp', on: e.mailchimp },
        { label: 'Klaviyo', on: e.klaviyo },
        { label: 'Brevo', on: e.brevo },
        { label: 'ActiveCampaign', on: e.activecampaign },
        { label: 'MailerLite', on: e.mailerlite },
        { label: 'ConvertKit', on: e.convertkit },
        { label: 'GetResponse', on: e.getresponse },
        { label: 'SendGrid', on: e.sendgrid },
      ],
    },
    {
      group: 'CRM / Marketing Automation',
      items: [
        { label: 'HubSpot', on: c.hubspot },
        { label: 'Salesforce', on: c.salesforce },
        { label: 'Pardot', on: c.pardot },
        { label: 'Marketo', on: c.marketo },
        { label: 'Pipedrive', on: c.pipedrive },
        { label: 'Zoho', on: c.zoho },
        { label: 'Freshworks', on: c.freshworks },
      ],
    },
    {
      group: 'Live Chat / Engagement',
      items: [
        { label: 'Intercom', on: lc.intercom },
        { label: 'Drift', on: lc.drift },
        { label: 'Tawk.to', on: lc.tawkTo },
        { label: 'Zendesk Chat', on: lc.zendeskChat },
        { label: 'Crisp', on: lc.crisp },
        { label: 'Tidio', on: lc.tidio },
        { label: 'LiveChat', on: lc.liveChatInc },
        { label: 'Userlike', on: lc.userlike },
      ],
    },
    {
      group: 'Booking',
      items: [
        { label: 'Calendly', on: b.calendly },
        { label: 'Booksy', on: b.booksy },
        { label: 'Treatwell', on: b.treatwell },
        { label: 'Fresha', on: b.fresha },
        { label: 'TheFork', on: b.thefork },
        { label: 'OpenTable', on: b.opentable },
        { label: 'Resy', on: b.resy },
        { label: 'SimplyBook', on: b.simplyBook },
        { label: 'Acuity', on: b.acuity },
      ],
    },
    {
      group: 'A/B Testing',
      items: [
        { label: 'Optimizely', on: ab.optimizely },
        { label: 'VWO', on: ab.vwo },
        { label: 'AB Tasty', on: ab.abTasty },
        { label: 'Google Optimize', on: ab.googleOptimize },
        { label: 'Convert', on: ab.convert },
      ],
    },
    {
      group: 'Heatmap & Session Replay',
      items: [
        { label: 'Hotjar', on: hm.hotjar },
        { label: 'Microsoft Clarity', on: hm.microsoftClarity },
        { label: 'FullStory', on: hm.fullStory },
        { label: 'Mouseflow', on: hm.mouseflow },
        { label: 'Lucky Orange', on: hm.luckyOrange },
        { label: 'Smartlook', on: hm.smartlook },
      ],
    },
    {
      group: 'E-commerce',
      items: [
        { label: 'Shopify', on: ec.shopify },
        { label: 'WooCommerce', on: ec.woocommerce },
        { label: 'Magento', on: ec.magento },
        { label: 'PrestaShop', on: ec.prestashop },
        { label: 'BigCommerce', on: ec.bigcommerce },
        { label: 'Squarespace', on: ec.squarespaceCommerce },
      ],
    },
  ]
}

function ScoreCard({ label, score }: { label: string; score: number | null }) {
  return (
    <div className={`rounded-lg border ${scoreRing(score)} bg-white p-3`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`text-2xl font-semibold tabular-nums ${scoreColor(score)}`}>
          {score == null ? '—' : score}
        </span>
        <span className="text-[11px] text-slate-400">/100</span>
      </div>
    </div>
  )
}

function VitalsRow({ ps }: { ps: PageSpeedResult }) {
  const items: { label: string; value: string; tone: string }[] = [
    {
      label: 'LCP',
      value: fmtMs(ps.lcpMs),
      tone:
        ps.lcpMs == null
          ? 'text-slate-500'
          : ps.lcpMs <= 2500
            ? 'text-emerald-600'
            : ps.lcpMs <= 4000
              ? 'text-amber-600'
              : 'text-rose-600',
    },
    {
      label: 'INP',
      value: fmtMs(ps.inpMs),
      tone:
        ps.inpMs == null
          ? 'text-slate-500'
          : ps.inpMs <= 200
            ? 'text-emerald-600'
            : ps.inpMs <= 500
              ? 'text-amber-600'
              : 'text-rose-600',
    },
    {
      label: 'CLS',
      value: ps.clsScore == null ? '—' : ps.clsScore.toFixed(3),
      tone:
        ps.clsScore == null
          ? 'text-slate-500'
          : ps.clsScore <= 0.1
            ? 'text-emerald-600'
            : ps.clsScore <= 0.25
              ? 'text-amber-600'
              : 'text-rose-600',
    },
    { label: 'FCP', value: fmtMs(ps.fcpMs), tone: 'text-slate-700' },
    { label: 'TBT', value: fmtMs(ps.tbtMs), tone: 'text-slate-700' },
    { label: 'TTFB', value: fmtMs(ps.ttfbMs), tone: 'text-slate-700' },
  ]
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {items.map((it) => (
        <div key={it.label} className="rounded-md border border-slate-200 bg-slate-50/60 px-2.5 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {it.label}
          </div>
          <div className={`mt-0.5 text-sm font-semibold tabular-nums ${it.tone}`}>{it.value}</div>
        </div>
      ))}
    </div>
  )
}

export default function FreeIntelPanel({ website, lead, activeMetaAds }: Props) {
  const [intel, setIntel] = useState<FreeIntel | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [pitchCopied, setPitchCopied] = useState(false)

  useEffect(() => {
    if (!website) {
      setIntel(null)
      return
    }
    let cancelled = false
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const res = await fetch('/api/lead/free-intel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ website }),
          signal: ac.signal,
        })
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!json || json.ok === false) {
          setIntel(null)
          setError(json?.error || 'Audit non disponibile')
        } else {
          setIntel((json.intel as FreeIntel) || null)
        }
      } catch (e) {
        if (cancelled) return
        const err = e as { name?: string; message?: string }
        if (err?.name !== 'AbortError') setError(err?.message || 'Errore audit')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      ac.abort()
    }
  }, [website, refreshKey])

  if (!website) return null

  const ps = intel?.performance || null
  const sec = intel?.security || null
  const dom = intel?.domain || null
  const audit = intel?.audit || null
  const triggers = intel?.triggers || []
  const buyingSignals = intel
    ? analyzeBuyingSignals(lead ?? {}, {
        ...toBuyingSignalAudit(intel),
        activeMetaAds: typeof activeMetaAds === 'number' ? activeMetaAds : null,
        metaAdsVerified: typeof activeMetaAds === 'number',
      })
    : null

  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">
            Audit Tecnico & Marketing
          </h2>
          <p className="text-xs text-slate-500">
            Performance reali, security, stack marketing, SEO e trigger commerciali per questo lead.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          title="Riesegui audit"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          Aggiorna
        </button>
      </div>

      {loading && !intel && (
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            Analisi tecnica in corso…
          </div>
        </div>
      )}

      {!loading && !intel && error && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
          Audit non disponibile per questo sito.
        </div>
      )}

      {intel && (
        <div className="space-y-4">
          {/* Segnali d'acquisto verificabili — il valore commerciale in cima */}
          {buyingSignals && buyingSignals.signals.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-rose-500" strokeWidth={1.75} />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Segnali d&apos;acquisto verificabili ({buyingSignals.signals.length})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const message = buildPitchMessage(buyingSignals, {
                        company: readLeadString(lead, ['azienda', 'nome', 'business_name', 'company', 'name']),
                        contactName: readLeadString(lead, ['referente', 'contact_name', 'owner_name', 'titolare']),
                      })
                      if (!message) return
                      try {
                        await navigator.clipboard.writeText(message)
                        setPitchCopied(true)
                        setTimeout(() => setPitchCopied(false), 2000)
                      } catch {
                        // clipboard non disponibile: nessuna azione distruttiva
                      }
                    }}
                    title="Copia un messaggio di primo contatto costruito sui segnali reali di questo lead"
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {pitchCopied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2} />
                        Copiato
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                        Copia messaggio
                      </>
                    )}
                  </button>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${BS_LABEL_STYLE[buyingSignals.label]}`}>
                    {buyingSignals.label} · {buyingSignals.score}
                  </span>
                </div>
              </div>
              <div className="space-y-3 p-4">
                {buyingSignals.signals.slice(0, 5).map((signal) => {
                  const style = BS_SEVERITY_STYLE[signal.severity]
                  return (
                    <div key={signal.id} className={`rounded-lg border p-3.5 ${style.card}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-bold text-slate-900">{signal.title}</span>
                          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase ${style.badge}`}>
                            {signal.severity}
                          </span>
                        </div>
                        <span className="flex-shrink-0 text-[11px] font-semibold text-slate-500">
                          {signal.confidence}%
                        </span>
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-slate-700">{signal.reason}</p>

                      <div className="mt-2.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {signal.evidence.map((ev, i) => (
                          <div key={`${signal.id}-ev-${i}`} className="rounded-md border border-white bg-white/70 px-2.5 py-1.5">
                            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{ev.label}</div>
                            <div className="text-[12px] font-semibold text-slate-800">{ev.value}</div>
                          </div>
                        ))}
                      </div>

                      {signal.quantifiedImpact && (
                        <div className="mt-2.5 rounded-md border border-slate-300 bg-white p-3">
                          <div className="flex items-center gap-1.5">
                            <TrendingDown className="h-3.5 w-3.5 text-rose-500" strokeWidth={2} />
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Impatto sul business</span>
                          </div>
                          <div className="mt-1 text-[12px] font-bold text-slate-900">{signal.quantifiedImpact.headline}</div>
                          <p className="mt-1 text-[12px] leading-relaxed text-slate-700">{signal.quantifiedImpact.estimate}</p>
                          <div className="mt-1.5 text-[11px] text-slate-600">
                            <span className="font-semibold text-slate-700">Come metterci un numero col cliente:</span> {signal.quantifiedImpact.howToQuantifyLive}
                          </div>
                          <div className="mt-1 text-[10px] text-slate-400">Fonte: {signal.quantifiedImpact.benchmarkSource}</div>
                        </div>
                      )}

                      <div className="mt-2.5 grid grid-cols-1 gap-1.5 md:grid-cols-3">
                        <div className="rounded-md border border-white bg-white/70 p-2.5">
                          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Cosa vendere</div>
                          <div className="mt-0.5 text-[12px] font-semibold text-slate-800">{signal.serviceToSell}</div>
                        </div>
                        <div className="rounded-md border border-white bg-white/70 p-2.5">
                          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Frase d&apos;apertura</div>
                          <div className="mt-0.5 text-[12px] text-slate-700">{signal.openingLine}</div>
                        </div>
                        <div className="rounded-md border border-white bg-white/70 p-2.5">
                          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Prossima azione</div>
                          <div className="mt-0.5 text-[12px] text-slate-700">{signal.nextBestAction}</div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Triggers commerciali in alto */}
          {triggers.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                <Target className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Trigger di vendita ({triggers.length})
                </span>
              </div>
              <ul className="divide-y divide-slate-100">
                {triggers.slice(0, 8).map((t, i) => (
                  <li key={i} className="flex items-start gap-3 px-4 py-2.5">
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${SEVERITY_STYLE[t.severity].dot}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-slate-900">{t.title}</div>
                      <div className="text-[12px] text-slate-500">{t.detail}</div>
                    </div>
                    <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {SEVERITY_STYLE[t.severity].label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Performance */}
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2">
                <Gauge className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Performance · Mobile
                </span>
              </div>
              {ps ? (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <ScoreCard label="Performance" score={ps.performance} />
                    <ScoreCard label="Accessibility" score={ps.accessibility} />
                    <ScoreCard label="Best Practices" score={ps.bestPractices} />
                    <ScoreCard label="SEO" score={ps.seo} />
                  </div>
                  <div className="mt-3">
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Core Web Vitals
                    </div>
                    <VitalsRow ps={ps} />
                  </div>
                  {ps.topIssues.length > 0 && (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Top 5 problemi rilevati
                      </div>
                      <ul className="space-y-1">
                        {ps.topIssues.map((iss) => (
                          <li
                            key={iss.id}
                            className="flex items-start justify-between gap-3 text-[12px]"
                          >
                            <span className="min-w-0 flex-1 truncate text-slate-700">
                              {iss.title}
                            </span>
                            {iss.savingMs != null && iss.savingMs > 0 && (
                              <span className="flex-shrink-0 text-rose-600 tabular-nums">
                                –{(iss.savingMs / 1000).toFixed(1)}s
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[13px] text-slate-400">Performance non disponibile per questo sito.</p>
              )}
            </div>

            {/* Security + Hosting */}
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2">
                <Shield className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Security & Hosting
                </span>
              </div>
              {sec ? (
                <>
                  <div className="flex items-center gap-3">
                    <div
                      className={`inline-flex h-12 w-12 items-center justify-center rounded-lg border text-xl font-semibold ${SECURITY_GRADE_STYLE[sec.grade] || 'text-slate-700 bg-slate-50 border-slate-200'}`}
                    >
                      {sec.grade}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-slate-900">
                        Headers di sicurezza: {sec.score}/6
                      </div>
                      <div className="text-[12px] text-slate-500">
                        {[
                          sec.cdn ? `CDN: ${sec.cdn.replace('_', ' ')}` : 'Nessun CDN',
                          sec.server ? `Server: ${sec.server}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-1.5 text-[12px] sm:grid-cols-3">
                    {(
                      [
                        ['HSTS', sec.hsts],
                        ['CSP', sec.csp],
                        ['X-Frame', sec.xFrameOptions],
                        ['X-Content-Type', sec.xContentType],
                        ['Referrer-Policy', sec.referrerPolicy],
                        ['Permissions', sec.permissionsPolicy],
                      ] as [string, boolean][]
                    ).map(([label, ok]) => (
                      <div
                        key={label}
                        className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50/60 px-2 py-1"
                      >
                        {ok ? (
                          <CheckCircle2
                            className="h-3.5 w-3.5 text-emerald-600"
                            strokeWidth={1.75}
                          />
                        ) : (
                          <AlertTriangle
                            className="h-3.5 w-3.5 text-rose-500"
                            strokeWidth={1.75}
                          />
                        )}
                        <span className="text-slate-700">{label}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-[13px] text-slate-400">Security audit non disponibile.</p>
              )}

              <div className="mt-3 grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Dominio
                  </div>
                  <div className="text-[13px] text-slate-800">
                    {dom?.ageYears != null ? `${dom.ageYears} anni` : '—'}
                    {dom?.registeredYear ? ` · dal ${dom.registeredYear}` : ''}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Scadenza
                  </div>
                  <div
                    className={`text-[13px] tabular-nums ${dom?.expiresInDays != null && dom.expiresInDays < 90 ? 'text-rose-600 font-medium' : 'text-slate-800'}`}
                  >
                    {dom?.expiresInDays != null
                      ? dom.expiresInDays > 0
                        ? `${dom.expiresInDays} giorni`
                        : 'Scaduto'
                      : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 inline-flex items-center gap-1">
                    <Mail className="h-3 w-3" strokeWidth={1.75} /> Email aziendale
                  </div>
                  <div className="text-[13px] text-slate-800">
                    {formatProvider(intel.emailProvider)}
                  </div>
                </div>
              </div>
              {dom?.registrar && (
                <div className="mt-2 text-[11px] text-slate-400 inline-flex items-center gap-1">
                  <Globe className="h-3 w-3" strokeWidth={1.75} />
                  Registrar: {dom.registrar}
                </div>
              )}
            </div>
          </div>

          {/* Marketing stack */}
          {audit && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2">
                <Boxes className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Stack Marketing & Tecnico ({audit.toolCount} tool rilevati)
                </span>
              </div>

              {/* Tracking pixel ribbon */}
              <div className="mb-4">
                <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <Target className="h-3 w-3" strokeWidth={1.75} />
                  Tracking & Pixel ({audit.pixelCount} attivi)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {flatPixels(audit).map((p) => (
                    <span
                      key={p.label}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium ${
                        p.on
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-slate-50 text-slate-400'
                      }`}
                    >
                      {p.on ? (
                        <CheckCircle2 className="h-3 w-3" strokeWidth={1.75} />
                      ) : (
                        <span className="h-3 w-3 inline-block" />
                      )}
                      {p.label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {flatStack(audit).map((g) => {
                  const activeCount = g.items.filter((it) => it.on).length
                  if (activeCount === 0) return null
                  return (
                    <div key={g.group} className="rounded-md border border-slate-200 p-2.5">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          {g.group}
                        </span>
                        <span className="text-[10px] font-semibold tabular-nums text-emerald-600">
                          {activeCount} attivo{activeCount === 1 ? '' : 'i'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {g.items
                          .filter((it) => it.on)
                          .map((it) => (
                            <span
                              key={it.label}
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700"
                            >
                              {it.label}
                            </span>
                          ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Sezione "Cosa manca" — opportunità di vendita */}
              {(() => {
                const missingGroups = flatStack(audit).filter(
                  (g) => g.items.some((it) => it.on) === false,
                )
                if (missingGroups.length === 0) return null
                return (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      <TrendingDown className="h-3 w-3" strokeWidth={1.75} />
                      Categorie senza tool installato
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {missingGroups.map((g) => (
                        <span
                          key={g.group}
                          className="inline-flex items-center rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700"
                        >
                          {g.group}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* Conversion + SEO basics */}
          {audit && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Conversion & Lead capture
                  </span>
                </div>
                <ul className="grid grid-cols-2 gap-2 text-[13px]">
                  <li className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2">
                    <span className="text-slate-600">Form di contatto</span>
                    <span className="font-semibold tabular-nums text-slate-900">
                      {audit.contactFormCount}
                    </span>
                  </li>
                  {(
                    [
                      ['Newsletter form', audit.hasNewsletterForm],
                      ['WhatsApp button', audit.hasWhatsappButton],
                      ['Booking online', audit.hasCalendarBooking],
                      ['Telefono cliccabile', audit.hasClickablePhone],
                      ['Email cliccabile', audit.hasClickableEmail],
                    ] as [string, boolean][]
                  ).map(([label, ok]) => (
                    <li
                      key={label}
                      className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2"
                    >
                      <span className="text-slate-600">{label}</span>
                      {ok ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" strokeWidth={1.75} />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-rose-500" strokeWidth={1.75} />
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Zap className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    SEO basics & Schema.org
                  </span>
                </div>
                <ul className="grid grid-cols-2 gap-2 text-[13px]">
                  <li className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2">
                    <span className="text-slate-600">Title length</span>
                    <span
                      className={`font-semibold tabular-nums ${audit.titleLength != null && (audit.titleLength < 20 || audit.titleLength > 70) ? 'text-rose-600' : 'text-emerald-600'}`}
                    >
                      {audit.titleLength == null ? '—' : audit.titleLength}
                    </span>
                  </li>
                  <li className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2">
                    <span className="text-slate-600">Meta descr.</span>
                    <span
                      className={`font-semibold tabular-nums ${audit.metaDescriptionLength != null && (audit.metaDescriptionLength < 80 || audit.metaDescriptionLength > 170) ? 'text-amber-600' : 'text-emerald-600'}`}
                    >
                      {audit.metaDescriptionLength == null ? '—' : audit.metaDescriptionLength}
                    </span>
                  </li>
                  <li className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2">
                    <span className="text-slate-600">H1 sulla pagina</span>
                    <span
                      className={`font-semibold tabular-nums ${audit.h1Count !== 1 ? 'text-rose-600' : 'text-emerald-600'}`}
                    >
                      {audit.h1Count}
                    </span>
                  </li>
                  {(
                    [
                      ['Open Graph', audit.hasOpenGraph],
                      ['Twitter Cards', audit.hasTwitterCards],
                      ['Canonical', audit.hasCanonical],
                      ['Hreflang', audit.hasHreflang],
                      ['LocalBusiness schema', audit.hasLocalBusiness],
                      ['Product schema', audit.hasProductSchema],
                      ['FAQ schema', audit.hasFaqSchema],
                      ['Review schema', audit.hasReviewSchema],
                    ] as [string, boolean][]
                  ).map(([label, ok]) => (
                    <li
                      key={label}
                      className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2"
                    >
                      <span className="text-slate-600">{label}</span>
                      {ok ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" strokeWidth={1.75} />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-rose-500" strokeWidth={1.75} />
                      )}
                    </li>
                  ))}
                </ul>

                {(audit.cms || audit.languages.length > 0) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                    {audit.cms && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5">
                        <ShoppingBag className="h-3 w-3" strokeWidth={1.75} /> CMS: {audit.cms}
                      </span>
                    )}
                    {audit.languages.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5">
                        <Lock className="h-3 w-3" strokeWidth={1.75} />
                        Lingue: {audit.languages.join(', ')}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
