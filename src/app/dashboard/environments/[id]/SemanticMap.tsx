'use client'

import { useRouter } from 'next/navigation'
import type { EnvironmentListSummary } from '@/types/environments'

type Props = {
  envName: string
  envColor?: string
  totalLeads: number
  lists: EnvironmentListSummary[]
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1).trimEnd()}…`
}

// Radial "mind map": the environment (capo) sits at the center, each linked list
// (sotto-ricerca) is a node connected to it. Pure SVG — responsive, no dependencies.
export function SemanticMap({ envName, envColor = '#8B5CF6', totalLeads, lists }: Props) {
  const router = useRouter()
  const MAX_NODES = 12
  const visible = lists.slice(0, MAX_NODES)
  const hidden = lists.length - visible.length

  const width = 820
  const height = 460
  const cx = width / 2
  const cy = height / 2
  const radius = visible.length <= 1 ? 0 : Math.min(168, 120 + visible.length * 6)

  const nodes = visible.map((list, i) => {
    // Distribute around the circle, starting from the top.
    const angle = (-Math.PI / 2) + (i * 2 * Math.PI) / Math.max(visible.length, 1)
    const x = visible.length === 1 ? cx : cx + radius * Math.cos(angle)
    const y = visible.length === 1 ? cy - 150 : cy + radius * Math.sin(angle)
    return { list, x, y }
  })

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-slate-900">Mappa Ambiente</h2>
        <span className="text-[11px] text-slate-400">{lists.length} sotto-ricerche</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Il capo Ambiente al centro, ogni ricerca correlata è un reparto collegato. Clicca un nodo per aprire la lista.
      </p>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto min-w-[520px]"
          role="img"
          aria-label={`Mappa dell'ambiente ${envName} con ${lists.length} sotto-ricerche`}
        >
          {/* Connectors (drawn first, behind nodes) */}
          {nodes.map(({ list, x, y }) => (
            <line
              key={`line-${list.id}`}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke={envColor}
              strokeOpacity={0.35}
              strokeWidth={2}
            />
          ))}

          {/* Child nodes */}
          {nodes.map(({ list, x, y }) => {
            const w = 150
            const h = 50
            return (
              <g
                key={`node-${list.id}`}
                className="cursor-pointer"
                role="link"
                tabIndex={0}
                onClick={() => router.push(`/dashboard/leads?list=${list.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    router.push(`/dashboard/leads?list=${list.id}`)
                  }
                }}
              >
                <title>{`${list.name} — ${list.leadsCount} lead`}</title>
                <rect
                  x={x - w / 2}
                  y={y - h / 2}
                  width={w}
                  height={h}
                  rx={10}
                  fill="#ffffff"
                  stroke="#e2e8f0"
                  strokeWidth={1.5}
                />
                <text
                  x={x}
                  y={y - 4}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={600}
                  fill="#0f172a"
                >
                  {truncate(list.name, 18)}
                </text>
                <text x={x} y={y + 13} textAnchor="middle" fontSize={11} fill={envColor} fontWeight={600}>
                  {list.leadsCount} lead
                </text>
              </g>
            )
          })}

          {/* Capo (environment) node — drawn last so it stays on top */}
          <g>
            <circle cx={cx} cy={cy} r={62} fill={envColor} fillOpacity={0.12} />
            <circle cx={cx} cy={cy} r={48} fill={envColor} />
            <text x={cx} y={cy - 4} textAnchor="middle" fontSize={13} fontWeight={700} fill="#ffffff">
              {truncate(envName, 12)}
            </text>
            <text x={cx} y={cy + 14} textAnchor="middle" fontSize={11} fill="#ffffff" fillOpacity={0.85}>
              {totalLeads} lead
            </text>
          </g>
        </svg>
      </div>

      {hidden > 0 && (
        <p className="text-[11px] text-slate-400 mt-2 text-center">
          + altre {hidden} sotto-ricerche (vedi elenco sotto)
        </p>
      )}
    </div>
  )
}
