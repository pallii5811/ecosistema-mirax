'use client'

import { useState } from 'react'
import { Search, Loader2, Mail, Phone, Linkedin, Briefcase, Users, MapPin, Shield, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'

interface MergedPerson {
  id: string
  name: string
  firstName: string | null
  lastName: string | null
  email: string | null
  emailVerified: boolean
  phone: string | null
  mobilePhone: string | null
  title: string | null
  seniority: string | null
  companyName: string | null
  companyDomain: string | null
  companySize: string | null
  industry: string | null
  linkedin: string | null
  city: string | null
  country: string | null
  photoUrl: string | null
  employmentHistory: any[]
  sources: string[]
  employmentType: string | null
  estimatedPotential: string | null
  triggers: string[]
}

export default function DatabaseSearchSection() {
  const [searchMode, setSearchMode] = useState<'role' | 'company' | 'person'>('role')
  
  // role fields
  const [roleTitle, setRoleTitle] = useState('')
  const [roleLocation, setRoleLocation] = useState('')
  
  // company fields
  const [companySearchName, setCompanySearchName] = useState('')

  // person fields
  const [personSearchName, setPersonSearchName] = useState('')
  const [personCompanyName, setPersonCompanyName] = useState('')

  const [results, setResults] = useState<MergedPerson[]>([])
  const [total, setTotal] = useState(0)
  const [sources, setSources] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  const doSearch = async (p = 1) => {
    if (searchMode === 'role' && !roleTitle.trim()) return
    if (searchMode === 'company' && !companySearchName.trim()) return
    if (searchMode === 'person' && !personSearchName.trim()) return

    setLoading(true)
    setError(null)
    setSearched(true)
    if (p === 1) setResults([])

    try {
      const payload = {
        mode: searchMode,
        query: searchMode === 'role' ? roleTitle.trim() : undefined,
        companyName: searchMode === 'company' ? companySearchName.trim() : searchMode === 'person' ? personCompanyName.trim() : undefined,
        personName: searchMode === 'person' ? personSearchName.trim() : undefined,
        location: searchMode === 'role' ? roleLocation.trim() : undefined,
        page: p,
        perPage: 25,
      }

      const res = await fetch('/api/database-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) throw new Error(`Errore ${res.status}`)

      const data = await res.json()
      if (p === 1) {
        setResults(data.results || [])
      } else {
        setResults(prev => [...prev, ...(data.results || [])])
      }
      setTotal(data.total || 0)
      setSources(data.sources || [])
      setHasMore(data.hasMore || false)
      setPage(p)
    } catch (e: any) {
      setError(e.message || 'Errore nella ricerca')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) doSearch(1)
  }

  const isSearchDisabled = 
    (searchMode === 'role' && !roleTitle.trim()) ||
    (searchMode === 'company' && !companySearchName.trim()) ||
    (searchMode === 'person' && !personSearchName.trim())

  return (
    <div>
      {/* Search Mode Selector */}
      <div className="flex bg-slate-100 p-1 rounded-xl mb-4 self-start w-fit">
        <button onClick={() => setSearchMode('role')} className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${searchMode === 'role' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
          <div className="flex items-center gap-1"><Users className="w-4 h-4" /> Per Ruolo</div>
        </button>
        <button onClick={() => setSearchMode('company')} className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${searchMode === 'company' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
          <div className="flex items-center gap-1"><Briefcase className="w-4 h-4" /> Esplora Azienda</div>
        </button>
        <button onClick={() => setSearchMode('person')} className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${searchMode === 'person' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
          <div className="flex items-center gap-1"><Search className="w-4 h-4" /> Investiga Persona</div>
        </button>
      </div>

      {/* Search inputs */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        
        {searchMode === 'role' && (
          <>
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={roleTitle}
                onChange={e => setRoleTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ruolo da cercare (Es: Marketing Manager, CEO...)"
                className="w-full pl-10 pr-4 py-3 text-sm text-slate-900 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-slate-400"
              />
            </div>
            <div className="sm:w-48 relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={roleLocation}
                onChange={e => setRoleLocation(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Città (Es: Milano)"
                className="w-full pl-10 pr-4 py-3 text-sm text-slate-900 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-slate-400"
              />
            </div>
          </>
        )}

        {searchMode === 'company' && (
          <div className="flex-1 relative">
            <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={companySearchName}
              onChange={e => setCompanySearchName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Nome dell'Azienda (es: Ferrari, Barilla... estrae i dipendenti)"
              className="w-full pl-10 pr-4 py-3 text-sm text-slate-900 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-slate-400"
            />
          </div>
        )}

        {searchMode === 'person' && (
          <>
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={personSearchName}
                onChange={e => setPersonSearchName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Nome e Cognome (es: Mario Rossi)"
                className="w-full pl-10 pr-4 py-3 text-sm text-slate-900 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-slate-400"
              />
            </div>
            <div className="sm:w-48 relative">
              <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={personCompanyName}
                onChange={e => setPersonCompanyName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Azienda (opzionale)"
                className="w-full pl-10 pr-4 py-3 text-sm text-slate-900 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-slate-400"
              />
            </div>
          </>
        )}

        <button
          onClick={() => doSearch(1)}
          disabled={loading || isSearchDisabled}
          className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center gap-2 transition-all whitespace-nowrap"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Cerca nel Database
        </button>
      </div>

      {/* Quick searches */}
      {!searched && searchMode === 'role' && (
        <div className="flex flex-wrap gap-2 mb-4">
          {[
            { label: 'Commercialisti Milano', q: 'commercialista', l: 'Milano' },
            { label: 'Avvocati Roma', q: 'avvocato', l: 'Roma' },
            { label: 'Imprenditori Napoli', q: 'imprenditore', l: 'Napoli' },
            { label: 'Titolari PMI Torino', q: 'titolare', l: 'Torino' },
            { label: 'CEO Firenze', q: 'CEO', l: 'Firenze' },
          ].map(s => (
            <button
              key={s.label}
              onClick={() => { setRoleTitle(s.q); setRoleLocation(s.l); }}
              className="px-3 py-1.5 rounded-full text-[11px] font-medium border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors cursor-pointer"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Results header */}
      {searched && !loading && results.length > 0 && (
        <div className="flex items-center justify-between mb-3 px-1">
          <p className="text-sm text-slate-600">
            <strong>{results.length}</strong> di <strong>{total}</strong> risultati
            {sources.length > 0 && (
              <span className="ml-2 text-xs text-slate-400">
                da {sources.join(' + ')}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Results table */}
      {results.length > 0 && (
        <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-xs font-bold text-slate-600 uppercase">Persona</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-600 uppercase">Azienda</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-600 uppercase">Contatti</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-600 uppercase">Tipo</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-600 uppercase">Potenziale</th>
                  <th className="px-4 py-3 text-xs font-bold text-slate-600 uppercase w-10"></th>
                </tr>
              </thead>
              <tbody>
                {results.map((person) => (
                  <PersonRow
                    key={person.id}
                    person={person}
                    expanded={expandedId === person.id}
                    onToggle={() => setExpandedId(expandedId === person.id ? null : person.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Load more */}
      {hasMore && !loading && (
        <div className="flex justify-center mt-4">
          <button
            onClick={() => doSearch(page + 1)}
            className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Carica altri risultati
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && results.length === 0 && (
        <div className="flex flex-col items-center py-12">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
          <p className="text-sm text-slate-600 font-medium">Ricerca in corso su Snov.io + Apollo...</p>
          <p className="text-xs text-slate-400 mt-1">I dati mostrati sono reali e verificati</p>
        </div>
      )}

      {/* No results */}
      {searched && !loading && results.length === 0 && !error && (
        <div className="flex flex-col items-center py-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
            <Users className="w-6 h-6 text-slate-400" />
          </div>
          <p className="text-sm text-slate-600 font-medium mb-1">Nessun risultato trovato</p>
          <p className="text-xs text-slate-400">Prova con un ruolo o settore diverso</p>
        </div>
      )}

      {/* Empty state */}
      {!searched && (
        <div className="flex flex-col items-center py-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center mb-4">
            <Shield className="w-6 h-6 text-blue-500" />
          </div>
          <h3 className="text-lg font-bold text-slate-800 mb-2">Motore di Ricerca Database</h3>
          <p className="text-sm text-slate-500 max-w-md mb-2 leading-relaxed">
            Seleziona la tua strategia di ricerca e riempi i campi in alto:
            <br/><br/>
            🎯 <strong>Per Ruolo:</strong> Scrivi &quot;Marketing Manager&quot; e &quot;Milano&quot;
            <br/>
            🔎 <strong>Per Nome:</strong> Scrivi &quot;Mario Rossi&quot; per investigare una singola persona
            <br/>
            🏢 <strong>Per Azienda:</strong> Scrivi &quot;Barilla&quot; per estrarre tutti i suoi dipendenti
          </p>
          <p className="text-xs text-slate-400 max-w-sm">
            Nome, cognome, email, telefono, cellulare, ruolo, azienda, LinkedIn, seniority, dimensione azienda, tipo lavoro, trigger assicurativi
          </p>
        </div>
      )}
    </div>
  )
}

// ── Single person row ────────────────────────────────────────────
function PersonRow({ person, expanded, onToggle }: {
  person: MergedPerson
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors cursor-pointer" onClick={onToggle}>
        {/* Persona */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            {person.photoUrl ? (
              <img src={person.photoUrl} alt="" className="w-9 h-9 rounded-full object-cover border border-slate-200" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center text-blue-600 font-bold text-sm">
                {(person.firstName || person.name || '?')[0]?.toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-sm font-semibold text-slate-900">{person.name || '—'}</p>
              {person.title && <p className="text-xs text-slate-500 line-clamp-1">{person.title}</p>}
              {person.seniority && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">
                  {person.seniority}
                </span>
              )}
            </div>
          </div>
        </td>

        {/* Azienda */}
        <td className="px-4 py-3">
          <p className="text-sm font-medium text-slate-800">{person.companyName || '—'}</p>
          {person.industry && <p className="text-xs text-slate-400">{person.industry}</p>}
          {person.companySize && (
            <span className="text-[10px] text-slate-500">{person.companySize} dip.</span>
          )}
        </td>

        {/* Contatti */}
        <td className="px-4 py-3">
          <div className="flex flex-col gap-1">
            {person.email && (
              <a href={`mailto:${person.email}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800">
                <Mail className="w-3 h-3" />
                <span className="truncate max-w-[160px]">{person.email}</span>
                {person.emailVerified && <span className="text-[9px] bg-green-100 text-green-700 px-1 rounded">✓</span>}
              </a>
            )}
            {person.mobilePhone && (
              <a href={`tel:${person.mobilePhone}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-800">
                <Phone className="w-3 h-3" />
                {person.mobilePhone}
                <a href={`https://wa.me/39${person.mobilePhone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-[9px] bg-green-100 text-green-700 px-1 rounded font-bold no-underline">WA</a>
              </a>
            )}
            {!person.mobilePhone && person.phone && (
              <a href={`tel:${person.phone}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1.5 text-xs text-slate-600">
                <Phone className="w-3 h-3" />
                {person.phone}
              </a>
            )}
            {person.linkedin && (
              <a href={person.linkedin} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-800">
                <Linkedin className="w-3 h-3" />
                LinkedIn
              </a>
            )}
          </div>
        </td>

        {/* Tipo lavoro */}
        <td className="px-4 py-3">
          {person.employmentType && (
            <span className={`text-[11px] font-medium px-2 py-1 rounded-full ${
              person.employmentType === 'Imprenditore'
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : person.employmentType.includes('P.IVA')
                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                : person.employmentType.includes('Dirigente')
                ? 'bg-purple-50 text-purple-700 border border-purple-200'
                : 'bg-slate-50 text-slate-600 border border-slate-200'
            }`}>
              {person.employmentType}
            </span>
          )}
          {person.city && (
            <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
              <MapPin className="w-2.5 h-2.5" /> {person.city}
            </p>
          )}
        </td>

        {/* Potenziale */}
        <td className="px-4 py-3">
          {person.estimatedPotential && (
            <span className="text-xs font-bold text-emerald-600">{person.estimatedPotential}</span>
          )}
          <div className="flex gap-0.5 mt-1">
            {person.sources.map(s => (
              <span key={s} className="text-[8px] font-bold px-1 py-0.5 rounded bg-slate-100 text-slate-500 uppercase">
                {s}
              </span>
            ))}
          </div>
        </td>

        {/* Expand */}
        <td className="px-4 py-3">
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </td>
      </tr>

      {/* Expanded details */}
      {expanded && (
        <tr>
          <td colSpan={6} className="px-4 py-4 bg-slate-50/80 border-b border-slate-200">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Employment History */}
              {person.employmentHistory?.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-slate-600 uppercase mb-2 flex items-center gap-1">
                    <Briefcase className="w-3 h-3" /> Esperienza lavorativa
                  </p>
                  <div className="space-y-1.5">
                    {person.employmentHistory.map((job: any, i: number) => (
                      <div key={i} className="text-xs">
                        <p className="font-medium text-slate-800">{job.title}</p>
                        <p className="text-slate-500">{job.company} {job.current && <span className="text-emerald-600 font-bold">• Attuale</span>}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Triggers */}
              {person.triggers?.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-slate-600 uppercase mb-2 flex items-center gap-1">
                    <Shield className="w-3 h-3" /> Trigger assicurativi
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {person.triggers.map((t: string, i: number) => (
                      <span key={i} className="text-[10px] font-medium px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div>
                <p className="text-xs font-bold text-slate-600 uppercase mb-2">Azioni rapide</p>
                <div className="flex flex-wrap gap-2">
                  {person.email && (
                    <a href={`mailto:${person.email}`} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold no-underline hover:bg-blue-700 transition-colors">
                      <Mail className="w-3 h-3" /> Email
                    </a>
                  )}
                  {(person.mobilePhone || person.phone) && (
                    <a href={`https://wa.me/39${(person.mobilePhone || person.phone || '').replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold no-underline hover:bg-emerald-700 transition-colors">
                      <Phone className="w-3 h-3" /> WhatsApp
                    </a>
                  )}
                  {person.linkedin && (
                    <a href={person.linkedin} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-600 text-white text-xs font-bold no-underline hover:bg-sky-700 transition-colors">
                      <Linkedin className="w-3 h-3" /> LinkedIn
                    </a>
                  )}
                  {person.companyDomain && (
                    <a href={`https://${person.companyDomain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-600 text-white text-xs font-bold no-underline hover:bg-slate-700 transition-colors">
                      <ExternalLink className="w-3 h-3" /> Sito
                    </a>
                  )}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
