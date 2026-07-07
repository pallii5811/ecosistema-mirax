/**
 * Universe Data Model — core types.
 *
 * Every commercial object in MIRAX becomes an entity with observations,
 * relationships, and events.
 */

export type EntityType =
  | 'company'
  | 'person'
  | 'website'
  | 'technology'
  | 'job'
  | 'event'
  | 'document'
  | 'product'
  | 'location'
  | 'tender'
  | 'investor'
  | 'product_category'

export type RelationshipType =
  | 'owns'
  | 'uses'
  | 'hires'
  | 'has'
  | 'receives'
  | 'buys'
  | 'competes_with'
  | 'located_in'
  | 'related_to'
  | 'mentioned_in'
  | 'supplies'
  | 'supplied_by'
  | 'sells_to'
  | 'buys_from'
  | 'partner_of'
  | 'invested_in'
  | 'received_investment_from'
  | 'customer_of'
  | 'has_customer'
  | 'awarded_to'
  | 'awarded_by'
  | 'competed_for'

export type AliasType =
  | 'domain'
  | 'vat'
  | 'linkedin'
  | 'facebook'
  | 'instagram'
  | 'phone'
  | 'email'
  | 'name_variant'

export type UniverseEventType =
  | 'website_changed'
  | 'pixel_installed'
  | 'pixel_removed'
  | 'new_hiring'
  | 'new_director'
  | 'crm_installed'
  | 'crm_change'
  | 'ads_started'
  | 'tender_won'
  | 'funding_received'
  | 'registry_change'
  | 'sector_investment'
  | 'revenue_changed'
  | 'employees_changed'
  | 'supplier_sought'
  | 'expansion_started'
  | 'new_product_launched'
  | 'market_entered'
  | 'executive_change'
  | 'partnership_announced'

export interface UniverseEntity {
  id: string
  canonical_id: string
  entity_type: EntityType
  name: string
  slug?: string | null
  country?: string | null
  city?: string | null
  region?: string | null
  metadata?: Record<string, unknown>
  merged_into_id?: string | null
  confidence?: number
  first_seen_at?: string
  last_seen_at?: string
  created_at?: string
  updated_at?: string
}

export interface UniverseEntityAlias {
  id?: string
  entity_id: string
  alias_type: AliasType
  alias_value: string
  confidence?: number
  created_at?: string
}

export interface UniverseObservation {
  id?: string
  entity_id: string
  attribute: string
  value: unknown
  observed_at: string
  source: string
  confidence?: number
  metadata?: Record<string, unknown>
  dedup_key?: string
  created_at?: string
}

export interface UniverseRelationship {
  id?: string
  source_entity_id: string
  target_entity_id: string
  relationship_type: RelationshipType
  confidence?: number
  observed_at: string
  source: string
  metadata?: Record<string, unknown>
  created_at?: string
}

export interface UniverseEvent {
  id?: string
  entity_id?: string | null
  event_type: UniverseEventType
  payload: Record<string, unknown>
  occurred_at: string
  processed_at?: string | null
  source: string
  processed?: boolean
  error_count?: number
  error_message?: string | null
  dedup_key?: string
  created_at?: string
}

export interface UniverseUserContext {
  user_id: string
  entity_id: string
  context_type: 'saved' | 'contacted' | 'pipeline' | 'ignored' | 'note' | 'hidden'
  metadata?: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

export interface TimelinePoint {
  attribute: string
  value: unknown
  observed_at: string
  source: string
  confidence: number
}

export interface RelatedEntity {
  relationship_id: string
  related_entity_id: string
  related_entity_type: EntityType
  related_entity_name: string
  relationship_type: RelationshipType
  confidence: number
  observed_at: string
}

export interface EntityGraphNode {
  id: string
  entity_type: EntityType
  name: string
  city?: string | null
  country?: string | null
}

export interface EntityGraphEdge {
  source: string
  target: string
  relationship_type: RelationshipType
}

export interface IngestResult {
  entity_id: string
  entity_type: EntityType
  observations_created: number
  relationships_created: number
  events_created: number
  aliases_created: number
  is_new: boolean
}
