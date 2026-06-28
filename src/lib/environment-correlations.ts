/**
 * Blocco 6 — correlazioni lead per ambiente (aggregazioni pure).
 */

export type LeadMeshInput = {
  nome?: string
  azienda?: string
  citta?: string
  city?: string
  categoria?: string
  category?: string
  telefono?: string
  email?: string
  sito?: string
  website?: string
  meta_pixel?: boolean
  google_tag_manager?: boolean
  opportunity_score?: number
  lead_score?: number
  score?: number
}

export type EnvironmentCorrelation = {
  signal: string
  label: string
  count: number
  pct: number
}

export type CategoryCluster = {
  category: string
  count: number
  avgScore: number
  noPixelPct: number
  withEmailPct: number
}

export type GeoCluster = {
  city: string
  count: number
  avgScore: number
}

export type EnvironmentMeshReport = {
  totalLeads: number
  correlations: EnvironmentCorrelation[]
  categories: CategoryCluster[]
  cities: GeoCluster[]
  sharedContacts: { phones: number; emails: number }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function scoreOf(lead: LeadMeshInput): number {
  const n = Number(lead.opportunity_score ?? lead.lead_score ?? lead.score)
  return Number.isFinite(n) ? Math.round(n) : 0
}

export function buildEnvironmentMesh(leads: LeadMeshInput[]): EnvironmentMeshReport {
  const total = leads.length
  if (total === 0) {
    return {
      totalLeads: 0,
      correlations: [],
      categories: [],
      cities: [],
      sharedContacts: { phones: 0, emails: 0 },
    }
  }

  let noPixel = 0
  let noGtm = 0
  let noEmail = 0
  let noPhone = 0
  let hot = 0
  let noSite = 0

  const catMap = new Map<string, { count: number; scores: number[]; noPixel: number; withEmail: number }>()
  const cityMap = new Map<string, { count: number; scores: number[] }>()
  const phoneCounts = new Map<string, number>()
  const emailCounts = new Map<string, number>()

  for (const lead of leads) {
    const sc = scoreOf(lead)
    if (!lead.meta_pixel) noPixel++
    if (!lead.google_tag_manager) noGtm++
    const email = str(lead.email)
    const phone = str(lead.telefono)
    const site = str(lead.sito) || str(lead.website)
    if (!email) noEmail++
    if (!phone) noPhone++
    if (!site) noSite++
    if (sc >= 70) hot++

    if (email) emailCounts.set(email.toLowerCase(), (emailCounts.get(email.toLowerCase()) ?? 0) + 1)
    if (phone) phoneCounts.set(phone.replace(/\D/g, ''), (phoneCounts.get(phone.replace(/\D/g, '')) ?? 0) + 1)

    const cat = str(lead.categoria) || str(lead.category) || 'Senza categoria'
    const c = catMap.get(cat) ?? { count: 0, scores: [], noPixel: 0, withEmail: 0 }
    c.count++
    c.scores.push(sc)
    if (!lead.meta_pixel) c.noPixel++
    if (email) c.withEmail++
    catMap.set(cat, c)

    const city = str(lead.citta) || str(lead.city) || 'Senza città'
    const ci = cityMap.get(city) ?? { count: 0, scores: [] }
    ci.count++
    ci.scores.push(sc)
    cityMap.set(city, ci)
  }

  const pct = (n: number) => Math.round((n / total) * 100)

  const correlations: EnvironmentCorrelation[] = [
    { signal: 'no_pixel', label: 'Senza Meta Pixel', count: noPixel, pct: pct(noPixel) },
    { signal: 'no_gtm', label: 'Senza GTM', count: noGtm, pct: pct(noGtm) },
    { signal: 'no_email', label: 'Senza email', count: noEmail, pct: pct(noEmail) },
    { signal: 'no_phone', label: 'Senza telefono', count: noPhone, pct: pct(noPhone) },
    { signal: 'no_website', label: 'Senza sito', count: noSite, pct: pct(noSite) },
    { signal: 'hot_score', label: 'Score ≥ 70', count: hot, pct: pct(hot) },
  ].filter((c) => c.count > 0)

  const categories = Array.from(catMap.entries())
    .map(([category, d]) => ({
      category,
      count: d.count,
      avgScore: d.scores.length ? Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length) : 0,
      noPixelPct: d.count ? Math.round((d.noPixel / d.count) * 100) : 0,
      withEmailPct: d.count ? Math.round((d.withEmail / d.count) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  const cities = Array.from(cityMap.entries())
    .map(([city, d]) => ({
      city,
      count: d.count,
      avgScore: d.scores.length ? Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length) : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  const dupPhones = [...phoneCounts.values()].filter((n) => n >= 2).length
  const dupEmails = [...emailCounts.values()].filter((n) => n >= 2).length

  return {
    totalLeads: total,
    correlations,
    categories,
    cities,
    sharedContacts: { phones: dupPhones, emails: dupEmails },
  }
}
