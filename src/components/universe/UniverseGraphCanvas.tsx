'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, ZoomIn, ZoomOut } from 'lucide-react'
import { labelRelationship } from '@/lib/universe/labels'
import type { RelationshipType } from '@/lib/universe/types'
import { cn } from '@/lib/utils'

type GraphNode = {
  id: string
  entity_type: string
  name: string
  city?: string | null
  x: number
  y: number
  vx: number
  vy: number
}

type GraphEdge = {
  source: string
  target: string
  relationship_type: string
}

type Props = {
  city?: string
  name?: string
  entityId?: string
  className?: string
  onSelectEntity?: (id: string) => void
}

const TYPE_COLORS: Record<string, string> = {
  company: '#7c3aed',
  person: '#2563eb',
  technology: '#059669',
  job: '#d97706',
  website: '#0891b2',
  location: '#64748b',
  default: '#94a3b8',
}

function nodeColor(type: string): string {
  return TYPE_COLORS[type] ?? TYPE_COLORS.default
}

function runLayout(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number) {
  const cx = width / 2
  const cy = height / 2
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2
    const r = Math.min(width, height) * 0.32
    n.x = cx + Math.cos(angle) * r
    n.y = cy + Math.sin(angle) * r
    n.vx = 0
    n.vy = 0
  }

  const idMap = new Map(nodes.map((n) => [n.id, n]))
  for (let tick = 0; tick < 120; tick++) {
    for (const n of nodes) {
      n.vx += (cx - n.x) * 0.002
      n.vy += (cy - n.y) * 0.002
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.max(20, Math.hypot(dx, dy))
        const force = 8000 / (dist * dist)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx -= fx
        a.vy -= fy
        b.vx += fx
        b.vy += fy
      }
    }
    for (const e of edges) {
      const a = idMap.get(e.source)
      const b = idMap.get(e.target)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.max(30, Math.hypot(dx, dy))
      const force = (dist - 140) * 0.05
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }
    for (const n of nodes) {
      n.vx *= 0.85
      n.vy *= 0.85
      n.x += n.vx
      n.y += n.vy
      n.x = Math.max(40, Math.min(width - 40, n.x))
      n.y = Math.max(40, Math.min(height - 40, n.y))
    }
  }
}

export function UniverseGraphCanvas({ city, name, entityId, className, onSelectEntity }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 480 })
  const [zoom, setZoom] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (entityId) qs.set('entity_id', entityId)
      if (city) qs.set('city', city)
      if (name) qs.set('name', name)
      const res = await fetch(`/api/universe/graph-view?${qs}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore caricamento grafo')
      const rawNodes = Array.isArray(data.nodes) ? data.nodes : []
      const rawEdges = Array.isArray(data.edges) ? data.edges : []
      const laid: GraphNode[] = rawNodes.map((n: GraphNode) => ({
        ...n,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
      }))
      runLayout(laid, rawEdges, size.w, size.h)
      setNodes(laid)
      setEdges(rawEdges)
      if (data.focus_entity_id) setSelected(data.focus_entity_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore grafo')
      setNodes([])
      setEdges([])
    } finally {
      setLoading(false)
    }
  }, [city, name, entityId, size.w, size.h])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth || 800, h: Math.max(420, el.clientHeight || 480) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  const handleSelect = (id: string) => {
    setSelected(id)
    onSelectEntity?.(id)
  }

  return (
    <div className={cn('rounded-2xl border border-slate-200 bg-slate-950 shadow-inner overflow-hidden', className)}>
      <div className="flex items-center justify-between border-b border-white/10 bg-slate-900/80 px-4 py-2">
        <p className="text-xs text-slate-300">
          <span className="font-semibold text-white">{nodes.length}</span> nodi ·{' '}
          <span className="font-semibold text-white">{edges.length}</span> relazioni
          {city ? <span className="text-slate-400"> · {city}</span> : null}
        </p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))} className="rounded p-1 text-slate-300 hover:bg-white/10">
            <ZoomOut className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))} className="rounded p-1 text-slate-300 hover:bg-white/10">
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div ref={wrapRef} className="relative min-h-[420px] w-full" style={{ height: size.h }}>
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
          </div>
        ) : error ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-rose-300">{error}</div>
        ) : nodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-400">
            <p>Nessun nodo nel grafo per questa zona.</p>
            <p className="text-xs">Fai una ricerca Maps dalla dashboard — le aziende arricchite entrano qui automaticamente.</p>
          </div>
        ) : (
          <svg width="100%" height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} className="block">
            <g transform={`scale(${zoom})`} style={{ transformOrigin: 'center' }}>
              {edges.map((e, i) => {
                const a = nodeById.get(e.source)
                const b = nodeById.get(e.target)
                if (!a || !b) return null
                const mx = (a.x + b.x) / 2
                const my = (a.y + b.y) / 2
                return (
                  <g key={`${e.source}-${e.target}-${i}`}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#475569" strokeWidth={1.2} opacity={0.7} />
                    <text x={mx} y={my} fill="#64748b" fontSize={9} textAnchor="middle">
                      {labelRelationship(e.relationship_type as RelationshipType)}
                    </text>
                  </g>
                )
              })}
              {nodes.map((n) => {
                const r = n.entity_type === 'company' ? 22 : 16
                const active = selected === n.id
                return (
                  <g
                    key={n.id}
                    className="cursor-pointer"
                    onClick={() => handleSelect(n.id)}
                  >
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={r}
                      fill={nodeColor(n.entity_type)}
                      stroke={active ? '#fbbf24' : '#1e293b'}
                      strokeWidth={active ? 3 : 2}
                      opacity={0.95}
                    />
                    <text
                      x={n.x}
                      y={n.y + r + 14}
                      fill="#e2e8f0"
                      fontSize={11}
                      fontWeight={600}
                      textAnchor="middle"
                    >
                      {n.name.length > 22 ? `${n.name.slice(0, 20)}…` : n.name}
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>
        )}
      </div>

      {selected ? (
        <div className="border-t border-white/10 bg-slate-900/90 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-slate-200 truncate">
            Selezionato: <strong className="text-white">{nodeById.get(selected)?.name}</strong>
          </p>
          <Link
            href={`/dashboard/universe/${selected}`}
            className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500"
          >
            Scheda completa →
          </Link>
        </div>
      ) : null}
    </div>
  )
}
