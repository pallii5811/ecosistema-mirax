/**
 * POST /api/database-search
 * Barra 1: Ricerca nel database Snov.io + Apollo
 * Cerca persone/aziende per categoria + città con dati GARANTITI
 * 
 * Body: { query: string, location: string, page?: number, perPage?: number }
 * Returns: { results: MergedPerson[], total: number, sources: string[] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { snovDatabaseSearch, type SnovPerson } from '@/lib/snov-enrichment'
import { apolloPeopleSearch, type ApolloPerson } from '@/lib/apollo-enrichment'
import { createClient } from '@/utils/supabase/server'

interface MergedPerson {
  id: string
  name: string
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
  employmentHistory: any[]
  sources: string[]
  // Inferred fields
  employmentType: string | null     // imprenditore / p.iva / dipendente
  estimatedPotential: string | null // stima capacità
  triggers: string[]
}

// ── Infer employment type from title/seniority ──────────────────
function inferEmploymentType(title: string | null, seniority: string | null): string | null {
  if (!title && !seniority) return null
  const t = (title || '').toLowerCase()
  const s = (seniority || '').toLowerCase()

  if (t.includes('owner') || t.includes('founder') || t.includes('titolare') ||
      t.includes('proprietario') || t.includes('ceo') || t.includes('imprenditore') ||
      t.includes('co-founder') || t.includes('socio')) {
    return 'Imprenditore'
  }
  if (t.includes('libero professionista') || t.includes('freelance') ||
      t.includes('consulente') || t.includes('avvocato') || t.includes('commercialista') ||
      t.includes('architetto') || t.includes('ingegnere') || t.includes('medico') ||
      t.includes('notaio') || t.includes('dentista')) {
    return 'Libero Professionista / P.IVA'
  }
  if (s === 'owner' || s === 'founder' || s === 'c_suite') {
    return 'Imprenditore'
  }
  if (s === 'director' || s === 'vp' || s === 'manager') {
    return 'Dirigente / Manager'
  }
  return 'Dipendente'
}

// ── Detect triggers from available data ─────────────────────────
function detectTriggers(person: MergedPerson): string[] {
  const triggers: string[] = []

  // Job change (if employment history shows recent change)
  if (person.employmentHistory?.length >= 2) {
    const current = person.employmentHistory.find((e: any) => e.current)
    if (current?.startDate) {
      const startYear = parseInt(current.startDate.split('-')[0])
      if (startYear && new Date().getFullYear() - startYear <= 1) {
        triggers.push('Cambio lavoro recente')
      }
    }
  }

  // Title-based triggers
  const t = (person.title || '').toLowerCase()
  if (t.includes('new') || t.includes('neo') || t.includes('junior')) {
    triggers.push('Ruolo recente')
  }

  // Owner/founder = needs business insurance
  if (person.employmentType === 'Imprenditore') {
    triggers.push('Titolare/Fondatore - protezione patrimonio')
  }

  // Freelancer = needs professional liability
  if (person.employmentType === 'Libero Professionista / P.IVA') {
    triggers.push('Professionista - RC Professionale')
  }

  // Company size triggers
  const size = parseInt(person.companySize || '0')
  if (size > 5) {
    triggers.push('Dipendenti > 5 - D&O / Welfare')
  }
  if (size > 20) {
    triggers.push('Azienda strutturata - Polizza collettiva')
  }

  return triggers
}

// ── Estimate potential ──────────────────────────────────────────
function estimatePotential(person: MergedPerson): string | null {
  const employeeCount = parseInt(person.companySize || '0')
  const isOwner = person.employmentType === 'Imprenditore'
  const isProfessional = person.employmentType === 'Libero Professionista / P.IVA'

  if (isOwner && employeeCount > 20) return '5.000 - 15.000 €/anno'
  if (isOwner && employeeCount > 5) return '2.500 - 8.000 €/anno'
  if (isOwner) return '1.500 - 4.000 €/anno'
  if (isProfessional) return '1.000 - 3.000 €/anno'
  if (employeeCount > 50) return '10.000+ €/anno'

  return '500 - 2.000 €/anno'
}

// ── Merge Snov + Apollo results ─────────────────────────────────
function mergeResults(snovPersons: SnovPerson[], apolloPersons: ApolloPerson[]): MergedPerson[] {
  const merged = new Map<string, MergedPerson>()

  // Add Snov results
  for (const sp of snovPersons) {
    const key = (sp.email || sp.name || Math.random().toString()).toLowerCase()
    merged.set(key, {
      id: `snov-${key}`,
      name: sp.name || '—',
      firstName: sp.firstName,
      lastName: sp.lastName,
      email: sp.email,
      emailVerified: false,
      phone: sp.phone,
      mobilePhone: null,
      title: sp.position,
      seniority: null,
      companyName: sp.companyName,
      companyDomain: sp.companyDomain,
      companySize: null,
      industry: sp.industry,
      linkedin: sp.linkedin,
      city: sp.location,
      country: sp.country,
      photoUrl: null,
      employmentHistory: [],
      sources: ['snov'],
      employmentType: null,
      estimatedPotential: null,
      triggers: [],
    })
  }

  // Merge Apollo results (enhance or add)
  for (const ap of apolloPersons) {
    const key = (ap.email || ap.name || Math.random().toString()).toLowerCase()

    if (merged.has(key)) {
      // Enhance existing entry with Apollo data
      const existing = merged.get(key)!
      if (!existing.phone && ap.phone) existing.phone = ap.phone
      if (!existing.mobilePhone && ap.mobilePhone) existing.mobilePhone = ap.mobilePhone
      if (!existing.seniority && ap.seniority) existing.seniority = ap.seniority
      if (!existing.companySize && ap.companySize) existing.companySize = ap.companySize
      if (!existing.linkedin && ap.linkedin) existing.linkedin = ap.linkedin
      if (!existing.photoUrl && ap.photoUrl) existing.photoUrl = ap.photoUrl
      if (!existing.title && ap.title) existing.title = ap.title
      if (ap.emailVerified) existing.emailVerified = true
      if (ap.employmentHistory?.length) existing.employmentHistory = ap.employmentHistory
      existing.sources.push('apollo')
    } else {
      // New entry from Apollo
      merged.set(key, {
        id: `apollo-${key}`,
        name: ap.name || '—',
        firstName: ap.firstName,
        lastName: ap.lastName,
        email: ap.email,
        emailVerified: ap.emailVerified,
        phone: ap.phone,
        mobilePhone: ap.mobilePhone,
        title: ap.title,
        seniority: ap.seniority,
        companyName: ap.companyName,
        companyDomain: ap.companyDomain,
        companySize: ap.companySize,
        industry: ap.industry,
        linkedin: ap.linkedin,
        city: ap.city,
        country: ap.country,
        photoUrl: ap.photoUrl,
        employmentHistory: ap.employmentHistory || [],
        sources: ['apollo'],
        employmentType: null,
        estimatedPotential: null,
        triggers: [],
      })
    }
  }

  // Post-process: infer fields + triggers
  const results = Array.from(merged.values())
  for (const person of results) {
    person.employmentType = inferEmploymentType(person.title, person.seniority)
    person.triggers = detectTriggers(person)
    person.estimatedPotential = estimatePotential(person)
  }

  // Sort: more complete data first
  results.sort((a, b) => {
    const scoreA = (a.email ? 2 : 0) + (a.phone || a.mobilePhone ? 2 : 0) + (a.linkedin ? 1 : 0) + (a.title ? 1 : 0)
    const scoreB = (b.email ? 2 : 0) + (b.phone || b.mobilePhone ? 2 : 0) + (b.linkedin ? 1 : 0) + (b.title ? 1 : 0)
    return scoreB - scoreA
  })

  return results
}

// ── Route handler ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

    const body = await req.json()
    // mode can be 'role', 'company', 'person'. It defaults to 'role' for backward compatibility.
    const { mode = 'role', query, companyName, personName, location, page = 1, perPage = 25 } = body

    // Support both the new structure and the old one
    const effectiveQuery = query || personName || ''

    const hasSnovKeys = !!(process.env.SNOV_CLIENT_ID && process.env.SNOV_CLIENT_SECRET)
    const hasApolloKey = !!process.env.APOLLO_API_KEY
    const sources: string[] = []

    let snovPersons: any[] = []
    let apolloPersons: any[] = []
    let total = 0
    let hasMore = false

    // Utility per pulire la ragione sociale
    const cleanCompany = (name: string) => {
      if (!name) return ''
      return name.replace(/\b(s\.r\.l\.|srl|s\.p\.a\.|spa|snc|s\.n\.c\.|sas|s\.a\.s\.|ltd|inc|llc)\b/gi, '').trim()
    }

    const cleanedCompanyName = cleanCompany(companyName)

    // ── WATERFALL LOGIC (Apollo -> Snov -> Hunter) ──
    
    // 1. Try Apollo First (Primary Database)
    if (hasApolloKey) {
      try {
        if (mode === 'company' && cleanedCompanyName) {
          // Ricerca Intera Azienda (estrae dipendenti)
          const apolloResult = await apolloPeopleSearch({
            organizationName: cleanedCompanyName,
            location: location || undefined,
            country: 'Italy',
            page,
            perPage: Math.min(perPage, 10),
          })
          apolloPersons = apolloResult.persons
          total = apolloResult.total
          hasMore = apolloResult.hasMore
        } else if (mode === 'person') {
          // Ricerca Specifica Persona
          const apolloResult = await apolloPeopleSearch({
            query: effectiveQuery,
            organizationName: cleanedCompanyName || undefined, // opzionale
            location: location || undefined,
            // Rimosso country: 'Italy' per la ricerca persona singola perché troppo restrittivo (filtra fuori chi non ha il paese specificato)
            page,
            perPage: Math.min(perPage, 10),
          })
          apolloPersons = apolloResult.persons
          total = apolloResult.total
          hasMore = apolloResult.hasMore
        } else {
          // mode === 'role' (Ricerca Ruolo/Settore)
          const apolloResult = await apolloPeopleSearch({
            personTitles: effectiveQuery ? [effectiveQuery] : undefined,
            location: location || undefined,
            country: 'Italy',
            page,
            perPage: Math.min(perPage, 10),
          })
          apolloPersons = apolloResult.persons
          total = apolloResult.total
          hasMore = apolloResult.hasMore
        }
        
        if (apolloPersons.length > 0) sources.push('Apollo')
      } catch (e) {
        console.error('Apollo search error:', e)
      }
    }

    // 2. Fallback to Snov.io if Apollo found nothing
    if (apolloPersons.length === 0 && hasSnovKeys) {
      try {
        let snovQuery = ''
        if (mode === 'role') snovQuery = effectiveQuery
        else if (mode === 'person') snovQuery = effectiveQuery // Snov doesn't handle person well here
        else if (mode === 'company') snovQuery = '' // Snov needs position, so if we just search company, it might fail unless we search domain. We'll pass empty and it might just fail nicely.
        
        const snovResult = await snovDatabaseSearch({
          position: snovQuery,
          location: location || undefined,
          country: 'IT',
          page,
          perPage,
        })
        snovPersons = snovResult.persons
        total = Math.max(total, snovResult.total)
        hasMore = hasMore || snovResult.hasMore
        if (snovPersons.length > 0) sources.push('Snov.io')
      } catch (e) {
        console.error('Snov search error:', e)
      }
    }

    // Merge results
    const results = mergeResults(snovPersons, apolloPersons)

    return NextResponse.json({
      results,
      total,
      sources,
      page,
      perPage,
      hasMore,
    })
  } catch (e: any) {
    console.error('[database-search] error:', e)
    return NextResponse.json({ error: e.message, results: [] }, { status: 500 })
  }
}
