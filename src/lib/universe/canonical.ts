/**
 * Canonical ID normalisation for Universe entities.
 *
 * A canonical_id must be deterministic, stable, and deduplicating.
 */

export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null
  try {
    let url = input.trim().toLowerCase()
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    const parsed = new URL(url)
    let host = parsed.hostname.replace(/^www\./, '')
    // Strip port
    host = host.replace(/:\d+$/, '')
    return host || null
  } catch {
    return null
  }
}

export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null
  const digits = input.replace(/\D/g, '')
  if (digits.length < 6) return null
  // Italian E.164 simplified
  if (digits.startsWith('39') && digits.length >= 10) return digits
  if (digits.startsWith('3') && digits.length === 10) return `39${digits}`
  return digits
}

export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null
  const email = input.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}

export function normalizeVat(input: string | null | undefined): string | null {
  if (!input) return null
  const digits = input.replace(/\D/g, '')
  if (digits.length !== 11) return null
  return `IT${digits}`
}

export function normalizeLinkedIn(input: string | null | undefined): string | null {
  if (!input) return null
  try {
    const url = new URL(input.trim().toLowerCase())
    const path = url.pathname.replace(/\/$/, '')
    if (path.startsWith('/in/') || path.startsWith('/company/')) {
      return `linkedin.com${path}`
    }
    return null
  } catch {
    return null
  }
}

export function slugifyTechnology(input: string | null | undefined): string | null {
  if (!input) return null
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

export function slugifyLocation(city: string | null | undefined, country = 'IT'): string | null {
  if (!city) return null
  const slug = city.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  return slug ? `${country.toLowerCase()}:${slug}` : null
}

export function slugifyName(input: string | null | undefined): string | null {
  if (!input) return null
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function buildCompanyCanonicalId(
  domain: string | null | undefined,
  vat: string | null | undefined,
  phone: string | null | undefined
): string | null {
  return normalizeDomain(domain) || normalizeVat(vat) || normalizePhone(phone) || null
}
