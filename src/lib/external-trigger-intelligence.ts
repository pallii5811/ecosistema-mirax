export type ExternalSearchResult = {
  title: string
  url: string
  snippet: string
  query: string
}

export type DecisionMakerSignal = {
  name: string | null
  role: string
  linkedinUrl: string | null
  sourceUrl: string
  evidence: string
  confidence: number
}

export type BuyingTriggerSignal = {
  type: 'hiring' | 'event' | 'tender' | 'expansion' | 'linkedin' | 'news'
  title: string
  sourceUrl: string
  evidence: string
  confidence: number
  suggestedOffer: string
}

export type ExternalIntelligence = {
  companyName: string
  website: string
  city: string
  decisionMakers: DecisionMakerSignal[]
  buyingTriggers: BuyingTriggerSignal[]
  linkedinResults: ExternalSearchResult[]
  hiringSignals: ExternalSearchResult[]
  tenderSignals: ExternalSearchResult[]
  newsSignals: ExternalSearchResult[]
  sources: string[]
  analyzedAt: string
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
}

function decodeHtml(value: string) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;|&#160;/g, ' ')
}

function stripHtml(value: string) {
  return decodeHtml(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim())
}

function normalizeText(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanCompanyName(value: string) {
  return String(value || '')
    .replace(/\b(s\.?r\.?l\.?s?|srls|srl|s\.?p\.?a\.?|spa|s\.?n\.?c\.?|snc|s\.?a\.?s\.?|sas|societa|società|cooperativa|coop)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function companyTokens(companyName: string) {
  return normalizeText(cleanCompanyName(companyName))
    .split(' ')
    .filter((token) => token.length >= 3 && !['italia', 'group', 'azienda', 'societa'].includes(token))
}

function leadHost(website: string) {
  try {
    const target = website.startsWith('http') ? website : `https://${website}`
    return new URL(target).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function decodeSearchHref(href: string) {
  try {
    let out = decodeHtml(decodeURIComponent(String(href || '')))
    if (out.startsWith('/url?')) out = new URL(`https://www.google.com${out}`).searchParams.get('q') || out
    if (out.startsWith('/l/?')) out = new URL(`https://duckduckgo.com${out}`).searchParams.get('uddg') || out
    if (out.includes('duckduckgo.com/l/?')) out = new URL(out).searchParams.get('uddg') || out
    return out.split('#')[0]
  } catch {
    return href
  }
}

function isBlockedResult(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return ['google.', 'gstatic.', 'bing.com', 'duckduckgo.com', 'youtube.com', 'youtu.be', 'facebook.com/sharer'].some((blocked) => host.includes(blocked))
  } catch {
    return true
  }
}

function resultMatchesCompany(result: ExternalSearchResult, companyName: string, website: string) {
  const blob = normalizeText(`${result.title} ${result.snippet} ${result.url}`)
  const tokens = companyTokens(companyName)
  const matched = tokens.filter((token) => blob.includes(token)).length
  const host = leadHost(website)
  const domainToken = host.split('.')[0]
  if (domainToken && domainToken.length >= 4 && blob.includes(normalizeText(domainToken))) return true
  return tokens.length > 0 && matched >= Math.min(2, tokens.length)
}

async function fetchHtml(url: string, timeoutMs = 8000) {
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
    if (!res.ok) return ''
    const text = await res.text()
    return text.slice(0, 500000)
  } catch {
    return ''
  }
}

function extractResultsFromHtml(html: string, query: string, maxResults: number) {
  const out: ExternalSearchResult[] = []
  const seen = new Set<string>()
  for (const match of String(html || '').matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = decodeSearchHref(match[1])
    if (!/^https?:\/\//i.test(url)) continue
    if (isBlockedResult(url)) continue
    let host = ''
    try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { continue }
    if (seen.has(host)) continue
    const title = stripHtml(match[2]).slice(0, 180)
    if (title.length < 4) continue
    const index = match.index || 0
    const context = stripHtml(html.slice(Math.max(0, index - 250), Math.min(html.length, index + 700))).slice(0, 500)
    seen.add(host)
    out.push({ title, url, snippet: context, query })
    if (out.length >= maxResults) break
  }
  return out
}

async function searchPublicWeb(query: string, maxResults = 6) {
  const urls = [
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=it-IT&cc=IT&count=${maxResults}`,
    `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
  ]
  const pages = await Promise.allSettled(urls.map((url) => fetchHtml(url)))
  const results: ExternalSearchResult[] = []
  const seen = new Set<string>()
  for (const page of pages) {
    if (page.status !== 'fulfilled' || !page.value) continue
    for (const result of extractResultsFromHtml(page.value, query, maxResults)) {
      const key = result.url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')
      if (seen.has(key)) continue
      seen.add(key)
      results.push(result)
      if (results.length >= maxResults) return results
    }
  }
  return results
}

function inferRole(text: string) {
  const t = normalizeText(text)
  const roles = [
    ['CEO / Amministratore', /\b(ceo|chief executive|amministratore|amministratrice|amministratore delegato|legale rappresentante)\b/],
    ['Titolare / Founder', /\b(titolare|fondatore|fondatrice|founder|co founder|owner|proprietario|socio|socia)\b/],
    ['Responsabile Commerciale', /\b(responsabile commerciale|direttore commerciale|sales manager|business development)\b/],
    ['Responsabile Marketing', /\b(marketing manager|responsabile marketing|communication manager|comunicazione|social media manager)\b/],
  ] as const
  for (const [label, re] of roles) if (re.test(t)) return label
  return ''
}

function extractPersonName(result: ExternalSearchResult, companyName: string) {
  const text = stripHtml(`${result.title} ${result.snippet}`)
  const companyClean = cleanCompanyName(companyName)
  const withoutCompany = text.replace(new RegExp(companyClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ')
  const linkedinName = result.url.includes('linkedin.com/in/') ? result.title.split(/[-–|]/)[0]?.trim() : ''
  const candidate = linkedinName || withoutCompany.match(/\b([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ']{2,}\s+[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ']{2,}(?:\s+[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ']{2,})?)\b/)?.[1] || ''
  if (!candidate) return null
  if (/\b(srl|spa|snc|sas|societa|azienda|linkedin|italia|home|news|contatti|privacy)\b/i.test(candidate)) return null
  return candidate.trim()
}

function decisionMakersFromResults(results: ExternalSearchResult[], companyName: string, website: string) {
  const out: DecisionMakerSignal[] = []
  const seen = new Set<string>()
  for (const result of results) {
    if (!resultMatchesCompany(result, companyName, website)) continue
    const evidence = `${result.title} ${result.snippet}`.slice(0, 500)
    const role = inferRole(evidence)
    if (!role && !result.url.includes('linkedin.com/in/')) continue
    const name = extractPersonName(result, companyName)
    const key = `${name || ''}:${role}:${result.url}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      name,
      role: role || 'Profilo LinkedIn potenzialmente rilevante',
      linkedinUrl: result.url.includes('linkedin.com/in/') ? result.url.split('?')[0] : null,
      sourceUrl: result.url,
      evidence: stripHtml(evidence),
      confidence: result.url.includes('linkedin.com/in/') && name ? 0.78 : role && name ? 0.68 : 0.52,
    })
  }
  return out.slice(0, 5)
}

function triggerFromResult(result: ExternalSearchResult, companyName: string, website: string): BuyingTriggerSignal | null {
  if (!resultMatchesCompany(result, companyName, website)) return null
  const evidence = stripHtml(`${result.title} ${result.snippet}`).slice(0, 500)
  const text = normalizeText(evidence)
  if (/\b(lavora con noi|posizioni aperte|assume|assunzioni|cerchiamo|job|careers|hiring|seleziona personale)\b/.test(text)) {
    return { type: 'hiring', title: 'Segnale hiring / crescita team', sourceUrl: result.url, evidence, confidence: 0.78, suggestedOffer: 'Lead generation, employer branding, campagne recruiting e contenuti LinkedIn' }
  }
  if (/\b(bando|gara|appalto|finanziamento|contributo|pnrr|voucher|agevolazione)\b/.test(text)) {
    return { type: 'tender', title: 'Bando/gara/finanziamento rilevato', sourceUrl: result.url, evidence, confidence: 0.72, suggestedOffer: 'Comunicazione istituzionale, landing page, campagne per progetto o nuova offerta' }
  }
  if (/\b(fiera|evento|expo|salone|manifestazione|convegno|open day)\b/.test(text)) {
    return { type: 'event', title: 'Evento/fiera in corso o recente', sourceUrl: result.url, evidence, confidence: 0.7, suggestedOffer: 'Campagne pre/post evento, contenuti social, video, lead capture e follow-up' }
  }
  if (/\b(nuova sede|apertura|inaugurazione|espansione|ampliamento|partnership|nuovo stabilimento|nuovo showroom)\b/.test(text)) {
    return { type: 'expansion', title: 'Espansione/nuova sede/partnership', sourceUrl: result.url, evidence, confidence: 0.74, suggestedOffer: 'Campagne locali, PR, Google Ads, social launch e materiali commerciali' }
  }
  if (/\b(lancio|nuovo prodotto|nuovo servizio|catalogo|certificazione|premio)\b/.test(text)) {
    return { type: 'news', title: 'Novità aziendale o prodotto/servizio', sourceUrl: result.url, evidence, confidence: 0.66, suggestedOffer: 'PR, contenuti, landing page, campagne awareness e remarketing' }
  }
  return null
}

function uniqueTriggers(results: ExternalSearchResult[], companyName: string, website: string) {
  const out: BuyingTriggerSignal[] = []
  const seen = new Set<string>()
  for (const result of results) {
    const trigger = triggerFromResult(result, companyName, website)
    if (!trigger) continue
    const key = `${trigger.type}:${trigger.sourceUrl}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trigger)
  }
  return out.slice(0, 8)
}

export async function analyzeExternalIntelligence(params: { companyName: string; website?: string; city?: string }): Promise<ExternalIntelligence> {
  const companyName = String(params.companyName || '').trim()
  const website = String(params.website || '').trim()
  const city = String(params.city || '').trim()
  if (!companyName) {
    return { companyName, website, city, decisionMakers: [], buyingTriggers: [], linkedinResults: [], hiringSignals: [], tenderSignals: [], newsSignals: [], sources: [], analyzedAt: new Date().toISOString() }
  }

  const queryCity = city ? ` ${city}` : ''
  const queries = {
    linkedin: `"${companyName}"${queryCity} site:linkedin.com/in OR site:linkedin.com/company`,
    decision: `"${companyName}"${queryCity} titolare OR amministratore OR founder OR "responsabile commerciale" OR "responsabile marketing"`,
    hiring: `"${companyName}"${queryCity} "lavora con noi" OR assunzioni OR "posizioni aperte" OR hiring`,
    tenders: `"${companyName}"${queryCity} bando OR gara OR appalto OR finanziamento OR contributo`,
    news: `"${companyName}"${queryCity} fiera OR evento OR "nuova sede" OR apertura OR partnership OR "nuovo prodotto"`,
  }

  const [linkedin, decision, hiring, tenders, news] = await Promise.all([
    searchPublicWeb(queries.linkedin, 8),
    searchPublicWeb(queries.decision, 8),
    searchPublicWeb(queries.hiring, 8),
    searchPublicWeb(queries.tenders, 8),
    searchPublicWeb(queries.news, 8),
  ])

  const decisionMakers = decisionMakersFromResults([...linkedin, ...decision], companyName, website)
  const triggerInputs = [...hiring, ...tenders, ...news]
  const buyingTriggers = uniqueTriggers(triggerInputs, companyName, website)
  const sources = Array.from(new Set([...linkedin, ...decision, ...triggerInputs].map((result) => result.url))).slice(0, 30)

  return {
    companyName,
    website,
    city,
    decisionMakers,
    buyingTriggers,
    linkedinResults: linkedin.filter((result) => resultMatchesCompany(result, companyName, website)).slice(0, 5),
    hiringSignals: hiring.filter((result) => resultMatchesCompany(result, companyName, website)).slice(0, 5),
    tenderSignals: tenders.filter((result) => resultMatchesCompany(result, companyName, website)).slice(0, 5),
    newsSignals: news.filter((result) => resultMatchesCompany(result, companyName, website)).slice(0, 5),
    sources,
    analyzedAt: new Date().toISOString(),
  }
}
