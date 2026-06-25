'use client'

import {
  AlertTriangle,
  ArrowRight,
  Brain,
  Flame,
  Mail,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react'

function MockupChrome({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="landing-platform__mockup">
      <div className="landing-platform__mockup-bar">
        <div className="landing-platform__mockup-dots" aria-hidden>
          <span /><span /><span />
        </div>
        <span className="landing-platform__mockup-url">{title}</span>
      </div>
      <div className="landing-platform__mockup-body">{children}</div>
    </div>
  )
}

export function CommandCenterMockup() {
  return (
    <MockupChrome title="miraxgroup.it/insights">
      <div className="landing-platform__split">
        <div className="landing-platform__split-pane landing-platform__split-pane--feed">
          <div className="landing-platform__pane-head">
            <span className="font-semibold text-slate-800 text-[11px]">Pipeline attiva</span>
            <span className="text-[9px] text-slate-400">3 deal</span>
          </div>
          <div className="space-y-2">
            {[
              { name: 'Studio Bianchi', stage: 'Proposta', days: '4 gg', hot: true },
              { name: 'Ink Factory', stage: 'Meeting', days: '1 gg', hot: false },
              { name: 'FitZone Gym', stage: 'Nuovo', stageScore: '84 HOT', hot: true },
            ].map((d) => (
              <div key={d.name} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold text-slate-900 truncate">{d.name}</span>
                  {d.hot && <Flame size={10} className="text-red-500 flex-shrink-0" />}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[8px] font-medium text-slate-500">{d.stage}</span>
                  <span className="text-[8px] text-slate-300">·</span>
                  <span className="text-[8px] text-amber-600 font-medium">{d.days || d.stageScore}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="landing-platform__split-pane landing-platform__split-pane--ai">
          <div className="landing-platform__pane-head landing-platform__pane-head--ai">
            <Brain size={12} className="text-violet-600" />
            <span className="font-semibold text-slate-800 text-[11px]">Sales Command Center</span>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50/80 p-2.5 mb-2">
            <div className="flex items-start gap-2">
              <AlertTriangle size={12} className="text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[10px] font-semibold text-red-800">1 proposta in attesa di risposta</p>
                <p className="text-[9px] text-red-700/90 mt-1 leading-relaxed">
                  Oltre 3 giorni senza follow-up perde il 50% di probabilità di chiusura. Chiama oggi.
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
            <p className="text-[10px] font-semibold text-amber-900">2 lead HOT mai contattati</p>
            <p className="text-[9px] text-amber-800/90 mt-1">Score 70+ — apri la Hotlist</p>
            <button type="button" className="mt-2 inline-flex items-center gap-1 text-[9px] font-semibold text-violet-700">
              Vai alla Pipeline <ArrowRight size={10} />
            </button>
          </div>
        </div>
      </div>
    </MockupChrome>
  )
}

export function HotlistMockup() {
  const rows = [
    { score: 84, tier: 'HOT', name: 'Ink Factory Milano', cat: 'Tatuatore · Milano', gap: 'No Pixel' },
    { score: 78, tier: 'HOT', name: 'FitZone Gym', cat: 'Fitness · Milano', gap: 'No GTM' },
    { score: 71, tier: 'WARM', name: 'Studio Bianchi', cat: 'Studio tattoo · Monza', gap: 'SEO −8' },
    { score: 62, tier: 'WARM', name: 'Palestra Centro', cat: 'Fitness · Milano', gap: 'No Ads' },
  ]

  return (
    <MockupChrome title="miraxgroup.it/stats">
      <div className="landing-platform__hotlist">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <Flame size={12} className="text-red-500" />
            <span className="text-[11px] font-bold text-slate-900">Lead Hotlist</span>
          </div>
          <span className="text-[9px] font-medium text-slate-400">Score AI adattivo</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          {[
            { label: 'Hot (70+)', val: '12' },
            { label: 'Caldi', val: '28' },
            { label: 'Win rate', val: '34%' },
          ].map((k) => (
            <div key={k.label} className="rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-1.5 text-center">
              <div className="text-[8px] text-slate-500 uppercase tracking-wide">{k.label}</div>
              <div className="text-sm font-bold text-slate-900 tabular-nums">{k.val}</div>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={r.name} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
              <span className="text-[11px] font-bold text-slate-900 w-6 text-center tabular-nums">{r.score}</span>
              <span
                className={`text-[7px] font-bold px-1 py-0.5 rounded ${
                  r.tier === 'HOT' ? 'bg-zinc-900 text-white' : 'bg-zinc-200 text-zinc-600'
                }`}
              >
                {r.tier}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-semibold text-slate-900 truncate">{r.name}</div>
                <div className="text-[8px] text-slate-500 truncate">{r.cat}</div>
              </div>
              <span className="text-[7px] font-bold text-red-600 bg-red-50 border border-red-100 px-1 rounded hidden sm:inline">
                {r.gap}
              </span>
              {i === 0 && <Target size={10} className="text-violet-600 flex-shrink-0" />}
            </div>
          ))}
        </div>
      </div>
    </MockupChrome>
  )
}

export function OutreachMockup() {
  return (
    <MockupChrome title="miraxgroup.it/outreach">
      <div className="landing-platform__outreach">
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-2.5 mb-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles size={11} className="text-violet-600" />
            <span className="text-[10px] font-semibold text-slate-900">Pitch AI · Ink Factory Milano</span>
          </div>
          <p className="text-[9px] text-slate-600 leading-relaxed">
            Ho notato che il vostro sito non traccia le conversioni Meta. Possiamo mostrarvi come recuperare visibilità sui lead persi…
          </p>
          <p className="text-[8px] text-violet-600 font-medium mt-1.5">Canale suggerito: WhatsApp</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 mb-3">
          <div className="flex items-center gap-1.5 mb-2">
            <ShieldCheck size={11} className="text-emerald-600" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-600">Guardrail attivi</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {['Limite giornaliero', 'Anti-duplicato 7 gg', 'Human-in-the-loop'].map((p) => (
              <span key={p} className="text-[7px] font-semibold text-violet-700 bg-white border border-violet-100 px-1.5 py-0.5 rounded-full">
                {p}
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" className="flex items-center justify-center gap-1 rounded-lg bg-emerald-600 text-white text-[9px] font-semibold py-2">
            <MessageCircle size={11} /> WhatsApp
          </button>
          <button type="button" className="flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-slate-700 text-[9px] font-semibold py-2">
            <Mail size={11} /> Email
          </button>
        </div>
      </div>
    </MockupChrome>
  )
}

export function PlatformMockup({ type }: { type: 'command-center' | 'hotlist' | 'outreach' }) {
  if (type === 'command-center') return <CommandCenterMockup />
  if (type === 'hotlist') return <HotlistMockup />
  return <OutreachMockup />
}
