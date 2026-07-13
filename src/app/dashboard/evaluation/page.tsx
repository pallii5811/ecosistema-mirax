'use client'

import { useCallback, useEffect, useState } from 'react'

type ReviewCase = { id:string; dataset_version:string; cohort:'legacy_baseline'|'v5_output'|'adversarial'; vertical:string; case_number:number; query:string; candidate_snapshot:Record<string,unknown>; provenance:Record<string,unknown> }
type Payload = { progress:{reviewed:number;total:number;remaining:number;legacy_baseline:{reviewed:number;target_min:number;cap:number;available:number};v5:{reviewed:number;target:number;available:number}}; case:ReviewCase|null; error?:string }
const boolFields = ['buyer_fit','official_domain_correct','entity_class_correct','evidence_supports_claim','signal_fresh','top_tier'] as const

export default function EvaluationReviewPage() {
  const [payload,setPayload] = useState<Payload|null>(null)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [form,setForm] = useState<Record<string,unknown>>({ label:'',company_size_class:'',contact_extraction_status:'',source_url:'',signal_date:'',reason:'',human_certification:false })
  const load = useCallback(async()=>{ const res=await fetch('/api/admin/evaluation-review',{cache:'no-store'}); const data=await res.json(); if(!res.ok) throw new Error(data.error||'Errore review'); setPayload(data) },[])
  useEffect(()=>{load().catch(e=>setError(String(e.message||e)))},[load])
  const candidate=payload?.case?.candidate_snapshot||{}
  const submit=async()=>{ if(!payload?.case)return; setBusy(true);setError('');try{const res=await fetch('/api/admin/evaluation-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,case_id:payload.case.id})});const data=await res.json();if(!res.ok)throw new Error(data.error||'Errore salvataggio');setForm({label:'',company_size_class:'',contact_extraction_status:'',source_url:'',signal_date:'',reason:'',human_certification:false});await load()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  return <main className="mx-auto max-w-6xl space-y-5 p-6">
    <div><h1 className="text-2xl font-bold">MIRAX Human Gold Review v5</h1><p className="text-sm text-slate-600">Il modello genera solo candidati: nessun modello ha scelto l’etichetta. Verifica manualmente dominio, fonte e data.</p></div>
    {payload&&<div className="rounded border p-3">Finale {payload.progress.reviewed}/{payload.progress.total} · Legacy baseline {payload.progress.legacy_baseline.reviewed}/{payload.progress.legacy_baseline.target_min} iniziali (cap {payload.progress.legacy_baseline.cap}) · v5 {payload.progress.v5.reviewed}/{payload.progress.v5.available} disponibili · Rimanenti {payload.progress.remaining}</div>}
    {error&&<div className="rounded border border-red-300 bg-red-50 p-3 text-red-800">{error}</div>}
    {!payload?.case&&payload?<div className="rounded border bg-green-50 p-5">Review completata.</div>:null}
    {payload?.case&&<div className="grid gap-5 lg:grid-cols-2">
      <section className="space-y-3 rounded border p-4"><h2 className="font-semibold">{payload.case.vertical} · caso {payload.case.case_number} · {payload.case.cohort}</h2><p className="text-xs text-slate-500">{payload.case.dataset_version}</p><p>{payload.case.query}</p><p className="text-xl font-bold">{String(candidate.name||'')}</p><a className="text-purple-700 underline" href={String(candidate.website||'#')} target="_blank" rel="noreferrer">Apri sito candidato</a><pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs">{JSON.stringify({candidate,provenance:payload.case.provenance},null,2)}</pre></section>
      <section className="space-y-3 rounded border p-4">
        <Select label="Etichetta" value={form.label} options={['positive','negative']} onChange={v=>setForm({...form,label:v})}/>
        {boolFields.map(key=><Select key={key} label={key} value={form[key]} options={['true','false']} onChange={v=>setForm({...form,[key]:v==='true'})}/>)}
        <Select label="Classe azienda" value={form.company_size_class} options={['micro','small','medium','large','not_operating','unknown']} onChange={v=>setForm({...form,company_size_class:v})}/>
        <Select label="Contatto pubblico" value={form.contact_extraction_status} options={['available_extracted','available_missed','not_public','not_checked']} onChange={v=>setForm({...form,contact_extraction_status:v})}/>
        <Input label="Dominio ufficiale" value={form.official_domain} onChange={v=>setForm({...form,official_domain:v})}/><Input label="URL fonte HTTPS verificata" value={form.source_url} onChange={v=>setForm({...form,source_url:v})}/><Input label="Data segnale/osservazione" type="date" value={form.signal_date} onChange={v=>setForm({...form,signal_date:v})}/>
        <label className="block text-sm">Motivazione umana (min 20 caratteri)<textarea className="mt-1 min-h-24 w-full rounded border p-2" value={String(form.reason||'')} onChange={e=>setForm({...form,reason:e.target.value})}/></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.human_certification===true} onChange={e=>setForm({...form,human_certification:e.target.checked})}/>Confermo di aver aperto e verificato personalmente la fonte; nessun modello ha scelto l’etichetta.</label>
        <button disabled={busy} onClick={submit} className="w-full rounded bg-purple-700 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy?'Salvataggio…':'Salva giudizio e passa al prossimo'}</button>
      </section>
    </div>}
  </main>
}
function Select({label,value,options,onChange}:{label:string;value:unknown;options:string[];onChange:(v:string)=>void}){return <label className="block text-sm">{label}<select className="mt-1 w-full rounded border p-2" value={value===true?'true':value===false?'false':String(value||'')} onChange={e=>onChange(e.target.value)}><option value="">Seleziona…</option>{options.map(v=><option key={v}>{v}</option>)}</select></label>}
function Input({label,value,onChange,type='text'}:{label:string;value:unknown;onChange:(v:string)=>void;type?:string}){return <label className="block text-sm">{label}<input type={type} className="mt-1 w-full rounded border p-2" value={String(value||'')} onChange={e=>onChange(e.target.value)}/></label>}
