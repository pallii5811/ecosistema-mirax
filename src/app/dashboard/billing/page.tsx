'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useDashboard, PLAN_CREDITS, PLAN_LABELS } from '@/components/DashboardContext'
import { Check, Crown, Zap, Building2, Rocket, CreditCard, Loader2, ExternalLink, Shield } from 'lucide-react'

type PaymentMethod = 'stripe' | 'paypal'

const plans = [
  {
    id: 'free' as const,
    name: 'Esplora',
    price: '€0',
    period: 'per sempre',
    icon: Zap,
    features: ['10 crediti una tantum', 'Ricerca AI + audit tecnico', 'Pitch, outreach e pipeline', 'Export CSV', 'Nessuna carta richiesta'],
    highlight: false,
  },
  {
    id: 'starter' as const,
    name: 'Starter',
    price: '€49',
    period: '/ mese',
    icon: Rocket,
    features: [
      '1.200 crediti / mese',
      'Tutte le funzionalità Esplora',
      'Liste, ambienti e bulk save',
      'Sync HubSpot e webhook',
      'Smart Insights e hotlist',
      'Supporto email prioritario',
    ],
    highlight: false,
    badge: 'Popolare',
  },
  {
    id: 'pro' as const,
    name: 'PRO',
    price: '€99',
    period: '/ mese',
    icon: Crown,
    features: [
      '3.000 crediti / mese',
      'Tutto dello Starter incluso',
      'Sequenze email con invio automatico',
      'Ricerca Ambiente (espansione AI)',
      'Campaign Agent in outreach',
      'Supporto prioritario',
    ],
    highlight: true,
    badge: 'Più Scelto',
  },
  {
    id: 'agency' as const,
    name: 'Agency',
    price: '€249',
    period: '/ mese',
    icon: Building2,
    features: [
      '10.000 crediti / mese',
      'Tutto del PRO incluso',
      'API REST + chiavi API',
      'Webhook personalizzato',
      'Sync CRM bulk avanzato',
      'Supporto dedicato',
    ],
    highlight: false,
  },
]

export default function BillingPage() {
  const { credits, planType } = useDashboard()
  const planCredits = PLAN_CREDITS[planType] || 100
  const planLabel = PLAN_LABELS[planType] || 'Free'
  const searchParams = useSearchParams()

  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('stripe')
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  // Handle return from Stripe/PayPal
  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      setSuccessMsg('Pagamento completato! Il tuo piano è stato aggiornato.')
    } else if (searchParams.get('canceled') === 'true') {
      setErrorMsg('Pagamento annullato.')
    }

    // Handle PayPal return — capture the order
    const paypalStatus = searchParams.get('paypal')
    const token = searchParams.get('token') // PayPal order ID
    if (paypalStatus === 'success' && token) {
      capturePayPalOrder(token)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function capturePayPalOrder(orderId: string) {
    setLoading(true)
    setErrorMsg('')
    try {
      const res = await fetch('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      })
      const data = await res.json()
      if (data.success) {
        setSuccessMsg(`Pagamento PayPal completato! Piano aggiornato a ${data.plan}.`)
        window.history.replaceState({}, '', '/dashboard/billing')
      } else {
        setErrorMsg(data.error || 'Errore durante la cattura del pagamento PayPal.')
      }
    } catch {
      setErrorMsg('Errore di rete durante la conferma del pagamento PayPal.')
    } finally {
      setLoading(false)
    }
  }

  async function handleUpgrade(planId: string) {
    if (planId === 'free') return
    setLoading(true)
    setErrorMsg('')
    setSuccessMsg('')

    try {
      if (paymentMethod === 'stripe') {
        const res = await fetch('/api/stripe/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId }),
        })
        const data = await res.json()
        if (data.url) {
          window.location.href = data.url
          return
        }
        setErrorMsg(data.error || 'Errore creazione checkout Stripe.')
      } else {
        const res = await fetch('/api/paypal/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId }),
        })
        const data = await res.json()
        if (data.approvalUrl) {
          window.location.href = data.approvalUrl
          return
        }
        setErrorMsg(data.error || 'Errore creazione ordine PayPal.')
      }
    } catch {
      setErrorMsg('Errore di rete. Riprova.')
    } finally {
      setLoading(false)
    }
  }

  async function handleManageSubscription() {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        setErrorMsg(data.error || 'Impossibile aprire il portale di gestione.')
      }
    } catch {
      setErrorMsg('Errore di rete.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-slate-900">Billing</h1>
        <p className="text-sm text-slate-500 mt-1">Gestisci il tuo piano e i crediti mensili</p>
      </div>

      {/* Success / Error banners */}
      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md px-4 py-3 text-sm font-medium flex items-center gap-2">
          <Check className="w-4 h-4" strokeWidth={1.75} /> {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-md px-4 py-3 text-sm font-medium">
          {errorMsg}
        </div>
      )}

      {/* Current plan summary */}
      <Card className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Piano attuale</p>
            <p className="text-2xl font-semibold text-slate-900 mt-0.5">{planLabel}</p>
            <p className="text-sm text-slate-500 mt-1">
              {credits.toLocaleString('it-IT')} crediti rimanenti su {planCredits.toLocaleString('it-IT')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-center min-w-[100px]">
              <p className="text-2xl font-semibold text-slate-900 tabular-nums">{credits.toLocaleString('it-IT')}</p>
              <p className="text-xs text-slate-500">crediti</p>
            </div>
            <div className="relative w-16 h-16">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                <circle
                  cx="18" cy="18" r="15" fill="none" stroke="#0f172a" strokeWidth="3"
                  strokeDasharray={`${Math.round((credits / planCredits) * 94)} 94`}
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-slate-700 tabular-nums">
                {Math.round((credits / planCredits) * 100)}%
              </span>
            </div>
            {planType !== 'free' && (
              <Button
                onClick={handleManageSubscription}
                disabled={loading}
                className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-md text-xs px-3 py-2"
              >
                <ExternalLink className="w-3 h-3 mr-1" strokeWidth={1.75} />
                Gestisci
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Payment method selector */}
      <Card className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Metodo di pagamento</h2>
        <div className="flex gap-3">
          <button
            onClick={() => setPaymentMethod('stripe')}
            className={`flex-1 flex items-center justify-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
              paymentMethod === 'stripe'
                ? 'border-slate-900 bg-slate-50'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <CreditCard className={`w-5 h-5 ${paymentMethod === 'stripe' ? 'text-slate-900' : 'text-slate-400'}`} strokeWidth={1.75} />
            <div className="text-left">
              <p className={`text-sm font-semibold ${paymentMethod === 'stripe' ? 'text-slate-900' : 'text-slate-700'}`}>
                Carta di Credito / Debito
              </p>
              <p className="text-xs text-slate-400">Visa, Mastercard, Amex via Stripe</p>
            </div>
            {paymentMethod === 'stripe' && (
              <div className="w-5 h-5 rounded-md bg-slate-900 flex items-center justify-center ml-auto">
                <Check className="w-3 h-3 text-white" strokeWidth={1.75} />
              </div>
            )}
          </button>

          <button
            onClick={() => setPaymentMethod('paypal')}
            className={`flex-1 flex items-center justify-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
              paymentMethod === 'paypal'
                ? 'border-slate-900 bg-slate-50'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <svg className={`w-5 h-5 ${paymentMethod === 'paypal' ? 'text-slate-900' : 'text-slate-400'}`} viewBox="0 0 24 24" fill="currentColor">
              <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c1.482-1.835 1.014-4.355-.508-5.843C18.75-.675 16.447 0 14.076 0h-.003c.003 0 .005.001.007.002-.002 0-.004-.002-.007-.002H6.654c-.528 0-.973.382-1.055.9L2.51 20.597a.643.643 0 0 0 .635.74h4.122l-.135.863a.572.572 0 0 0 .566.66h3.942c.46 0 .853-.335.925-.79l.038-.19.733-4.648.047-.256a.93.93 0 0 1 .919-.79h.578c3.762 0 6.706-1.528 7.565-5.946.36-1.847.174-3.388-.744-4.473z"/>
            </svg>
            <div className="text-left">
              <p className={`text-sm font-semibold ${paymentMethod === 'paypal' ? 'text-slate-900' : 'text-slate-700'}`}>
                PayPal
              </p>
              <p className="text-xs text-slate-400">Paga con il tuo account PayPal</p>
            </div>
            {paymentMethod === 'paypal' && (
              <div className="w-5 h-5 rounded-md bg-slate-900 flex items-center justify-center ml-auto">
                <Check className="w-3 h-3 text-white" strokeWidth={1.75} />
              </div>
            )}
          </button>
        </div>
      </Card>

      {/* Plans grid */}
      <div>
        <h2 className="text-base font-semibold text-slate-900 mb-4">Scegli il tuo piano</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => {
            const isCurrent = plan.id === planType
            const Icon = plan.icon
            const isSelected = selectedPlan === plan.id

            return (
              <Card
                key={plan.id}
                className={`relative rounded-lg p-5 transition-colors cursor-pointer ${
                  plan.highlight
                    ? 'border border-slate-900 bg-white'
                    : 'border border-slate-200 bg-white'
                } ${isCurrent ? 'ring-1 ring-slate-900 ring-offset-2' : ''}
                ${isSelected && !isCurrent ? 'ring-1 ring-emerald-500 ring-offset-2' : ''}`}
                onClick={() => !isCurrent && plan.id !== 'free' && setSelectedPlan(plan.id)}
              >
                {plan.badge && (
                  <span className={`absolute -top-3 left-4 text-xs font-semibold px-3 py-1 rounded-md border ${
                    plan.highlight
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}>
                    {plan.badge}
                  </span>
                )}

                <div className="flex items-center gap-2 mb-3 mt-1">
                  <div className="w-8 h-8 rounded-md flex items-center justify-center bg-slate-50 border border-slate-200">
                    <Icon className="w-4 h-4 text-slate-500" strokeWidth={1.75} />
                  </div>
                  <h3 className="font-semibold text-slate-900">{plan.name}</h3>
                </div>

                <div className="mb-4">
                  <span className="text-2xl font-semibold text-slate-900">{plan.price}</span>
                  <span className="text-sm text-slate-500 ml-1">{plan.period}</span>
                </div>

                <ul className="space-y-2 mb-5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-slate-600">
                      <Check className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" strokeWidth={1.75} />
                      {f}
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <Button disabled className="w-full rounded-md bg-slate-100 text-slate-500 cursor-default">
                    Piano attuale
                  </Button>
                ) : plan.id === 'free' ? (
                  <Button disabled className="w-full rounded-md bg-slate-50 text-slate-400 cursor-default">
                    Gratuito
                  </Button>
                ) : (
                  <Button
                    className={`w-full rounded-md ${
                      plan.highlight
                        ? 'bg-slate-900 hover:bg-slate-800 text-white'
                        : 'bg-slate-900 hover:bg-slate-800 text-white'
                    }`}
                    disabled={loading}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleUpgrade(plan.id)
                    }}
                  >
                    {loading && selectedPlan === plan.id ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" strokeWidth={1.75} />
                    ) : null}
                    {paymentMethod === 'stripe' ? 'Paga con Carta' : 'Paga con PayPal'}
                  </Button>
                )}
              </Card>
            )
          })}
        </div>
      </div>

      {/* Security badge */}
      <div className="flex items-center justify-center gap-2 text-xs text-slate-400 py-2">
        <Shield className="w-4 h-4" strokeWidth={1.75} />
        <span>Pagamenti sicuri e criptati. Garanzia 14 giorni soddisfatti o rimborsati.</span>
      </div>

      {/* FAQ */}
      <Card className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="font-semibold text-slate-900 mb-4">Domande frequenti</h2>
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-semibold text-slate-800">Come funzionano i crediti?</p>
            <p className="text-slate-500 mt-0.5">Ogni lead trovato consuma 1 credito. Prima di cercare puoi scegliere quanti lead vuoi (10, 25, 50, 100). I crediti si rinnovano mensilmente e non si accumulano.</p>
          </div>
          <div>
            <p className="font-semibold text-slate-800">Posso cancellare in qualsiasi momento?</p>
            <p className="text-slate-500 mt-0.5">Sì, senza vincoli. La cancellazione ha effetto alla fine del periodo corrente. Garanzia 14 giorni soddisfatti o rimborsati.</p>
          </div>
          <div>
            <p className="font-semibold text-slate-800">Cosa succede se finisco i crediti?</p>
            <p className="text-slate-500 mt-0.5">Le ricerche verranno bloccate fino al rinnovo o all&apos;upgrade del piano. I lead già trovati restano accessibili.</p>
          </div>
          <div>
            <p className="font-semibold text-slate-800">Quali metodi di pagamento accettate?</p>
            <p className="text-slate-500 mt-0.5">Accettiamo tutte le principali carte di credito/debito (Visa, Mastercard, American Express) tramite Stripe e PayPal.</p>
          </div>
          <div>
            <p className="font-semibold text-slate-800">Come gestisco il mio abbonamento?</p>
            <p className="text-slate-500 mt-0.5">Puoi gestire, cambiare piano o cancellare il tuo abbonamento in qualsiasi momento da questa pagina cliccando su &quot;Gestisci&quot;.</p>
          </div>
        </div>
      </Card>
    </div>
  )
}
