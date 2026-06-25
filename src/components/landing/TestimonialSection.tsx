'use client'

import { motion } from 'framer-motion'
import '@/styles/landing-value-backbone.css'

const EASE = [0.22, 1, 0.36, 1] as const

const STATS = [
  {
    value: '16+',
    label: 'filtri tecnici — Pixel, GTM, SSL, SEO, social e altro',
  },
  {
    value: '1:1',
    label: 'un credito = un lead con telefono o email verificato',
  },
  {
    value: '< 2 min',
    label: 'dal click alla lista contattabile con pitch pronto',
  },
  {
    value: '7 gg',
    label: 'finestra anti-duplicato nel Centro Outreach',
  },
] as const

function BackboneRays() {
  const rays = Array.from({ length: 40 }, (_, i) => {
    const t = i / 39
    const angle = -88 + t * 176
    const rad = (angle * Math.PI) / 180
    const len = 78 + (i % 4) * 6
    const x2 = 50 + Math.sin(rad) * len
    const y2 = 100 - Math.cos(rad) * len
    const opacity = 0.38 + (i % 5) * 0.1
    const width = i % 5 === 0 ? 1.1 : i % 3 === 0 ? 0.75 : 0.55
    return { x2, y2, opacity, width, i }
  })

  const ribbons = Array.from({ length: 14 }, (_, i) => {
    const y = 58 + i * 3.2
    const amp = 8 + (i % 4) * 3
    const phase = i * 0.4
    const d = `M -5 ${y}
      Q 25 ${y - amp * Math.sin(phase)} 50 ${y + amp * 0.3}
      T 105 ${y - amp * 0.5}`
    return { d, opacity: 0.22 + (i % 5) * 0.08, width: i % 4 === 0 ? 1.4 : 0.9, i }
  })

  return (
    <svg
      className="landing-backbone__rays"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="mirax-ray-grad" x1="50%" y1="100%" x2="50%" y2="0%">
          <stop offset="0%" stopColor="#6d28d9" stopOpacity="0.85" />
          <stop offset="45%" stopColor="#8b5cf6" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id="mirax-ribbon-grad" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.15" />
          <stop offset="35%" stopColor="#7c3aed" stopOpacity="0.7" />
          <stop offset="65%" stopColor="#8b5cf6" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      {ribbons.map((r) => (
        <path
          key={`ribbon-${r.i}`}
          d={r.d}
          fill="none"
          stroke="url(#mirax-ribbon-grad)"
          strokeWidth={r.width}
          opacity={r.opacity}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {rays.map((r) => (
        <line
          key={r.i}
          x1="50"
          y1="100"
          x2={r.x2}
          y2={r.y2}
          stroke="url(#mirax-ray-grad)"
          strokeWidth={r.width}
          opacity={r.opacity}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}

export function TestimonialSection() {
  return (
    <section className="landing-backbone border-t border-zinc-100" aria-label="Impatto MIRAX">
      <div className="landing-backbone__inner">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.7, ease: EASE }}
          className="landing-backbone__headline"
        >
          La spina dorsale del B2B italiano.
        </motion.h2>

        <div className="landing-backbone__stats">
          {STATS.map((stat, i) => (
            <motion.div
              key={stat.value}
              className="landing-backbone__stat"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.55, delay: i * 0.08, ease: EASE }}
            >
              <div className="landing-backbone__stat-value">{stat.value}</div>
              <p className="landing-backbone__stat-label">{stat.label}</p>
            </motion.div>
          ))}
        </div>

        <motion.div
          className="landing-backbone__visual"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-20px' }}
          transition={{ duration: 1, delay: 0.2, ease: EASE }}
        >
          <div className="landing-backbone__visual-bg" />
          <div className="landing-backbone__glow" />
          <BackboneRays />
          <div className="landing-backbone__visual-fade" aria-hidden="true" />
        </motion.div>
      </div>
    </section>
  )
}
