import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://www.miraxgroup.it'
  const now = new Date().toISOString()

  return [
    // ── Pagine principali (alta priorità) ────────────────────────────
    {
      url: baseUrl,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },

    // ── Pagine di conversione ────────────────────────────────────────
    {
      url: `${baseUrl}/signup`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/login`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    },

    // ── Anchor sections (per Google sitelinks) ───────────────────────
    {
      url: `${baseUrl}/#pricing`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/#how-it-works`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/#features`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    },

    // ── Pagine legali ────────────────────────────────────────────────
    {
      url: `${baseUrl}/privacy`,
      lastModified: '2025-01-01',
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: '2025-01-01',
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/cookie-policy`,
      lastModified: '2025-01-01',
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ]
}
