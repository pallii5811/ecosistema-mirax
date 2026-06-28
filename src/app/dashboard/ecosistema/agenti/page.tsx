'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bot, Loader2, Play, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type Agent = { id: string; label: string; description: string; capabilities: string[] }

export default function EcosistemaAgentiPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [presets, setPresets] = useState<Record<string, string[]>>({})
  const [hasPipeline, setHasPipeline] = useState(false)
  const [running, setRunning] = useState<string | null>(null)
  const [output, setOutput] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/api/ecosistema/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setAgents(d.agents ?? [])
        setPresets(d.presets ?? {})
        setHasPipeline((d.counts?.pipeline ?? 0) > 0)
      })
      .catch(() => {})
  }, [])

  const run = useCallback(async (key: string, body: Record<string, unknown>) => {
    setRunning(key)
    setOutput(null)
    try {
      const res = await fetch('/api/agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setOutput(JSON.stringify(data, null, 2))
    } catch (e) {
      setOutput(e instanceof Error ? e.message : 'Errore')
    } finally {
      setRunning(null)
    }
  }, [])

  return (
    <div className="space-y-6">
      <Card className="p-5 border-violet-200 bg-violet-50/50">
        <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <Bot className="w-5 h-5 text-violet-600" />
          Orchestrator multi-agent
        </h2>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          Cinque agenti specializzati (Search, Audit, Pitch, Outreach, Insights) coordinati da un orchestrator.
          Usali da qui per debug, oppure si attivano automaticamente nel flusso (audit resume, insights coach, guardrail outreach).
        </p>
        {!hasPipeline && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
            Per l&apos;Insights Agent aggiungi lead in{' '}
            <Link href="/dashboard/pipeline" className="font-semibold underline">
              Pipeline
            </Link>
            .
          </p>
        )}
      </Card>

      <div className="flex flex-wrap gap-2">
        {Object.keys(presets).map((preset) => (
          <Button
            key={preset}
            size="sm"
            variant="outline"
            disabled={!!running || (preset === 'coach' && !hasPipeline)}
            onClick={() => run(preset, { pipeline: presets[preset] ?? ['insights'] })}
          >
            {running === preset ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Play className="w-3 h-3 mr-1" />}
            Pipeline &quot;{preset}&quot;
          </Button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {agents
          .filter((a) => a.id !== 'orchestrator')
          .map((agent) => (
            <Card key={agent.id} className="p-4 border-slate-200 hover:border-violet-200 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-900">{agent.label}</div>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">{agent.description}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-violet-600"
                  disabled={!!running || (agent.id === 'insights' && !hasPipeline)}
                  onClick={() => run(agent.id, { agent: agent.id })}
                >
                  Run
                </Button>
              </div>
              <div className="flex flex-wrap gap-1 mt-3">
                {agent.capabilities.map((cap) => (
                  <span key={cap} className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600">
                    {cap}
                  </span>
                ))}
              </div>
            </Card>
          ))}
      </div>

      {output && (
        <Card className="p-0 overflow-hidden border-slate-800">
          <div className="bg-slate-900 px-4 py-2 text-xs font-medium text-slate-300">Risposta agente</div>
          <pre className="text-[11px] bg-slate-950 text-emerald-300 p-4 overflow-x-auto max-h-80">{output}</pre>
        </Card>
      )}

      <Link
        href="/dashboard/insights"
        className="inline-flex items-center gap-1 text-sm font-medium text-violet-600 hover:underline"
      >
        Smart Insights (PKI + coach) <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  )
}
