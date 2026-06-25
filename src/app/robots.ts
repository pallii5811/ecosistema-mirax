import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: 'Googlebot',
        allow: '/',
        disallow: ['/dashboard/', '/api/', '/auth/', '/reset-password/'],
      },
      {
        userAgent: 'Googlebot-Image',
        allow: '/',
      },
      {
        userAgent: 'Bingbot',
        allow: '/',
        disallow: ['/dashboard/', '/api/', '/auth/', '/reset-password/'],
      },
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard/', '/api/', '/auth/', '/reset-password/'],
      },
    ],
    sitemap: 'https://www.miraxgroup.it/sitemap.xml',
    host: 'https://www.miraxgroup.it',
  }
}
