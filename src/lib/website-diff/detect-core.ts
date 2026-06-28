/**
 * Fase 8 — website diff engine (testable core, no Next deps).
 */

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeWebsiteUrl(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return s.replace(/^www\./, '')
}

export function textSample(html: string, maxLen = 8000): string {
  return stripHtml(html).slice(0, maxLen)
}

export function htmlHash(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i += 1) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0
  }
  return `h${Math.abs(h).toString(16)}`
}

/** Ignora diff triviali (cookie banner, date dinamiche). */
export function sanitizeDiffText(text: string): string {
  return text
    .replace(/\b20\d{2}\b/g, 'YYYY')
    .replace(/\b\d{1,2}[/:-]\d{1,2}[/:-]\d{2,4}\b/g, 'DATE')
    .replace(/cookie|gdpr|consent|accetta/i, '')
}

function tokenSimilarity(a: string, b: string): number {
  const ta = sanitizeDiffText(a).split(/\s+/).filter(Boolean).slice(0, 400)
  const tb = sanitizeDiffText(b).split(/\s+/).filter(Boolean).slice(0, 400)
  if (ta.length === 0 && tb.length === 0) return 1
  const setB = new Set(tb)
  let hits = 0
  for (const t of ta) {
    if (setB.has(t)) hits += 1
  }
  return hits / Math.max(ta.length, tb.length, 1)
}

export type WebsiteDiffResult = {
  changed: boolean
  similarity: number
  summary: string
}

export function detectWebsiteChange(prevText: string, nextText: string): WebsiteDiffResult {
  const prev = sanitizeDiffText(prevText.slice(0, 4000))
  const next = sanitizeDiffText(nextText.slice(0, 4000))
  const similarity = tokenSimilarity(prev, next)
  const changed = prev.length > 0 && similarity < 0.88
  let summary = 'Nessuna modifica significativa'
  if (changed) {
    const prevWords = new Set(prev.split(/\s+/).filter((w) => w.length > 4))
    const newTokens = next.split(/\s+/).filter((w) => w.length > 4 && !prevWords.has(w))
    summary = newTokens.length
      ? `Nuovi termini rilevati: ${newTokens.slice(0, 6).join(', ')}`
      : 'Contenuto pagina modificato'
  }
  return { changed, similarity, summary }
}
