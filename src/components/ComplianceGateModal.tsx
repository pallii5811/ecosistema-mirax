'use client'

import { AlertTriangle, ShieldCheck, X } from 'lucide-react'

type Props = {
  open: boolean
  title: string
  message: string
  variant: 'blocked' | 'confirm'
  onClose: () => void
  onConfirm?: () => void
}

export function ComplianceGateModal({ open, title, message, variant, onClose, onConfirm }: Props) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            {variant === 'blocked' ? (
              <AlertTriangle className="h-5 w-5 text-rose-600" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-amber-600" />
            )}
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Chiudi">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {variant === 'blocked' ? 'Ho capito' : 'Annulla'}
          </button>
          {variant === 'confirm' && onConfirm ? (
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
            >
              Conferma e procedi
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default ComplianceGateModal
