'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import CtaLink from '@/components/CtaLink'

const navItems = [
  { label: 'Come funziona', href: '#how-it-works' },
  { label: 'Funzionalità', href: '#features' },
  { label: 'Prezzi', href: '#pricing' },
]

export default function LandingNavbar() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-white/90 backdrop-blur-md border-b border-zinc-200/80 shadow-[0_1px_0_0_rgba(0,0,0,0.04)]'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-14 sm:h-16">
        {/* Logo */}
        <Link href="/" className="no-underline flex items-center flex-shrink-0 min-w-0">
          <img
            src="/mirax-logo-clean.svg"
            alt="MiraX"
            className="h-9 sm:h-12 w-auto max-w-[120px] sm:max-w-none object-contain"
          />
        </Link>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="px-3.5 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-900 transition-colors duration-200 no-underline rounded-lg hover:bg-zinc-50"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* CTA Group */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          <Link
            href="/login"
            className="hidden sm:block text-sm font-medium text-zinc-500 hover:text-zinc-900 transition-colors px-3.5 py-2 no-underline"
          >
            Accedi
          </Link>
          <CtaLink>
            <span className="inline-flex items-center gap-1 bg-violet-600 hover:bg-violet-700 text-white text-xs sm:text-sm font-semibold px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg cursor-pointer transition-all duration-200 shadow-[0_1px_3px_0_rgba(124,58,237,0.3)] whitespace-nowrap">
              Inizia Gratis
            </span>
          </CtaLink>

          {/* Mobile hamburger */}
          <button
            type="button"
            className="md:hidden p-2 rounded-lg hover:bg-zinc-100 transition-colors border-none bg-transparent cursor-pointer"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2" strokeLinecap="round">
              {mobileOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="7" x2="21" y2="7" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="17" x2="21" y2="17" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-white border-t border-zinc-100 px-5 py-4 flex flex-col gap-1">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className="text-sm font-medium text-zinc-600 py-2.5 border-b border-zinc-50 no-underline hover:text-zinc-900"
            >
              {item.label}
            </a>
          ))}
          <Link href="/login" className="text-sm font-medium text-zinc-600 py-2.5 no-underline">
            Accedi
          </Link>
          <CtaLink>
            <span className="flex justify-center bg-violet-600 text-white text-sm font-semibold py-3 px-5 rounded-lg cursor-pointer mt-2">
              Inizia Gratis →
            </span>
          </CtaLink>
        </div>
      )}
    </header>
  )
}
