'use client'

import { useCallback, useEffect, useState } from 'react'

type ReviewCase = { id:string; dataset_version:string; cohort:'legacy_baseline'|'v5_output'|'adversarial'; vertical:string; case_number:number; query:string; candidate_snapshot:Record<string,unknown>; provenance:Record<string,unknown> }
type CohortProgress = { reviewed:number;target:number;available:number }
type Payload = { progress:{reviewed:number;total:number;remaining:number;legacy_baseline:CohortProgress&{target_min:number;cap:number};v5_output:CohortProgress;adversarial:CohortProgress}; case:ReviewCase|null; error?:string }
const boolFields = ['buyer_fit','official_domain_correct','entity_class_correct','evidence_supports_claim','signal_fresh','top_tier'] as const

export default function EvaluationReviewPage() {
  const [payload,setPayload] = useState<Payload|null>(null)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [form,setForm] = useState<Record<string,unknown>>({ label:'',company_size_class:'',contact_extraction_status:'',source_url:'',signal_date:'',reason:'',human_certification:false })
  const load = useCallback(async()=>{ const res=await fetch('/api/admin/evaluation-review',{cache:'no-store'}); const data=await res.json(); if(!res.ok) throw new Error(data.error||'Errore review'); setPayload(data) },[])
  useEffect(()=>{load().catch(e=>setError(String(e.message||e)))},[load])
  const candidate=payload?.case?.candidate_snapshot||{}
  const provenance=payload?.case?.provenance||{}
  const canSubmit=Boolean(payload?.case&&form.human_certification===true&&String(form.label||'')&&String(form.company_size_class||'')&&String(form.contact_extraction_status||'')&&String(form.official_domain||'')&&/^https:\/\//i.test(String(form.source_url||''))&&String(form.signal_date||'')&&String(form.reason||'').trim().length>=20&&boolFields.every(key=>typeof form[key]==='boolean'))
  const submit=async()=>{ if(!payload?.case)return; setBusy(true);setError('');try{const res=await fetch('/api/admin/evaluation-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,case_id:payload.case.id})});const data=await res.json();if(!res.ok)throw new Error(data.error||'Errore salvataggio');setForm({label:'',company_size_class:'',contact_extraction_status:'',source_url:'',signal_date:'',reason:'',human_certification:false});await load()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  return <main className="mx-auto max-w-6xl space-y-5 p-6">
    <div><h1 className="text-2xl font-bold">MIRAX Human Gold Review v5</h1><p className="text-sm text-slate-600">Il modello genera solo candidati: nessun modello ha scelto l’etichetta. Verifica manualmente dominio, fonte, data e contatto.</p></div>
    {payload&&<div className="grid gap-2 rounded border p-3 text-sm sm:grid-cols-4">
      <span>Totale <strong>{payload.progress.reviewed}/{payload.progress.total}</strong></span>
      <span>v5 output <strong>{payload.progress.v5_output.reviewed}/{payload.progress.v5_output.target}</strong></span>
      <span>Avversariali <strong>{payload.progress.adversarial.reviewed}/{payload.progress.adversarial.target}</strong></span>
      <span>Legacy <strong>{payload.progress.legacy_baseline.reviewed}/{payload.progress.legacy_baseline.target}</strong></span>
      <span className="sm:col-span-4 text-slate-600">Rimanenti per il gate finale: {payload.progress.remaining}</span>
    </div>}
    {error&&<div className="rounded border border-red-300 bg-red-50 p-3 text-red-800">{error}</div>}
    {!payload?.case&&payload?<div className={`rounded border p-5 ${payload.progress.remaining===0?'bg-green-50':'bg-amber-50'}`}>{payload.progress.remaining===0?'Review umana completata.':'Nessun evidence packet pronto: il gate non è completo e riprenderà quando arriveranno nuovi output v5.'}</div>:null}
    {payload?.case&&<div className="grid gap-5 lg:grid-cols-2">
      <section className="space-y-3 rounded border p-4"><h2 className="font-semibold">{payload.case.vertical} · caso {payload.case.case_number} · {payload.case.cohort}</h2><p className="text-xs text-slate-500">{payload.case.dataset_version}</p><p>{payload.case.query}</p><p className="text-xl font-bold">{String(candidate.name||'')}</p><div className="flex flex-wrap gap-3 text-sm"><a className="text-purple-700 underline" href={String(candidate.website||'#')} target="_blank" rel="noreferrer">Apri sito candidato</a>{/^https:\/\//i.test(String(provenance.source_url||''))&&<a className="text-purple-700 underline" href={String(provenance.source_url)} target="_blank" rel="noreferrer">Apri fonte del segnale</a>}</div><dl className="grid grid-cols-2 gap-2 rounded bg-slate-50 p-3 text-xs"><dt>Publisher</dt><dd>{String(provenance.publisher||'N/D')}</dd><dt>Data osservazione</dt><dd>{String(provenance.observation_date||'N/D')}</dd><dt>Metodo</dt><dd>{String(provenance.extraction_method||'N/D')}</dd><dt>Costo attribuito</dt><dd>€ {Number(provenance.cost_eur||provenance.cost_eur_total_run||0).toFixed(4)}</dd><dt>Motivo selezione</dt><dd>{String(provenance.selection_reason||'N/D')}</dd></dl><details><summary className="cursor-pointer text-sm text-slate-600">Payload tecnico completo</summary><pre className="mt-2 max-h-[420px] overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs">{JSON.stringify({candidate,provenance},null,2)}</pre></details></section>
      <section className="space-y-3 rounded border p-4">
        <Select label="Etichetta" value={form.label} options={['positive','negative']} onChange={v=>setForm({...form,label:v})}/>
        {boolFields.map(key=><Select key={key} label={key} value={form[key]} options={['true','false']} onChange={v=>setForm({...form,[key]:v==='true'})}/>)}
        <Select label="Classe azienda" value={form.company_size_class} options={['micro','small','medium','large','not_operating','unknown']} onChange={v=>setForm({...form,company_size_class:v})}/>
        <Select label="Contatto pubblico" value={form.contact_extraction_status} options={['available_extracted','available_missed','not_public','not_checked']} onChange={v=>setForm({...form,contact_extraction_status:v})}/>
        <Input label="Dominio ufficiale" value={form.official_domain} onChange={v=>setForm({...form,official_domain:v})}/><Input label="URL fonte HTTPS verificata" value={form.source_url} onChange={v=>setForm({...form,source_url:v})}/><Input label="Data segnale/osservazione" type="date" value={form.signal_date} onChange={v=>setForm({...form,signal_date:v})}/>
        <label className="block text-sm">Motivazione umana (min 20 caratteri)<textarea className="mt-1 min-h-24 w-full rounded border p-2" value={String(form.reason||'')} onChange={e=>setForm({...form,reason:e.target.value})}/></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.human_certification===true} onChange={e=>setForm({...form,human_certification:e.target.checked})}/>Confermo di aver aperto e verificato personalmente la fonte; nessun modello ha scelto l’etichetta.</label>
        <button disabled={busy||!canSubmit} onClick={submit} className="w-full rounded bg-purple-700 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy?'Salvataggio…':'Salva giudizio e passa al prossimo'}</button>
      </section>
    </div>}
  </main>
}
function Select({label,value,options,onChange}:{label:string;value:unknown;options:string[];onChange:(v:string)=>void}){return <label className="block text-sm">{label}<select className="mt-1 w-full rounded border p-2" value={value===true?'true':value===false?'false':String(value||'')} onChange={e=>onChange(e.target.value)}><option value="">Seleziona…</option>{options.map(v=><option key={v}>{v}</option>)}</select></label>}
function Input({label,value,onChange,type='text'}:{label:string;value:unknown;onChange:(v:string)=>void;type?:string}){return <label className="block text-sm">{label}<input type={type} className="mt-1 w-full rounded border p-2" value={String(value||'')} onChange={e=>onChange(e.target.value)}/></label>}
