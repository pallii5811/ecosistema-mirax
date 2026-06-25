/**
 * Deep Website Scraper
 * Scrapes ALL pages of a company website to extract:
 * - All email addresses (personal + generic)
 * - All phone numbers (landline + mobile)
 * - Team members (names + roles from /chi-siamo, /team, /about)
 * - Social media links (LinkedIn, Facebook, Instagram, TikTok, YouTube)
 * - P.IVA / Codice Fiscale
 * - Physical address
 */

// ── Types ────────────────────────────────────────────────────────
export interface WebsiteScrapedData {
  emails: { email: string; type: 'personal' | 'generic' | 'pec'; page: string }[]
  phones: { number: string; type: 'mobile' | 'landline' | 'unknown'; page: string }[]
  socialLinks: {
    linkedin: string | null
    linkedinPersonal: string[]
    facebook: string | null
    instagram: string | null
    tiktok: string | null
    youtube: string | null
    twitter: string | null
  }
  teamMembers: { name: string; role: string | null }[]
  partitaIva: string | null
  codiceFiscale: string | null
  address: string | null
  pagesScraped: number
  scrapedAt: string
}

// ── Helpers ──────────────────────────────────────────────────────
async function fetchPage(url: string, timeoutMs = 6000): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    })
    if (!res.ok) return ''
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('text/html') && !ct.includes('text/plain') && !ct.includes('application/xhtml')) return ''
    return await res.text()
  } catch {
    return ''
  }
}

function getOrigin(website: string): string {
  const url = website.startsWith('http') ? website : `https://${website}`
  try { return new URL(url).origin } catch { return url }
}

// ── Email extraction ────────────────────────────────────────────
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
const FAKE_DOMAINS = new Set(['example.com','email.com','sito.com','domain.com','test.com','yoursite.com','yourdomain.com','tuosito.com','sitoweb.com','sample.com','placeholder.com','wixpress.com','sentry.io','googleapis.com','w3.org','schema.org','wordpress.org','jquery.com','bootstrapcdn.com'])
const FAKE_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|webp|bmp|ico|tiff|css|js|woff|woff2|ttf|eot|mp4|mp3|pdf|zip|xml|json)$/i
const SPAM_DOMAINS = /sentry|wixpress|cloudflare|netlify|vercel|herokuapp/i

function isPersonalEmail(email: string): boolean {
  const parts = email.split('@')
  const local = parts[0].toLowerCase()
  const genericPrefixes = ['info','contatti','contact','admin','office','segreteria','reception','booking','prenotazioni','sales','vendite','support','assistenza','help','marketing','hr','risorse','noreply','no-reply','postmaster','webmaster','newsletter','press','media']
  return !genericPrefixes.some(p => local === p || local.startsWith(p + '.'))
}

function isPecEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() || ''
  return domain.includes('pec.') || domain.includes('.pec') || domain.endsWith('legalmail.it') || domain.endsWith('pecimprese.it') || domain.endsWith('arubapec.it') || domain.endsWith('pec-email.it') || domain.endsWith('postecert.it')
}

function extractEmails(html: string, page: string): WebsiteScrapedData['emails'] {
  const matches = html.match(EMAIL_RE) || []
  const seen = new Set<string>()
  const results: WebsiteScrapedData['emails'] = []

  for (const raw of matches) {
    const email = raw.toLowerCase().trim()
    if (seen.has(email)) continue
    seen.add(email)

    const domain = email.split('@')[1] || ''
    if (FAKE_DOMAINS.has(domain)) continue
    if (domain.includes('.png') || domain.includes('.jpg') || domain.includes('.svg')) continue
    // Skip image/file names falsely matched as emails (e.g. "banner@img-v2.gif")
    if (FAKE_EXTENSIONS.test(email)) continue
    if (FAKE_EXTENSIONS.test(domain)) continue
    // Skip if local part looks like a filename, hash, or too long
    const local = email.split('@')[0].toLowerCase()
    if (local.length > 35) continue // hashes and tracking IDs are usually long
    if (/^[0-9a-f]{10,}$/i.test(local)) continue // looks like a hex hash
    if (SPAM_DOMAINS.test(domain)) continue // sentry, wixpress etc
    if (/banner|image|img|logo|icon|thumb|background|header|footer|sprite|placeholder|pixel/i.test(local) && !/info|contact|mail|support/i.test(local)) continue

    results.push({
      email,
      type: isPecEmail(email) ? 'pec' : isPersonalEmail(email) ? 'personal' : 'generic',
      page,
    })
  }
  return results
}

// ── Phone extraction ────────────────────────────────────────────
// Regex flessibili: catturano qualsiasi raggruppamento (3-4, 2-2-3, 3-3-3, ecc.)
// con separatori multipli tra le cifre (spazi, dash, punti, nbsp).
const PHONE_PATTERNS = [
  // Italian mobile: 3xx + 7 più cifre con separatori flessibili (totale 10 cifre)
  /(?<!\d)(?:\+39\s?|0039\s?)?3(?:[\s.\-\u00a0\u202f\u2009]*\d){9}(?!\d)/g,
  // Italian landline: 0[1-9] + 6-9 cifre con separatori flessibili (totale 8-11 cifre)
  /(?<!\d)(?:\+39\s?|0039\s?)?0[1-9](?:[\s.\-\u00a0\u202f\u2009]*\d){6,9}(?!\d)/g,
]

// Decodifica HTML entities comuni (&nbsp; → space, &amp; → &, ecc.)
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = parseInt(n, 10)
      return Number.isFinite(code) ? String.fromCharCode(code) : ''
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16)
      return Number.isFinite(code) ? String.fromCharCode(code) : ''
    })
}

function isMobileNumber(num: string): boolean {
  const digits = num.replace(/\D/g, '').replace(/^(39|0039)/, '')
  return digits.startsWith('3') && digits.length >= 9
}

// Rileva se un numero è in realtà una P.IVA tramite contesto.
// I siti scrivono spesso "P.IVA 01075740891" o "Partita IVA: 01075740891".
function looksLikePivaByContext(raw: string, textBefore: string): boolean {
  const digits = raw.replace(/\D/g, '').replace(/^(39|0039)/, '')
  if (digits.length !== 11) return false
  // Ultimi 60 caratteri prima del numero (contesto)
  const ctx = textBefore.slice(-60).toLowerCase()
  return /p\s*\.?\s*iva|partita\s*iva|vat|codice\s+fiscale|c\.?\s*f\.?/i.test(ctx)
}

/** Reject fake phone numbers with too many repeating digits (e.g. 33.3333333) */
function isFakeRepeatingNumber(num: string): boolean {
  const digits = num.replace(/\D/g, '').replace(/^(39|0039)/, '')
  if (digits.length < 6) return true
  // Check if one digit makes up >70% of the number
  for (let d = 0; d <= 9; d++) {
    const count = (digits.match(new RegExp(String(d), 'g')) || []).length
    if (count / digits.length > 0.7) return true
  }
  // Check sequential patterns like 1234567 or 7654321
  let ascending = 0, descending = 0
  for (let i = 1; i < digits.length; i++) {
    if (parseInt(digits[i]) === parseInt(digits[i-1]) + 1) ascending++
    if (parseInt(digits[i]) === parseInt(digits[i-1]) - 1) descending++
  }
  if (ascending / (digits.length - 1) > 0.7) return true
  if (descending / (digits.length - 1) > 0.7) return true
  return false
}

/** Reject non-Italian numbers (must start with +39, 0039, 0, or 3) */
function isItalianPhone(num: string): boolean {
  const raw = num.replace(/[\s.\-()]/g, '')
  // Must start with +39, 0039, 0 (landline) or 3 (mobile)
  if (/^(\+39|0039|0[1-9]|3[0-9])/.test(raw)) return true
  // Pure digits starting with 0 or 3
  const digits = raw.replace(/\D/g, '')
  if (/^(39|0039)/.test(digits)) return true
  if (/^(0[1-9]|3[0-9])/.test(digits)) return true
  return false
}

function extractPhones(
  html: string,
  page: string,
  pivaDenylist?: string | null,
): WebsiteScrapedData['phones'] {
  const seen = new Set<string>()
  const results: WebsiteScrapedData['phones'] = []

  // Cifre della P.IVA da escludere (se fornita)
  const pivaDigits = pivaDenylist ? pivaDenylist.replace(/\D/g, '') : ''

  // Extract from tel: links first (più affidabili)
  const telLinks = html.match(/href=["']tel:([^"']+)["']/gi) || []
  for (const tl of telLinks) {
    const num = tl.replace(/href=["']tel:/i, '').replace(/["']/g, '').trim()
    if (!isItalianPhone(num)) continue
    if (isFakeRepeatingNumber(num)) continue
    const digits = num.replace(/\D/g, '')
    if (digits.length < 9) continue
    // Esclude P.IVA usata erroneamente in href=tel:
    if (pivaDigits && pivaDigits.length === 11 && digits.replace(/^(39|0039)/, '') === pivaDigits) continue
    const key = digits.slice(-9)
    if (seen.has(key)) continue
    seen.add(key)
    results.push({
      number: num,
      type: isMobileNumber(num) ? 'mobile' : 'landline',
      page,
    })
  }

  // Extract from VISIBLE text content only (strip script/style/noscript/svg blocks first)
  const visibleHtml = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
  // IMPORTANTE: decodifica HTML entities (&nbsp; etc.) PRIMA del regex match
  // perché molti siti scrivono "334&nbsp;-&nbsp;62&nbsp;31&nbsp;132".
  const textContent = decodeHtmlEntities(
    visibleHtml.replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ')

  for (const pattern of PHONE_PATTERNS) {
    pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pattern.exec(textContent)) !== null) {
      const raw = m[0]
      const matchIndex = m.index
      if (!isItalianPhone(raw)) continue
      if (isFakeRepeatingNumber(raw)) continue
      // Esclude se il contesto suggerisce P.IVA / Codice Fiscale
      if (looksLikePivaByContext(raw, textContent.slice(0, matchIndex))) continue
      const digits = raw.replace(/\D/g, '').replace(/^(39|0039)/, '')
      if (digits.length < 9 || digits.length > 12) continue
      // Esclude se le 11 cifre coincidono con la P.IVA estratta
      if (pivaDigits && pivaDigits.length === 11 && digits === pivaDigits) continue
      const key = digits.slice(-9)
      if (seen.has(key)) continue
      seen.add(key)
      results.push({
        number: raw.trim(),
        type: isMobileNumber(raw) ? 'mobile' : 'landline',
        page,
      })
    }
  }

  return results
}

// ── Social links extraction ─────────────────────────────────────
function extractSocialLinks(html: string): WebsiteScrapedData['socialLinks'] {
  const links: WebsiteScrapedData['socialLinks'] = {
    linkedin: null,
    linkedinPersonal: [],
    facebook: null,
    instagram: null,
    tiktok: null,
    youtube: null,
    twitter: null,
  }

  // Extract all href values
  const hrefs = html.match(/href=["']([^"']+)["']/gi) || []
  const urls = hrefs.map(h => h.replace(/href=["']/i, '').replace(/["']$/, ''))

  for (const url of urls) {
    const lower = url.toLowerCase()

    // LinkedIn company page
    if (lower.includes('linkedin.com/company/') && !links.linkedin) {
      links.linkedin = url
    }
    // LinkedIn personal profiles
    if (lower.includes('linkedin.com/in/') && !links.linkedinPersonal.includes(url)) {
      links.linkedinPersonal.push(url)
    }
    // Facebook
    if ((lower.includes('facebook.com/') || lower.includes('fb.com/')) && !links.facebook && !lower.includes('facebook.com/sharer')) {
      links.facebook = url
    }
    // Instagram
    if (lower.includes('instagram.com/') && !links.instagram && !lower.includes('instagram.com/p/')) {
      links.instagram = url
    }
    // TikTok
    if (lower.includes('tiktok.com/@') && !links.tiktok) {
      links.tiktok = url
    }
    // YouTube
    if ((lower.includes('youtube.com/') || lower.includes('youtu.be/')) && !links.youtube) {
      links.youtube = url
    }
    // Twitter/X
    if ((lower.includes('twitter.com/') || lower.includes('x.com/')) && !links.twitter && !lower.includes('twitter.com/intent')) {
      links.twitter = url
    }
  }

  return links
}

// ── Team members extraction ─────────────────────────────────────
function extractTeamMembers(html: string): WebsiteScrapedData['teamMembers'] {
  const members: WebsiteScrapedData['teamMembers'] = []
  const seen = new Set<string>()

  // Pattern 1: JSON-LD Person structured data
  const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || []
  for (const block of jsonLdBlocks) {
    try {
      const json = JSON.parse(block.replace(/<\/?script[^>]*>/gi, '').trim())
      const items = Array.isArray(json) ? json : [json]
      for (const item of items) {
        if (item['@type'] === 'Person' && item.name) {
          const name = item.name.trim()
          if (!seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase())
            members.push({ name, role: item.jobTitle || null })
          }
        }
        // Check for employees array
        if (item.employee) {
          const emps = Array.isArray(item.employee) ? item.employee : [item.employee]
          for (const emp of emps) {
            if (emp.name) {
              const n = emp.name.trim()
              if (!seen.has(n.toLowerCase())) {
                seen.add(n.toLowerCase())
                members.push({ name: n, role: emp.jobTitle || null })
              }
            }
          }
        }
      }
    } catch { /* ignore */ }
  }

  // Pattern 2: Common HTML patterns for team pages
  // <h3>Name</h3><p>Role</p> or similar patterns
  const teamPatterns = [
    // <h2/h3/h4> followed by <p> with role keywords
    /<h[2-4][^>]*>([A-ZÀ-Ú][a-zà-ú]+ [A-ZÀ-Ú][a-zà-ú]+(?:\s[A-ZÀ-Ú][a-zà-ú]+)?)<\/h[2-4]>\s*<[^>]*>([^<]{3,60})<\//gi,
    // data-name or itemprop="name"
    /(?:data-name|itemprop=["']name["'])[^>]*>([A-ZÀ-Ú][a-zà-ú]+ [A-ZÀ-Ú][a-zà-ú]+(?:\s[A-ZÀ-Ú][a-zà-ú]+)?)</gi,
  ]

  const roleKeywords = ['fondatore','ceo','cto','cfo','coo','direttore','manager','responsabile','titolare','socio','partner','avvocato','dottore','dott','ing','arch','geom','rag','amministratore','presidente','vice','legale','commerciale','marketing','vendite','hr','risorse','tecnico']

  const nameBlacklist = new Set([
    'richiedi informazioni','richiesta informazioni','maggiori informazioni','per informazioni',
    'informazioni generali','contatta adesso','contattaci ora','contattaci subito','scrivici ora',
    'chiama ora','chiama adesso','prenota ora','prenota adesso','scopri ora','leggi tutto',
    'vedi tutto','mostra tutto','carica altro','cookie policy','privacy policy',
    'termini condizioni','tutti diritti','diritti riservati','accetto tutto',
    'iscriviti ora','registrati ora','scarica ora','ulteriori informazioni',
    'nome cognome','inserisci nome','il tuo nome','la tua email',
  ])

  for (const pattern of teamPatterns) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(html)) !== null) {
      const name = match[1]?.trim()
      const role = match[2]?.trim()
      if (!name || name.length < 4 || name.length > 50) continue
      if (seen.has(name.toLowerCase())) continue
      if (nameBlacklist.has(name.toLowerCase())) continue
      // Validate it looks like a real name (at least 2 words, capitalized)
      if (!/^[A-ZÀ-Ú]/.test(name)) continue
      if (name.split(' ').length < 2) continue

      const isRole = role && roleKeywords.some(k => role.toLowerCase().includes(k))
      seen.add(name.toLowerCase())
      members.push({ name, role: isRole ? role : null })
    }
  }

  return members.slice(0, 20) // Cap at 20
}

// ── P.IVA / CF extraction ───────────────────────────────────────
const PIVA_PATTERNS = [
  /(?:P\.?\s*I\.?V\.?A\.?|Partita\s*IVA)[\/\s:.\-]*(?:IT)?[\s]?(\d{11})/gi,
  /(?:C\.?\s*F\.?\s*(?:e\s*)?P\.?\s*I\.?V\.?A\.?)[\/\s:.\-]*(?:IT)?[\s]?(\d{11})/gi,
  /\bIT(\d{11})\b/g,
]

function extractPiva(html: string): string | null {
  for (const re of PIVA_PATTERNS) {
    re.lastIndex = 0
    const m = re.exec(html)
    if (m?.[1]) return m[1]
  }
  // Context search
  const area = html.match(/(?:P\.?\s*I\.?V\.?A|Partita\s*IVA|codice\s*fiscale).{0,100}/gi)
  if (area) {
    for (const a of area) {
      const d = a.match(/\b(\d{11})\b/)
      if (d?.[1]) return d[1]
    }
  }
  return null
}

// ── Address extraction ──────────────────────────────────────────
function extractAddress(html: string): string | null {
  // Look for structured data first
  const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || []
  for (const block of jsonLdBlocks) {
    try {
      const json = JSON.parse(block.replace(/<\/?script[^>]*>/gi, '').trim())
      const addr = json.address || json.location?.address
      if (addr) {
        if (typeof addr === 'string') return addr
        if (addr.streetAddress) {
          return [addr.streetAddress, addr.postalCode, addr.addressLocality, addr.addressRegion]
            .filter(Boolean).join(', ')
        }
      }
    } catch { /* ignore */ }
  }

  // Look for Italian address patterns near "sede" or "indirizzo"
  const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const addressPatterns = [
    /(?:sede|indirizzo|via|piazza|corso|viale|largo)\s*[:\-]?\s*((?:Via|Piazza|Corso|Viale|Largo|P\.zza|V\.le)\s+[^,]+,\s*\d{5}\s*[A-ZÀ-Ú][a-zà-ú]+(?:\s*\([A-Z]{2}\))?)/i,
  ]
  for (const p of addressPatterns) {
    const m = textContent.match(p)
    if (m?.[1]) return m[1].trim()
  }
  return null
}

// ── Main scraper ────────────────────────────────────────────────
export async function scrapeWebsiteDeep(website: string): Promise<WebsiteScrapedData> {
  const result: WebsiteScrapedData = {
    emails: [],
    phones: [],
    socialLinks: { linkedin: null, linkedinPersonal: [], facebook: null, instagram: null, tiktok: null, youtube: null, twitter: null },
    teamMembers: [],
    partitaIva: null,
    codiceFiscale: null,
    address: null,
    pagesScraped: 0,
    scrapedAt: new Date().toISOString(),
  }

  if (!website) return result

  const origin = getOrigin(website)
  const baseUrl = website.startsWith('http') ? website : `https://${website}`

  // Pages to scrape (ordered by priority)
  const pagePaths = [
    '', // homepage
    '/contatti', '/contacts', '/contact', '/contact-us', '/contattaci',
    '/chi-siamo', '/about', '/about-us', '/azienda', '/company',
    '/team', '/il-team', '/staff', '/persone', '/people',
    '/privacy', '/privacy-policy',
    '/impressum',
  ]

  const allEmails: WebsiteScrapedData['emails'] = []
  const allPhones: WebsiteScrapedData['phones'] = []
  const allMembers: WebsiteScrapedData['teamMembers'] = []
  let mergedSocials: WebsiteScrapedData['socialLinks'] = { ...result.socialLinks }

  // Fetch all pages in parallel (batch of 5)
  const batchSize = 5
  for (let i = 0; i < pagePaths.length; i += batchSize) {
    const batch = pagePaths.slice(i, i + batchSize)
    const fetches = await Promise.allSettled(
      batch.map(path => {
        const url = path ? `${origin}${path}` : baseUrl
        return fetchPage(url, 5000).then(html => ({ html, path: path || '/' }))
      })
    )

    for (const f of fetches) {
      if (f.status !== 'fulfilled' || !f.value.html) continue
      const { html, path } = f.value
      if (html.length < 500) continue // too small, probably error page

      result.pagesScraped++

      // Strip img/source/video/picture tags to avoid matching image filenames as emails
      const cleanHtml = html.replace(/<(?:img|source|video|picture)[^>]*>/gi, '')

      // 1. Estrai P.IVA per primo, così possiamo escluderla dai numeri di telefono
      const pivaFromPage = extractPiva(html)
      if (!result.partitaIva && pivaFromPage) result.partitaIva = pivaFromPage

      // 2. Email e telefoni (con P.IVA come denylist per evitare confusione)
      allEmails.push(...extractEmails(cleanHtml, path))
      allPhones.push(...extractPhones(html, path, result.partitaIva))

      // Social links (merge, first found wins)
      const pageSocials = extractSocialLinks(html)
      if (!mergedSocials.linkedin && pageSocials.linkedin) mergedSocials.linkedin = pageSocials.linkedin
      if (!mergedSocials.facebook && pageSocials.facebook) mergedSocials.facebook = pageSocials.facebook
      if (!mergedSocials.instagram && pageSocials.instagram) mergedSocials.instagram = pageSocials.instagram
      if (!mergedSocials.tiktok && pageSocials.tiktok) mergedSocials.tiktok = pageSocials.tiktok
      if (!mergedSocials.youtube && pageSocials.youtube) mergedSocials.youtube = pageSocials.youtube
      if (!mergedSocials.twitter && pageSocials.twitter) mergedSocials.twitter = pageSocials.twitter
      for (const lp of pageSocials.linkedinPersonal) {
        if (!mergedSocials.linkedinPersonal.includes(lp)) mergedSocials.linkedinPersonal.push(lp)
      }

      // Team members (from about/team pages)
      if (/chi-siamo|about|team|staff|persone|people|azienda/i.test(path)) {
        allMembers.push(...extractTeamMembers(html))
      }

      // Address (first found)
      if (!result.address) {
        result.address = extractAddress(html)
      }
    }
  }

  // Deduplicate
  const seenEmails = new Set<string>()
  result.emails = allEmails.filter(e => {
    if (seenEmails.has(e.email)) return false
    seenEmails.add(e.email)
    return true
  })

  const seenPhones = new Set<string>()
  result.phones = allPhones.filter(p => {
    const key = p.number.replace(/\D/g, '').slice(-9)
    if (seenPhones.has(key)) return false
    seenPhones.add(key)
    return true
  })

  const seenMembers = new Set<string>()
  result.teamMembers = allMembers.filter(m => {
    const key = m.name.toLowerCase()
    if (seenMembers.has(key)) return false
    seenMembers.add(key)
    return true
  }).slice(0, 20)

  result.socialLinks = mergedSocials

  return result
}
