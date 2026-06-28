'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Brain, Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function EcosistemaIntelligencePage() {
  const [pki, setPki] = useState<{ score: number; grade: string } | null>(null)
  const [patterns, setPatterns] = useState(0)
  const [knowledge, setKnowledge] = useState(0)
  const [hasPipeline, setHasPipeline] = useState(false)

  useEffect(() => {
    void fetch('/api/ecosistema/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setPki(d.pki)
        setPatterns(d.closure_patterns ?? 0)
        setKnowledge(d.counts?.knowledge_objects ?? 0)
        setHasPipeline((d.counts?.pipeline ?? 0) > 0)
      })
      .catch(() => {})
  }, [])

  return (
    <div className="space-y-6">
      <Card className="p-5 border-indigo-200 bg-indigo-50/40">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Brain className="w-5 h-5 text-indigo-600" />
          Cross-Meshing · PKI · Knowledge (CKBase-lite)
        </h2>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          Performance KPI Index (PKI) composito su pipeline e outreach. Pattern di chiusura da conversioni reali.
          Knowledge objects alimentati da deal chiusi — ricercabili via SemanticMap e vector search.
        </p>
      </Card>

      <div className="grid sm:grid-cols-3 gap-3">
        <Card className="p-4 border-slate-200 text-center">
          <div className="text-3xl font-bold text-slate-900 tabular-nums">
            {pki ? pki.score : '—'}
          </div>
          <div className="text-xs text-slate-500 mt-1">PKI Score {pki ? `(${pki.grade})` : ''}</div>
        </Card>
        <Card className="p-4 border-slate-200 text-center">
          <div className="text-3xl font-bold text-slate-900 tabular-nums">{patterns}</div>
          <div className="text-xs text-slate-500 mt-1">Pattern chiusura</div>
        </Card>
        <Card className="p-4 border-slate-200 text-center">
          <div className="text-3xl font-bold text-slate-900 tabular-nums">{knowledge}</div>
          <div className="text-xs text-slate-500 mt-1">Knowledge objects</div>
        </Card>
      </div>

      {!hasPipeline ? (
        <Card className="p-5 border-dashed border-slate-300 text-center">
          <Sparkles className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-600">
            Aggiungi lead in Pipeline per sbloccare PKI, forecast e coach AI personalizzato.
          </p>
          <Button asChild size="sm" className="mt-3">
            <Link href="/dashboard/pipeline">Apri Pipeline</Link>
          </Button>
        </Card>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button asChild className="bg-indigo-600 hover:bg-indigo-700">
            <Link href="/dashboard/insights">
              Smart Insights (coach + azioni)
              <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard/environments">SemanticMap negli Ambienti</Link>
          </Button>
        </div>
      )}
    </div>
  )
}
