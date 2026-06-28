'use client'

import { useMemo } from 'react'
import {
  intentScoreToColor,
  revenueToRadius,
  type MarketMapPoint,
} from '@/lib/competitive/market-metrics'

type Props = {
  points: MarketMapPoint[]
  loading?: boolean
  height?: number
}

const PAD = { top: 24, right: 24, bottom: 48, left: 56 }

function formatRevenue(n: number): string {
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `€${Math.round(n / 1_000)}k`
  return `€${n}`
}

export function MarketMap({ points, loading = false, height = 420 }: Props) {
  const width = 720

  const { minRev, maxRev, plotPoints } = useMemo(() => {
    const revs = points.map((p) => p.estimatedRevenue).filter((n) => n > 0)
    const minRev = revs.length ? Math.min(...revs) : 100_000
    const maxRev = revs.length ? Math.max(...revs) : 2_000_000
    const innerW = width - PAD.left - PAD.right
    const innerH = height - PAD.top - PAD.bottom

    const plotPoints = points.map((p) => ({
      ...p,
      cx: PAD.left + (p.digitalMaturity / 100) * innerW,
      cy: PAD.top + innerH - (p.growthRate / 100) * innerH,
      r: revenueToRadius(p.estimatedRevenue, minRev, maxRev),
      color: intentScoreToColor(p.intentScore),
    }))

    return { minRev, maxRev, plotPoints }
  }, [points, height, width])

  if (loading) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-500"
        style={{ height }}
      >
        Caricamento market map…
      </div>
    )
  }

  if (!points.length) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center px-6"
        style={{ height }}
      >
        <p className="text-sm text-slate-600">Nessun punto da visualizzare.</p>
        <p className="text-xs text-slate-400 mt-1">Aggiungi competitor o esegui una ricerca lead.</p>
      </div>
    )
  }

  const innerW = width - PAD.left - PAD.right
  const innerH = height - PAD.top - PAD.bottom

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full max-w-full rounded-xl border border-slate-200 bg-white"
        role="img"
        aria-label="Market map scatter plot"
      >
        <defs>
          <linearGradient id="mm-grid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="100%" stopColor="#ffffff" />
          </linearGradient>
        </defs>

        <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} fill="url(#mm-grid)" />

        {[0, 25, 50, 75, 100].map((tick) => {
          const x = PAD.left + (tick / 100) * innerW
          const y = PAD.top + innerH - (tick / 100) * innerH
          return (
            <g key={`grid-${tick}`}>
              <line x1={x} y1={PAD.top} x2={x} y2={PAD.top + innerH} stroke="#e2e8f0" strokeWidth={1} />
              <line x1={PAD.left} y1={y} x2={PAD.left + innerW} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text x={x} y={PAD.top + innerH + 16} textAnchor="middle" className="fill-slate-400 text-[10px]">
                {tick}
              </text>
              <text x={PAD.left - 8} y={y + 4} textAnchor="end" className="fill-slate-400 text-[10px]">
                {tick}
              </text>
            </g>
          )
        })}

        <text
          x={PAD.left + innerW / 2}
          y={height - 8}
          textAnchor="middle"
          className="fill-slate-600 text-[11px] font-medium"
        >
          Digital Maturity (tech stack 0–100)
        </text>
        <text
          x={14}
          y={PAD.top + innerH / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${PAD.top + innerH / 2})`}
          className="fill-slate-600 text-[11px] font-medium"
        >
          Growth Rate (hiring + funding + tender)
        </text>

        {plotPoints.map((p) => (
          <g key={p.id}>
            <circle
              cx={p.cx}
              cy={p.cy}
              r={p.r}
              fill={p.color}
              fillOpacity={p.kind === 'competitor' ? 0.85 : 0.55}
              stroke={p.kind === 'competitor' ? '#1e293b' : '#94a3b8'}
              strokeWidth={p.kind === 'competitor' ? 2 : 1}
            >
              <title>
                {p.name}
                {'\n'}Maturity {p.digitalMaturity} · Growth {p.growthRate}
                {'\n'}Intent {p.intentScore} · {formatRevenue(p.estimatedRevenue)}
                {'\n'}{p.kind === 'competitor' ? 'Competitor' : 'Lead'}
              </title>
            </circle>
            {p.r >= 12 && (
              <text x={p.cx} y={p.cy + 3} textAnchor="middle" className="fill-white text-[8px] font-semibold pointer-events-none">
                {p.intentScore}
              </text>
            )}
          </g>
        ))}

        <g transform={`translate(${PAD.left + innerW - 140}, ${PAD.top + 8})`}>
          <text className="fill-slate-500 text-[10px] font-semibold">Intent Score</text>
          <rect x={0} y={14} width={120} height={8} rx={4} fill="url(#intent-grad)" />
          <defs>
            <linearGradient id="intent-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={intentScoreToColor(10)} />
              <stop offset="100%" stopColor={intentScoreToColor(90)} />
            </linearGradient>
          </defs>
          <text x={0} y={34} className="fill-slate-400 text-[9px]">basso</text>
          <text x={100} y={34} textAnchor="end" className="fill-slate-400 text-[9px]">alto</text>
          <circle cx={8} cy={48} r={6} fill="#64748b" fillOpacity={0.5} stroke="#94a3b8" />
          <text x={20} y={51} className="fill-slate-500 text-[9px]">Lead</text>
          <circle cx={8} cy={64} r={6} fill="#7c3aed" fillOpacity={0.85} stroke="#1e293b" strokeWidth={1.5} />
          <text x={20} y={67} className="fill-slate-500 text-[9px]">Competitor</text>
          <text x={0} y={84} className="fill-slate-400 text-[9px]">
            Bubble size: fatturato ({formatRevenue(minRev)}–{formatRevenue(maxRev)})
          </text>
        </g>
      </svg>
    </div>
  )
}
