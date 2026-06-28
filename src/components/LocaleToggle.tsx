'use client'

import { LOCALE_LABELS, type MiraxLocale } from '@/lib/i18n'
import { Globe } from 'lucide-react'

type Props = {
  locale: MiraxLocale
  onChange: (locale: MiraxLocale) => void
  compact?: boolean
  className?: string
}

export function LocaleToggle({ locale, onChange, compact = false, className = '' }: Props) {
  return (
    <div
      className={`inline-flex items-center rounded-full border border-slate-200 bg-slate-100 p-0.5 ${className}`}
      role="group"
      aria-label="Lingua interfaccia"
    >
      {(['it', 'es'] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => onChange(code)}
          title={LOCALE_LABELS[code]}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            locale === code ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {compact ? code.toUpperCase() : (
            <>
              <Globe className="h-3 w-3" />
              {code.toUpperCase()}
            </>
          )}
        </button>
      ))}
    </div>
  )
}

export default LocaleToggle
