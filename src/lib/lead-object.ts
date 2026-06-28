/**
 * Lead Object v2 — schema stabile per risultati ricerca (JSON in searches.results).
 * @see docs/SCORE_AI_RULES.md
 */

export const LEAD_OBJECT_VERSION = 2

export type LeadObject = {
  lead_object_version: number
  azienda: string
  nome: string
  telefono: string
  email: string
  sito: string | null
  website: string | null
  citta: string
  categoria: string
  tech_stack: string[]
  meta_pixel: boolean
  google_tag_manager: boolean
  technical_report: Record<string, unknown>
  audit: Record<string, unknown>
  opportunity_score: number
  freshness_score: number
  last_audited_at: string | null
  audit_version: number
  instagram?: string | null
  facebook?: string | null
  instagram_missing?: boolean
  [key: string]: unknown
}

const EMPTY = new Set(['', 'n/d', 'n/a', 'none', 'null', 'undefined', 'n.d.'])

/** Decadimento 0–100 su 30 giorni (allineato al worker Python). */
export function computeFreshnessScore(lastAuditedIso: unknown, now = Date.now()): number {
  if (!lastAuditedIso || typeof lastAuditedIso !== 'string') return 0
  const ts = Date.parse(lastAuditedIso)
  if (!Number.isFinite(ts)) return 0
  const ageDays = (now - ts) / 86_400_000
  return Math.max(0, Math.min(100, Math.round(100 - (ageDays / 30) * 100)))
}

export function freshnessLabel(score: number): string {
  if (score >= 80) return 'Fresco'
  if (score >= 50) return 'Valido'
  if (score > 0) return 'Da rivalutare'
  return 'Non auditato'
}

function cleanStr(v: unknown): string {
  if (v == null) return ''
  const s = String(v).trim()
  if (EMPTY.has(s.toLowerCase())) return ''
  return s
}

/** Normalizza un lead grezzo (Maps/worker/UI) al contratto v2. */
export function normalizeLeadObject(raw: unknown): LeadObject {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const techRaw = src.tech_stack ?? src.techStack
  const tech_stack = Array.isArray(techRaw)
    ? techRaw.filter((x) => typeof x === 'string').map((x) => String(x).trim()).filter(Boolean)
    : typeof techRaw === 'string' && techRaw.trim()
      ? [techRaw.trim()]
      : ['Verifica in corso']

  const last_audited_at = cleanStr(src.last_audited_at) || null
  const freshness_score =
    typeof src.freshness_score === 'number' && Number.isFinite(src.freshness_score)
      ? Math.max(0, Math.min(100, Math.round(src.freshness_score)))
      : computeFreshnessScore(last_audited_at)

  const sito = cleanStr(src.sito) || cleanStr(src.website) || null
  const tr =
    src.technical_report && typeof src.technical_report === 'object'
      ? { ...(src.technical_report as Record<string, unknown>) }
      : {}

  const audit =
    src.audit && typeof src.audit === 'object'
      ? { ...(src.audit as Record<string, unknown>) }
      : {}

  const instagram = cleanStr(src.instagram) || null
  const facebook = cleanStr(src.facebook) || null

  return {
    ...src,
    lead_object_version: LEAD_OBJECT_VERSION,
    azienda: cleanStr(src.azienda) || cleanStr(src.nome) || cleanStr(src.business_name) || 'N/A',
    nome: cleanStr(src.nome) || cleanStr(src.azienda) || cleanStr(src.business_name) || '',
    telefono: cleanStr(src.telefono) || cleanStr(src.phone) || '',
    email: cleanStr(src.email) || '',
    sito,
    website: sito,
    citta: cleanStr(src.citta) || cleanStr(src.city) || cleanStr(src.location) || 'N/A',
    categoria: cleanStr(src.categoria) || cleanStr(src.category) || '',
    tech_stack,
    meta_pixel: Boolean(src.meta_pixel ?? audit.has_facebook_pixel),
    google_tag_manager: Boolean(src.google_tag_manager ?? audit.has_gtm),
    technical_report: tr,
    audit,
    opportunity_score:
      typeof src.opportunity_score === 'number'
        ? Math.max(0, Math.min(100, Math.round(src.opportunity_score)))
        : 0,
    freshness_score,
    last_audited_at,
    audit_version:
      typeof src.audit_version === 'number' ? src.audit_version : LEAD_OBJECT_VERSION,
    instagram,
    facebook,
    instagram_missing:
      typeof src.instagram_missing === 'boolean'
        ? src.instagram_missing
        : !instagram,
  }
}
