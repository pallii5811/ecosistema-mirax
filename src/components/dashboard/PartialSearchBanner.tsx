'use client'

type PartialSearchBannerProps = {
  found: number
  target: number
  message?: string
}

export function PartialSearchBanner({ found, target, message }: PartialSearchBannerProps) {
  const pct = target > 0 ? Math.min(100, Math.round((found / target) * 100)) : 0

  return (
    <div
      className="mb-4 rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 px-4 py-3 shadow-sm"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-violet-900">
          Trovati {found} su {target} lead
        </p>
        <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700">
          {pct}%
        </span>
      </div>
      <p className="mt-1 text-sm text-violet-700">
        {message ??
          "L'Agente AI sta ancora navigando il web — i risultati arrivano in tempo reale."}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-violet-100">
        <div
          className="h-full rounded-full bg-violet-500 transition-all duration-500"
          style={{ width: `${Math.max(pct, found > 0 ? 4 : 0)}%` }}
        />
      </div>
    </div>
  )
}
