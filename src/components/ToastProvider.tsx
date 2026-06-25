'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'

type ToastVariant = 'success' | 'error' | 'info'

type ToastItem = {
  id: string
  title?: string
  description: string
  variant: ToastVariant
}

type ToastContextValue = {
  toast: (input: Omit<ToastItem, 'id'>) => void
  success: (description: string, title?: string) => void
  error: (description: string, title?: string) => void
  info: (description: string, title?: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (input: Omit<ToastItem, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const next: ToastItem = { id, ...input }

      setItems((prev) => [next, ...prev].slice(0, 3))

      window.setTimeout(() => {
        remove(id)
      }, 4500)
    },
    [remove]
  )

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (description, title) => toast({ variant: 'success', description, title }),
      error: (description, title) => toast({ variant: 'error', description, title }),
      info: (description, title) => toast({ variant: 'info', description, title }),
    }),
    [toast]
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 top-4 z-[9999] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-3">
        {items.map((t) => {
          const tone =
            t.variant === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : t.variant === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-900'
                : 'border-slate-200 bg-white text-slate-900'

          const dot =
            t.variant === 'success'
              ? 'bg-emerald-500'
              : t.variant === 'error'
                ? 'bg-rose-500'
                : 'bg-blue-500'

          return (
            <div
              key={t.id}
              className={`relative overflow-hidden rounded-2xl border px-4 py-3 shadow-[0_18px_60px_-30px_rgba(0,0,0,0.35)] ${tone}`}
              role="status"
            >
              <div className="flex items-start gap-3">
                <div className={`mt-1 h-2.5 w-2.5 rounded-full ${dot} shadow-[0_0_18px_rgba(0,0,0,0.15)]`} />
                <div className="min-w-0 flex-1">
                  {t.title ? <div className="text-sm font-semibold">{t.title}</div> : null}
                  <div className="text-sm/relaxed opacity-90">{t.description}</div>
                </div>
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  className="rounded-lg px-2 py-1 text-sm font-semibold opacity-60 hover:opacity-100"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-black/5" />
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
