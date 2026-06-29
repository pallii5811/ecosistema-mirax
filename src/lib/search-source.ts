/** Sorgente ricerca unificata — una barra, tre modalità. */
export type SearchSource = 'maps' | 'graph' | 'hybrid'

export const SEARCH_SOURCE_META: Record<
  SearchSource,
  { label: string; short: string; hint: string; costsCredits: boolean }
> = {
  maps: {
    label: 'Discovery live',
    short: 'Territorio',
    hint: 'Scansione intelligente su directory, registri pubblici e fonti web verificate. Usa crediti.',
    costsCredits: true,
  },
  graph: {
    label: 'Knowledge Graph',
    short: 'Grafo',
    hint: 'Interroga il grafo MIRAX già arricchito da audit e segnali. Zero crediti discovery.',
    costsCredits: false,
  },
  hybrid: {
    label: 'Grafo + Discovery',
    short: 'Ibrido',
    hint: 'Prima il grafo (istantaneo), poi discovery live se servono altre aziende.',
    costsCredits: true,
  },
}

export function parseSearchSource(raw: string | null | undefined): SearchSource {
  if (raw === 'graph' || raw === 'hybrid') return raw
  return 'maps'
}
