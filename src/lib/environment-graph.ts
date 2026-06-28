import type { EnvironmentListSummary, EnvironmentStats } from '../types/environments'

export type GraphNodeKind = 'environment' | 'list' | 'category' | 'city' | 'knowledge'

export type EnvironmentGraphNode = {
  id: string
  kind: GraphNodeKind
  label: string
  sublabel?: string
  value?: number
  href?: string
  color?: string
}

export type EnvironmentGraphEdge = {
  from: string
  to: string
  weight?: number
}

export type KnowledgeGraphSummary = {
  id: string
  title: string
  object_type: string
  confidence: number
}

export function buildEnvironmentGraph(input: {
  environmentId: string
  envName: string
  envColor: string
  totalLeads: number
  lists: EnvironmentListSummary[]
  stats: EnvironmentStats
  knowledge: KnowledgeGraphSummary[]
}): { nodes: EnvironmentGraphNode[]; edges: EnvironmentGraphEdge[] } {
  const nodes: EnvironmentGraphNode[] = []
  const edges: EnvironmentGraphEdge[] = []
  const centerId = `env:${input.environmentId}`

  nodes.push({
    id: centerId,
    kind: 'environment',
    label: input.envName,
    sublabel: `${input.totalLeads} lead`,
    value: input.totalLeads,
    color: input.envColor,
  })

  for (const list of input.lists) {
    const id = `list:${list.id}`
    nodes.push({
      id,
      kind: 'list',
      label: list.name,
      sublabel: `${list.leadsCount} lead`,
      value: list.leadsCount,
      href: `/dashboard/leads?list=${list.id}`,
    })
    edges.push({ from: centerId, to: id, weight: Math.max(1, list.leadsCount) })
  }

  const maxCat = Math.max(1, ...(input.stats.top_categories ?? []).map((c) => c.count))
  for (const cat of (input.stats.top_categories ?? []).slice(0, 6)) {
    if (!cat.name) continue
    const id = `cat:${cat.name.toLowerCase().replace(/\s+/g, '-')}`
    if (!nodes.some((n) => n.id === id)) {
      nodes.push({
        id,
        kind: 'category',
        label: cat.name,
        sublabel: `${cat.count} lead`,
        value: cat.count,
        color: '#6366f1',
      })
      edges.push({ from: centerId, to: id, weight: cat.count / maxCat })
    }
  }

  for (const city of (input.stats.top_cities ?? []).slice(0, 5)) {
    if (!city.name) continue
    const id = `city:${city.name.toLowerCase().replace(/\s+/g, '-')}`
    if (!nodes.some((n) => n.id === id)) {
      nodes.push({
        id,
        kind: 'city',
        label: city.name,
        sublabel: `${city.count} lead`,
        value: city.count,
        color: '#0ea5e9',
      })
      edges.push({ from: centerId, to: id, weight: city.count / maxCat })
    }
  }

  for (const k of input.knowledge.slice(0, 8)) {
    const id = `know:${k.id}`
    nodes.push({
      id,
      kind: 'knowledge',
      label: k.title.length > 28 ? `${k.title.slice(0, 27)}…` : k.title,
      sublabel: k.object_type,
      value: Math.round(k.confidence * 100),
      color: '#f59e0b',
    })
    edges.push({ from: centerId, to: id, weight: k.confidence })
  }

  return { nodes, edges }
}
