/** Sinonimi ruolo hiring — allineati a backend `_expand_hiring_roles`. */
export const HIRING_ROLE_SYNONYMS: Record<string, string[]> = {
  sviluppatore: ['sviluppatore', 'developer', 'programmatore', 'software engineer', 'full stack', 'frontend', 'backend'],
  developer: ['developer', 'sviluppatore', 'programmatore', 'software engineer', 'full stack'],
  programmatore: ['programmatore', 'sviluppatore', 'developer', 'software engineer'],
  commerciale: [
    'commerciale',
    'commercial',
    'sales',
    'account manager',
    'business developer',
    'sales manager',
    'venditore',
    'venditrice',
    'venditori',
    'area manager',
    'sales representative',
    'business development',
    'inside sales',
    'field sales',
  ],
  marketing: ['marketing', 'digital marketing', 'marketing manager', 'growth', 'seo', 'copywriter'],
  designer: ['designer', 'graphic designer', 'ux designer', 'ui designer', 'web designer'],
  tecnico: ['tecnico', 'tecnici', 'installatore', 'manutentore', 'operatore'],
  hr: ['hr', 'recruiter', 'risorse umane', 'talent'],
}

export function expandHiringRoles(roles: string[]): string[] {
  const out = new Set<string>()
  for (const r of roles) {
    const key = r.trim().toLowerCase()
    if (!key) continue
    out.add(key)
    for (const syn of HIRING_ROLE_SYNONYMS[key] || []) out.add(syn.toLowerCase())
  }
  return [...out]
}

export function textMatchesHiringRoles(text: string, roles: string[]): boolean {
  if (!roles.length) return true
  const hay = text.toLowerCase()
  return expandHiringRoles(roles).some((r) => {
    if (r.length <= 4) return new RegExp(`\\b${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hay)
    // Evita false positive "communication" → commerciale
    if (r === 'commerciale' || r === 'commercial') {
      return /\bcommerciale\b|\bcommercial\b|\bsales\b|\bvenditor\w*\b|\baccount manager\b/i.test(hay)
    }
    return hay.includes(r)
  })
}

/** Testo aggregato da lead per match ruolo (jobs + evidenze segnali hiring). */
export function hiringMatchTextFromLead(lead: Record<string, unknown>): string {
  const parts: string[] = []
  const jobs = lead.business_hiring_jobs
  if (Array.isArray(jobs)) {
    for (const j of jobs) {
      if (j && typeof j === 'object') parts.push(String((j as Record<string, unknown>).title || ''))
    }
  }
  const signals = lead.business_signals
  if (Array.isArray(signals)) {
    for (const s of signals) {
      if (!s || typeof s !== 'object') continue
      const sig = s as Record<string, unknown>
      if (sig.type !== 'hiring') continue
      parts.push(String(sig.title || ''))
      const ev = sig.evidence
      if (Array.isArray(ev)) {
        for (const e of ev) {
          if (e && typeof e === 'object') parts.push(String((e as Record<string, unknown>).value || ''))
        }
      }
    }
  }
  return parts.join(' ')
}
