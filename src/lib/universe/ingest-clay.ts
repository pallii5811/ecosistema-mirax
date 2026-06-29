/**
 * Ingest a ClayEnrichedLead into Universe.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClayEnrichedLead } from '@/lib/clay-enrichment'
import type { IngestResult, RelationshipType, UniverseObservation } from './types.ts'
import { normalizeDomain, normalizeEmail, normalizePhone, normalizeVat, slugifyName } from './canonical.ts'
import { upsertEntity } from './entity-repository.ts'
import { createObservations } from './observation-repository.ts'
import { createRelationships } from './relationship-repository.ts'

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'string' ? Number(value.replace(/\D/g, '')) : value
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function ingestClayEnrichedLead(
  sb: SupabaseClient,
  lead: ClayEnrichedLead,
  source: string,
  userId?: string | null
): Promise<IngestResult> {
  const now = new Date().toISOString()
  const domain = normalizeDomain(lead.website)
  const canonicalId = domain ?? normalizePhone(lead.mapsPhone) ?? slugifyName(lead.companyName)

  if (!canonicalId) {
    throw new Error('Impossibile determinare canonical_id per ClayEnrichedLead')
  }

  const observations: Omit<UniverseObservation, 'id' | 'created_at'>[] = []
  const relationships: Array<{
    source_entity_id: string
    target_entity_id: string
    relationship_type: RelationshipType
    observed_at: string
    source: string
    confidence?: number
    metadata?: Record<string, unknown>
  }> = []

  const aliases: Array<{ alias_type: 'domain' | 'vat' | 'phone' | 'email' | 'linkedin'; alias_value: string; confidence?: number }> = []
  if (domain) aliases.push({ alias_type: 'domain', alias_value: domain, confidence: 1.0 })
  const vat = normalizeVat(lead.partitaIva)
  if (vat) aliases.push({ alias_type: 'vat', alias_value: vat, confidence: 0.95 })
  const phone = normalizePhone(lead.bestPhone ?? lead.mapsPhone)
  if (phone) aliases.push({ alias_type: 'phone', alias_value: phone, confidence: 0.9 })
  const email = normalizeEmail(lead.bestEmail)
  if (email) aliases.push({ alias_type: 'email', alias_value: email, confidence: 0.9 })
  const linkedinCompany = lead.linkedinCompany ? normalizeDomain(lead.linkedinCompany) ?? lead.linkedinCompany : null
  if (linkedinCompany) aliases.push({ alias_type: 'linkedin', alias_value: linkedinCompany, confidence: 0.85 })

  const { entity: company, is_new } = await upsertEntity(sb, {
    canonical_id: canonicalId,
    entity_type: 'company',
    name: lead.companyName,
    slug: slugifyName(lead.companyName),
    country: 'IT',
    city: lead.city,
    metadata: {
      category: lead.category,
      address: lead.mapsAddress,
      legal_name: lead.ragineSociale,
      ateco_code: lead.codiceAteco,
      ateco_description: lead.descrizioneAteco,
      company_size: lead.companySize,
      employment_type: lead.employmentType,
      enrichment_quality: lead.enrichmentQuality,
      enrichment_sources: lead.enrichmentSources,
    },
    confidence: 1.0,
    aliases,
  })

  // Registry observations
  const employees = toNumber(lead.dipendenti)
  if (employees !== null) {
    observations.push({ entity_id: company.id, attribute: 'employees', value: employees, observed_at: now, source, confidence: 0.95 })
  }
  const revenue = toNumber(lead.fatturato)
  if (revenue !== null) {
    observations.push({ entity_id: company.id, attribute: 'revenue', value: revenue, observed_at: now, source, confidence: 0.95 })
  }
  if (lead.dataCostutuzione) {
    observations.push({ entity_id: company.id, attribute: 'founded_year', value: Number(lead.dataCostutuzione.slice(0, 4)), observed_at: now, source, confidence: 0.9 })
  }
  if (lead.formaGiuridica) {
    observations.push({ entity_id: company.id, attribute: 'legal_form', value: lead.formaGiuridica, observed_at: now, source, confidence: 0.9 })
  }

  // Contacts
  if (lead.bestEmail) {
    observations.push({ entity_id: company.id, attribute: 'email', value: lead.bestEmail, observed_at: now, source, confidence: 0.9 })
  }
  if (lead.bestPhone) {
    observations.push({ entity_id: company.id, attribute: 'phone', value: lead.bestPhone, observed_at: now, source, confidence: 0.9 })
  }
  if (lead.mobilePhone) {
    observations.push({ entity_id: company.id, attribute: 'mobile_phone', value: lead.mobilePhone, observed_at: now, source, confidence: 0.9 })
  }
  if (lead.pecEmail) {
    observations.push({ entity_id: company.id, attribute: 'pec_email', value: lead.pecEmail, observed_at: now, source, confidence: 0.95 })
  }

  // Social presence observations
  const socialPlatforms = [
    ['linkedin_company', lead.linkedinCompany],
    ['linkedin_person', lead.linkedinPerson],
    ['facebook', lead.facebook],
    ['instagram', lead.instagram],
    ['tiktok', lead.tiktok],
    ['youtube', lead.youtube],
    ['twitter', lead.twitter],
  ] as const
  for (const [attr, value] of socialPlatforms) {
    if (value) {
      observations.push({ entity_id: company.id, attribute: attr, value, observed_at: now, source, confidence: 0.85 })
    }
  }

  // Person entity + has relationship
  if (lead.personName) {
    const personCanonical = lead.personLinkedin ? normalizeDomain(lead.personLinkedin) ?? slugifyName(lead.personName) : slugifyName(lead.personName)
    if (personCanonical) {
      const { entity: person } = await upsertEntity(sb, {
        canonical_id: personCanonical,
        entity_type: 'person',
        name: lead.personName,
        slug: slugifyName(lead.personName),
        metadata: {
          role: lead.personRole,
          seniority: lead.personSeniority,
          linkedin: lead.personLinkedin,
          photo: lead.personPhoto,
        },
        confidence: 0.75,
      })
      relationships.push({
        source_entity_id: company.id,
        target_entity_id: person.id,
        relationship_type: 'has',
        observed_at: now,
        source,
        confidence: 0.75,
        metadata: { role: lead.personRole },
      })
    }
  }

  // Team members as person entities
  for (const member of lead.teamMembers ?? []) {
    if (!member.name) continue
    const memberCanonical = slugifyName(member.name)
    if (!memberCanonical) continue
    const { entity: person } = await upsertEntity(sb, {
      canonical_id: memberCanonical,
      entity_type: 'person',
      name: member.name,
      slug: memberCanonical,
      metadata: { role: member.role },
      confidence: 0.6,
    })
    relationships.push({
      source_entity_id: company.id,
      target_entity_id: person.id,
      relationship_type: 'has',
      observed_at: now,
      source,
      confidence: 0.6,
      metadata: { role: member.role },
    })
  }

  // User context (private)
  if (userId) {
    await sb.from('universe_user_context').upsert(
      {
        user_id: userId,
        entity_id: company.id,
        context_type: 'saved',
        metadata: { source: 'enrich-lead' },
      },
      { onConflict: 'user_id, entity_id, context_type' }
    )
  }

  const obsCreated = await createObservations(sb, observations as UniverseObservation[])
  const relCreated = await createRelationships(sb, relationships)

  return {
    entity_id: company.id,
    entity_type: 'company',
    observations_created: obsCreated.length,
    relationships_created: relCreated.length,
    events_created: 0,
    aliases_created: aliases.length,
    is_new,
  }
}
