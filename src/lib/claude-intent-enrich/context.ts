import type { SignalIntentSpec } from '@/lib/signal-intent/types'
import { readPage } from '@/lib/research/tools'
import { searchWeb } from '@/lib/research/tools'

function readString(lead: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = lead[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function siteUrl(lead: Record<string, unknown>): string {
  const raw = readString(lead, ['sito', 'website', 'url'])
  if (!raw || raw === 'N/D') return ''
  return raw.startsWith('http') ? raw : `https://${raw}`
}

function auditSnippet(lead: Record<string, unknown>): string {
  const parts: string[] = []
  if (lead.meta_pixel === true) parts.push('Meta Pixel presente')
  if (lead.meta_pixel === false) parts.push('Meta Pixel assente')
  if (lead.google_tag_manager === true) parts.push('GTM presente')
  if (lead.ssl === false) parts.push('SSL assente')
  const tr = lead.technical_report
  if (tr && typeof tr === 'object') {
    const t = tr as Record<string, unknown>
    if (t.seo_disaster === true) parts.push('Errori SEO')
    if (t.has_google_ads === true) parts.push('Google Ads rilevato')
  }
  return parts.join('; ')
}

const CAREER_PATHS = ['/careers', '/jobs', '/lavora-con-noi', '/lavora-con-noi/', '/join-us', '/carriere', '/work-with-us']

export async function gatherLeadContext(
  lead: Record<string, unknown>,
  userQuery: string,
  intent: SignalIntentSpec,
): Promise<string> {
  const name = readString(lead, ['azienda', 'nome', 'name', 'company'])
  const city = readString(lead, ['citta', 'city', 'localita'])
  const category = readString(lead, ['categoria', 'category'])
  const url = siteUrl(lead)
  const blocks: string[] = [
    `Azienda: ${name || 'N/D'}`,
    city ? `Città: ${city}` : '',
    category ? `Categoria Maps: ${category}` : '',
    url ? `Sito: ${url}` : 'Sito: non disponibile',
    auditSnippet(lead) ? `Audit sito: ${auditSnippet(lead)}` : '',
  ].filter(Boolean)

  const textChunks: string[] = []
  if (url) {
    const home = await readPage({ url })
    if (home.ok && home.data && typeof home.data === 'object') {
      const excerpt = String((home.data as Record<string, unknown>).excerpt || '').slice(0, 3500)
      if (excerpt) textChunks.push(`[Homepage]\n${excerpt}`)
    }
    for (const path of CAREER_PATHS.slice(0, 3)) {
      try {
        const base = new URL(url)
        const careersUrl = `${base.origin}${path}`
        const page = await readPage({ url: careersUrl })
        if (page.ok && page.data && typeof page.data === 'object') {
          const ex = String((page.data as Record<string, unknown>).excerpt || '').slice(0, 2500)
          if (ex.length > 80) {
            textChunks.push(`[${path}]\n${ex}`)
            break
          }
        }
      } catch {
        /* ignore invalid url */
      }
    }
  }

  const searchQ = [
    `"${name}"`,
    city,
    intent.hiring_roles.join(' '),
    intent.sector_keywords.join(' '),
    userQuery.slice(0, 80),
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 200)

  const web = await searchWeb({ query: searchQ, max_results: 4 })
  if (web.ok && Array.isArray(web.data)) {
    for (const hit of web.data.slice(0, 4)) {
      if (hit && typeof hit === 'object') {
        const h = hit as Record<string, unknown>
        blocks.push(`[Web] ${h.title}: ${h.snippet} (${h.url})`)
      }
    }
  }

  if (textChunks.length) blocks.push('\n--- Contenuto sito ---\n' + textChunks.join('\n\n'))

  return blocks.join('\n')
}
