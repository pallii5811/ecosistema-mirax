'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, Loader2, Mail, Shield, AlertTriangle } from 'lucide-react'
import { SPF_DKIM_GUIDE } from '@/lib/deliverability/resend-status'

type Report = {
  domain: string
  score: number
  summary: string
  spf: { status: string; message: string; value?: string }
  dmarc: { status: string; message: string; value?: string }
  dkim: Array<{ status: string; message: string }>
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'ok') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  if (status === 'warning') return <AlertTriangle className="h-4 w-4 text-amber-600" />
  return <AlertTriangle className="h-4 w-4 text-rose-600" />
}

export default function DeliverabilityPage() {
  const [domain, setDomain] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [resendInfo, setResendInfo] = useState<string | null>(null)

  const runCheck = async () => {
    const d = domain.trim()
    if (!d) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/deliverability/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: d }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Check fallito')
      setReport(data.report)
      setResendInfo(
        data.resend?.domainVerified
          ? `Dominio verificato su Resend (${data.resend.matchedDomain})`
          : data.resend?.message || null,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/dashboard/integrations" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-6">
        <ArrowLeft className="h-4 w-4" /> Integrazioni
      </Link>

      <div className="flex items-start gap-3 mb-6">
        <div className="h-11 w-11 rounded-xl bg-violet-50 border border-violet-200 flex items-center justify-center">
          <Mail className="h-6 w-6 text-violet-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Deliverability email</h1>
          <p className="text-sm text-slate-600 mt-1">
            Verifica SPF, DKIM e DMARC del tuo dominio. MIRAX usa Resend per le sequenze — nessun acquisto automatico di domini.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dominio mittente</label>
        <div className="flex gap-2 mt-2">
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="mail.tuodominio.it"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-violet-400"
          />
          <button
            type="button"
            onClick={runCheck}
            disabled={loading || !domain.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
            Verifica DNS
          </button>
        </div>
        {error ? <p className="text-xs text-rose-600 mt-2">{error}</p> : null}
      </div>

      {report ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-slate-900">{report.domain}</div>
              <div className="text-xs text-slate-500">{report.summary}</div>
            </div>
            <div className="text-2xl font-bold tabular-nums text-violet-600">{report.score}/100</div>
          </div>
          {resendInfo ? <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{resendInfo}</p> : null}
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <StatusIcon status={report.spf.status} />
              <span><strong>SPF:</strong> {report.spf.message}</span>
            </li>
            <li className="flex items-start gap-2">
              <StatusIcon status={report.dmarc.status} />
              <span><strong>DMARC:</strong> {report.dmarc.message}</span>
            </li>
            {report.dkim.map((d, i) => (
              <li key={i} className="flex items-start gap-2">
                <StatusIcon status={d.status} />
                <span><strong>DKIM:</strong> {d.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-sm font-bold text-slate-900 mb-3">{SPF_DKIM_GUIDE.title}</h2>
        <ol className="space-y-3">
          {SPF_DKIM_GUIDE.steps.map((s) => (
            <li key={s.title}>
              <div className="text-sm font-semibold text-slate-800">{s.title}</div>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
