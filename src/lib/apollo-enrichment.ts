/**
 * Apollo.io API Integration
 * People search + Company enrichment + Person enrichment
 * Docs: https://apolloio.github.io/apollo-api-docs/
 */

const APOLLO_BASE = 'https://api.apollo.io/v1'

function getApiKey(): string {
  return process.env.APOLLO_API_KEY || ''
}

// ── Types ────────────────────────────────────────────────────────
export interface ApolloPerson {
  name: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
  emailVerified: boolean
  phone: string | null
  mobilePhone: string | null
  title: string | null
  seniority: string | null
  companyName: string | null
  companyDomain: string | null
  companySize: string | null
  industry: string | null
  linkedin: string | null
  city: string | null
  country: string | null
  photoUrl: string | null
  employmentHistory: {
    title: string
    company: string
    current: boolean
    startDate: string | null
  }[]
  source: 'apollo'
}

export interface ApolloSearchResult {
  persons: ApolloPerson[]
  total: number
  hasMore: boolean
}

// ── Helpers ──────────────────────────────────────────────────────
function mapPerson(p: any): ApolloPerson {
  const phones = p.phone_numbers || []
  const mobile = phones.find((ph: any) => ph.type === 'mobile')?.sanitized_number
  const directDial = phones.find((ph: any) => ph.type === 'work_direct')?.sanitized_number
  const anyPhone = phones[0]?.sanitized_number || phones[0]?.raw_number

  return {
    name: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
    firstName: p.first_name || null,
    lastName: p.last_name || null,
    email: p.email || null,
    emailVerified: p.email_status === 'verified',
    phone: directDial || anyPhone || null,
    mobilePhone: mobile || null,
    title: p.title || null,
    seniority: p.seniority || null,
    companyName: p.organization?.name || p.organization_name || null,
    companyDomain: p.organization?.primary_domain || null,
    companySize: p.organization?.estimated_num_employees
      ? `${p.organization.estimated_num_employees}`
      : null,
    industry: p.organization?.industry || null,
    linkedin: p.linkedin_url || null,
    city: p.city || null,
    country: p.country || null,
    photoUrl: p.photo_url || null,
    employmentHistory: (p.employment_history || []).slice(0, 5).map((e: any) => ({
      title: e.title || '',
      company: e.organization_name || '',
      current: e.current || false,
      startDate: e.start_date || null,
    })),
    source: 'apollo' as const,
  }
}

// ── People Search: search by title + location + industry ────────
export async function apolloPeopleSearch(params: {
  query?: string         // keyword search (e.g. person name)
  personTitles?: string[] // job titles to search for
  organizationName?: string // specific company name
  location?: string      // city
  country?: string       // country code
  industry?: string[]    // industry keywords
  companySize?: string   // e.g. '1,10' or '11,50'
  page?: number
  perPage?: number
}): Promise<ApolloSearchResult> {
  const apiKey = getApiKey()
  if (!apiKey) {
    return { persons: [], total: 0, hasMore: false }
  }

  try {
    const body: any = {
      api_key: apiKey,
      page: params.page || 1,
      per_page: Math.min(params.perPage || 25, 100),
    }

    if (params.query) {
      body.q_keywords = params.query
    }

    if (params.personTitles?.length) {
      body.person_titles = params.personTitles
    }

    if (params.organizationName) {
      body.q_organization_name = params.organizationName
    }

    if (params.location) {
      body.person_locations = [params.location]
    }

    if (params.country) {
      body.person_locations = body.person_locations || []
      body.person_locations.push(params.country)
    }

    if (params.industry?.length) {
      body.organization_industry_tag_ids = params.industry
    }

    if (params.companySize) {
      const [min, max] = params.companySize.split(',').map(Number)
      body.organization_num_employees_ranges = [`${min},${max}`]
    }

    const res = await fetch(`${APOLLO_BASE}/mixed_people/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      console.warn(`[apollo] people search failed: ${res.status}`)
      return { persons: [], total: 0, hasMore: false }
    }

    const data = await res.json()
    const people = data.people || []

    return {
      persons: people.map(mapPerson),
      total: data.pagination?.total_entries || people.length,
      hasMore: (data.pagination?.page || 1) < (data.pagination?.total_pages || 1),
    }
  } catch (e: any) {
    console.error('[apollo] people search error:', e.message)
    return { persons: [], total: 0, hasMore: false }
  }
}

// ── Person Enrichment: enrich by email or LinkedIn URL ──────────
export async function apolloEnrichPerson(params: {
  email?: string
  linkedinUrl?: string
  firstName?: string
  lastName?: string
  companyDomain?: string
}): Promise<ApolloPerson | null> {
  const apiKey = getApiKey()
  if (!apiKey) return null

  try {
    const body: any = { api_key: apiKey }

    if (params.email) body.email = params.email
    if (params.linkedinUrl) body.linkedin_url = params.linkedinUrl
    if (params.firstName) body.first_name = params.firstName
    if (params.lastName) body.last_name = params.lastName
    if (params.companyDomain) body.organization_domain = params.companyDomain

    const res = await fetch(`${APOLLO_BASE}/people/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) return null

    const data = await res.json()
    if (!data.person) return null

    return mapPerson(data.person)
  } catch {
    return null
  }
}

// ── Company Enrichment: get company data by domain ──────────────
export async function apolloEnrichCompany(domain: string): Promise<{
  name: string | null
  industry: string | null
  employees: number | null
  revenue: string | null
  founded: number | null
  linkedin: string | null
  description: string | null
  city: string | null
  country: string | null
} | null> {
  const apiKey = getApiKey()
  if (!apiKey) return null

  try {
    const cleanDomain = domain
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .trim()

    const res = await fetch(`${APOLLO_BASE}/organizations/enrich`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    // Use the match endpoint instead
    const res2 = await fetch(`${APOLLO_BASE}/organizations/enrich?api_key=${apiKey}&domain=${cleanDomain}`, {
      method: 'GET',
    })

    if (!res2.ok) return null

    const data = await res2.json()
    const org = data.organization

    if (!org) return null

    return {
      name: org.name || null,
      industry: org.industry || null,
      employees: org.estimated_num_employees || null,
      revenue: org.annual_revenue_printed || null,
      founded: org.founded_year || null,
      linkedin: org.linkedin_url || null,
      description: org.short_description || null,
      city: org.city || null,
      country: org.country || null,
    }
  } catch {
    return null
  }
}

// ── Colleagues: find people at the same company ─────────────────
export async function apolloFindColleagues(
  companyDomain?: string,
  companyName?: string,
  limit = 10
): Promise<ApolloPerson[]> {
  const apiKey = getApiKey()
  if (!apiKey) return []

  try {
    const body: any = {
      api_key: apiKey,
      page: 1,
      per_page: limit,
    }

    if (companyDomain) {
      const clean = companyDomain
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '')
        .trim()
      body.q_organization_domains = clean
    } else if (companyName) {
      body.q_organization_name = companyName
    } else {
      return []
    }

    const res = await fetch(`${APOLLO_BASE}/mixed_people/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) return []

    const data = await res.json()
    return (data.people || []).map(mapPerson)
  } catch {
    return []
  }
}
