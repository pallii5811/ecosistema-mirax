export type RicercaRow = {
  id: string
  created_at: string
  nome: string
  sito: string
  citta: string
  categoria: string
  email: string
  telefono: string
  rating: number | null
  tech_stack: string[]
  html_errors: string[]
  page_speed: number | null
}
