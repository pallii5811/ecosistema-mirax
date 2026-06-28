'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Copy, Key, CheckCircle2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const ENDPOINTS = [
  { method: 'POST', path: '/api/v1/leads', desc: 'Inserisci o aggiorna lead' },
  { method: 'GET', path: '/api/v1/pipeline', desc: 'Leggi pipeline CRM interna' },
  { method: 'GET', path: '/api/v1/outreach', desc: 'Log outreach e touchpoint' },
  { method: 'GET', path: '/api/v1/environments', desc: 'Ambienti e liste' },
]

export default function EcosistemaApiPage() {
  const [origin, setOrigin] = useState('https://ecosistema-mirax.vercel.app')
  const [keyCount, setKeyCount] = useState(0)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    setOrigin(window.location.origin)
    void fetch('/api/ecosistema/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setKeyCount(d.counts?.api_keys ?? 0))
      .catch(() => {})
  }, [])

  const copy = (text: string, id: string) => {
    void navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="space-y-6">
      <Card className="p-5 border-slate-200">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Key className="w-5 h-5 text-violet-600" />
          API REST v1 — Enterprise
        </h2>
        <p className="text-sm text-slate-600 mt-2">
          Chiavi API con scope utente. Autenticazione:{' '}
          <code className="text-xs bg-slate-100 px-1 rounded">Authorization: Bearer mx_…</code>
        </p>
        <p className="text-sm mt-2">
          Chiavi attive: <strong>{keyCount}</strong>
        </p>
        <Button asChild size="sm" className="mt-3">
          <Link href="/dashboard/integrations/api-keys">Gestisci API Keys</Link>
        </Button>
      </Card>

      <div className="space-y-3">
        {ENDPOINTS.map((ep) => {
          const full = `${origin}${ep.path}`
          const curl = `curl -H "Authorization: Bearer mx_TUA_CHIAVE" "${full}"`
          const id = ep.path
          return (
            <Card key={ep.path} className="p-4 border-slate-200">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-violet-100 text-violet-700">
                  {ep.method}
                </span>
                <code className="text-sm text-slate-800">{ep.path}</code>
              </div>
              <p className="text-xs text-slate-500 mb-3">{ep.desc}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11px] bg-slate-900 text-slate-100 px-3 py-2 rounded-lg overflow-x-auto">
                  {curl}
                </code>
                <Button size="sm" variant="outline" onClick={() => copy(curl, id)}>
                  {copied === id ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
