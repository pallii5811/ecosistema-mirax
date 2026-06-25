import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { cleanPiva, enrichCompanyByPiva, searchByCompanyName, type OpenApiEnrichedCompany, type OpenApiSearchHit } from '@/lib/openapi-service'

type UnlockType = 'company' | 'owner'

type UnlockBody = {
  type?: UnlockType
  lead?: Record<string, unknown>
}

const CREDIT_COST: Record<UnlockType, number> = {
  company: 15,
  owner: 4,
}

const COMPANY_FORM_RE = /\b(s\.?r\.?l\.?s?|srls|srl|s\.?p\.?a\.?|spa|s\.?n\.?c\.?|snc|s\.?a\.?s\.?|sas|societa|cooperativa|coop|consorzio|scarl|scrl)\b/i
const COMPANY_LEGAL_FORM_RE = /\b(societa|responsabilita\s+limitata|azioni|nome\s+collettivo|accomandita|cooperativa|consorzio|s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?)\b/i
const INDIVIDUAL_LEGAL_FORM_RE = /\b(ditta\s+individuale|impresa\s+individuale|lavoratore\s+autonomo|libero\s+professionista|persona\s+fisica|professionista|individuale)\b/i
const PROFESSIONAL_RE = /\b(avv\.?|avvocato|dott\.?|dottore|dr\.?|ing\.?|ingegnere|arch\.?|architetto|geom\.?|geometra|commercialista|consulente|medico|dentista|odontoiatra|psicologo|fisioterapista|notaio|studio)\b/i

function pickString(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(srls?|spa|snc|sas|societa|societa|cooperativa|coop|consorzio|scarl|scrl|di|del|della|dei|le|la|il|lo|gli|sede|azienda)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isValidItalianVat(value: string) {
  const piva = cleanPiva(value)
  if (!/^\d{11}$/.test(piva)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) {
    let n = Number(piva[i])
    if (i % 2 === 1) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
  }
  return (10 - (sum % 10)) % 10 === Number(piva[10])
}

function pushPivaCandidate(values: string[], raw: string | undefined, requireChecksum = true) {
  const piva = cleanPiva(raw || '')
  if (piva.length === 11 && (!requireChecksum || isValidItalianVat(piva)) && !values.includes(piva)) values.push(piva)
}

function extractPivaCandidatesFromText(value: string, allowGeneric = false) {
  const text = String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
  const candidates: string[] = []
  const labeled = /(?:p\.?\s*iva|partita\s+iva|vat(?:\s*(?:number|no|n))?|codice\s+fiscale|cod\.?\s*fisc\.?|c\.?\s*f\.?)\D{0,80}(?:IT\s*)?([\d\s.\-\/]{11,22})/gi
  const trailingLabel = /(?:IT\s*)?([\d\s.\-\/]{11,22})\D{0,40}(?:p\.?\s*iva|partita\s+iva|vat|codice\s+fiscale|cod\.?\s*fisc\.?|c\.?\s*f\.?)/gi
  for (const match of text.matchAll(labeled)) pushPivaCandidate(candidates, match[1], false)
  for (const match of text.matchAll(trailingLabel)) pushPivaCandidate(candidates, match[1], false)
  if (allowGeneric) {
    const generic = /\b(?:IT\s*)?(\d{11})\b/gi
    for (const match of text.matchAll(generic)) pushPivaCandidate(candidates, match[1])
  }
  return candidates
}

function extractPivaFromText(value: string, allowGeneric = false) {
  return extractPivaCandidatesFromText(value, allowGeneric)[0] || ''
}

function extractPivaFromLead(lead: Record<string, unknown>) {
  const direct = pickString(lead, ['partita_iva', 'partitaIva', 'piva', 'vatCode', 'vat', 'codice_fiscale'])
  const cleanedDirect = cleanPiva(direct)
  if (cleanedDirect.length === 11) return cleanedDirect
  const candidates = [
    pickString(lead, ['raw_text', 'description', 'descrizione']),
    JSON.stringify(lead).slice(0, 20000),
  ]
  for (const candidate of candidates) {
    const piva = extractPivaFromText(candidate, true)
    if (piva) return piva
  }
  return ''
}

function hasCompanyEvidenceText(value: string) {
  const text = String(value || '')
  return COMPANY_FORM_RE.test(text) ||
    COMPANY_LEGAL_FORM_RE.test(text)
}

function hasIndividualSignal(value: string) {
  const text = String(value || '')
  return INDIVIDUAL_LEGAL_FORM_RE.test(text) ||
    (PROFESSIONAL_RE.test(text) && !hasCompanyEvidenceText(text)) ||
    /\b(?:di|del|della)\s+[a-zÃ -Ã¿']{2,}\s+[a-zÃ -Ã¿']{2,}\b/i.test(text)
}

async function fetchHtmlSafe(url: string) {
  try {
    const target = url.startsWith('http') ? url : `https://${url}`
    const res = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(7000),
    })
    if (!res.ok) return ''
    const html = await res.text()
    return html.slice(0, 300000)
  } catch {
    return ''
  }
}

async function fetchHtmlWithProtocolFallback(url: string) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  if (raw.startsWith('https://')) {
    const httpsHtml = await fetchHtmlSafe(raw)
    if (httpsHtml) return httpsHtml
    return fetchHtmlSafe(raw.replace(/^https:\/\//i, 'http://'))
  }
  if (raw.startsWith('http://')) {
    const httpHtml = await fetchHtmlSafe(raw)
    if (httpHtml) return httpHtml
    return fetchHtmlSafe(raw.replace(/^http:\/\//i, 'https://'))
  }
  const httpsHtml = await fetchHtmlSafe(`https://${raw}`)
  if (httpsHtml) return httpsHtml
  return fetchHtmlSafe(`http://${raw}`)
}

function pushUnique(values: string[], value: string) {
  if (value && !values.includes(value)) values.push(value)
}

function decodeHtmlEntities(value: string) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;|&#160;/g, ' ')
}

function stripHtml(value: string) {
  return decodeHtmlEntities(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim())
}

function extractRelevantSameOriginLinks(html: string, origin: string) {
  const links: string[] = []
  const linkRe = /href\s*=\s*["']([^"']+)["']/gi
  const relevantRe = /(contatti|contact|privacy|cookie|legali|legal|termini|azienda|chi-siamo|about|dove_siamo)/i
  for (const match of html.matchAll(linkRe)) {
    const href = String(match[1] || '').trim()
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue
    try {
      const parsed = new URL(href, origin)
      if (parsed.origin !== origin) continue
      const haystack = `${parsed.pathname} ${href}`
      if (!relevantRe.test(haystack)) continue
      pushUnique(links, parsed.href)
    } catch {}
  }
  return links.slice(0, 20)
}

async function extractPivaFromWebsite(website: string) {
  if (!website) return { piva: '', hasCompanyEvidence: false }
  const cleanWebsite = String(website || '').trim()
  const base = cleanWebsite.startsWith('http') ? cleanWebsite : `https://${cleanWebsite}`
  const httpBase = cleanWebsite.startsWith('http') ? cleanWebsite : `http://${cleanWebsite}`
  let origin = base
  let httpOrigin = httpBase
  try { origin = new URL(base).origin } catch {}
  try { httpOrigin = new URL(httpBase).origin } catch {}
  const pages = [
    base,
    httpBase,
    `${origin}/contatti`,
    `${httpOrigin}/contatti`,
    `${origin}/contatti.php`,
    `${httpOrigin}/contatti.php`,
    `${origin}/contatti.php`,
    `${httpOrigin}/contatti.php`,
    `${origin}/contact`,
    `${origin}/contact.php`,
    `${origin}/contact.php`,
    `${origin}/chi-siamo`,
    `${origin}/chi-siamo.php`,
    `${origin}/chi-siamo.php`,
    `${origin}/azienda`,
    `${origin}/azienda.php`,
    `${origin}/azienda.php`,
    `${origin}/about`,
    `${origin}/about.php`,
    `${origin}/about.php`,
    `${origin}/about-us`,
    `${origin}/about-us.php`,
    `${origin}/about-us.php`,
    `${origin}/privacy`,
    `${origin}/privacy.php`,
    `${origin}/privacy.php`,
    `${origin}/privacy-policy`,
    `${origin}/privacy-policy.php`,
    `${origin}/privacy-policy.php`,
    `${origin}/cookie-policy`,
    `${origin}/cookie-policy.php`,
    `${origin}/cookie-policy.php`,
    `${origin}/note-legali`,
    `${origin}/note-legali.php`,
    `${origin}/note-legali.php`,
    `${origin}/legal`,
    `${origin}/legal.php`,
    `${origin}/legal.php`,
    `${origin}/termini-e-condizioni`,
    `${origin}/termini-e-condizioni.php`,
    `${origin}/termini-e-condizioni.php`,
  ]
  const genericCandidates: string[] = []
  let hasCompanyEvidence = false
  const visited = new Set<string>()
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    if (visited.has(page)) continue
    visited.add(page)
    const html = await fetchHtmlWithProtocolFallback(page)
    if (!html) continue
    if (hasCompanyEvidenceText(html)) hasCompanyEvidence = true
    const labeled = extractPivaFromText(html)
    if (labeled) return { piva: labeled, hasCompanyEvidence: hasCompanyEvidenceText(html) }
    for (const piva of extractPivaCandidatesFromText(html, true)) {
      if (!genericCandidates.includes(piva)) genericCandidates.push(piva)
    }
    let pageOrigin = origin
    try { pageOrigin = new URL(page).origin } catch {}
    for (const link of extractRelevantSameOriginLinks(html, pageOrigin)) {
      if (pages.length >= 50) break
      pushUnique(pages, link)
    }
  }
  return { piva: genericCandidates.length === 1 ? genericCandidates[0] : '', hasCompanyEvidence }
}

function decodeSearchHref(href: string) {
  try {
    let out = decodeHtmlEntities(decodeURIComponent(String(href || '')))
    if (out.startsWith('/url?')) out = new URL(`https://www.google.com${out}`).searchParams.get('q') || out
    if (out.startsWith('/l/?')) out = new URL(`https://duckduckgo.com${out}`).searchParams.get('uddg') || out
    if (out.includes('duckduckgo.com/l/?')) out = new URL(out).searchParams.get('uddg') || out
    if (out.startsWith('/ck/a?')) out = `https://www.bing.com${out}`
    if (out.includes('bing.com/ck/a?')) {
      const raw = new URL(out).searchParams.get('u') || ''
      if (raw.startsWith('http')) out = raw
      else if (raw.startsWith('a1')) out = Buffer.from(raw.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    }
    return out.split('#')[0]
  } catch {
    return href
  }
}

function publicPivaSourceAllowed(url: string, ownHost: string) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    if (ownHost && host === ownHost) return true
    return [
      'companyreports.it',
      'ufficiocamerale.it',
      'registroaziende.it',
      'informazione-aziende.it',
      'fatturatoitalia.it',
      'reportaziende.it',
      'aziende.it',
      'impresaitalia.info',
      'guidamonaci.it',
      'pmi.it',
      'visura.pro',
    ].some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
  } catch {
    return false
  }
}

function extractSearchResultUrls(html: string, ownHost: string) {
  const urls: string[] = []
  for (const match of String(html || '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = decodeSearchHref(match[1])
    if (!/^https?:\/\//i.test(href)) continue
    if (!publicPivaSourceAllowed(href, ownHost)) continue
    pushUnique(urls, href)
    if (urls.length >= 12) break
  }
  return urls
}

function leadDomainHost(website: string) {
  try {
    const target = website.startsWith('http') ? website : `https://${website}`
    return new URL(target).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function usefulNameTokens(name: string) {
  return normalizeText(name)
    .split(' ')
    .filter((token) => token.length >= 3 && !['srl', 'spa', 'snc', 'sas', 'societa', 'azienda', 'italia', 'group'].includes(token))
}

function publicPivaEvidenceScore(piva: string, text: string, sourceUrl: string, companyName: string, city: string, website: string) {
  if (!isValidItalianVat(piva)) return 0
  const blob = normalizeText(`${text} ${sourceUrl}`)
  const tokens = usefulNameTokens(companyName)
  const matchedTokens = tokens.filter((token) => blob.includes(token)).length
  if (tokens.length > 0 && matchedTokens < Math.min(2, tokens.length)) return 0
  const cityNorm = normalizeText(city)
  const cityMatch = Boolean(cityNorm && blob.includes(cityNorm))
  const ownHost = leadDomainHost(website)
  const domainTokens = ownHost.split('.')[0]?.split(/[-_]/).filter((token) => token.length >= 4) || []
  const domainMatch = domainTokens.some((token) => blob.includes(normalizeText(token)))
  const hasVatLabel = /p\.?\s*iva|partita\s+iva|vat|codice\s+fiscale|c\.?\s*f\.?/i.test(text)
  const allowedSource = publicPivaSourceAllowed(sourceUrl, ownHost)
  const strongLegalNameEvidence = COMPANY_FORM_RE.test(companyName) && hasVatLabel && allowedSource && matchedTokens >= 1
  if (tokens.length <= 1 && !cityMatch && !domainMatch && !strongLegalNameEvidence) return 0
  let score = matchedTokens * 2
  if (cityMatch) score += 2
  if (domainMatch) score += 2
  if (hasCompanyEvidenceText(text)) score += 2
  if (hasVatLabel) score += 2
  if (allowedSource) score += 1
  if (strongLegalNameEvidence) score += 1
  return score
}

async function resolvePivaFromPublicSources(companyName: string, city: string, website: string) {
  const ownHost = leadDomainHost(website)
  const queries = [
    `"${companyName}" "${city}" "partita iva"`,
    `"${companyName}" "partita iva"`,
    `"${companyName}" "codice fiscale" "partita iva"`,
    ownHost ? `"${companyName}" "${ownHost}" "partita iva"` : '',
    `site:ufficiocamerale.it "${companyName}" "${city}"`,
    `site:companyreports.it "${companyName}" "${city}"`,
  ].filter(Boolean).slice(0, 6)
  const searchUrls = queries.flatMap((query) => [
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=it-IT&cc=IT&count=8`,
    `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
  ])
  const candidates: Array<{ piva: string; sourceUrl: string; score: number }> = []
  const collect = (text: string, sourceUrl: string) => {
    const labeled = extractPivaCandidatesFromText(`${text} ${sourceUrl}`, publicPivaSourceAllowed(sourceUrl, ownHost))
    for (const piva of labeled) {
      const score = publicPivaEvidenceScore(piva, text, sourceUrl, companyName, city, website)
      if (score >= 5) candidates.push({ piva, sourceUrl, score })
    }
  }
  const searchPages = await Promise.allSettled(searchUrls.map((url) => fetchHtmlSafe(url)))
  const resultUrls: string[] = []
  for (let i = 0; i < searchPages.length; i++) {
    const page = searchPages[i]
    if (page.status !== 'fulfilled' || !page.value) continue
    collect(stripHtml(page.value).slice(0, 20000), searchUrls[i])
    for (const url of extractSearchResultUrls(page.value, ownHost)) pushUnique(resultUrls, url)
  }
  const pages = await Promise.allSettled(resultUrls.slice(0, 8).map((url) => fetchHtmlSafe(url)))
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    if (page.status !== 'fulfilled' || !page.value) continue
    collect(stripHtml(page.value).slice(0, 30000), resultUrls[i])
  }
  const aggregated = Array.from(
    candidates.reduce((map, candidate) => {
      const prev = map.get(candidate.piva)
      if (!prev) map.set(candidate.piva, { piva: candidate.piva, sourceUrl: candidate.sourceUrl, score: candidate.score })
      else map.set(candidate.piva, { ...prev, score: prev.score + candidate.score })
      return map
    }, new Map<string, { piva: string; sourceUrl: string; score: number }>())
  ).map(([, value]) => value).sort((a, b) => b.score - a.score)
  const best = aggregated[0]
  if (!best) return { piva: '', sourceUrl: '', score: 0 }
  const second = aggregated[1]
  if (second && second.score >= best.score * 0.75) return { piva: '', sourceUrl: '', score: 0 }
  return best
}

function isLikelyCompanyName(name: string) {
  const n = name.trim()
  if (!n) return false
  if (COMPANY_FORM_RE.test(n)) return true
  if (PROFESSIONAL_RE.test(n) && !COMPANY_FORM_RE.test(n)) return false
  const words = normalizeText(n).split(' ').filter(Boolean)
  return words.length >= 2 && !/^[a-z]+\s+[a-z]+$/i.test(n)
}

function companyHitMatchesLead(hit: OpenApiSearchHit, companyName: string, city: string) {
  const hitName = normalizeText(hit.ragione_sociale)
  const leadName = normalizeText(companyName)
  if (!hitName || !leadName) return false
  const leadTokens = leadName.split(' ').filter((t) => t.length >= 3)
  const matchedTokens = leadTokens.filter((t) => hitName.includes(t)).length
  const nameOk = hitName.includes(leadName) || leadName.includes(hitName) || matchedTokens >= Math.min(2, leadTokens.length)
  if (!nameOk) return false
  if (city.trim()) {
    const cityNorm = normalizeText(city)
    const hitCity = normalizeText(`${hit.citta || ''} ${hit.indirizzo || ''}`)
    if (cityNorm && hitCity && !hitCity.includes(cityNorm)) return false
  }
  return true
}

function isOfficialCompanySearchHit(hit: OpenApiSearchHit) {
  const legalText = `${hit.ragione_sociale || ''} ${hit.forma_giuridica || ''}`
  if (INDIVIDUAL_LEGAL_FORM_RE.test(legalText)) return false
  return COMPANY_FORM_RE.test(legalText) || COMPANY_LEGAL_FORM_RE.test(legalText)
}

function companySearchQueries(companyName: string) {
  const original = companyName.trim()
  const simplified = original
    .replace(COMPANY_FORM_RE, ' ')
    .replace(/\b(societa|responsabilita\s+limitata|azioni)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(new Set([original, simplified].filter((value) => value.length >= 3))).slice(0, 2)
}

async function precheckWithItSearch(companyName: string, city: string, piva?: string) {
  if (!companyName.trim()) return { ok: false, reason: 'missing_company_name' }
  const cleanTargetPiva = cleanPiva(piva || '')
  let lastReason = 'search_failed'

  for (const query of companySearchQueries(companyName)) {
    const search = await searchByCompanyName(query)
    if (!search.success || !Array.isArray(search.data)) {
      lastReason = search.errorMessage || search.skipped || 'search_failed'
      continue
    }

    const matches = search.data.filter((hit) => {
      if (cleanTargetPiva) {
        if (hit.partita_iva !== cleanTargetPiva) return false
        if (city.trim()) return companyHitMatchesLead(hit, companyName, city)
        return true
      }
      return companyHitMatchesLead(hit, companyName, city)
    })
    const uniquePivas = Array.from(new Set(matches.map((hit) => hit.partita_iva).filter(Boolean)))
    if (uniquePivas.length > 1) return { ok: false, reason: 'ambiguous_match' }
    if (uniquePivas.length === 0) {
      lastReason = 'no_safe_match'
      continue
    }
    const match = matches.find((hit) => hit.partita_iva === uniquePivas[0])
    if (!match) {
      lastReason = 'no_safe_match'
      continue
    }
    if (!isOfficialCompanySearchHit(match)) return { ok: false, reason: 'not_company', hit: match }
    return { ok: true, piva: match.partita_iva, hit: match, reason: 'it_search_company_verified' }
  }

  return { ok: false, reason: lastReason }
}



async function resolvePiva(lead: Record<string, unknown>) {
  const companyName = pickString(lead, ['nome', 'azienda', 'business_name', 'company', 'name'])
  const city = pickString(lead, ['citta', 'city', 'location'])
  const website = pickString(lead, ['sito', 'website', 'url'])
  const direct = extractPivaFromLead(lead)
  if (direct) {
    const verified = await precheckWithItSearch(companyName, city, direct)
    if (!verified.ok && (isLikelyCompanyName(companyName) || hasCompanyEvidenceText(JSON.stringify(lead).slice(0, 20000)))) {
      return { piva: direct, source: 'lead_labeled_piva', reason: 'piva_found_unverified', searchHit: verified.hit }
    }
    if (!verified.ok) return { piva: '', source: 'none', reason: verified.reason, searchHit: verified.hit }
    return { piva: verified.piva || direct, source: 'lead_it_search_verified', searchHit: verified.hit }
  }
  const fromWebsite = await extractPivaFromWebsite(website)
  if (fromWebsite.piva) {
    const verified = await precheckWithItSearch(companyName, city, fromWebsite.piva)
    if (!verified.ok && (fromWebsite.hasCompanyEvidence || isLikelyCompanyName(companyName))) {
      return { piva: fromWebsite.piva, source: 'website_labeled_piva', reason: 'piva_found_unverified', searchHit: verified.hit }
    }
    if (!verified.ok) return { piva: '', source: 'none', reason: verified.reason, searchHit: verified.hit }
    return { piva: verified.piva || fromWebsite.piva, source: 'website_it_search_verified', searchHit: verified.hit }
  }
  if (!isLikelyCompanyName(companyName) || hasIndividualSignal(companyName)) return { piva: '', source: 'none', reason: 'not_company' }
  const publicPiva = await resolvePivaFromPublicSources(companyName, city, website)
  if (publicPiva.piva) {
    const verified = await precheckWithItSearch(companyName, city, publicPiva.piva)
    if (verified.ok) {
      return { piva: verified.piva || publicPiva.piva, source: 'public_piva_it_search_verified', searchHit: verified.hit, publicSourceUrl: publicPiva.sourceUrl }
    }
    if (publicPiva.score >= 9) {
      return { piva: publicPiva.piva, source: 'public_piva_high_confidence', reason: 'piva_found_unverified', searchHit: verified.hit, publicSourceUrl: publicPiva.sourceUrl }
    }
  }
  const verified = await precheckWithItSearch(companyName, city)
  if (!verified.ok) return { piva: '', source: 'none', reason: verified.reason, searchHit: verified.hit }
  return { piva: verified.piva || '', source: 'openapi_search_company_verified', searchHit: verified.hit }
}

function companyProfileMatchesLead(company: OpenApiEnrichedCompany, lead: Record<string, unknown>) {
  const companyName = pickString(lead, ['nome', 'azienda', 'business_name', 'company', 'name'])
  const city = pickString(lead, ['citta', 'city', 'location'])
  const hit: OpenApiSearchHit = {
    ragione_sociale: company.ragione_sociale || '',
    partita_iva: company.partita_iva || '',
    citta: company.citta,
    provincia: company.provincia,
    indirizzo: company.sede_legale,
    forma_giuridica: company.forma_giuridica,
    pec: company.pec,
    stato_attivita: company.stato_attivita,
  }
  return companyHitMatchesLead(hit, companyName, city)
}

function selectCompanyData(company: OpenApiEnrichedCompany) {
  return {
    ragione_sociale: company.ragione_sociale,
    partita_iva: company.partita_iva,
    codice_fiscale: company.codice_fiscale,
    sede_legale: company.sede_legale,
    citta: company.citta,
    provincia: company.provincia,
    cap: company.cap,
    regione: company.regione,
    stato_attivita: company.stato_attivita,
    codice_ateco: company.codice_ateco,
    descrizione_ateco: company.descrizione_ateco,
    forma_giuridica: company.forma_giuridica,
    codice_rea: company.codice_rea,
    cciaa: company.cciaa,
    pec: company.pec,
    data_registrazione: company.data_registrazione,
    data_costituzione: company.data_costituzione,
    data_cessazione: company.data_cessazione,
    codice_sdi: company.codice_sdi,
    capitale_sociale: company.capitale_sociale,
    fatturato: company.fatturato,
    fatturato_anno: company.fatturato_anno,
    dipendenti: company.dipendenti,
    costo_personale: company.costo_personale,
    patrimonio_netto: company.patrimonio_netto,
    utile_netto: company.utile_netto,
    totale_attivo: company.totale_attivo,
    ral_medio: company.ral_medio,
    storico_bilanci: company.storico_bilanci,
    telefono: company.telefono,
    sito_web: company.sito_web,
  }
}

function selectOwnerData(company: OpenApiEnrichedCompany) {
  return {
    titolare_best: company.titolare_best,
    shareholders: company.shareholders,
  }
}

function isOfficialCompanyProfile(company: OpenApiEnrichedCompany) {
  const legalText = `${company.ragione_sociale || ''} ${company.forma_giuridica || ''}`
  if (INDIVIDUAL_LEGAL_FORM_RE.test(legalText)) return false
  const hasCorporateForm = COMPANY_FORM_RE.test(legalText) || COMPANY_LEGAL_FORM_RE.test(legalText)
  const hasRegistryIdentity = Boolean(company.codice_rea || company.cciaa)
  const hasFinancials = Boolean(
    (Array.isArray(company.storico_bilanci) && company.storico_bilanci.length > 0) ||
    typeof company.fatturato === 'number' ||
    typeof company.capitale_sociale === 'number' ||
    typeof company.patrimonio_netto === 'number' ||
    typeof company.totale_attivo === 'number' ||
    typeof company.costo_personale === 'number' ||
    typeof company.dipendenti === 'number'
  )
  const hasShareholders = Array.isArray(company.shareholders) && company.shareholders.length > 0
  return hasCorporateForm || (hasRegistryIdentity && (hasFinancials || hasShareholders))
}

async function spendCredits(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, amount: number) {
  const { data: profile, error } = await supabase.from('profiles').select('credits').eq('id', userId).single()
  if (error || !profile) return { ok: false, error: 'Profilo non trovato', credits: 0 }
  const current = typeof profile.credits === 'number' ? profile.credits : 0
  if (current < amount) return { ok: false, error: 'Crediti insufficienti', credits: current }
  const { data: updated, error: updateError } = await supabase
    .from('profiles')
    .update({ credits: current - amount })
    .eq('id', userId)
    .gte('credits', amount)
    .select('credits')
    .single()
  if (updateError || !updated) return { ok: false, error: 'Errore aggiornamento crediti', credits: current }
  return { ok: true, credits: updated.credits as number }
}

async function readCredits(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: profile, error } = await supabase.from('profiles').select('credits').eq('id', userId).single()
  if (error || !profile) return { ok: false, error: 'Profilo non trovato', credits: 0 }
  return { ok: true, credits: typeof profile.credits === 'number' ? profile.credits : 0 }
}

async function readExistingUnlock(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, piva: string, unlockType: UnlockType) {
  try {
    const { data, error } = await supabase
      .from('user_openapi_unlocks')
      .select('id')
      .eq('user_id', userId)
      .eq('piva', piva)
      .eq('unlock_type', unlockType)
      .maybeSingle()
    if (error) return null
    return data
  } catch {
    return null
  }
}

async function saveUnlockBestEffort(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, piva: string, unlockType: UnlockType, cost: number) {
  try {
    await supabase.from('user_openapi_unlocks').upsert({
      user_id: userId,
      piva,
      unlock_type: unlockType,
      credits_spent: cost,
    }, { onConflict: 'user_id,piva,unlock_type' })
  } catch {}
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as UnlockBody | null
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const unlockType = body?.type
  const lead = body?.lead && typeof body.lead === 'object' ? body.lead : null
  if (unlockType !== 'company' && unlockType !== 'owner') return NextResponse.json({ error: 'Tipo sblocco non valido' }, { status: 400 })
  if (!lead) return NextResponse.json({ error: 'Lead mancante' }, { status: 400 })

  const resolved = await resolvePiva(lead)
  if (!resolved.piva) {
    const message = resolved.reason === 'not_company'
      ? 'Sblocco disponibile solo per aziende strutturate. Non disponibile per liberi professionisti o persone fisiche.'
      : 'Dati aziendali non trovati in modo sicuro per questo lead.'
    return NextResponse.json({ error: message, reason: resolved.reason || 'piva_missing' }, { status: 422 })
  }

  const existingUnlock = await readExistingUnlock(supabase, user.id, resolved.piva, unlockType)

  const cost = existingUnlock ? 0 : CREDIT_COST[unlockType]
  if (!existingUnlock) {
    const current = await readCredits(supabase, user.id)
    if (!current.ok || current.credits < cost) {
      return NextResponse.json(
        { error: current.ok ? 'Crediti insufficienti' : current.error, credits: current.credits, required: cost },
        { status: current.ok ? 403 : 500 }
      )
    }
  }

  const company = await enrichCompanyByPiva(resolved.piva)
  if (!company) return NextResponse.json({ error: `Dati aziendali non disponibili per la P.IVA ${resolved.piva}.` }, { status: 502 })
  if (resolved.reason === 'piva_found_unverified' && !companyProfileMatchesLead(company, lead)) {
    return NextResponse.json({
      error: 'P.IVA trovata da fonte pubblica, ma il profilo camerale non combacia in modo sicuro con il lead.',
      reason: 'piva_profile_mismatch',
      piva: resolved.piva,
    }, { status: 422 })
  }
  if (!isOfficialCompanyProfile(company)) {
    return NextResponse.json({
      error: 'Profilo aziendale non disponibile. Probabile lavoratore autonomo o libero professionista: sblocco disponibile solo per aziende strutturate.',
      reason: 'not_company_profile',
      piva: resolved.piva,
    }, { status: 422 })
  }

  let credits: number | null = null
  let charged = false
  if (!existingUnlock) {
    const spend = await spendCredits(supabase, user.id, cost)
    if (!spend.ok) return NextResponse.json({ error: spend.error, credits: spend.credits, required: cost }, { status: 403 })
    credits = spend.credits
    charged = true
    await saveUnlockBestEffort(supabase, user.id, resolved.piva, unlockType, cost)
  }

  return NextResponse.json({
    ok: true,
    type: unlockType,
    piva: resolved.piva,
    credits,
    cost,
    charged,
    pivaSource: resolved.source,
    publicSourceUrl: resolved.publicSourceUrl,
    fromPreviousUnlock: Boolean(existingUnlock),
    company: unlockType === 'company' ? selectCompanyData(company) : undefined,
    owner: unlockType === 'owner' ? selectOwnerData(company) : undefined,
  })
}
