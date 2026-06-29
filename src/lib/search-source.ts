/** Sorgente ricerca unificata — una barra, tre modalità. */
export type SearchSource = 'maps' | 'graph' | 'hybrid'

export const SEARCH_SOURCE_META: Record<
  SearchSource,
  { label: string; short: string; hint: string; costsCredits: boolean }
> = {
  maps: {
    label: 'Trova nuove aziende',
    short: 'Maps + Google',
    hint: 'Scopre lead nuovi su Google Maps e siti web. Usa crediti.',
    costsCredits: true,
  },
  graph: {
    label: 'Nel grafo MIRAX',
    short: 'Grafo',
    hint: 'Cerca tra le aziende già arricchite da MIRAX. Zero crediti Maps.',
    costsCredits: false,
  },
  hybrid: {
    label: 'Grafo poi Maps',
    short: 'Entrambi',
    hint: 'Prima il grafo (istantaneo), poi Maps se servono altre aziende.',
    costsCredits: true,
  },
}

export function parseSearchSource(raw: string | null | undefined): SearchSource {
  if (raw === 'graph' || raw === 'hybrid') return raw
  return 'maps'
}
