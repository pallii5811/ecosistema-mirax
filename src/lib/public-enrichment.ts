/**
 * Public Source Enrichment
 * Finds LinkedIn profiles, social accounts, and public data via Google search
 * All sources are FREE and publicly accessible
 */

// ── Types ────────────────────────────────────────────────────────
export interface PublicEnrichmentData {
  // LinkedIn
  linkedinCompanyUrl: string | null
  linkedinCompanyDescription: string | null
  linkedinPersonUrl: string | null
  linkedinPersonName: string | null
  linkedinPersonTitle: string | null

  // Social
  facebookUrl: string | null
  instagramUrl: string | null
  instagramHandle: string | null
  tiktokUrl: string | null
  youtubeUrl: string | null

  // Google data
  googleDescription: string | null
  googleSnippets: string[]

  // INIPEC
  pecEmail: string | null

  // Sources used
  sources: string[]
}

// ── Google search via scraping ───────────────────────────────────
async function googleSearch(query: string, maxResults = 5): Promise<{ title: string; url: string; snippet: string }[]> {
  try {
    const encoded = encodeURIComponent(query)
    const res = await fetch(`https://www.google.com/search?q=${encoded}&hl=it&num=${maxResults}&gl=it`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) return []
    const html = await res.text()

    // Extract search results from HTML
    const results: { title: string; url: string; snippet: string }[] = []

    // Pattern: extract URLs and snippets from Google results HTML
    const linkPattern = /<a[^>]+href="\/url\?q=([^"&]+)[^"]*"[^>]*>/gi
    const matches = html.matchAll(linkPattern)

    for (const match of matches) {
      const url = decodeURIComponent(match[1])
      if (!url.startsWith('http')) continue
      if (url.includes('google.com') || url.includes('webcache') || url.includes('translate.google')) continue

      // Try to get title and snippet from surrounding context
      const startIdx = Math.max(0, (match.index || 0) - 200)
      const endIdx = Math.min(html.length, (match.index || 0) + 500)
      const context = html.slice(startIdx, endIdx)

      const titleMatch = context.match(/>([^<]{5,100})<\/(?:h3|a)/i)
      const snippetMatch = context.match(/class="[^"]*(?:st|VwiC3b|s3v9rd)[^"]*"[^>]*>([^<]{10,300})</i)

      results.push({
        title: titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || '',
        url,
        snippet: snippetMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || '',
      })

      if (results.length >= maxResults) break
    }

    // Fallback: simpler URL extraction if the above didn't work
    if (results.length === 0) {
      const simpleUrls = html.match(/https?:\/\/[^\s"<>]+/g) || []
      for (const u of simpleUrls) {
        if (u.includes('google.com') || u.includes('gstatic') || u.includes('googleapis')) continue
        if (results.length >= maxResults) break
        results.push({ title: '', url: u, snippet: '' })
      }
    }

    return results
  } catch {
    return []
  }
}

// ── Find LinkedIn company page ──────────────────────────────────
async function findLinkedInCompany(companyName: string, city?: string): Promise<{
  url: string | null
  description: string | null
}> {
  const query = `site:linkedin.com/company/ "${companyName}"${city ? ` ${city}` : ''}`
  const results = await googleSearch(query, 3)

  for (const r of results) {
    if (r.url.includes('linkedin.com/company/')) {
      return {
        url: r.url.split('?')[0], // Clean URL
        description: r.snippet || null,
      }
    }
  }
  return { url: null, description: null }
}

// ── Find LinkedIn person ────────────────────────────────────────
async function findLinkedInPerson(personName: string, companyName?: string): Promise<{
  url: string | null
  name: string | null
  title: string | null
}> {
  if (!personName) return { url: null, name: null, title: null }

  const query = `site:linkedin.com/in/ "${personName}"${companyName ? ` "${companyName}"` : ''}`
  const results = await googleSearch(query, 3)

  for (const r of results) {
    if (r.url.includes('linkedin.com/in/')) {
      // Extract title from snippet (often format: "Name - Title - Company | LinkedIn")
      const titleMatch = r.snippet.match(/[-–—]\s*([^-–—|]+?)(?:\s*[-–—|]|$)/)
      return {
        url: r.url.split('?')[0],
        name: personName,
        title: titleMatch?.[1]?.trim() || null,
      }
    }
  }
  return { url: null, name: null, title: null }
}

// ── Find social profiles via Google ─────────────────────────────
async function findSocialProfiles(companyName: string, city?: string): Promise<{
  facebook: string | null
  instagram: string | null
  instagramHandle: string | null
  tiktok: string | null
  youtube: string | null
}> {
  const result = {
    facebook: null as string | null,
    instagram: null as string | null,
    instagramHandle: null as string | null,
    tiktok: null as string | null,
    youtube: null as string | null,
  }

  // Search for social profiles
  const query = `"${companyName}"${city ? ` ${city}` : ''} (site:facebook.com OR site:instagram.com OR site:tiktok.com)`
  const results = await googleSearch(query, 8)

  for (const r of results) {
    const url = r.url.split('?')[0]

    if (url.includes('facebook.com/') && !result.facebook && !url.includes('/sharer') && !url.includes('/dialog')) {
      result.facebook = url
    }
    if (url.includes('instagram.com/') && !result.instagram && !url.includes('/p/') && !url.includes('/reel/')) {
      result.instagram = url
      const handleMatch = url.match(/instagram\.com\/([^/?]+)/)
      if (handleMatch) result.instagramHandle = `@${handleMatch[1]}`
    }
    if (url.includes('tiktok.com/@') && !result.tiktok) {
      result.tiktok = url
    }
  }

  return result
}

// ── INIPEC PEC lookup ───────────────────────────────────────────
async function lookupInipec(companyName: string): Promise<string | null> {
  try {
    // INIPEC search
    const encoded = encodeURIComponent(companyName)
    const res = await fetch(`https://www.inipec.gov.it/cerca/imprese?denominazione=${encoded}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) return null
    const html = await res.text()

    // Extract PEC from results
    const pecMatch = html.match(/([a-zA-Z0-9._%+\-]+@(?:pec\.|legalmail\.|pecimprese\.|arubapec\.|postecert\.)[a-zA-Z0-9.\-]+)/i)
    if (pecMatch) return pecMatch[1].toLowerCase()

    // Generic email pattern near "PEC" text
    const pecArea = html.match(/PEC[\s:]*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i)
    if (pecArea) return pecArea[1].toLowerCase()

    return null
  } catch {
    return null
  }
}

// ── Google company info ─────────────────────────────────────────
async function getGoogleInfo(companyName: string, city?: string): Promise<{
  description: string | null
  snippets: string[]
}> {
  const query = `"${companyName}"${city ? ` ${city}` : ''}`
  const results = await googleSearch(query, 5)

  return {
    description: results[0]?.snippet || null,
    snippets: results.map(r => r.snippet).filter(Boolean).slice(0, 5),
  }
}

// ── Main orchestrator ───────────────────────────────────────────
export async function enrichFromPublicSources(params: {
  companyName: string
  city?: string
  ownerName?: string
  website?: string
}): Promise<PublicEnrichmentData> {
  const result: PublicEnrichmentData = {
    linkedinCompanyUrl: null,
    linkedinCompanyDescription: null,
    linkedinPersonUrl: null,
    linkedinPersonName: null,
    linkedinPersonTitle: null,
    facebookUrl: null,
    instagramUrl: null,
    instagramHandle: null,
    tiktokUrl: null,
    youtubeUrl: null,
    googleDescription: null,
    googleSnippets: [],
    pecEmail: null,
    sources: [],
  }

  const { companyName, city, ownerName } = params
  if (!companyName) return result

  // Run all searches in parallel for speed
  const [linkedinCompany, linkedinPerson, socialProfiles, inipecPec, googleInfo] = await Promise.allSettled([
    findLinkedInCompany(companyName, city),
    ownerName ? findLinkedInPerson(ownerName, companyName) : Promise.resolve({ url: null, name: null, title: null }),
    findSocialProfiles(companyName, city),
    lookupInipec(companyName),
    getGoogleInfo(companyName, city),
  ])

  // LinkedIn company
  if (linkedinCompany.status === 'fulfilled' && linkedinCompany.value.url) {
    result.linkedinCompanyUrl = linkedinCompany.value.url
    result.linkedinCompanyDescription = linkedinCompany.value.description
    result.sources.push('linkedin')
  }

  // LinkedIn person
  if (linkedinPerson.status === 'fulfilled' && linkedinPerson.value.url) {
    result.linkedinPersonUrl = linkedinPerson.value.url
    result.linkedinPersonName = linkedinPerson.value.name
    result.linkedinPersonTitle = linkedinPerson.value.title
    if (!result.sources.includes('linkedin')) result.sources.push('linkedin')
  }

  // Social profiles
  if (socialProfiles.status === 'fulfilled') {
    const sp = socialProfiles.value
    if (sp.facebook) { result.facebookUrl = sp.facebook; result.sources.push('facebook') }
    if (sp.instagram) {
      result.instagramUrl = sp.instagram
      result.instagramHandle = sp.instagramHandle
      result.sources.push('instagram')
    }
    if (sp.tiktok) { result.tiktokUrl = sp.tiktok; result.sources.push('tiktok') }
  }

  // INIPEC PEC
  if (inipecPec.status === 'fulfilled' && inipecPec.value) {
    result.pecEmail = inipecPec.value
    result.sources.push('inipec')
  }

  // Google info
  if (googleInfo.status === 'fulfilled') {
    result.googleDescription = googleInfo.value.description
    result.googleSnippets = googleInfo.value.snippets
    if (googleInfo.value.snippets.length > 0) result.sources.push('google')
  }

  return result
}
