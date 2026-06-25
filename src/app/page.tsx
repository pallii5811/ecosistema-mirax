import type { Metadata } from 'next'
import { LANDING } from '@/lib/landing-copy'
import '@/styles/landing-tokens.css'
import LandingFooter from '@/components/landing/LandingFooter'
import FaqComplianceSection from '@/components/landing/FaqComplianceSection'
import HeroSection from '@/components/landing/HeroSection'
import HowItWorks from '@/components/landing/HowItWorks'
import ImpactStatsSection from '@/components/landing/ImpactStatsSection'
import LandingNavbar from '@/components/landing/LandingNavbar'
import PricingSection from '@/components/landing/PricingSection'
import ProductShowcase from '@/components/landing/ProductShowcase'
import SalesPlatformSection from '@/components/landing/SalesPlatformSection'
import { TestimonialSection } from '@/components/landing/TestimonialSection'
import { VsSection } from '@/components/landing/VsSection'
import { ScrollAnimationObserver } from '@/components/ui/use-scroll-animation'
import { UseCases } from '@/components/landing/use-cases'
import { Guarantee } from '@/components/landing/guarantee'
import { TrustBadges } from '@/components/landing/trust-badges'

export const metadata: Metadata = {
  title: 'MIRAX — Sales Automation B2B Italia | Ricerca, Outreach e Pipeline',

  description:
    'Trova clienti B2B, contattali e chiudi il deal da un\'unica piattaforma: ricerca AI, audit tecnico, lead scoring, pitch, sequenze email, Sales Command Center e pipeline. Prova gratis con 10 crediti.',

  keywords: [
    'lead generation B2B Italia',
    'software lead generation italiano',
    'trovare clienti agenzia web',
    'audit seo automatico italia',
    'database aziende italiane',
    'prospecting B2B automatico',
    'trovare clienti web agency',
    'lead qualificati italia',
    'outbound B2B italia',
    'pitch AI email fredda',
    'contatti aziende italiane verificati',
    'aziende senza meta pixel italia',
    'aziende senza google tag manager',
    'intelligence B2B italia',
    'trovare clienti freelance marketing',
    'generare lead B2B automaticamente',
    'scraping lead GDPR compliant',
    'cold outreach tool italia',
    'trovare clienti web design italia',
    'lead generation agenzia seo',
    'software trovare clienti PMI',
    'numero cellulare titolare azienda',
    'email decision maker italia',
    'aziende con problemi SEO italia',
  ],

  openGraph: {
    title: 'MIRAX — Lead Intelligence B2B per l\'Italia',
    description:
      'Cerca in italiano, audita ogni sito, genera pitch e sequenze, gestisci outreach con guardrail anti-ban e pipeline integrata. 10 crediti gratis.',
    url: 'https://www.miraxgroup.it',
    siteName: 'MIRAX',
    locale: 'it_IT',
    type: 'website',
    images: [
      {
        url: 'https://www.miraxgroup.it/og-image.png',
        width: 1200,
        height: 630,
        alt: 'MIRAX — Lead intelligence B2B per l\'Italia',
      },
    ],
  },

  twitter: {
    card: 'summary_large_image',
    site: '@miraxgroup',
    title: 'MIRAX — Lead Intelligence B2B Italia',
    description:
      'Ricerca AI, audit tecnico, pitch personalizzato e pipeline commerciale. Prova gratis con 10 crediti.',
    images: ['https://www.miraxgroup.it/og-image.png'],
  },

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },

  alternates: {
    canonical: 'https://www.miraxgroup.it',
  },
}

export default function Home() {
  const BASE = 'https://www.miraxgroup.it'

  // ── 1. SoftwareApplication — core product schema ──────────────────
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'MIRAX',
    alternateName: 'MIRAX Group Lead Generation',
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Lead Generation Software',
    operatingSystem: 'Web',
    url: BASE,
    image: `${BASE}/og-image.png`,
    screenshot: `${BASE}/og-image.png`,
    description:
      `MIRAX è la piattaforma di sales automation B2B per l'Italia. ${LANDING.discovery.headline}, audit tecnico, lead scoring adattivo, pitch AI, sequenze email, Sales Command Center, Centro Outreach con guardrail, pipeline kanban e export CSV/HubSpot.`,
    featureList: [
      'Ricerca AI in linguaggio naturale italiano',
      `${LANDING.discovery.engine} con 16+ filtri tecnici`,
      'Audit automatico (SEO, Pixel, GTM, SSL, DMARC, social)',
      'Lead Hotlist con score adattivo 0-100',
      'Sales Command Center con alert proattivi sulla pipeline',
      'Pitch AI con canale suggerito (WhatsApp, email, LinkedIn)',
      'Centro Outreach con log, limite giornaliero e anti-duplicato 7 giorni',
      'Human-in-the-loop su ogni invio outreach',
      'Sequenze email AI multi-step',
      'Pipeline commerciale kanban integrata',
      'Ambiente tematico per verticale/progetto',
      'Export CSV e sync HubSpot/webhook',
      'Server in Unione Europea',
    ],
    offers: [
      {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'EUR',
        name: 'Esplora — Gratuito',
        description: '10 crediti gratuiti alla registrazione. Un credito = un lead con telefono o email. Nessuna carta richiesta.',
        availability: 'https://schema.org/InStock',
        url: `${BASE}/signup`,
      },
      {
        '@type': 'Offer',
        price: '49',
        priceCurrency: 'EUR',
        name: 'Starter',
        description: '1.200 crediti al mese. Tutte le funzionalità della piattaforma.',
        priceValidUntil: '2026-12-31',
        availability: 'https://schema.org/InStock',
        url: `${BASE}/#pricing`,
      },
      {
        '@type': 'Offer',
        price: '99',
        priceCurrency: 'EUR',
        name: 'PRO',
        description: '3.000 crediti al mese. Volume maggiore per agency in crescita.',
        priceValidUntil: '2026-12-31',
        availability: 'https://schema.org/InStock',
        url: `${BASE}/#pricing`,
      },
      {
        '@type': 'Offer',
        price: '249',
        priceCurrency: 'EUR',
        name: 'Agency',
        description: '10.000 crediti al mese con API REST, webhook e sequenze email.',
        priceValidUntil: '2026-12-31',
        availability: 'https://schema.org/InStock',
        url: `${BASE}/#pricing`,
      },
    ],
  }

  // ── 2. Organization ───────────────────────────────────────────────
  const orgJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'MIRAX Group',
    legalName: 'MIRAX Group S.r.l.',
    url: BASE,
    logo: `${BASE}/mirax-logo-clean.svg`,
    image: `${BASE}/og-image.png`,
    description:
      'MIRAX è il motore di lead intelligence B2B per l\'Italia. Software SaaS per ricerca, audit tecnico, pitch AI, outreach e pipeline commerciale.',
    foundingDate: '2024',
    areaServed: { '@type': 'Country', name: 'Italy' },
    knowsLanguage: 'Italian',
    contactPoint: {
      '@type': 'ContactPoint',
      email: 'supporto@miraxgroup.it',
      contactType: 'customer service',
      availableLanguage: 'Italian',
      areaServed: 'IT',
    },
    sameAs: [],
  }

  // ── 3. WebSite — abilita Google Sitelinks Search Box ──────────────
  const websiteJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'MIRAX',
    alternateName: 'MIRAX Group',
    url: BASE,
    description: 'Software di lead generation B2B per agenzie e freelance italiani.',
    inLanguage: 'it-IT',
    publisher: { '@type': 'Organization', name: 'MIRAX Group', url: BASE },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${BASE}/dashboard?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  }

  // ── 4. BreadcrumbList ─────────────────────────────────────────────
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: BASE,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Funzionalità',
        item: `${BASE}/#features`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'Prezzi',
        item: `${BASE}/#pricing`,
      },
      {
        '@type': 'ListItem',
        position: 4,
        name: 'Come Funziona',
        item: `${BASE}/#how-it-works`,
      },
    ],
  }

  // ── 5. FAQ — 8 domande per massimo SERP real estate ───────────────
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'Cos\'è MIRAX e come funziona?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: `MIRAX è un software di lead intelligence B2B italiano. Scrivi in italiano cosa cerchi (es. "dentisti a Milano senza pixel"), il motore AI interpreta la query, avvia la ${LANDING.discovery.scan} e ti restituisce lead con audit tecnico, contatti, score 0-100 e pitch personalizzato. Include Centro Outreach, pipeline e export CRM.`,
        },
      },
      {
        '@type': 'Question',
        name: 'Da dove provengono i dati di MIRAX?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: `I dati provengono da ${LANDING.discovery.sources}. Ogni lead viene arricchito con audit tecnico automatico al momento della ricerca. Nessuna lista statica acquistata da broker terzi.`,
        },
      },
      {
        '@type': 'Question',
        name: 'I numeri di telefono sono reali e verificati?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Sì. MIRAX distingue automaticamente cellulari da numeri fissi. I numeri mobile vengono verificati e separati dal centralino. Ottieni il cellulare diretto del titolare o decision maker, non il numero generico dell\'ufficio.',
        },
      },
      {
        '@type': 'Question',
        name: 'Quanto costa MIRAX? C\'è un piano gratuito?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'MIRAX offre 10 crediti gratuiti alla registrazione (un credito = un lead con telefono o email). I piani a pagamento partono da €49/mese (Starter, 1.200 crediti), €99/mese (PRO, 3.000 crediti) e €249/mese (Agency, 10.000 crediti con API e webhook). Garanzia 14 giorni soddisfatti o rimborsati.',
        },
      },
      {
        '@type': 'Question',
        name: 'Come funziona il Pitch AI di MIRAX?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: "Per ogni lead, l'AI analizza i problemi reali del sito (Meta Pixel mancante, GTM assente, errori SEO) e genera un messaggio commerciale personalizzato con oggetto, corpo e CTA. Disponibile su WhatsApp, email e dal Centro Outreach.",
        },
      },
      {
        '@type': 'Question',
        name: 'MIRAX è conforme al GDPR?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Sì. MIRAX utilizza esclusivamente dati pubblicamente accessibili. Tutti i server sono in Unione Europea. Il sistema è progettato per essere GDPR-compliant by design con crittografia, accesso controllato e diritto alla cancellazione.',
        },
      },
      {
        '@type': 'Question',
        name: 'Posso cancellare l\'abbonamento in qualsiasi momento?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Sì. Cancellazione con un click, senza vincoli contrattuali, senza penali. Garanzia 14 giorni soddisfatti o rimborsati su tutti i piani.',
        },
      },
      {
        '@type': 'Question',
        name: 'Posso integrare MIRAX con il mio CRM?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Sì. Export CSV su tutti i piani. Integrazione nativa HubSpot, webhook personalizzato e API REST nel piano Agency. Sync bulk disponibile dalle liste.',
        },
      },
    ],
  }

  // ── 6. HowTo — per Google "How To" rich results ───────────────────
  const howToJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: 'Come trovare clienti B2B con MIRAX in 3 passi',
    description: 'Guida passo-passo per trovare aziende con problemi digitali e chiudere contratti in meno di 2 minuti usando MIRAX.',
    totalTime: 'PT2M',
    estimatedCost: { '@type': 'MonetaryAmount', currency: 'EUR', value: '0' },
    step: [
      {
        '@type': 'HowToStep',
        position: 1,
        name: 'Cerca il tuo target',
        text: `Scrivi in italiano cosa cerchi, ad esempio "imprese edili a Bologna senza GTM". Il motore AI interpreta la query e avvia la ${LANDING.discovery.scan} con filtri tecnici.`,
        url: `${BASE}/#how-it-works`,
      },
      {
        '@type': 'HowToStep',
        position: 2,
        name: 'Analizza i risultati',
        text: 'Ogni lead mostra score di priorità (0-100), audit tecnico completo, contatti verificati del titolare (cellulare e email) e problemi specifici del sito.',
        url: `${BASE}/#features`,
      },
      {
        '@type': 'HowToStep',
        position: 3,
        name: 'Genera il pitch e chiudi',
        text: "L'AI genera un messaggio personalizzato basato sui problemi reali del sito. Contatta dal Centro Outreach, traccia ogni invio nel log audit e gestisci il deal in pipeline.",
        url: `${BASE}/#features`,
      },
    ],
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="landing-main text-zinc-900 overflow-x-clip">
        <ScrollAnimationObserver />
        <LandingNavbar />
        <main className="pb-24 overflow-x-clip" role="main">
          {/* ── Structured Data — 6 schemas for max SERP coverage ── */}
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd) }} />

          <HeroSection />
          <SalesPlatformSection />
          <HowItWorks />
          <UseCases />
          <TestimonialSection />
          <ProductShowcase />
          <ImpactStatsSection />
          <VsSection />
          <PricingSection />
          <Guarantee />
          <TrustBadges />
          <FaqComplianceSection />
        </main>
        <LandingFooter />
      </div>
    </div>
  )
}
