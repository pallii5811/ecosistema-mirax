'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Key, Loader2, Plus, ArrowLeft, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { JARVIS_API_ENDPOINTS, MIRAX_API_VERSION } from '@/lib/jarvis-api-catalog'

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<any[]>([])
  const [newKey, setNewKey] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/keys')
      .then((r) => r.json())
      .then((d) => {
        setKeys(d.data || [])
        setIsLoading(false)
      })
      .catch(() => {
        setKeys([])
        setIsLoading(false)
      })
  }, [])

  const createKey = async () => {
    if (!keyName.trim()) return
    setIsCreating(true)

    try {
      const res = await fetch('/api/v1/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: keyName }),
      })

      const data = await res.json()
      setNewKey(data.key)
      setKeys((prev) => [
        ...prev,
        {
          key_prefix: data.prefix,
          name: data.name,
          is_active: true,
          requests_count: 0,
        },
      ])
      setKeyName('')
    } finally {
      setIsCreating(false)
    }
  }

  const copyKey = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link href="/dashboard/integrations" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 mb-4">
        <ArrowLeft className="w-3 h-3" /> Integrazioni
      </Link>
      <div className="flex items-center gap-3 mb-8">
        <Key className="w-6 h-6 text-violet-600" />
        <div>
          <h1 className="text-2xl font-bold">API Keys</h1>
          <p className="text-slate-500 text-sm">Integra MiraX nel tuo workflow con la nostra API REST</p>
        </div>
      </div>

      {newKey ? (
        <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
          <p className="text-sm text-emerald-700 font-medium mb-2">⚠️ Copia questa chiave ora — non verrà mostrata di nuovo</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border rounded px-3 py-2 text-sm font-mono">{newKey}</code>
            <Button size="sm" onClick={copyKey} className="bg-emerald-600 hover:bg-emerald-700">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="bg-white border rounded-xl p-4 mb-6">
        <h2 className="font-medium mb-3">Crea nuova chiave</h2>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Nome chiave (es. Integrazione CRM)"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <Button
            onClick={createKey}
            disabled={isCreating || !keyName.trim()}
            className="bg-violet-600 hover:bg-violet-700"
          >
            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Crea
          </Button>
        </div>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="p-4 border-b bg-slate-50">
          <h2 className="font-medium">Le tue chiavi</h2>
        </div>

        {isLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
          </div>
        ) : keys.length === 0 ? (
          <div className="p-8 text-center text-slate-500">Nessuna chiave API. Creane una per iniziare.</div>
        ) : (
          <div className="divide-y">
            {keys.map((k, i) => (
              <div key={i} className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">{k.name}</div>
                  <div className="text-xs text-slate-400 font-mono">{k.key_prefix}...</div>
                  <div className="text-xs text-slate-400">{k.requests_count} richieste</div>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    k.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {k.is_active ? 'Attiva' : 'Disattivata'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 bg-slate-900 rounded-xl p-4 text-sm font-mono text-slate-300">
        <div className="text-slate-500 mb-2"># Esempio — lead per categoria e città</div>
        <div>
          <span className="text-violet-400">curl</span> https://ecosistema-mirax.vercel.app/api/v1/leads \
        </div>
        <div className="ml-4">-H <span className="text-emerald-400">&quot;Authorization: Bearer mx_...&quot;</span> \</div>
        <div className="ml-4">-G -d <span className="text-emerald-400">&quot;categoria=agenzie seo&quot;</span> \</div>
        <div className="ml-4">-d <span className="text-emerald-400">&quot;citta=Milano&quot;</span></div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b bg-slate-50">
          <BookOpen className="w-4 h-4 text-violet-600" />
          <h2 className="font-medium">Catalogo API v1 (Jarvis)</h2>
          <span className="text-xs text-slate-400 ml-auto">v{MIRAX_API_VERSION}</span>
        </div>
        <div className="divide-y">
          {JARVIS_API_ENDPOINTS.map((ep) => (
            <div key={`${ep.method}-${ep.path}`} className="p-4 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                  ep.method === 'GET' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'
                }`}>{ep.method}</span>
                <code className="text-xs text-slate-800">{ep.path}</code>
              </div>
              <p className="text-slate-600 text-xs">{ep.description}</p>
              {'auth' in ep && ep.auth ? (
                <p className="text-[11px] text-slate-400 mt-1">Auth: {ep.auth}</p>
              ) : null}
              {'query' in ep && ep.query ? (
                <p className="text-[11px] text-slate-400">Query: {ep.query}</p>
              ) : null}
              {'body' in ep && ep.body ? (
                <p className="text-[11px] text-slate-400">Body: {ep.body}</p>
              ) : null}
            </div>
          ))}
        </div>
        <div className="p-4 bg-slate-50 border-t text-xs text-slate-500">
          Health check pubblico: <code className="bg-white px-1 rounded">GET /api/v1/status</code> · Classify-reply è suggest-only (HITL, nessun invio automatico).
        </div>
      </div>
    </div>
  )
}
