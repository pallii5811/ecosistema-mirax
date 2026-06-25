"use client"

import { useEffect, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import {
  Cable,
  Check,
  Copy,
  Mail,
  Settings2,
  Workflow,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

type IntegrationId = 'webhook'

type Integration = {
  id: IntegrationId
  title: string
  description: string
  badge?: { label: string; tone: 'popular' | 'comingSoon' }
  icon: React.ReactNode
  enabled: boolean
  comingSoon?: boolean
}

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onChange}
      aria-pressed={checked}
      className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-0 ${
        disabled
          ? 'opacity-60 cursor-not-allowed bg-slate-100 border-slate-200'
          : checked
            ? 'bg-slate-900 border-slate-900'
            : 'bg-slate-200 border-slate-300 hover:border-slate-400'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function Badge({ label, tone }: { label: string; tone: 'popular' | 'comingSoon' }) {
  const base = 'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide border'
  if (tone === 'popular') {
    return <span className={`${base} bg-emerald-50 text-emerald-700 border-emerald-200`}>{label}</span>
  }
  return <span className={`${base} bg-slate-100 text-slate-600 border-slate-200`}>{label}</span>
}

function IntegrationCard({
  integration,
  onToggle,
  children,
}: {
  integration: Integration
  onToggle: (id: IntegrationId) => void
  children?: React.ReactNode
}) {
  return (
    <Card
      className={`group relative overflow-hidden rounded-lg border border-slate-200 bg-white p-6 transition-colors duration-150 hover:border-slate-300 ${
        integration.comingSoon ? 'opacity-70' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-50 border border-slate-200">
            <div className="text-slate-500">{integration.icon}</div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <div className="text-base font-semibold text-slate-900">{integration.title}</div>
              {integration.badge ? <Badge label={integration.badge.label} tone={integration.badge.tone} /> : null}
            </div>
            <div className="mt-0.5 text-sm text-slate-500">{integration.description}</div>
          </div>
        </div>

        <Switch
          checked={integration.enabled}
          disabled={integration.comingSoon}
          onChange={() => onToggle(integration.id)}
        />
      </div>

      {children ? <div className="mt-5">{children}</div> : null}
    </Card>
  )
}

export default function IntegrationsPage() {
  const [webhookEnabled, setWebhookEnabled] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [webhookLoading, setWebhookLoading] = useState(false)
  const [webhookSaving, setWebhookSaving] = useState(false)
  const [webhookError, setWebhookError] = useState<string | null>(null)
  const [webhookSaved, setWebhookSaved] = useState(false)

  useEffect(() => {
    const run = async () => {
      setWebhookLoading(true)
      setWebhookError(null)

      try {
        const res = await fetch('/api/integrations/webhook', { cache: 'no-store' })
        const data = (await res.json().catch(() => null)) as { webhookUrl?: string; error?: string } | null

        if (!res.ok) {
          throw new Error(data?.error || 'Impossibile caricare le impostazioni webhook.')
        }

        const url = (data?.webhookUrl ?? '').trim()
        setWebhookUrl(url)
        setWebhookEnabled(Boolean(url))
      } catch (e) {
        const raw = e instanceof Error ? e.message : 'Errore webhook.'
        setWebhookError(raw)
      } finally {
        setWebhookLoading(false)
      }
    }

    run()
  }, [])

  const grid: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
        delayChildren: 0.05,
      },
    },
  }

  const item: Variants = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xl md:text-2xl font-semibold tracking-tight text-slate-900">Integrazioni</div>
        <div className="mt-1 text-sm text-slate-600">
          Collega MIRAX al tuo ecosistema di vendita. Attiva automazioni, CRM e alert in pochi secondi.
        </div>
      </div>

      <Card className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-slate-900">CRM Sync (HubSpot / Webhook)</div>
            <div className="mt-1 text-sm text-slate-600">Configura l'invio dei lead al tuo CRM e usa il bottone “CRM” nella tabella risultati.</div>
          </div>
          <Button asChild className="rounded-md bg-slate-900 hover:bg-slate-800 text-white font-medium">
            <Link href="/dashboard/integrations/crm">Configura</Link>
          </Button>
        </div>
      </Card>

      <motion.div
        variants={grid}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
      >
        <motion.div variants={item} className="lg:col-span-3">
          <IntegrationCard
            integration={{
              id: 'webhook',
              title: 'Webhook personalizzato',
              description: 'Invia i dati grezzi (Audit, Email, Tech Stack) a qualsiasi endpoint esterno.',
              icon: <Cable className="h-5 w-5" strokeWidth={1.75} />,
              enabled: webhookEnabled,
            }}
            onToggle={() => {
              setWebhookSaved(false)
              setWebhookError(null)
              setWebhookEnabled((p) => !p)
            }}
          >
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Mail className="h-4 w-4 text-slate-400" strokeWidth={1.75} />
                  Endpoint URL
                </div>
                <div className="text-xs text-slate-400">POST JSON</div>
              </div>

              <div className="mt-3 flex flex-col md:flex-row gap-3">
                <Input
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://tuo-endpoint.com/webhook"
                  className="h-10 rounded-lg border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-1 focus-visible:ring-slate-900"
                  disabled={webhookLoading || webhookSaving}
                />
                <Button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(webhookUrl)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1000)
                    } catch {
                      // ignore
                    }
                  }}
                  variant="secondary"
                  className="h-10 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  disabled={!webhookUrl || webhookLoading || webhookSaving}
                >
                  {copied ? (
                    <span className="flex items-center gap-2">
                      <Check className="h-4 w-4" strokeWidth={1.75} /> Copiato
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Copy className="h-4 w-4" strokeWidth={1.75} /> Copia
                    </span>
                  )}
                </Button>
                <Button
                  type="button"
                  onClick={async () => {
                    setWebhookSaving(true)
                    setWebhookError(null)
                    setWebhookSaved(false)

                    try {
                      const res = await fetch('/api/integrations/webhook', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ webhookUrl: webhookEnabled ? webhookUrl : '' }),
                      })

                      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null

                      if (!res.ok) {
                        throw new Error(data?.error || 'Errore durante il salvataggio.')
                      }

                      setWebhookSaved(true)
                      if (!webhookEnabled) {
                        setWebhookUrl('')
                      }
                    } catch (e) {
                      const raw = e instanceof Error ? e.message : 'Errore webhook.'
                      setWebhookError(raw)
                    } finally {
                      setWebhookSaving(false)
                    }
                  }}
                  className="h-10 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-medium"
                  disabled={webhookLoading || webhookSaving || (webhookEnabled && !webhookUrl)}
                >
                  {webhookSaving ? 'Salvataggio…' : 'Salva'}
                </Button>
              </div>

              <div className="mt-3 text-xs text-slate-500">
                Quando attivo, MIRAX invierà payload con Audit, contatti email e segnali tecnici. Perfetto per CRM custom,
                enrichment, orchestrazione e qualsiasi stack.
              </div>

              {webhookError ? (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {webhookError}
                </div>
              ) : null}

              {webhookSaved ? (
                <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  Webhook salvato.
                </div>
              ) : null}

              <div className="mt-3 text-xs text-slate-400">
                Stato: {webhookEnabled ? 'Attivo' : 'Disattivato'}
              </div>
            </div>
          </IntegrationCard>
        </motion.div>
      </motion.div>
    </div>
  )
}
