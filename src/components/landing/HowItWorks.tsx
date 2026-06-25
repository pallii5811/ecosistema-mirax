'use client'

import { ArrowRight } from 'lucide-react'
import { motion } from 'framer-motion'
import CtaLink from '@/components/CtaLink'
import { LANDING } from '@/lib/landing-copy'
import '@/styles/landing-tokens.css'
import '@/styles/landing-how-it-works.css'

const EASE = [0.22, 1, 0.36, 1] as const

const SCALE_STATS = [
  { value: '6M+', label: 'aziende italiane nel database' },
  { value: '3M+', label: 'lead profilati con dati di contatto' },
  { value: '8.000+', label: 'comuni italiani coperti dalla ricerca' },
] as const

/** Diagramma integrazioni — stile Stripe "Connect to existing systems" */
function IntegrationDiagram() {
  const nodes = {
    top: [LANDING.discovery.inputNode, 'Ricerca AI', '16 filtri tech'],
    hub: 'MIRAX',
    bottom: ['Outreach', 'Pitch AI', 'Pipeline'],
    left: ['HubSpot', 'Webhook'],
    right: ['CSV', 'API REST'],
  }

  return (
    <svg
      className="landing-how__integrate-svg"
      viewBox="0 0 800 340"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="how-hub-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="50%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#6d28d9" />
        </linearGradient>
      </defs>

      {/* Connettori */}
      {[
        [130, 55, 400, 155],
        [400, 55, 400, 155],
        [670, 55, 400, 155],
        [130, 285, 400, 185],
        [400, 285, 400, 185],
        [670, 285, 400, 185],
        [80, 170, 320, 170],
        [720, 170, 480, 170],
      ].map((line, i) => (
        <line
          key={i}
          x1={line[0]}
          y1={line[1]}
          x2={line[2]}
          y2={line[3]}
          stroke="rgba(148, 144, 160, 0.35)"
          strokeWidth="1"
          strokeDasharray="5 5"
        />
      ))}

      {/* Top nodes */}
      {nodes.top.map((label, i) => {
        const x = 130 + i * 270
        return (
          <g key={label}>
            <rect x={x - 72} y={28} width={144} height={36} rx={8} fill="rgba(26, 23, 36, 0.95)" stroke="rgba(255,255,255,0.1)" />
            <text x={x} y={51} textAnchor="middle" fill="#e4e4e7" fontSize="11" fontWeight="600" fontFamily="Inter, sans-serif">
              {label}
            </text>
          </g>
        )
      })}

      {/* Hub */}
      <rect x={320} y={148} width={160} height={44} rx={22} fill="url(#how-hub-grad)" />
      <text x={400} y={176} textAnchor="middle" fill="#fff" fontSize="14" fontWeight="800" letterSpacing="0.08em" fontFamily="Inter, sans-serif">
        {nodes.hub}
      </text>

      {/* Bottom nodes */}
      {nodes.bottom.map((label, i) => {
        const x = 130 + i * 270
        return (
          <g key={label}>
            <rect x={x - 72} y={268} width={144} height={36} rx={8} fill="rgba(26, 23, 36, 0.95)" stroke="rgba(255,255,255,0.1)" />
            <text x={x} y={291} textAnchor="middle" fill="#e4e4e7" fontSize="11" fontWeight="600" fontFamily="Inter, sans-serif">
              {label}
            </text>
          </g>
        )
      })}

      {/* Side — CRM / export */}
      {nodes.left.map((label, i) => (
        <g key={label}>
          <rect x={8} y={148 + i * 48} width={100} height={32} rx={6} fill="rgba(26, 23, 36, 0.9)" stroke="rgba(255,255,255,0.08)" />
          <text x={58} y={168 + i * 48} textAnchor="middle" fill="#9490a0" fontSize="10" fontWeight="600" fontFamily="Inter, sans-serif">
            {label}
          </text>
        </g>
      ))}
      {nodes.right.map((label, i) => (
        <g key={label}>
          <rect x={692} y={148 + i * 48} width={100} height={32} rx={6} fill="rgba(26, 23, 36, 0.9)" stroke="rgba(255,255,255,0.08)" />
          <text x={742} y={168 + i * 48} textAnchor="middle" fill="#9490a0" fontSize="10" fontWeight="600" fontFamily="Inter, sans-serif">
            {label}
          </text>
        </g>
      ))}
    </svg>
  )
}

/** Nastri astratti — stile Stripe "Scale with confidence" in palette MIRAX */
function RibbonVisual() {
  const ribbons = Array.from({ length: 28 }, (_, i) => {
    const offset = i * 14
    const amp = 40 + (i % 5) * 12
    const phase = i * 0.35
    const d = `M -80 ${160 + offset}
      Q 200 ${80 + amp * Math.sin(phase)} 400 ${140 + offset * 0.3}
      T 880 ${120 + offset}`
    const opacity = 0.12 + (i % 6) * 0.06
    return { d, opacity, i }
  })

  return (
    <svg className="landing-how__ribbon-svg" viewBox="0 0 800 320" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="how-ribbon-grad" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#c4b5fd" stopOpacity="0.85" />
          <stop offset="35%" stopColor="#a78bfa" stopOpacity="0.8" />
          <stop offset="65%" stopColor="#7c3aed" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#6d28d9" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      {ribbons.map((r) => (
        <path
          key={r.i}
          d={r.d}
          stroke="url(#how-ribbon-grad)"
          strokeWidth={r.i % 4 === 0 ? 1.4 : 0.8}
          opacity={r.opacity}
          style={{
            animationDelay: `${r.i * 0.12}s`,
            animationDuration: `${4.5 + (r.i % 5) * 0.6}s`,
          }}
        />
      ))}
    </svg>
  )
}

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="landing-how relative py-16 sm:py-24 lg:py-28 overflow-x-clip">
      <div className="absolute inset-0 landing-how__glow pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* —— Parte 1: Infrastructure (Stripe screen 3) —— */}
        <motion.div
          className="landing-how__block"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.65, ease: EASE }}
        >
          <h2 className="landing-how__headline">
            Infrastruttura affidabile per ogni team commerciale.{' '}
            <span className="landing-how__headline-muted">
              Dalla {LANDING.discovery.engineShort} al pitch, all&apos;outreach e alla pipeline — un solo flusso, zero tool da patchare.
            </span>
          </h2>

          <div className="landing-how__ctas">
            <CtaLink>
              <span className="landing-how__btn-primary">
                Inizia gratis — 10 crediti
                <ArrowRight size={14} />
              </span>
            </CtaLink>
            <a href="#features" className="landing-how__btn-secondary">
              Vedi tutte le funzionalità
              <ArrowRight size={14} />
            </a>
          </div>

          <div className="landing-how__integrate">
            <div className="landing-how__integrate-head">
              <h3 className="landing-how__integrate-title">
                Si collega ai sistemi che già usi.{' '}
                <span className="landing-how__headline-muted">
                  Input da {LANDING.discovery.engineShort} e ricerca semantica, output verso outreach, pitch e CRM — orchestrato in piattaforma.
                </span>
              </h3>
            </div>
            <div className="landing-how__integrate-panel">
              <div className="landing-how__integrate-dots" />
              <IntegrationDiagram />
            </div>
          </div>
        </motion.div>

        {/* —— Parte 2: Scale (Stripe screen 4) —— */}
        <motion.div
          className="landing-how__block"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.65, ease: EASE }}
        >
          <h2 className="landing-how__headline">
            Scala con sicurezza.{' '}
            <span className="landing-how__headline-muted">
              Migliaia di lead processati con la stessa velocità — dalla prima ricerca all&apos;export, anche nei picchi di outbound.
            </span>
          </h2>

          <div className="landing-how__ribbon-wrap">
            <RibbonVisual />
            <div className="landing-how__ribbon-fade" />
          </div>

          <div className="landing-how__scale-stats">
            {SCALE_STATS.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08, ease: EASE }}
              >
                <div className="landing-how__scale-value">{s.value}</div>
                <p className="landing-how__scale-label">{s.label}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
