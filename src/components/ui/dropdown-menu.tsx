'use client'

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

type DropdownMenuRootProps = {
  children: ReactNode
}

type DropdownMenuTriggerProps = {
  asChild?: boolean
  children: ReactNode
}

type DropdownMenuContentProps = {
  align?: 'start' | 'end'
  children: ReactNode
  className?: string
}

type DropdownMenuItemProps = {
  children: ReactNode
  className?: string
  onClick?: () => void
}

type Ctx = {
  open: boolean
  setOpen: (v: boolean) => void
  triggerRef: React.RefObject<HTMLElement | null>
}

let _ctx: Ctx | null = null

function useDropdownCtx() {
  if (!_ctx) throw new Error('DropdownMenu components must be used within DropdownMenu')
  return _ctx
}

export function DropdownMenu({ children }: DropdownMenuRootProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLElement | null>(null)

  const ctx = useMemo<Ctx>(() => ({ open, setOpen, triggerRef }), [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      const trig = triggerRef.current
      if (trig && trig.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  _ctx = ctx
  return <div className="relative inline-flex">{children}</div>
}

export function DropdownMenuTrigger({ asChild, children }: DropdownMenuTriggerProps) {
  const { open, setOpen, triggerRef } = useDropdownCtx()

  if (asChild) {
    const child = children as any
    return (
      <span
        ref={(node) => {
          triggerRef.current = node as any
          if (typeof child?.ref === 'function') child.ref(node)
        }}
        onClick={(e) => {
          e.preventDefault()
          setOpen(!open)
          child?.props?.onClick?.(e)
        }}
        className="inline-flex"
      >
        {children}
      </span>
    )
  }

  return (
    <button
      type="button"
      ref={(node) => {
        triggerRef.current = node as any
      }}
      onClick={() => setOpen(!open)}
    >
      {children}
    </button>
  )
}

export function DropdownMenuContent({ align = 'start', children, className }: DropdownMenuContentProps) {
  const { open } = useDropdownCtx()
  if (!open) return null

  const sideClass = align === 'end' ? 'right-0' : 'left-0'

  return (
    <div
      className={`absolute z-50 mt-2 min-w-[10rem] overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl ${sideClass} ${
        className ?? ''
      }`}
      role="menu"
    >
      {children}
    </div>
  )
}

export function DropdownMenuItem({ children, className, onClick }: DropdownMenuItemProps) {
  const { setOpen } = useDropdownCtx()

  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 ${
        className ?? ''
      }`}
      role="menuitem"
      onClick={() => {
        onClick?.()
        setOpen(false)
      }}
    >
      {children}
    </button>
  )
}
