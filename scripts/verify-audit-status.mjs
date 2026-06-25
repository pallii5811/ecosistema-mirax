function isAuditPendingLead(lead) {
  if (!lead || typeof lead !== 'object') return false
  const techStack = Array.isArray(lead.tech_stack) ? lead.tech_stack.filter((v) => typeof v === 'string') : []
  const stackStr = techStack.join(' ').toLowerCase()
  if (stackStr.includes('verifica in corso') || stackStr.includes('stack in arrivo') || stackStr.includes('audit in arrivo')) return true
  const technicalReport = lead.technical_report && typeof lead.technical_report === 'object' ? lead.technical_report : null
  return techStack.length === 0 && (!technicalReport || Object.keys(technicalReport).length === 0)
}

function countPendingAudits(leads) {
  if (!Array.isArray(leads)) return 0
  return leads.filter(isAuditPendingLead).length
}

const pending = { tech_stack: ['Verifica in corso'], telefono: '3331234567' }
const audited = { tech_stack: ['No Google Ads', 'No Pixel'], technical_report: { has_google_ads: false } }
const empty = { tech_stack: [], technical_report: {} }

const cases = [
  [isAuditPendingLead(pending), true, 'verifica in corso'],
  [isAuditPendingLead(audited), false, 'audited lead'],
  [isAuditPendingLead(empty), true, 'empty stack'],
  [countPendingAudits([pending, audited, pending]), 2, 'pending count'],
]

let failed = 0
for (const [got, want, label] of cases) {
  if (got !== want) {
    console.error(`FAIL ${label}: got ${got}, want ${want}`)
    failed++
  } else {
    console.log(`OK ${label}`)
  }
}
process.exit(failed > 0 ? 1 : 0)
