function isAuditPendingLead(lead) {
  if (!lead || typeof lead !== 'object') return false
  const techStack = Array.isArray(lead.tech_stack) ? lead.tech_stack.filter((v) => typeof v === 'string') : []
  const stackStr = techStack.join(' ').toLowerCase()
  if (stackStr.includes('verifica in corso') || stackStr.includes('audit in arrivo')) return true
  const tr = lead.technical_report && typeof lead.technical_report === 'object' ? lead.technical_report : null
  return techStack.length === 0 && (!tr || !Object.keys(tr).length)
}

function buildTechStackFromAudit(audit) {
  const ts = []
  const raw = String(audit.tech_stack ?? '').toLowerCase()
  if (raw.includes('wordpress')) ts.push('WORDPRESS')
  const hasPixel = Boolean(audit.has_pixel ?? audit.meta_pixel)
  const hasGtm = Boolean(audit.has_gtm ?? audit.google_tag_manager)
  const hasAds = Boolean(audit.has_google_ads)
  if (audit.has_ssl !== false) ts.push('SSL')
  ts.push(hasPixel ? 'Meta Pixel' : 'MISSING FB PIXEL')
  ts.push(hasGtm ? 'GTM' : 'MISSING GTM')
  ts.push(hasAds ? 'GOOGLE ADS' : 'MISSING GOOGLE ADS')
  return [...new Set(ts)]
}

function mergeAuditIntoLead(lead, audit) {
  return {
    ...lead,
    tech_stack: buildTechStackFromAudit(audit),
    meta_pixel: Boolean(audit.has_pixel),
    technical_report: { has_google_ads: Boolean(audit.has_google_ads) },
    last_audited_at: new Date().toISOString(),
  }
}

const pending = { sito: 'https://example.com', tech_stack: ['Verifica in corso'], telefono: '3331234567' }
const audit = { has_pixel: false, has_gtm: true, has_google_ads: false, has_ssl: true, tech_stack: 'WordPress' }
const merged = mergeAuditIntoLead(pending, audit)

const cases = [
  [isAuditPendingLead(merged), false, 'merged not pending'],
  [buildTechStackFromAudit(audit).includes('MISSING GOOGLE ADS'), true, 'missing ads label'],
]

let failed = 0
for (const [got, want, label] of cases) {
  if (got !== want) {
    console.error(`FAIL ${label}`)
    failed++
  } else {
    console.log(`OK ${label}`)
  }
}
process.exit(failed)
