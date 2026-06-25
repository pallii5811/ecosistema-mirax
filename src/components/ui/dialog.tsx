'use client'

import { type ReactNode, useEffect } from 'react'
import { createPortal } from 'react-dom'

type DialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  useEffect(() => {
    if (!open) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        {children}
      </div>
    </div>,
    document.body
  )
}

export function DialogContent({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`w-full max-w-2xl rounded-lg bg-white shadow-xl border border-slate-200 overflow-hidden ${className}`}>
      {children}
    </div>
  )
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return <div className="px-6 pt-6">{children}</div>
}

export function DialogTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h3 className={`text-lg font-semibold text-slate-900 ${className}`}>{children}</h3>
}

export function DialogDescription({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-sm text-slate-600">{children}</p>
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="px-6 pb-6 pt-4 flex items-center justify-end gap-2">{children}</div>
}
