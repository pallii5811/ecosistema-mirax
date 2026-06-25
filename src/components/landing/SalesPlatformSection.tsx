'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { LANDING } from '@/lib/landing-copy'
import { PlatformMockup } from '@/components/landing/platform/PlatformFeatureMockups'
import '@/styles/landing-sections.css'

const EASE = [0.22, 1, 0.36, 1] as const
const ROWS = LANDING.platformRows

function StickyMockupPanel({ activeIndex }: { activeIndex: number }) {
  const row = ROWS[activeIndex]

  return (
    <div className="landing-platform__visual landing-platform__visual--sticky">
      <div className="landing-platform__dots" aria-hidden />
      <div className="landing-platform__frame">
        <div className="landing-platform__mockup-stack">
          {ROWS.map((r, i) => (
            <motion.div
              key={r.id}
              className="landing-platform__mockup-layer"
              initial={false}
              animate={{
                opacity: i === activeIndex ? 1 : 0,
                y: i === activeIndex ? 0 : i < activeIndex ? -28 : 28,
                scale: i === activeIndex ? 1 : 0.96,
                filter: i === activeIndex ? 'blur(0px)' : 'blur(6px)',
              }}
              transition={{ duration: 0.65, ease: EASE }}
              aria-hidden={i !== activeIndex}
            >
              <PlatformMockup type={r.mockup} />
            </motion.div>
          ))}
        </div>
      </div>
      <p className="sr-only">Anteprima: {row.headline}</p>
    </div>
  )
}

function DesktopStickyScroll() {
  const [activeIndex, setActiveIndex] = useState(0)
  const stepRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const nodes = stepRefs.current.filter(Boolean) as HTMLDivElement[]
    if (nodes.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible[0]) {
          const idx = Number(visible[0].target.getAttribute('data-step-index'))
          if (!Number.isNaN(idx)) setActiveIndex(idx)
        }
      },
      {
        root: null,
        rootMargin: '-42% 0px -42% 0px',
        threshold: [0, 0.15, 0.35, 0.55, 0.75, 1],
      },
    )

    nodes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [])

  return (
    <div className="landing-platform__sticky-desktop hidden lg:grid">
      <div className="landing-platform__steps">
        {ROWS.map((row, index) => (
          <div
            key={row.id}
            ref={(el) => { stepRefs.current[index] = el }}
            data-step-index={index}
            className="landing-platform__step"
          >
            <motion.div
              className="landing-platform__copy landing-platform__copy--step"
              animate={{
                opacity: activeIndex === index ? 1 : 0.22,
                y: activeIndex === index ? 0 : 10,
              }}
              transition={{ duration: 0.55, ease: EASE }}
            >
              <h2 className="landing-platform__headline">{row.headline}</h2>
              <p className="landing-platform__body">{row.body}</p>
            </motion.div>
          </div>
        ))}
      </div>

      <div className="landing-platform__sticky-col">
        <StickyMockupPanel activeIndex={activeIndex} />
      </div>
    </div>
  )
}

function MobileStackedRows() {
  const reduceMotion = useReducedMotion()

  return (
    <div className="landing-platform__mobile lg:hidden">
      {ROWS.map((row, index) => (
        <article key={row.id} className="landing-platform__mobile-row">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.6, ease: EASE }}
            className="landing-platform__copy"
          >
            <h2 className="landing-platform__headline">{row.headline}</h2>
            <p className="landing-platform__body">{row.body}</p>
          </motion.div>
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-30px' }}
            transition={{ duration: 0.65, ease: EASE, delay: 0.05 }}
            className="landing-platform__visual"
          >
            <div className="landing-platform__dots" aria-hidden />
            <div className="landing-platform__frame">
              <PlatformMockup type={row.mockup} />
            </div>
          </motion.div>
        </article>
      ))}
    </div>
  )
}

export default function SalesPlatformSection() {
  return (
    <section id="platform" className="landing-platform relative overflow-x-clip">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <DesktopStickyScroll />
        <MobileStackedRows />
      </div>
    </section>
  )
}
