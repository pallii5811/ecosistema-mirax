'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'

type TooltipProps = {
  text: string
  children: React.ReactNode
}

export default function Tooltip({ text, children }: TooltipProps) {
  const [show, setShow] = useState(false)
  const [coords, setCoords] = useState({ x: 0, y: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleEnter = useCallback(() => {
    timerRef.current = setTimeout(() => {
      if (ref.current) {
        const rect = ref.current.getBoundingClientRect()
        setCoords({ x: rect.right + 12, y: rect.top + rect.height / 2 })
        setShow(true)
      }
    }, 300)
  }, [])

  const handleLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setShow(false)
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <div ref={ref} onMouseEnter={handleEnter} onMouseLeave={handleLeave} className="w-full">
      {children}
      {show && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed z-[9999] max-w-xs px-4 py-3 rounded-xl bg-slate-900 text-white text-sm font-medium shadow-2xl leading-relaxed pointer-events-none animate-in fade-in-0 zoom-in-95 duration-150"
              style={{ left: coords.x, top: coords.y, transform: 'translateY(-50%)' }}
            >
              {text}
              <div className="absolute right-full top-1/2 -translate-y-1/2 border-[6px] border-transparent border-r-slate-900" />
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
