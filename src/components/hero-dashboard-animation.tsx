'use client'

import { useEffect, useState } from 'react'

const mockRows = [
  {
    name: 'Studio Legale Martini',
    shortName: 'Studio Legale M...',
    phone: '02 456789',
    email: 'info@studiolegale...',
    badges: ['NO PIXEL', 'ERRORI SEO'],
  },
  {
    name: 'Centri Sportivi Milano',
    shortName: 'Centri Sportivi Mil...',
    phone: '+39 347 123 4567',
    email: 'info@centri...',
    badges: ['NO PIXEL', 'ERRORI SEO'],
  },
  {
    name: 'Clinica Medica Duomo',
    shortName: 'Clinica Medica Du...',
    phone: '+39 392 555 0188',
    email: 'segreteria...',
    badges: ['NO PIXEL', 'ERRORI SEO'],
  },
]

export default function HeroDashboardAnimation({ className }: { className?: string }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div
      className={`relative w-full ${className ?? ''}`}
      style={{ perspective: '1200px' }}
    >
      <div className="hidden md:block absolute -inset-8 bg-gradient-to-br from-indigo-600/12 via-violet-600/10 to-transparent blur-2xl rounded-[2.5rem]" />

      <div className="relative md:transform-gpu md:[transform:rotateX(7deg)_rotateY(-10deg)] md:origin-top">
        <div className="w-full rounded-2xl border border-gray-200 bg-white shadow-xl overflow-hidden">
      {/* ── Barra titolo browser ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
        </div>
        <span className="text-xs font-semibold text-gray-400">Mirax</span>
      </div>

      {/* ── Search bar ── */}
      <div className="px-3 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
          <div className="w-1.5 h-1.5 rounded-full bg-violet-500 flex-shrink-0" />
          <span className="text-xs text-gray-500 flex-1 truncate">
            trovami aziende a milano senza pixel e con gr...
          </span>
          <button className="bg-violet-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-md flex-shrink-0">
            Search
          </button>
        </div>
      </div>

      {/* DESKTOP TABLE — visibile solo da md+ */}
      <div className="hidden md:block w-full">
        <div className="grid grid-cols-[2fr_2fr_2fr_auto] px-4 py-2 bg-gray-50 border-b border-gray-100 gap-2">
          <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Azienda</span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Contatto</span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Opportunità</span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Azioni</span>
        </div>

        {mockRows.map((row, i) => (
          <div
            key={i}
            className={`grid grid-cols-[2fr_2fr_2fr_auto] px-4 py-3 border-b border-gray-50 gap-2 items-center transition-all duration-500 ${
              visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            style={{ transitionDelay: `${i * 150}ms` }}
          >
            <span className="text-xs font-semibold text-gray-800 truncate">{row.name}</span>

            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="flex items-center gap-1 text-[10px] text-gray-600">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                <span className="truncate">{row.phone}</span>
              </span>
              <span className="text-[10px] text-gray-400 truncate">{row.email}</span>
            </div>

            <div className="flex items-center gap-1 flex-wrap">
              {row.badges.map((badge, j) => (
                <span
                  key={j}
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-600 whitespace-nowrap"
                >
                  {badge}
                </span>
              ))}
              <span className="text-[9px] text-gray-400 whitespace-nowrap">+ altri 2</span>
            </div>

            <button className="bg-violet-600 text-white text-[9px] font-bold px-2 py-1.5 rounded-md whitespace-nowrap flex-shrink-0">
              Genera Pitch
            </button>
          </div>
        ))}
      </div>

      {/* MOBILE LAYOUT — visibile solo sotto md */}
      <div className="md:hidden w-full">
        {mockRows.map((row, i) => (
          <div
            key={i}
            className={`px-3 py-3 border-b border-gray-50 transition-all duration-500 ${
              visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            style={{ transitionDelay: `${i * 150}ms` }}
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-xs font-semibold text-gray-800 truncate">{row.shortName}</span>
              <button className="bg-violet-600 text-white text-[9px] font-bold px-2 py-1 rounded-md flex-shrink-0 whitespace-nowrap">
                Genera Pitch
              </button>
            </div>

            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="flex items-center gap-1 text-[10px] text-gray-600">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                {row.phone}
              </span>
              <span className="text-[10px] text-gray-400">{row.email}</span>
            </div>

            <div className="flex items-center gap-1 flex-wrap">
              {row.badges.map((badge, j) => (
                <span key={j} className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-600">
                  {badge}
                </span>
              ))}
              <span className="text-[9px] text-gray-400">+ altri 2</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Footer AI ── */}
      <div className="px-4 py-2 flex items-center justify-between bg-gray-50">
        <span className="text-[9px] text-gray-400 font-mono">ai://semantic-search</span>
        <span className="text-[9px] text-green-500 font-semibold">ok</span>
      </div>
        </div>
      </div>
    </div>
  )
}
