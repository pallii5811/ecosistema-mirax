'use client'

import Link from 'next/link'

const links = {
  Prodotto: [
    { label: 'Come funziona', href: '/#how-it-works' },
    { label: 'Funzionalità', href: '/#features' },
    { label: 'Prezzi', href: '/#pricing' },
    { label: 'Casi d\'uso', href: '/#use-cases' },
  ],
  Legale: [
    { label: 'Privacy Policy', href: '/privacy' },
    { label: 'Termini di Servizio', href: '/terms' },
    { label: 'Cookie Policy', href: '/cookie-policy' },
  ],
  Supporto: [
    { label: 'Contatti', href: 'mailto:supporto@miraxgroup.it' },
    { label: 'Dashboard', href: '/dashboard' },
  ],
}

export default function LandingFooter() {
  return (
    <footer className="relative overflow-hidden pt-20 pb-10 px-6 sm:px-8" style={{ background: '#020617' }}>
      {/* Top glow line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent" />
      {/* Dot grid */}
      <div className="absolute inset-0 dot-grid pointer-events-none opacity-50" />

      <div className="relative max-w-7xl mx-auto">
        {/* Top row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 md:gap-12 mb-16">
          {/* Brand */}
          <div>
            {/* Same logo as header, colors inverted for dark bg */}
            <div className="mb-6">
              <img src="/mirax-logo-footer.svg?v=2" alt="MiraX" style={{ height: '56px', width: 'auto' }} />
            </div>
            <p className="text-sm text-white/30 leading-relaxed max-w-[260px] mb-7">
              Lead intelligence B2B per l&apos;Italia. Ricerca, audit, pitch AI, outreach e pipeline — dal target al deal.
            </p>
            <div className="flex gap-2 flex-wrap">
              {['GDPR', 'EU Server', '99.9% uptime'].map((b) => (
                <span key={b} className="text-[11px] font-medium text-white/25 border border-white/[0.06] rounded-full px-2.5 py-1"
                  style={{ background: 'rgba(255,255,255,0.03)' }}>
                  {b}
                </span>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(links).map(([group, items]) => (
            <div key={group}>
              <div className="text-[11px] font-bold text-white/20 uppercase tracking-[0.2em] mb-5">
                {group}
              </div>
              <div className="flex flex-col gap-3">
                {items.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="text-sm text-white/30 hover:text-white/70 transition-colors duration-200 no-underline"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="h-px bg-white/[0.04] mb-7" />

        {/* Bottom row */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <span className="text-xs text-white/15">
            © {new Date().getFullYear()} MiraX Group. Tutti i diritti riservati.
          </span>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"
              style={{ boxShadow: '0 0 6px rgba(16,185,129,0.4), 0 0 0 3px rgba(16,185,129,0.1)' }} />
            <span className="text-xs text-white/20">
              Tutti i sistemi operativi
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
}