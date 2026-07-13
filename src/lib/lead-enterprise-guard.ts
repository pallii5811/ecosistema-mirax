export type EnterpriseLeadLike = Record<string, unknown>

const GLOBAL_BRAND_DOMAINS = [
  'nike.com',
  'ferrari.com',
  'uniqlo.com',
  'primark.com',
  'urbanoutfitters.com',
  'ikea.com',
  'zara.com',
  'hm.com',
  'apple.com',
  'microsoft.com',
  'google.com',
  'amazon.',
  'mediaset.it',
  'iliad.it',
  'acer.com',
]

const GLOBAL_BRAND_PATTERNS: Array<[RegExp, string]> = [
  [/\buniqlo\b/i, 'uniqlo'],
  [/\bprimark\b/i, 'primark'],
  [/\burban\s+outfitters\b/i, 'urban outfitters'],
  [/\bnike(?:\s+(?:milano|roma|store|flagship|retail|shop))?\b/i, 'nike'],
  [/\bferrari\s+(?:flagship|store|official|milano|roma)\b/i, 'ferrari'],
  [/\bikea\b/i, 'ikea'],
  [/\bzara\b/i, 'zara'],
  [/\bh\s*&\s*m\b|\bhm\s+(?:store|milano|roma)\b/i, 'h&m'],
  [/\bapple\s+store\b/i, 'apple'],
  [/\bgalleria\s+vittorio\s+emanuele\b/i, 'galleria vittorio emanuele'],
]

const SMB_INTENT_RE =
  /\b(pmi|piccol[aeio]?|medie?\s+imprese?|local[ei]|non\s+famose?|lead\s+cald|a\s+cui\s+vendere|prospect|sales\s+intelligence|lead\s+generation|outreach|segnal[ei]\s+d.?acquisto|invest\w*\s+in\s+marketing|budget\s+marketing|ads\s+attiv[ei])\b/i

function normalizeDomain(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return ''
  return s
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .trim()
}

function leadHaystack(lead: EnterpriseLeadLike): string {
  return [
    lead.azienda,
    lead.nome,
    lead.company,
    lead.business_name,
    lead.name,
    lead.categoria,
    lead.category,
    lead.sito,
    lead.website,
  ]
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .join(' ')
}

function explicitBrandRequested(query: string, brand: string): boolean {
  if (!query.trim()) return false
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'i').test(query)
}

export function enterpriseLeadReason(lead: EnterpriseLeadLike): string | null {
  const domain = normalizeDomain(lead.sito || lead.website)
  if (domain) {
    const matchedDomain = GLOBAL_BRAND_DOMAINS.find((d) => domain === d || domain.endsWith(`.${d}`) || domain.includes(d))
    if (matchedDomain) return `global-brand-domain:${matchedDomain}`
  }

  const hay = leadHaystack(lead)
  for (const [pattern, label] of GLOBAL_BRAND_PATTERNS) {
    if (pattern.test(hay)) return `global-brand-name:${label}`
  }
  return null
}

export function shouldRejectEnterpriseLead(
  lead: EnterpriseLeadLike,
  queryOrIntentSummary: string,
  opts?: { signalFocused?: boolean },
): boolean {
  const reason = enterpriseLeadReason(lead)
  if (!reason) return false

  const context = String(queryOrIntentSummary || '')
  const brand = reason.split(':').pop()?.replace(/\..*$/, '') || ''
  if (brand && explicitBrandRequested(context, brand)) return false

  return opts?.signalFocused === true || !context.trim() || SMB_INTENT_RE.test(context)
}
