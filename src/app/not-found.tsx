import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-violet-100 border border-violet-200 mb-6">
          <span className="text-4xl font-bold text-violet-600" style={{ fontFamily: 'Syne, sans-serif' }}>
            404
          </span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2" style={{ fontFamily: 'Syne, sans-serif' }}>
          Pagina non trovata
        </h1>
        <p className="text-sm text-slate-500 mb-8 leading-relaxed">
          La pagina che stai cercando non esiste o è stata spostata.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors"
          >
            Torna alla Home
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors"
          >
            Vai alla Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
