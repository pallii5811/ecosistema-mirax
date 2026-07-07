import { isAuditPendingLead } from '@/lib/lead-audit-status'

function _sanitize(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v).trim()
  if (s === 'None' || s === 'none' || s === 'null' || s === 'undefined') return ''
  return s
}

const _FAKE_EMAIL_DOMAINS = new Set([
  'website.com', 'example.com', 'email.com', 'sito.com', 'domain.com', 'test.com',
  'yoursite.com', 'yourdomain.com', 'tuosito.com', 'tuodominio.com', 'sitoweb.com',
  'miosito.com', 'nomedominio.com', 'nomesito.com', 'sample.com', 'placeholder.com',
  'mail.com',
])

const ITALIAN_REGIONS = new Set([
  'lombardia', 'lazio', 'campania', 'sicilia', 'veneto', 'emilia-romagna', 'emilia romagna',
  'piemonte', 'puglia', 'toscana', 'calabria', 'sardegna', 'liguria', 'marche', 'abruzzo',
  'friuli-venezia giulia', 'umbria', 'basilicata', 'molise', "valle d'aosta", 'italia', 'italy',
])

function isItalianRegion(name: string): boolean {
  return ITALIAN_REGIONS.has(name.trim().toLowerCase())
}

export function normalizeLeadFields(lead: unknown): unknown {
  if (!lead || typeof lead !== 'object') return lead
  const obj = lead as Record<string, unknown>
  const audit = (obj.audit as Record<string, unknown>) || {}

  const _cleanEmail = (raw: string): string => {
    if (!raw || !raw.includes('@')) return ''
    const domain = raw.split('@')[1]?.toLowerCase()
    if (_FAKE_EMAIL_DOMAINS.has(domain)) return ''
    return raw
  }

  const _extractCity = (): string => {
    const raw = _sanitize(obj.citta) || _sanitize(obj.city) || _sanitize(obj.location) || ''
    if (raw && !isItalianRegion(raw)) return raw
    const addr = _sanitize(obj.address) || _sanitize(obj.indirizzo) || ''
    if (addr) {
      const capMatch = addr.match(/\b(\d{5})\s+([A-Za-zÀ-ÿ'\-\s]+?)(?:\s+[A-Z]{2})?\b/)
      if (capMatch?.[2] && !isItalianRegion(capMatch[2])) return capMatch[2].trim()
      const parts = addr.split(',').map((p) => p.trim())
      for (let i = parts.length - 1; i >= 0; i--) {
        const cleaned = parts[i].replace(/\d{5}/g, '').trim()
        if (cleaned && cleaned.length > 2 && !isItalianRegion(cleaned)) return cleaned
      }
    }
    return ''
  }

  const hasItalianFields = _sanitize(obj.azienda) || _sanitize(obj.nome) || _sanitize(obj.sito) || _sanitize(obj.telefono)
  const base: Record<string, unknown> = hasItalianFields
    ? {
        ...obj,
        azienda: _sanitize(obj.azienda) || _sanitize(obj.nome) || _sanitize(obj.business_name) || _sanitize(obj.name) || '',
        nome: _sanitize(obj.nome) || _sanitize(obj.azienda) || _sanitize(obj.business_name) || _sanitize(obj.name) || '',
        sito: _sanitize(obj.sito) || _sanitize(obj.website) || '',
        telefono: _sanitize(obj.telefono) || _sanitize(obj.phone) || '',
        email: _cleanEmail(_sanitize(obj.email) || ''),
        citta: _extractCity(),
        categoria: _sanitize(obj.categoria) || _sanitize(obj.category) || '',
        instagram: _sanitize(obj.instagram) || '',
      }
    : {
        ...obj,
        azienda: _sanitize(obj.business_name) || _sanitize(obj.name) || '',
        nome: _sanitize(obj.business_name) || _sanitize(obj.name) || '',
        sito: _sanitize(obj.website) || '',
        telefono: _sanitize(obj.phone) || '',
        email: _cleanEmail(_sanitize(obj.email) || ''),
        citta: _extractCity(),
        categoria: _sanitize(obj.category) || '',
        instagram: _sanitize(obj.instagram) || '',
      }

  const techStackArr = Array.isArray(base.tech_stack)
    ? base.tech_stack
    : Array.isArray(obj.tech_stack)
      ? obj.tech_stack
      : []

  if (isAuditPendingLead({ ...base, tech_stack: techStackArr })) {
    return { ...base, tech_stack: techStackArr, technical_report: base.technical_report ?? {} }
  }

  if (base.tech_stack && base.technical_report && base.meta_pixel !== undefined) return base

  const metaPixel = (base.meta_pixel as boolean | undefined) ?? (audit.has_facebook_pixel as boolean | undefined) ?? false
  const gtm = (base.google_tag_manager as boolean | undefined) ?? (audit.has_gtm as boolean | undefined) ?? false
  const ssl = (base.ssl as boolean | undefined) ?? (audit.has_ssl as boolean | undefined) ?? true
  const googleAds = (base.google_ads as boolean | undefined) ?? (audit.has_google_ads as boolean | undefined) ?? false
  const ga4 = (base.google_analytics as boolean | undefined) ?? (audit.has_ga4 as boolean | undefined) ?? false
  const mobileResp = (audit.is_mobile_responsive as boolean | undefined) ?? true
  const missingIg = (audit.missing_instagram as boolean | undefined) ?? false
  const seoDis = (audit.seo_disaster as boolean | undefined) ?? false
  const hasDmarc = (audit.has_dmarc as boolean | undefined) ?? true
  const htmlErr = (audit.html_errors as boolean | undefined) ?? false

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

export function hasLeadContactOrWebsite(lead: unknown): boolean {
  if (!lead || typeof lead !== 'object') return false
  const obj = lead as Record<string, unknown>
  const isVal = (v: unknown) => {
    if (v == null) return false
    const s = String(v).trim().toLowerCase()
    return s.length > 0 && !['', 'n/d', 'n/a', 'none', 'null', 'n.d.', 'undefined'].includes(s)
  }
  const hasPhone = isVal(obj.telefono) || isVal(obj.phone)
  const email = String(obj.email ?? '').trim().toLowerCase()
  const hasEmail = email.includes('@') && !['', 'n/d', 'n/a', 'none', 'null', 'n.d.', 'undefined'].includes(email)
  const site = String(obj.sito ?? obj.website ?? '').trim()
  const hasWebsite =
    site.length > 0 &&
    !['', 'n/d', 'n/a', 'none', 'null', 'n.d.', 'undefined'].includes(site.toLowerCase())
  return hasPhone || hasEmail || hasWebsite
}

/** Chiave stabile per merge/dedup/React key (allineata al worker). */
export function leadStableKey(lead: Record<string, unknown>): string {
  const dedupe = lead.dedupe_key
  if (typeof dedupe === 'string' && dedupe.trim()) return dedupe.trim()

  const rawPhone = (lead.telefono || lead.phone || '').toString()
  const phoneParts = rawPhone.split(/[\/\,;|]+/)
  let phone = ''
  for (const part of phoneParts) {
    const digits = part.replace(/\D/g, '').replace(/^(39|0039)/, '')
    if (digits.length >= 8) {
      phone = digits.slice(-9)
      break
    }
  }
  const rawSite = (lead.sito || lead.website || '').toString().toLowerCase().trim()
  const domain = rawSite.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim()
  if (domain) return `web:${domain}`
  if (phone && phone.length >= 8) return `tel:${phone}`

  const name = (lead.azienda || lead.nome || lead.company || lead.name || '')
    .toString()
    .toLowerCase()
    .trim()
  const city = (lead.citta || lead.city || lead.localita || '').toString().toLowerCase().trim()
  const nameSlug = name.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  const citySlug = city.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)
  if (nameSlug && citySlug) return `name:${nameSlug}:${citySlug}`
  if (nameSlug) return `name:${nameSlug}`
  return `uid:orphan:${domain || phone || nameSlug || 'lead'}`
}

export function leadRowKey(item: unknown, rowIdx = 0): string {
  const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : null
  if (!row) return `row-${rowIdx}`
  if (typeof row.id === 'string' && row.id.trim()) return row.id.trim()
  return leadStableKey(row)
}

export function deduplicateResults(items: unknown[]): unknown[] {
  const seen = new Map<string, unknown>()
  const domainToKey = new Map<string, string>()

  const leadQualityScore = (lead: Record<string, unknown>): number => {
    if (isAuditPendingLead(lead)) return -500
    const isReal = (v: unknown) => {
      const s = String(v || '').trim()
      return !!s && !['N/D', 'N/A', 'N.D.', 'n/d', 'none', 'null', '-'].includes(s)
    }
    const phoneDigits = String(lead?.telefono || lead?.phone || '').replace(/\D/g, '')
    const hasPhone = phoneDigits.length >= 8
    const hasEmail = String(lead?.email || '').includes('@')
    const hasAudit = Boolean((lead?.technical_report as Record<string, unknown>)?.organic_audited || lead?.audit)
    const techStack = Array.isArray(lead?.tech_stack) ? lead.tech_stack : []
    const hasRealTech = techStack.some((x: unknown) => {
      const s = String(x).toLowerCase()
      return s && !/contatto da verificare|verifica in corso|audit in arrivo|stack in arrivo/i.test(s)
    })
    const tr = lead?.technical_report
    const hasTechnicalReport = tr && typeof tr === 'object' && Object.keys(tr as object).length > 0
    return (
      (hasPhone ? 100 : 0) +
      (hasEmail ? 100 : 0) +
      (hasAudit ? 30 : 0) +
      (hasRealTech ? 80 : 0) +
      (hasTechnicalReport ? 10 : 0) +
      [lead?.sito, lead?.website, lead?.instagram, lead?.rating].filter(isReal).length
    )
  }

  for (const item of items) {
    const obj = item as Record<string, unknown>
    const rawPhone = (obj.telefono || obj.phone || '').toString()
    const phoneParts = rawPhone.split(/[\/\,;|]+/)
    let phone = ''
    for (const part of phoneParts) {
      const digits = part.replace(/\D/g, '').replace(/^(39|0039)/, '')
      if (digits.length >= 8) {
        phone = digits.slice(-9)
        break
      }
    }

    const name = (obj.azienda || obj.nome || obj.company || '').toString().toLowerCase().trim().slice(0, 20)
    const rawSite = (obj.sito || obj.website || '').toString().toLowerCase().trim()
    const domain = rawSite.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim()

    const phoneKey = phone && phone.length >= 8 ? `tel:${phone}` : ''
    const webKey = domain ? `web:${domain}` : ''
    const nameKey = name ? `name:${name}` : ''

    if (webKey && domainToKey.has(webKey)) {
      const existingMapKey = domainToKey.get(webKey)!
      const existing = seen.get(existingMapKey) as Record<string, unknown> | undefined
      if (existing) {
        const existingScore = leadQualityScore(existing)
        const newScore = leadQualityScore(obj)
        if (newScore >= existingScore) seen.set(existingMapKey, item)
      }
      continue
    }

    if (phoneKey && seen.has(phoneKey)) {
      const existing = seen.get(phoneKey) as Record<string, unknown>
      const existingScore = leadQualityScore(existing)
      const newScore = leadQualityScore(obj)
      if (newScore >= existingScore) seen.set(phoneKey, item)
      if (webKey) domainToKey.set(webKey, phoneKey)
      continue
    }

    const primaryKey = leadStableKey(obj)
    if (seen.has(primaryKey)) {
      const existing = seen.get(primaryKey) as Record<string, unknown>
      const existingScore = leadQualityScore(existing)
      const newScore = leadQualityScore(obj)
      if (newScore >= existingScore) seen.set(primaryKey, item)
      if (webKey) domainToKey.set(webKey, primaryKey)
      continue
    }

    seen.set(primaryKey, item)
    if (webKey) domainToKey.set(webKey, primaryKey)
  }

  return Array.from(seen.values())
}

/** Accumula lead in sessione — mai rimuove chiavi già viste. */
export function upsertLeadsIntoSession(
  session: Map<string, Record<string, unknown>>,
  incoming: unknown[],
): void {
  for (const raw of incoming) {
    const lead = normalizeLeadFields(raw) as Record<string, unknown>
    const key = leadStableKey(lead)
    const prev = session.get(key)
    session.set(key, prev ? ({ ...prev, ...lead } as Record<string, unknown>) : lead)
  }
}

export function sessionLeadsToArray(session: Map<string, Record<string, unknown>>): Record<string, unknown>[] {
  return Array.from(session.values())
}

/** Unione monotona: arricchisce lead esistenti senza far sparire righe già mostrate. */
export function mergeLeadLists(prev: unknown[], next: unknown[]): unknown[] {
  const combined = [
    ...(Array.isArray(prev) ? prev : []),
    ...(Array.isArray(next) ? next : []),
  ]
  if (combined.length === 0) return []
  return deduplicateResults(combined.map(normalizeLeadFields))
}

export function buildTechFilter(q: string): ((l: Record<string, unknown>) => boolean) | null {
  const filters: Array<(l: Record<string, unknown>) => boolean> = []
  const ql = q.toLowerCase()
  if (/errori?\s*(seo|html)|seo\s*error|con\s*errori/i.test(ql))
    filters.push((l) => {
      const tr = (l.technical_report || {}) as Record<string, unknown>
      const stack = Array.isArray(l.tech_stack) ? l.tech_stack.join(' ').toLowerCase() : ''
      const htmlErr = tr.html_errors
      const hasHtmlErrors = htmlErr === true || (typeof htmlErr === 'number' && htmlErr > 0)
      return tr.seo_disaster === true || hasHtmlErrors || stack.includes('disastro seo') || stack.includes('seo error')
    })
  if (/senza\s*(meta\s*)?pixel|no\s*pixel/i.test(ql)) filters.push((l) => l.meta_pixel !== true)
  if (/senza\s*gtm|no\s*gtm|senza\s*tag\s*manager/i.test(ql)) filters.push((l) => l.google_tag_manager !== true)
  if (/senza\s*ssl|no\s*ssl/i.test(ql)) filters.push((l) => l.ssl === false)
  if (/senza\s*google\s*ads|no\s*google\s*ads|senza\s*ads/i.test(ql))
    filters.push((l) => l.google_ads !== true && (l.technical_report as Record<string, unknown>)?.has_google_ads !== true)
  if (/senza\s*instagram|no\s*instagram/i.test(ql))
    filters.push((l) => {
      const ig = (l.instagram || '').toString().trim()
      return !ig || ig === 'N/D'
    })
  if (/senza\s*(google\s*)?analytics|no\s*analytics|senza\s*ga4|no\s*ga4/i.test(ql))
    filters.push((l) => l.google_analytics !== true && (l.technical_report as Record<string, unknown>)?.has_ga4 !== true)
  if (/sito\s*lento|slow\s*(site|speed)/i.test(ql))
    filters.push((l) => {
      const tr = l.technical_report as Record<string, unknown> | undefined
      const spd = tr?.load_speed_s ?? tr?.load_speed_seconds
      return typeof spd === 'number' && spd > 3
    })
  if (/senza\s*(sito|website)|no\s*(web|website|sito)/i.test(ql))
    filters.push((l) => {
      const s = (l.sito || l.website || '').toString().trim()
      return !s || s === 'N/D' || s === 'N/A' || s === 'N.D.' || s === 'n/d'
    })
  if (/senza\s*facebook|no\s*facebook/i.test(ql))
    filters.push((l) => {
      const fb = (l.facebook || '').toString().trim()
      return !fb || fb === 'N/D'
    })
  if (/senza\s*dmarc|no\s*dmarc/i.test(ql))
    filters.push((l) => l.dmarc !== true && (l.technical_report as Record<string, unknown>)?.has_dmarc !== true)
  if (/non\s*mobile|no\s*mobile|senza\s*mobile/i.test(ql))
    filters.push((l) => l.mobile_friendly !== true && (l.technical_report as Record<string, unknown>)?.mobile_friendly !== true)
  if (/senza\s*linkedin|no\s*linkedin/i.test(ql))
    filters.push((l) => {
      const li = (l.linkedin || '').toString().trim()
      return !li || li === 'N/D'
    })
  if (/senza\s*email|no\s*email/i.test(ql))
    filters.push((l) => {
      const em = (l.email || '').toString().trim()
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
      const n = parseInt(
        String(l.reviews_count ?? l.review_count ?? l.reviews ?? l.google_reviews ?? l.num_recensioni ?? ''),
        10,
      )
      return !isNaN(n) && n >= 0 && n < 10
    })
  if (filters.length === 0) return null
  const needsWebsite =
    !(/senza\s*(sito|website)|no\s*(web|website|sito)/i.test(ql)) &&
    /errori|seo|pixel|gtm|tag.manager|ssl|google.ads|ads|analytics|ga4|lento|slow|dmarc|mobile/i.test(ql)
  return (lead: Record<string, unknown>) => {
    if (needsWebsite) {
      const s = (lead.sito || lead.website || '').toString().trim()
      if (!s || s === 'N/D' || s === 'N/A' || s === 'N.D.' || s === 'n/d') return false
    }
    return filters.some((f) => f(lead))
  }
}
