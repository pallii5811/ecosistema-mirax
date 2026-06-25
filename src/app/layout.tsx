import type { Metadata } from 'next'
import './globals.css'
import ToastProvider from '@/components/ToastProvider'
import CookieConsent from '@/components/CookieConsent'
import { Analytics } from '@vercel/analytics/next'

const BASE_URL = 'https://www.miraxgroup.it'

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),

  // ── Title ──────────────────────────────────────────────────────────
  title: {
    default: 'MIRAX — Lead Intelligence B2B Italia',
    template: '%s | MIRAX',
  },

  // ── Description ────────────────────────────────────────────────────
  description:
    'Lead intelligence B2B italiano. Discovery territoriale AI, audit tecnico, pitch AI, Centro Outreach e pipeline. Prova gratis con 10 crediti.',

  // ── Keywords ───────────────────────────────────────────────────────
  keywords: [
    'lead generation B2B Italia',
    'software lead generation italiano',
    'trovare clienti agenzia web',
    'audit seo automatico',
    'database aziende italiane',
    'prospecting B2B tool',
    'trovare clienti freelance',
    'lead qualificati italia',
    'outbound B2B italia',
    'pitch AI vendita',
    'crm lead agenzia',
    'software trovare clienti',
    'aziende senza google tag manager',
    'aziende senza meta pixel',
    'lead generation agenzia marketing',
    'contatti aziende italiane verificati',
    'scraping lead GDPR compliant',
    'intelligenza artificiale lead generation',
    'cold email b2b italia',
    'prospecting automatico',
  ],

  // ── Authors ────────────────────────────────────────────────────────
  authors: [{ name: 'MIRAX Group', url: BASE_URL }],
  creator: 'MIRAX Group',
  publisher: 'MIRAX Group',

  // ── Open Graph ─────────────────────────────────────────────────────
  openGraph: {
    type: 'website',
    locale: 'it_IT',
    url: BASE_URL,
    siteName: 'MIRAX',
    title: 'MIRAX — Lead Intelligence B2B Italia',
    description:
      'Lead intelligence B2B italiano. Discovery territoriale AI, audit tecnico, pitch AI, Centro Outreach e pipeline. Prova gratis con 10 crediti.',
    images: [
      {
        url: `${BASE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: 'MIRAX — Lead Intelligence B2B Italia',
        type: 'image/png',
      },
    ],
  },

  // ── Twitter / X ────────────────────────────────────────────────────
  twitter: {
    card: 'summary_large_image',
    site: '@miraxgroup',
    creator: '@miraxgroup',
    title: 'MIRAX — Lead Intelligence B2B Italia',
    description:
      'Ricerca in italiano, audit tecnico, pitch AI e pipeline. 10 crediti gratis alla registrazione.',
    images: [`${BASE_URL}/og-image.png`],
  },

  // ── Icons ──────────────────────────────────────────────────────────
  icons: {
    icon: [
      { url: '/mirax-icon.svg?v=3', type: 'image/svg+xml' },
    ],
    shortcut: '/mirax-icon.svg?v=3',
    apple: '/mirax-icon.svg?v=3',
  },

  // ── Robots ─────────────────────────────────────────────────────────
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },

  // ── Canonical & alternates ─────────────────────────────────────────
  alternates: {
    canonical: BASE_URL,
    languages: { 'it-IT': BASE_URL },
  },

  // ── Verification ───────────────────────────────────────────────────
  verification: {
    google: 'GOOGLE_SEARCH_CONSOLE_TOKEN', // ← sostituisci con il token reale
  },

  // ── App info ───────────────────────────────────────────────────────
  applicationName: 'MIRAX',
  category: 'Business Software',
  classification: 'Lead Generation Software',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="it" dir="ltr">
      <head>
        {/* Preconnect per velocità massima */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* DNS prefetch per servizi esterni */}
        <link rel="dns-prefetch" href="https://vercel-insights.com" />
        <link rel="dns-prefetch" href="https://va.vercel-scripts.com" />
        {/* Theme color per mobile browser */}
        <meta name="theme-color" content="#09090b" />
        <meta name="color-scheme" content="dark light" />
        {/* Mobile */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="MIRAX" />
        <link rel="icon" href="/mirax-icon.svg?v=3" type="image/svg+xml" />
        <link rel="shortcut icon" href="/mirax-icon.svg?v=3" />
        {/* Geo targeting Italia */}
        <meta name="geo.region" content="IT" />
        <meta name="geo.placename" content="Italia" />
        <meta name="language" content="Italian" />
        <meta name="content-language" content="it" />
      </head>
      <body className="antialiased">
        <ToastProvider>
          {children}
          <CookieConsent />
          <Analytics />
        </ToastProvider>
      </body>
    </html>
  )
}
