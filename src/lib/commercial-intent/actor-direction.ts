import type { CommercialIntentSpec } from './types'

const INVERSE_ROLE_PAIRS: Array<[string, string[]]> = [
  ['recipient', ['investor', 'lender', 'funder', 'provider', 'grantor']],
  ['employer', ['recruiter', 'job_board', 'staffing_agency', 'publisher']],
  ['buyer', ['vendor', 'seller', 'supplier', 'provider']],
  ['winner', ['contracting_authority', 'buyer_authority', 'publisher']],
  ['website_owner', ['web_agency', 'directory', 'publisher']],
  ['expanding_company', ['landlord', 'municipality', 'publisher']],
]

const EXCLUDED_AS_TARGET = new Set([
  'publisher',
  'recruiter',
  'investor',
  'lender',
  'funder',
  'vendor',
  'seller',
  'provider',
  'job_board',
  'directory',
  'advisor',
  'authority',
  'contracting_authority',
])

function norm(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

/**
 * Detect actor-direction inversion using target role, exclusions and event relationships.
 * Does not auto-pass on query keywords alone.
 */
export function hasActorDirectionInversion(spec: CommercialIntentSpec): boolean {
  const role = norm(spec.target_role)
  if (!role) return false

  const excluded = new Set(spec.excluded_roles.map(norm))
  if (excluded.has(role)) return true
  if (EXCLUDED_AS_TARGET.has(role)) return true

  for (const [expected, inverses] of INVERSE_ROLE_PAIRS) {
    if (role === expected) continue
    if (inverses.includes(role)) {
      const rels = spec.required_relationships.map((r) => r.toLowerCase())
      const expectsRecipient = rels.some((r) => /recipient|received|raising|funding|capital/.test(r))
      const expectsEmployer = rels.some((r) => /employer|hiring|staffing|workforce/.test(r))
      const expectsBuyer = rels.some((r) => /buyer|seeking|customer|procurement/.test(r))
      if (expectsRecipient && inverses.includes(role)) return true
      if (expectsEmployer && ['recruiter', 'job_board', 'staffing_agency'].includes(role)) return true
      if (expectsBuyer && ['vendor', 'seller', 'supplier'].includes(role)) return true
    }
  }

  if (
    spec.request_mode === 'seller_driven_lead_discovery' &&
    ['seller', 'vendor', 'provider', 'consultant'].includes(role)
  ) {
    return true
  }

  return false
}
