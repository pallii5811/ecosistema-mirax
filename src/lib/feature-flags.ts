/** Hub Centro Comando (/dashboard/ecosistema) — disattivato in UI fino a integrazione full-product */
export const SHOW_CENTRO_COMANDO =
  process.env.NEXT_PUBLIC_SHOW_CENTRO_COMANDO === 'true'

/** Knowledge Graph Universe — UI esploratore grafo (default visibile) */
export const SHOW_UNIVERSE_UI = process.env.NEXT_PUBLIC_UNIVERSE_UI !== 'false'
