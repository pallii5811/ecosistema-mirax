'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Shield, ShieldCheck, ArrowLeft, Loader2 } from 'lucide-react'
import { COMPLIANCE_UI_STATUS, toUiStatus } from '@/lib/compliance/types'
import { AI_ACT_DISCLAIMER } from '@/lib/ai-act-audit'

type CheckRow = {
  id: string
  channel: string
  target: string
  check_type: string
  status: string
  checked_at: string
}

export default function CompliancePage() {
  const [checks, setChecks] = useState<CheckRow[]>([])
  const [loading, setLoading] = useState(true)
  const [needsMigration, setNeedsMigration] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/compliance/check', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('fetch failed'))))
      .then((d) => {
        if (cancelled) return
        setChecks(Array.isArray(d.checks) ? d.checks : [])
        setNeedsMigration(Boolean(d.needsMigration))
      })
      .catch(() => {
        if (!cancelled) setChecks([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link
        href="/dashboard/integrations"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Integrazioni
      </Link>

      <div className="flex items-start gap-3 mb-6">
        <div className="h-11 w-11 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
          <ShieldCheck className="h-6 w-6 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Compliance outreach B2B</h1>
          <p className="text-sm text-slate-600 mt-1">
            Il tool più sicuro per l&apos;outreach B2B in EU — verifica Registro Opposizioni, base GDPR documentata, revisione umana obbligatoria.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Come funziona</h2>
        <ul className="text-sm text-slate-600 space-y-2 list-disc pl-5">
          <li>Prima di ogni contatto telefonico o WhatsApp verifichiamo il Registro Opposizioni (dove configurato).</li>
          <li>Per le email B2B documentiamo la base giuridica: legittimo interesse, fonte pubblica, nessun dato inventato.</li>
          <li>Nessun invio automatico: ogni messaggio passa dalla tua approvazione (human-in-the-loop).</li>
          <li>Server e database in UE (Supabase EU).</li>
        </ul>
        <p className="text-xs text-slate-400 border-t border-slate-100 pt-3">{AI_ACT_DISCLAIMER}</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Shield className="h-4 w-4 text-violet-500" /> Log verifiche recenti
          </h2>
          {needsMigration && (
            <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
              Migration DB pendente
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Caricamento…
          </div>
        ) : checks.length === 0 ? (
          <p className="px-5 py-10 text-sm text-slate-500 text-center">
            Nessuna verifica ancora. Al primo outreach da Centro Outreach o dalla tabella risultati comparirà qui.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {checks.map((row) => {
              const ui = COMPLIANCE_UI_STATUS[toUiStatus(row.status as 'clear' | 'blocked' | 'unknown' | 'manual_review')]
              return (
                <li key={row.id} className="px-5 py-3 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 truncate">{row.target}</div>
                    <div className="text-xs text-slate-500">
                      {row.channel} · {row.check_type} · {new Date(row.checked_at).toLocaleString('it-IT')}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${ui.tone}`}>
                    {ui.label}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-400">
        Test blocco mock: telefono <code className="bg-slate-100 px-1 rounded">3399999999</code> · email{' '}
        <code className="bg-slate-100 px-1 rounded">blocked-test@mirax.local</code>
      </p>
    </div>
  )
}
