'use client'

import { useEffect, useState } from 'react'

export function useTypewriter(
  text: string,
  active: boolean,
  charMs = 42,
  holdMs = 1200,
) {
  const [len, setLen] = useState(0)

  useEffect(() => {
    if (!active) {
      setLen(0)
      return
    }
    if (len < text.length) {
      const t = window.setTimeout(() => setLen((n) => n + 1), charMs)
      return () => window.clearTimeout(t)
    }
    // holdMs === 0 → resta al testo completo (la fase successiva è gestita dal parent)
    if (holdMs > 0) {
      const t = window.setTimeout(() => setLen(0), holdMs)
      return () => window.clearTimeout(t)
    }
  }, [active, len, text, charMs, holdMs])

  const complete = active && len >= text.length
  return { text: text.slice(0, len), complete, len }
}

export function TypewriterCursor({ visible = true }: { visible?: boolean }) {
  if (!visible) return null
  return (
    <span
      className="inline-block w-[2px] h-[0.9em] bg-violet-500 ml-px align-middle landing-hero__cursor"
      aria-hidden="true"
    />
  )
}

export function HeroTypingQuery({ className = '' }: { className?: string }) {
  const [len, setLen] = useState(0)
  const FULL_QUERY = 'tatuatori a Milano senza instagram'

  useEffect(() => {
    if (len < FULL_QUERY.length) {
      const t = window.setTimeout(() => setLen((n) => n + 1), 48)
      return () => clearTimeout(t)
    }
    const t = window.setTimeout(() => setLen(0), 2800)
    return () => clearTimeout(t)
  }, [len])

  return (
    <span className={`text-[11px] sm:text-[13px] text-slate-900 font-medium whitespace-nowrap ${className}`}>
      {FULL_QUERY.slice(0, len)}
      <TypewriterCursor />
    </span>
  )
}

export function useHeroAutoScroll(active: boolean) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!active || !el) return
    let frame = 0
    let start: number | null = null
    const maxScroll = () => Math.max(0, el.scrollHeight - el.clientHeight - 4)
    const delay = 1200
    const duration = 3800

    const timeout = window.setTimeout(() => {
      const target = maxScroll()
      const step = (ts: number) => {
        if (start === null) start = ts
        const p = Math.min(1, (ts - start) / duration)
        const eased = 1 - Math.pow(1 - p, 3)
        el.scrollTop = target * eased
        if (p < 1) frame = requestAnimationFrame(step)
      }
      frame = requestAnimationFrame(step)
    }, delay)

    return () => {
      clearTimeout(timeout)
      cancelAnimationFrame(frame)
      el.scrollTop = 0
    }
  }, [active, el])

  return setEl
}

export function useStaggerReveal(count: number, active: boolean, delayMs = 320, startDelayMs = 200) {
  const [visible, setVisible] = useState(0)

  useEffect(() => {
    if (!active) {
      setVisible(0)
      return
    }
    if (visible >= count) return
    const t = window.setTimeout(
      () => setVisible((v) => v + 1),
      visible === 0 ? startDelayMs : delayMs,
    )
    return () => window.clearTimeout(t)
  }, [active, visible, count, delayMs, startDelayMs])

  return visible
}
