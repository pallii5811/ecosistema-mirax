import { isAuditPendingLead } from '@/lib/lead-audit-status'

const BLANK_SITES = new Set(['', 'n/d', 'n/a', 'n.d.', 'none', 'null', '-'])

export function isBlankWebsite(site: unknown): boolean {
  const s = String(site ?? '').trim().toLowerCase()
  return BLANK_SITES.has(s)
}

export function buildTechStackFromAudit(audit: Record<string, unknown>): string[] {
  const ts: string[] = []
  const raw = String(audit.tech_stack ?? '').toLowerCase()
  if (raw.includes('wordpress')) ts.push('WORDPRESS')
  else if (raw.includes('shopify')) ts.push('SHOPIFY')
  else if (raw.includes('wix')) ts.push('WIX')

  const hasPixel = Boolean(audit.has_pixel ?? audit.meta_pixel)
  const hasGtm = Boolean(audit.has_gtm ?? audit.google_tag_manager)
  const hasAds = Boolean(audit.has_google_ads)
  const hasSsl = audit.has_ssl !== false

  if (hasSsl) ts.push('SSL')
  if (hasPixel) ts.push('Meta Pixel')
  else ts.push('MISSING FB PIXEL')
  if (hasGtm) ts.push('GTM')
  else ts.push('MISSING GTM')
  if (hasAds) ts.push('GOOGLE ADS')
  else ts.push('MISSING GOOGLE ADS')

  const loadSpeed = audit.load_speed_seconds
  if (typeof loadSpeed === 'number' && loadSpeed > 4) ts.push('SITO LENTO')

  const unique = [...new Set(ts.filter(Boolean))]
  return unique.length > 0 ? unique : ['Custom HTML']
}

export function finalizeLeadWithoutWebsite(lead: Record<string, unknown>): Record<string, unknown> {
  const prevTr =
    lead.technical_report && typeof lead.technical_report === 'object'
      ? (lead.technical_report as Record<string, unknown>)
      : {}
  return {
    ...lead,
    tech_stack: ['NO WEBSITE'],
    technical_report: { ...prevTr, has_google_ads: false },
    last_audited_at: new Date().toISOString(),
    freshness_score: 100,
    audit_version: 2,
  }
}

export function mergeAuditIntoLead(
  lead: Record<string, unknown>,
  audit: Record<string, unknown>,
): Record<string, unknown> {
  const tech_stack = buildTechStackFromAudit(audit)
  const hasGoogleAds = Boolean(audit.has_google_ads)
  const seoErrors = Array.isArray(audit.seo_errors) ? audit.seo_errors : []
  const prevTr =
    lead.technical_report && typeof lead.technical_report === 'object'
      ? (lead.technical_report as Record<string, unknown>)
      : {}

  const existingEmail = String(lead.email ?? '').trim()
  const auditEmail = String(audit.email ?? '').trim()
  const existingPhone = String(lead.telefono ?? lead.phone ?? '').replace(/\D/g, '')
  const auditPhone = String(audit.telefono ?? audit.phone ?? '').replace(/\D/g, '')

  return {
    ...lead,
    meta_pixel: Boolean(audit.has_pixel ?? audit.meta_pixel),
    google_tag_manager: Boolean(audit.has_gtm ?? audit.google_tag_manager),
    email: existingEmail.includes('@') ? lead.email : auditEmail || lead.email,
    telefono:
      existingPhone.length >= 8
        ? lead.telefono ?? lead.phone
        : audit.telefono ?? audit.phone ?? lead.telefono ?? lead.phone,
    tech_stack,
    technical_report: {
      ...prevTr,
      has_google_ads: hasGoogleAds,
      has_ga4: Boolean(audit.has_ga4),
      load_speed_seconds: audit.load_speed_seconds ?? null,
      html_errors: seoErrors.length,
      error_details: seoErrors,
    },
    audit:
      audit.audit && typeof audit.audit === 'object'
        ? audit.audit
        : {
            has_ssl: audit.has_ssl !== false,
            has_facebook_pixel: Boolean(audit.has_pixel),
            has_gtm: Boolean(audit.has_gtm),
            has_tiktok_pixel: false,
            is_mobile_responsive: false,
            missing_instagram: false,
          },
    last_audited_at: new Date().toISOString(),
    freshness_score: 100,
    audit_version: 2,
  }
}

export function leadNeedsResumeAudit(lead: unknown): boolean {
  if (!lead || typeof lead !== 'object') return false
  if (!isAuditPendingLead(lead)) return false
  const obj = lead as Record<string, unknown>
  const site = obj.sito ?? obj.website
  return !isBlankWebsite(site)
}

export function countResumeAudits(leads: unknown[]): number {
  if (!Array.isArray(leads)) return 0
  return leads.filter(leadNeedsResumeAudit).length
}
