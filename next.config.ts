import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {
    root: process.cwd(),
  },

  // ── Image optimization ─────────────────────────────────────────────
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
  },

  // ── Compression ────────────────────────────────────────────────────
  compress: true,

  // ── Powered-by header removal (security) ───────────────────────────
  poweredByHeader: false,

  // ── Trailing slashes per canonical consistency ─────────────────────
  trailingSlash: false,

  // ── HTTP Headers — security + SEO boost ────────────────────────────
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Security headers — improve Lighthouse score (ranking signal)
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
        ],
      },
      // Cache static assets aggressively
      {
        source: '/(.*)\\.(svg|png|jpg|jpeg|gif|ico|webp|avif|woff2|woff)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },

  // ── Redirects — canonical domain enforcement ───────────────────────
  async redirects() {
    return [
      // www → non-www (or reverse — adjust per your domain setup)
      // Uncomment if you want to enforce non-www:
      // {
      //   source: '/:path*',
      //   has: [{ type: 'host', value: 'miraxgroup.it' }],
      //   destination: 'https://www.miraxgroup.it/:path*',
      //   permanent: true,
      // },
    ];
  },
};

export default nextConfig;
