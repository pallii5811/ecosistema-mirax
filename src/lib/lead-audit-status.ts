/** Rileva lead pubblicati prima che l'audit del sito sia finito (worker: "Verifica in corso"). */

export function isAuditPendingLead(lead: unknown): boolean {
  if (!lead || typeof lead !== 'object') return false
  const obj = lead as Record<string, unknown>

  const techStackRaw = obj.tech_stack ?? obj.techStack
  const techStack = Array.isArray(techStackRaw) ? techStackRaw.filter((v) => typeof v === 'string') : []
  const stackStr = techStack.join(' ').toLowerCase()

  if (
    stackStr.includes('verifica in corso') ||
    stackStr.includes('stack in arrivo') ||
    stackStr.includes('audit in arrivo')
  ) {
    return true
  }

  const technicalReport =
    obj.technical_report && typeof obj.technical_report === 'object'
      ? (obj.technical_report as Record<string, unknown>)
      : null

  return techStack.length === 0 && (!technicalReport || Object.keys(technicalReport).length === 0)
}

export function countPendingAudits(leads: unknown[]): number {
  if (!Array.isArray(leads)) return 0
  return leads.filter(isAuditPendingLead).length
}
