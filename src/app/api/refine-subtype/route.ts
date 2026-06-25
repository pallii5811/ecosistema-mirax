import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import {
  detectSubtypeIntent,
  classifyTextBySubtype,
  type SubtypeIntent,
  type SubtypeVerdict,
} from '@/lib/subtypeRefinement'

export const maxDuration = 60

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Limiti di sicurezza per non bloccare la UI né sovraccaricare il server.
const MAX_LEADS_TO_FETCH = 120
const CONCURRENCY = 8
const FETCH_TIMEOUT_MS = 6000
const OVERALL_BUDGET_MS = 48000
const MAX_INTERNAL_PAGES = 2

// Parole nei link/URL che suggeriscono pagine con la descrizione dei servizi/settori.
const INTERNAL_HINTS = [
  'servizi', 'settori', 'settore', 'refrigeraz', 'industrial', 'commercial',
  'chi-siamo', 'chisiamo', 'azienda', 'prodotti', 'soluzioni', 'about', 'attivita',
]

function normalizeUrl(raw: string): string | null {
  const s = (raw || '').trim()
  if (!s || s === 'N/D' || s === 'N/A' || s === 'N.D.') return null
  try {
    const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
    const u = new URL(withScheme)
    if (!u.hostname.includes('.')) return null
    return u.toString()
  } catch {
    return null
  }
}

async function fetchHtml(url: string, ms: number): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(ms),
      redirect: 'follow',
    })
    if (!res.ok) return ''
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return ''
    return await res.text()
  } catch {
    return ''
  }
}

/** Estrae testo significativo: title, meta description, og, alt, e testo del body. */
function extractText(html: string): string {
  if (!html) return ''
  let text = ''
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  if (title) text += ' ' + title
  const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1]
  if (metaDesc) text += ' ' + metaDesc
  const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1]
  if (ogDesc) text += ' ' + ogDesc
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1]
  if (ogTitle) text += ' ' + ogTitle
  // alt delle immagini (spesso contengono "cella frigorifera", ecc.)
  for (const m of html.matchAll(/alt=["']([^"']+)["']/gi)) text += ' ' + m[1]

  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/gi, ' ')
  text += ' ' + body
  return text.replace(/\s+/g, ' ').slice(0, 60000)
}

/** Trova fino a N link interni promettenti (stesso dominio). */
function findInternalLinks(html: string, baseUrl: string, limit: number): string[] {
  const out: string[] = []
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    return out
  }
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (out.length >= limit) break
    const href = m[1]
    const anchor = (m[2] || '').replace(/<[^>]+>/g, ' ').toLowerCase()
    const hrefLower = href.toLowerCase()
    const looksRelevant = INTERNAL_HINTS.some((h) => hrefLower.includes(h) || anchor.includes(h))
    if (!looksRelevant) continue
    try {
      const u = new URL(href, base)
      if (u.hostname !== base.hostname) continue
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
      const full = u.toString()
      if (full === baseUrl) continue
      if (!out.includes(full)) out.push(full)
    } catch {
      // ignore malformed href
    }
  }
  return out
}

function getWebsite(lead: unknown): string | null {
  const l = (lead && typeof lead === 'object' ? lead : {}) as Record<string, unknown>
  const candidates = [l.sito, l.website, l.url, l.web]
  for (const c of candidates) {
    if (typeof c === 'string') {
      const u = normalizeUrl(c)
      if (u) return u
    }
  }
  return null
}

function leadName(lead: unknown): string {
  const l = (lead && typeof lead === 'object' ? lead : {}) as Record<string, unknown>
  const n = l.nome ?? l.azienda ?? l.name ?? l.business_name
  return typeof n === 'string' ? n : ''
}

/** Classifica un singolo lead leggendone il sito (home + eventuali pagine interne). */
async function classifyLead(
  lead: unknown,
  intent: SubtypeIntent,
  deadline: number,
): Promise<{ verdict: SubtypeVerdict; reason: string }> {
  const site = getWebsite(lead)
  if (!site) return { verdict: 'unknown', reason: 'no_website' }
  if (Date.now() > deadline) return { verdict: 'unknown', reason: 'timeout' }

  const homeHtml = await fetchHtml(site, FETCH_TIMEOUT_MS)
  if (!homeHtml) return { verdict: 'unknown', reason: 'fetch_failed' }

  let combinedText = extractText(homeHtml)
  let cls = classifyTextBySubtype(combinedText, intent)
  if (cls.verdict === 'match') {
    return { verdict: 'match', reason: cls.matchedPositives.slice(0, 3).join(', ') }
  }

  // Home inconcludente o opposta: prova alcune pagine interne pertinenti.
  if (Date.now() < deadline) {
    const internal = findInternalLinks(homeHtml, site, MAX_INTERNAL_PAGES)
    for (const link of internal) {
      if (Date.now() > deadline) break
      const html = await fetchHtml(link, FETCH_TIMEOUT_MS)
      if (!html) continue
      combinedText += ' ' + extractText(html)
      cls = classifyTextBySubtype(combinedText, intent)
      if (cls.verdict === 'match') {
        return { verdict: 'match', reason: cls.matchedPositives.slice(0, 3).join(', ') }
      }
    }
  }

  if (cls.verdict === 'opposite') {
    return { verdict: 'opposite', reason: cls.matchedNegatives.slice(0, 3).join(', ') }
  }
  return { verdict: 'unknown', reason: 'no_signal' }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { query?: unknown; leads?: unknown }
  const query = typeof body.query === 'string' ? body.query : ''
  const leads = Array.isArray(body.leads) ? body.leads : []

  const intent = detectSubtypeIntent(query)

  // Nessun qualificatore riconosciuto → no-op assoluto: ritorna i lead invariati.
  if (!intent) {
    return NextResponse.json({ refined: false, intent: null, leads, removed: 0 })
  }
  if (leads.length === 0) {
    return NextResponse.json({ refined: true, intent: intent.label, leads: [], removed: 0 })
  }

  // Intent verificato non-null: const tipizzata per preservare il narrowing nelle closure.
  const activeIntent: SubtypeIntent = intent

  const deadline = Date.now() + OVERALL_BUDGET_MS
  const toEvaluate = leads.slice(0, MAX_LEADS_TO_FETCH)
  const overflow = leads.slice(MAX_LEADS_TO_FETCH) // oltre il limite: tenuti per non perdere dati

  const verdicts: SubtypeVerdict[] = new Array(toEvaluate.length).fill('unknown')
  const reasons: string[] = new Array(toEvaluate.length).fill('')

  console.log(`[refine-subtype] intent="${activeIntent.label}" query="${query}" leads=${leads.length} evaluating=${toEvaluate.length}`)

  // Worker pool a concorrenza limitata.
  let cursor = 0
  async function worker() {
    while (true) {
      const i = cursor++
      if (i >= toEvaluate.length) break
      const { verdict, reason } = await classifyLead(toEvaluate[i], activeIntent, deadline)
      verdicts[i] = verdict
      reasons[i] = reason
    }
  }
  const workers = Array.from({ length: Math.min(CONCURRENCY, toEvaluate.length) }, () => worker())
  await Promise.all(workers)

  // Policy: precisione richiesta dall'utente → tieni SOLO chi conferma sul sito ('match').
  const kept: unknown[] = []
  let removed = 0
  for (let i = 0; i < toEvaluate.length; i++) {
    const verb = verdicts[i] === 'match' ? 'KEEP ' : 'DROP '
    console.log(`[refine-subtype] ${verb} [${verdicts[i]}] ${leadName(toEvaluate[i]) || '(senza nome)'} — ${reasons[i]}`)
    if (verdicts[i] === 'match') kept.push(toEvaluate[i])
    else removed += 1
  }

  console.log(`[refine-subtype] DONE kept=${kept.length} removed=${removed} overflow_kept=${overflow.length}`)

  return NextResponse.json({
    refined: true,
    intent: intent.label,
    leads: [...kept, ...overflow],
    removed,
    evaluated: toEvaluate.length,
  })
}
