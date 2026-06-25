/**
 * Snov.io API Integration
 * Database search + Email finder + Email verification
 * Docs: https://snov.io/knowledgebase/api
 */

const SNOV_BASE = 'https://api.snov.io/v1'

let cachedToken: { token: string; expiresAt: number } | null = null

// ── Auth: get access token ──────────────────────────────────────
async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token
  }

  const clientId = process.env.SNOV_CLIENT_ID || ''
  const clientSecret = process.env.SNOV_CLIENT_SECRET || ''

  if (!clientId || !clientSecret) {
    throw new Error('SNOV_CLIENT_ID e SNOV_CLIENT_SECRET non configurati')
  }

  const res = await fetch(`${SNOV_BASE}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!res.ok) throw new Error(`Snov auth failed: ${res.status}`)
  const data = await res.json()

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000 - 60000,
  }

  return cachedToken.token
}

// ── Types ────────────────────────────────────────────────────────
export interface SnovPerson {
  name: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  position: string | null
  companyName: string | null
  companyDomain: string | null
  linkedin: string | null
  location: string | null
  industry: string | null
  country: string | null
  source: 'snov'
}

export interface SnovSearchResult {
  persons: SnovPerson[]
  total: number
  hasMore: boolean
}

// ── Database Search: search by position + location ──────────────
export async function snovDatabaseSearch(params: {
  position?: string      // job title / role keyword
  industry?: string      // industry keyword
  location?: string      // city or region
  country?: string       // country code, e.g. 'IT'
  companySize?: string   // e.g. '1-10', '11-50', '51-200'
  page?: number
  perPage?: number
}): Promise<SnovSearchResult> {
  try {
    const token = await getAccessToken()

    // Build search criteria
    const searchParams: any = {
      access_token: token,
      page: params.page || 1,
      per_page: Math.min(params.perPage || 25, 100),
    }

    // Location filter (city or country)
    if (params.location) {
      searchParams.locations = [{ city: params.location, country: params.country || 'IT' }]
    } else if (params.country) {
      searchParams.locations = [{ country: params.country }]
    }

    // Position/role filter
    if (params.position) {
      searchParams.positions = [params.position]
    }

    // Industry filter
    if (params.industry) {
      searchParams.industries = [params.industry]
    }

    // Company size
    if (params.companySize) {
      searchParams.company_sizes = [params.companySize]
    }

    const res = await fetch(`${SNOV_BASE}/v2/prospect-search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(searchParams),
    })

    if (!res.ok) {
      console.warn(`[snov] database search failed: ${res.status}`)
      return { persons: [], total: 0, hasMore: false }
    }

    const data = await res.json()
    const prospects = data.data || data.prospects || []

    const persons: SnovPerson[] = prospects.map((p: any) => ({
      name: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
      firstName: p.first_name || null,
      lastName: p.last_name || null,
      email: p.email || (p.emails?.[0]?.email) || null,
      phone: p.phones?.[0] || null,
      position: p.position || p.current_job_title || null,
      companyName: p.company_name || p.current_company || null,
      companyDomain: p.company_domain || p.domain || null,
      linkedin: p.social_links?.linkedin || p.linkedin || null,
      location: p.locality || p.city || null,
      industry: p.industry || null,
      country: p.country || null,
      source: 'snov' as const,
    }))

    return {
      persons,
      total: data.total || data.meta?.total || persons.length,
      hasMore: (data.meta?.current_page || 1) < (data.meta?.last_page || 1),
    }
  } catch (e: any) {
    console.error('[snov] database search error:', e.message)
    return { persons: [], total: 0, hasMore: false }
  }
}

// ── Domain Search: find all emails for a company domain ─────────
export async function snovDomainSearch(domain: string): Promise<SnovPerson[]> {
  try {
    const token = await getAccessToken()

    // Clean domain
    const cleanDomain = domain
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .trim()

    if (!cleanDomain) return []

    const res = await fetch(`${SNOV_BASE}/v2/domain-emails-with-info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: token,
        domain: cleanDomain,
        type: 'all',
        limit: 20,
      }),
    })

    if (!res.ok) return []

    const data = await res.json()
    const emails = data.emails || data.data || []

    return emails.map((e: any) => ({
      name: [e.first_name, e.last_name].filter(Boolean).join(' ') || null,
      firstName: e.first_name || null,
      lastName: e.last_name || null,
      email: e.email || null,
      phone: null,
      position: e.position || e.job_title || null,
      companyName: data.company_name || null,
      companyDomain: cleanDomain,
      linkedin: e.social_links?.linkedin || null,
      location: null,
      industry: null,
      country: null,
      source: 'snov' as const,
    }))
  } catch (e: any) {
    console.error('[snov] domain search error:', e.message)
    return []
  }
}

// ── Email Finder: find email by name + domain ───────────────────
export async function snovEmailFinder(
  firstName: string,
  lastName: string,
  domain: string
): Promise<{ email: string | null; confidence: string | null }> {
  try {
    const token = await getAccessToken()

    const cleanDomain = domain
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .trim()

    const res = await fetch(`${SNOV_BASE}/v1/get-emails-from-names`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: token,
        first_name: firstName,
        last_name: lastName,
        domain: cleanDomain,
      }),
    })

    if (!res.ok) return { email: null, confidence: null }

    const data = await res.json()
    const emailData = data.data?.emails?.[0] || data.emails?.[0]

    return {
      email: emailData?.email || null,
      confidence: emailData?.email_status || null,
    }
  } catch {
    return { email: null, confidence: null }
  }
}

// ── Email Verifier ──────────────────────────────────────────────
export async function snovVerifyEmail(email: string): Promise<{
  valid: boolean
  status: string
}> {
  try {
    const token = await getAccessToken()

    // Step 1: Add to verification
    await fetch(`${SNOV_BASE}/v1/add-emails-to-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: token,
        emails: [email],
      }),
    })

    // Step 2: Check result (may need polling for async verification)
    const res = await fetch(`${SNOV_BASE}/v1/get-emails-verification-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: token,
        emails: [email],
      }),
    })

    if (!res.ok) return { valid: false, status: 'error' }

    const data = await res.json()
    const result = data.data?.[0] || data[0]
    const status = result?.result || result?.status || 'unknown'

    return {
      valid: status === 'valid' || status === 'ok',
      status,
    }
  } catch {
    return { valid: false, status: 'error' }
  }
}

// ── Prospect profile enrichment ─────────────────────────────────
export async function snovGetProspect(email: string): Promise<SnovPerson | null> {
  try {
    const token = await getAccessToken()

    const res = await fetch(`${SNOV_BASE}/v1/get-profile-by-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: token,
        email,
      }),
    })

    if (!res.ok) return null

    const p = await res.json()
    if (!p || p.success === false) return null

    return {
      name: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
      firstName: p.first_name || null,
      lastName: p.last_name || null,
      email: email,
      phone: p.phones?.[0] || null,
      position: p.current_job_title || null,
      companyName: p.current_company || null,
      companyDomain: p.current_company_domain || null,
      linkedin: p.social?.linkedin || p.li_url || null,
      location: p.locality || p.city || null,
      industry: p.industry || null,
      country: p.country || null,
      source: 'snov' as const,
    }
  } catch {
    return null
  }
}
