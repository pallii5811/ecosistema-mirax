'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EnvironmentGraphEdge, EnvironmentGraphNode } from '@/lib/environment-graph'

type Props = {
  environmentId: string
  envName: string
  envColor?: string
}

const KIND_COLORS: Record<string, string> = {
  environment: '#8B5CF6',
  list: '#64748b',
  category: '#6366f1',
  city: '#0ea5e9',
  knowledge: '#f59e0b',
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1).trimEnd()}…`
}

export function SemanticMap({ environmentId, envName, envColor = '#8B5CF6' }: Props) {
  const router = useRouter()
  const [nodes, setNodes] = useState<EnvironmentGraphNode[]>([])
  const [edges, setEdges] = useState<EnvironmentGraphEdge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/environments/${environmentId}/graph`, { cache: 'no-store' })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || 'Errore grafo')
        if (!cancelled) {
          setNodes(Array.isArray(data?.graph?.nodes) ? data.graph.nodes : [])
          setEdges(Array.isArray(data?.graph?.edges) ? data.graph.edges : [])
          setError(null)
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Errore caricamento mappa')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [environmentId])

  const layout = useMemo(() => {
    const center = nodes.find((n) => n.kind === 'environment')
    const orbit = nodes.filter((n) => n.kind !== 'environment')
    const width = 860
    const height = 480
    const cx = width / 2
    const cy = height / 2
    const radius = orbit.length <= 1 ? 0 : Math.min(190, 110 + orbit.length * 8)

    const positioned = orbit.map((node, i) => {
      const angle = (-Math.PI / 2) + (i * 2 * Math.PI) / Math.max(orbit.length, 1)
      const x = orbit.length === 1 ? cx : cx + radius * Math.cos(angle)
      const y = orbit.length === 1 ? cy - 150 : cy + radius * Math.sin(angle)
      return { node, x, y }
    })

    return { width, height, cx, cy, center, positioned }
  }, [nodes])

  const legend = [
    { kind: 'list', label: 'Liste' },
    { kind: 'category', label: 'Categorie' },
    { kind: 'city', label: 'Città' },
    { kind: 'knowledge', label: 'Knowledge' },
  ]

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-slate-900">Mappa Semantica (dati reali)</h2>
        <span className="text-[11px] text-slate-400">{nodes.length} nodi · {edges.length} collegamenti</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Grafo da liste, aggregazioni ambiente e knowledge objects. Clicca un nodo navigabile.
      </p>

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-400">Carico grafo ambiente…</div>
      ) : error ? (
        <div className="py-8 text-center text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg">
          {error}
        </div>
      ) : nodes.length <= 1 ? (
        <div className="py-8 text-center text-sm text-slate-500">
          Collega liste o attendi il cron knowledge per popolare la mappa.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            {legend.map((l) => (
              <span key={l.kind} className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                <span className="w-2 h-2 rounded-full" style={{ background: KIND_COLORS[l.kind] }} />
                {l.label}
              </span>
            ))}
          </div>
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              className="w-full h-auto min-w-[520px]"
              role="img"
              aria-label={`Mappa semantica ambiente ${envName}`}
            >
              {edges.map((edge) => {
                const to = layout.positioned.find((p) => p.node.id === edge.to)
                if (!to) return null
                const color = to.node.color || KIND_COLORS[to.node.kind] || envColor
                return (
                  <line
                    key={`${edge.from}-${edge.to}`}
                    x1={layout.cx}
                    y1={layout.cy}
                    x2={to.x}
                    y2={to.y}
                    stroke={color}
                    strokeOpacity={0.35}
                    strokeWidth={1 + (edge.weight ?? 0.5) * 2}
                  />
                )
              })}

              {layout.positioned.map(({ node, x, y }) => {
                const color = node.color || KIND_COLORS[node.kind] || '#94a3b8'
                const w = node.kind === 'knowledge' ? 160 : 148
                const h = 52
                const clickable = !!node.href
                return (
                  <g
                    key={node.id}
                    className={clickable ? 'cursor-pointer' : undefined}
                    role={clickable ? 'link' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={() => node.href && router.push(node.href)}
                    onKeyDown={(e) => {
                      if (clickable && node.href && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault()
                        router.push(node.href)
                      }
                    }}
                  >
                    <title>{`${node.label} — ${node.sublabel ?? ''}`}</title>
                    <rect
                      x={x - w / 2}
                      y={y - h / 2}
                      width={w}
                      height={h}
                      rx={10}
                      fill="#ffffff"
                      stroke={color}
                      strokeWidth={1.5}
                      strokeOpacity={0.55}
                    />
                    <circle cx={x - w / 2 + 10} cy={y - h / 2 + 10} r={4} fill={color} />
                    <text x={x} y={y - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill="#0f172a">
                      {truncate(node.label, 20)}
                    </text>
                    <text x={x} y={y + 12} textAnchor="middle" fontSize={10} fill={color} fontWeight={600}>
                      {node.sublabel ?? ''}
                    </text>
                  </g>
                )
              })}

              <g>
                <circle cx={layout.cx} cy={layout.cy} r={62} fill={envColor} fillOpacity={0.12} />
                <circle cx={layout.cx} cy={layout.cy} r={48} fill={envColor} />
                <text x={layout.cx} y={layout.cy - 4} textAnchor="middle" fontSize={13} fontWeight={700} fill="#ffffff">
                  {truncate(envName, 12)}
                </text>
                <text x={layout.cx} y={layout.cy + 14} textAnchor="middle" fontSize={11} fill="#ffffff" fillOpacity={0.85}>
                  {layout.center?.sublabel ?? 'Ambiente'}
                </text>
              </g>
            </svg>
          </div>
        </>
      )}
    </div>
  )
}
