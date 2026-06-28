'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  CheckCircle,
  ExternalLink,
  Loader2,
  Plus,
  Plug,
  Webhook,
  ShieldCheck,
  History,
  Unplug,
  XCircle,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/utils/supabase/client'

type TestState = { status: 'idle' | 'testing' | 'success' | 'error'; message: string | null }

export default function CrmIntegrationsPage() {
  const supabase = createClient()
  const searchParams = useSearchParams()

  const [integrations, setIntegrations] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const [showHubspotForm, setShowHubspotForm] = useState(false)
  const [showWebhookForm, setShowWebhookForm] = useState(false)

  const [hubspotToken, setHubspotToken] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')

  const [isSaving, setIsSaving] = useState(false)
  const [hubspotTest, setHubspotTest] = useState<TestState>({ status: 'idle', message: null })
  const [webhookTest, setWebhookTest] = useState<TestState>({ status: 'idle', message: null })
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)
  const [syncSavingId, setSyncSavingId] = useState<string | null>(null)
  const [salesforceNotice, setSalesforceNotice] = useState<string | null>(null)

  useEffect(() => {
    loadIntegrations()
    const sf = searchParams.get('salesforce')
    if (sf === 'connected') setSalesforceNotice('Salesforce connesso con successo.')
    if (sf === 'error') setSalesforceNotice('Connessione Salesforce non riuscita. Riprova.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadIntegrations = async () => {
    setIsLoading(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setIntegrations([])
      setIsLoading(false)
      return
    }

    const { data } = await supabase
      .from('crm_integrations')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)

    setIntegrations(data || [])
    setIsLoading(false)
  }

  const testHubspot = async () => {
    const token = hubspotToken.trim()
    if (!token) {
      setHubspotTest({ status: 'error', message: 'Inserisci prima il token.' })
      return
    }
    setHubspotTest({ status: 'testing', message: null })
    try {
      const res = await fetch('/api/crm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'hubspot', token }),
      })
      const data = await res.json().catch(() => null)
      if (data?.ok) {
        setHubspotTest({
          status: 'success',
          message: data?.uiDomain ? `Connesso al portale ${data.uiDomain}` : 'Token valido.',
        })
      } else {
        setHubspotTest({ status: 'error', message: data?.error || 'Token non valido.' })
      }
    } catch (e: any) {
      setHubspotTest({ status: 'error', message: e?.message || 'Errore di rete.' })
    }
  }

  const saveHubspot = async () => {
    if (!hubspotToken.trim()) return

    setIsSaving(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setIsSaving(false)
      return
    }

    await supabase.from('crm_integrations').insert({
      user_id: user.id,
      type: 'hubspot',
      name: 'HubSpot',
      config: { access_token: hubspotToken.trim() },
    })

    setHubspotToken('')
    setHubspotTest({ status: 'idle', message: null })
    setShowHubspotForm(false)
    setIsSaving(false)
    loadIntegrations()
  }

  const testWebhook = async () => {
    const url = webhookUrl.trim()
    if (!url) {
      setWebhookTest({ status: 'error', message: 'Inserisci prima l\'URL.' })
      return
    }
    setWebhookTest({ status: 'testing', message: null })
    try {
      const res = await fetch('/api/crm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'webhook', url, secret: webhookSecret.trim() || undefined }),
      })
      const data = await res.json().catch(() => null)
      if (data?.ok) {
        setWebhookTest({ status: 'success', message: `Endpoint OK (HTTP ${data.status}).` })
      } else {
        setWebhookTest({ status: 'error', message: data?.error || 'Endpoint non risponde correttamente.' })
      }
    } catch (e: any) {
      setWebhookTest({ status: 'error', message: e?.message || 'Errore di rete.' })
    }
  }

  const saveWebhook = async () => {
    if (!webhookUrl.trim()) return

    setIsSaving(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setIsSaving(false)
      return
    }

    await supabase.from('crm_integrations').insert({
      user_id: user.id,
      type: 'webhook',
      name: 'Webhook',
      config: { url: webhookUrl.trim(), secret: webhookSecret.trim() || null },
    })

    setWebhookUrl('')
    setWebhookSecret('')
    setWebhookTest({ status: 'idle', message: null })
    setShowWebhookForm(false)
    setIsSaving(false)
    loadIntegrations()
  }

  const disconnectIntegration = async (id: string) => {
    if (!confirm('Disconnettere questa integrazione? Lo storico degli invii rimarrà accessibile.')) return
    setDisconnectingId(id)
    try {
      const res = await fetch('/api/crm/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId: id }),
      })
      const data = await res.json().catch(() => null)
      if (!data?.ok) {
        alert(data?.error || 'Errore disconnessione.')
      } else {
        await loadIntegrations()
      }
    } catch (e: any) {
      alert(e?.message || 'Errore di rete.')
    } finally {
      setDisconnectingId(null)
    }
  }

  const updateSyncSetting = async (
    id: string,
    patch: { auto_sync_hot_leads?: boolean; auto_create_deals?: boolean },
  ) => {
    setSyncSavingId(id)
    try {
      const res = await fetch('/api/crm/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      })
      const data = await res.json().catch(() => null)
      if (data?.ok && data.integration) {
        setIntegrations((prev) => prev.map((i) => (i.id === id ? { ...i, ...data.integration } : i)))
      } else {
        alert(data?.error || 'Errore salvataggio impostazioni.')
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Errore di rete.')
    } finally {
      setSyncSavingId(null)
    }
  }

  const connectSalesforce = async () => {
    setIsSaving(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const { data: row, error } = await supabase
        .from('crm_integrations')
        .insert({
          user_id: user.id,
          type: 'salesforce',
          name: 'Salesforce',
          config: {},
          is_active: false,
        })
        .select('id')
        .single()

      if (error || !row?.id) {
        setSalesforceNotice(error?.message || 'Impossibile creare integrazione Salesforce.')
        return
      }

      const res = await fetch(`/api/crm/salesforce/oauth?integration_id=${row.id}`)
      const data = await res.json().catch(() => null)
      if (data?.url) {
        window.location.href = data.url
      } else {
        setSalesforceNotice(data?.error || 'OAuth Salesforce non disponibile.')
      }
    } catch (e: unknown) {
      setSalesforceNotice(e instanceof Error ? e.message : 'Errore di rete.')
    } finally {
      setIsSaving(false)
    }
  }

  const hasHubspot = integrations.some((i) => i.type === 'hubspot')
  const hasWebhook = integrations.some((i) => i.type === 'webhook')
  const hasSalesforce = integrations.some((i) => i.type === 'salesforce')

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Plug className="w-6 h-6 text-violet-600" />
        <div>
          <h1 className="text-2xl font-bold">Integrazioni CRM</h1>
          <p className="text-slate-500 text-sm">Invia i lead direttamente nel tuo CRM con un click</p>
        </div>
      </div>

      {salesforceNotice ? (
        <div className="mb-4 text-sm px-3 py-2 rounded border border-slate-200 bg-slate-50 text-slate-700">
          {salesforceNotice}
        </div>
      ) : null}

      {isLoading ? (
        <div className="p-8 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            <div className="bg-white border rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                  <span className="text-orange-600 font-bold text-sm">HS</span>
                </div>
                <div>
                  <h3 className="font-semibold">HubSpot</h3>
                  <p className="text-xs text-slate-500">CRM gratuito più usato in Italia</p>
                </div>
              </div>

              {hasHubspot ? (
                <div className="flex items-center gap-2 text-emerald-600 text-sm">
                  <CheckCircle className="w-4 h-4" /> Connesso
                </div>
              ) : showHubspotForm ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="HubSpot Private App Token"
                    value={hubspotToken}
                    onChange={(e) => {
                      setHubspotToken(e.target.value)
                      if (hubspotTest.status !== 'idle') setHubspotTest({ status: 'idle', message: null })
                    }}
                    className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                  <a
                    href="https://developers.hubspot.com/docs/api/private-apps"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-violet-600 flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" /> Come ottenere il token
                  </a>
                  {hubspotTest.status === 'success' && hubspotTest.message ? (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5">
                      <CheckCircle className="w-3 h-3 flex-shrink-0" /> {hubspotTest.message}
                    </div>
                  ) : null}
                  {hubspotTest.status === 'error' && hubspotTest.message ? (
                    <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                      <XCircle className="w-3 h-3 flex-shrink-0" /> {hubspotTest.message}
                    </div>
                  ) : null}
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => setShowHubspotForm(false)}>
                      Annulla
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={testHubspot}
                      disabled={hubspotTest.status === 'testing' || !hubspotToken.trim()}
                      className="border-slate-300"
                    >
                      {hubspotTest.status === 'testing' ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <>
                          <ShieldCheck className="w-3 h-3 mr-1" /> Testa
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      onClick={saveHubspot}
                      disabled={isSaving || !hubspotToken.trim()}
                      className="bg-violet-600 hover:bg-violet-700"
                    >
                      {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Collega'}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={() => setShowHubspotForm(true)}
                  className="bg-orange-500 hover:bg-orange-600 text-white"
                >
                  <Plus className="w-3 h-3 mr-1" /> Collega HubSpot
                </Button>
              )}
            </div>

            <div className="bg-white border rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-sky-100 rounded-lg flex items-center justify-center">
                  <span className="text-sky-700 font-bold text-sm">SF</span>
                </div>
                <div>
                  <h3 className="font-semibold">Salesforce</h3>
                  <p className="text-xs text-slate-500">OAuth + export Lead nativo</p>
                </div>
              </div>

              {hasSalesforce ? (
                <div className="flex items-center gap-2 text-emerald-600 text-sm">
                  <CheckCircle className="w-4 h-4" /> Connesso
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={connectSalesforce}
                  disabled={isSaving}
                  className="bg-sky-600 hover:bg-sky-700 text-white"
                >
                  {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : (
                    <>
                      <Plus className="w-3 h-3 mr-1" /> Collega Salesforce
                    </>
                  )}
                </Button>
              )}
            </div>

            <div className="bg-white border rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-violet-100 rounded-lg flex items-center justify-center">
                  <Webhook className="w-5 h-5 text-violet-600" />
                </div>
                <div>
                  <h3 className="font-semibold">Webhook</h3>
                  <p className="text-xs text-slate-500">Qualsiasi CRM (Pipedrive, Salesforce...)</p>
                </div>
              </div>

              {hasWebhook ? (
                <div className="flex items-center gap-2 text-emerald-600 text-sm">
                  <CheckCircle className="w-4 h-4" /> Connesso
                </div>
              ) : showWebhookForm ? (
                <div className="space-y-2">
                  <input
                    type="url"
                    placeholder="https://tuocrm.com/webhook"
                    value={webhookUrl}
                    onChange={(e) => {
                      setWebhookUrl(e.target.value)
                      if (webhookTest.status !== 'idle') setWebhookTest({ status: 'idle', message: null })
                    }}
                    className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                  <input
                    type="text"
                    placeholder="Secret (opzionale)"
                    value={webhookSecret}
                    onChange={(e) => setWebhookSecret(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                  {webhookTest.status === 'success' && webhookTest.message ? (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5">
                      <CheckCircle className="w-3 h-3 flex-shrink-0" /> {webhookTest.message}
                    </div>
                  ) : null}
                  {webhookTest.status === 'error' && webhookTest.message ? (
                    <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                      <XCircle className="w-3 h-3 flex-shrink-0" /> {webhookTest.message}
                    </div>
                  ) : null}
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => setShowWebhookForm(false)}>
                      Annulla
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={testWebhook}
                      disabled={webhookTest.status === 'testing' || !webhookUrl.trim()}
                      className="border-slate-300"
                    >
                      {webhookTest.status === 'testing' ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <>
                          <ShieldCheck className="w-3 h-3 mr-1" /> Testa
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      onClick={saveWebhook}
                      disabled={isSaving || !webhookUrl.trim()}
                      className="bg-violet-600 hover:bg-violet-700"
                    >
                      {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Salva'}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={() => setShowWebhookForm(true)}
                  className="bg-violet-600 hover:bg-violet-700 text-white"
                >
                  <Plus className="w-3 h-3 mr-1" /> Configura Webhook
                </Button>
              )}
            </div>
          </div>

          {integrations.length > 0 ? (
            <div className="bg-white border rounded-xl overflow-hidden mb-6">
              <div className="p-4 border-b bg-violet-50 flex items-center gap-2">
                <Zap className="w-4 h-4 text-violet-600 flex-shrink-0" />
                <div>
                  <span className="font-medium text-sm">Sincronizzazione automatica MIRAX</span>
                  <p className="text-xs text-slate-500">
                    I hot lead (Intent ≥ 60) vengono inviati al CRM senza click manuale
                  </p>
                </div>
              </div>
              <div className="divide-y">
                {integrations.map((i) => (
                  <div key={`sync-${i.id}`} className="p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-sm">{i.name}</div>
                      {syncSavingId === i.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500" />
                      ) : null}
                    </div>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(i.auto_sync_hot_leads)}
                        disabled={syncSavingId === i.id}
                        onChange={(e) => updateSyncSetting(i.id, { auto_sync_hot_leads: e.target.checked })}
                        className="mt-0.5 rounded border-slate-300"
                      />
                      <span className="text-sm">
                        <span className="font-medium">Auto-sync hot lead</span>
                        <span className="block text-xs text-slate-500">Intent Score ≥ 60 → contatto nel CRM</span>
                      </span>
                    </label>
                    <label
                      className={`flex items-start gap-3 ${i.auto_sync_hot_leads ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(i.auto_create_deals)}
                        disabled={syncSavingId === i.id || !i.auto_sync_hot_leads}
                        onChange={(e) => updateSyncSetting(i.id, { auto_create_deals: e.target.checked })}
                        className="mt-0.5 rounded border-slate-300"
                      />
                      <span className="text-sm">
                        <span className="font-medium">Crea deal automaticamente</span>
                        <span className="block text-xs text-slate-500">
                          Intent Score ≥ 80 → deal associato (HubSpot)
                        </span>
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {integrations.length > 0 ? (
            <div className="bg-white border rounded-xl overflow-hidden">
              <div className="p-4 border-b bg-slate-50 flex items-center justify-between flex-wrap gap-2">
                <span className="font-medium">Integrazioni attive</span>
                <Link
                  href="/dashboard/integrations/crm/history"
                  className="inline-flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 font-semibold"
                >
                  <History className="w-3 h-3" /> Cronologia sync
                </Link>
              </div>
              <div className="divide-y">
                {integrations.map((i) => (
                  <div key={i.id} className="p-4 flex justify-between items-center gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm">{i.name}</div>
                      <div className="text-xs text-slate-400">
                        {i.leads_synced} lead sincronizzati
                        {i.last_sync_at ? ` · Ultimo: ${new Date(i.last_sync_at).toLocaleDateString('it-IT')}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => disconnectIntegration(i.id)}
                        disabled={disconnectingId === i.id}
                        className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                      >
                        {disconnectingId === i.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <>
                            <Unplug className="w-3 h-3 mr-1" /> Disconnetti
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
