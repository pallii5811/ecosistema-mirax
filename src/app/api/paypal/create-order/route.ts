import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const PAYPAL_API = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com'

const PLAN_PRICES: Record<string, { amount: string; name: string }> = {
  starter: { amount: '49.00', name: 'Mirax Starter' },
  pro: { amount: '99.00', name: 'Mirax PRO' },
  agency: { amount: '249.00', name: 'Mirax Agency' },
}

async function getPayPalAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID || ''
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET || ''

  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  })

  const data = await res.json()
  if (!data.access_token) throw new Error('PayPal auth failed')
  return data.access_token
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
    }

    const { planId } = await req.json()

    if (!planId || !PLAN_PRICES[planId]) {
      return NextResponse.json({ error: 'Piano non valido' }, { status: 400 })
    }

    const plan = PLAN_PRICES[planId]
    const accessToken = await getPayPalAccessToken()

    const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            description: `${plan.name} — Abbonamento mensile`,
            amount: {
              currency_code: 'EUR',
              value: plan.amount,
            },
            custom_id: JSON.stringify({ user_id: user.id, plan_id: planId }),
          },
        ],
        application_context: {
          brand_name: 'Mirax Group',
          return_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://www.miraxgroup.it'}/dashboard/billing?paypal=success`,
          cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://www.miraxgroup.it'}/dashboard/billing?paypal=canceled`,
        },
      }),
    })

    const order = await orderRes.json()

    if (!order.id) {
      console.error('PayPal create order error:', order)
      return NextResponse.json({ error: 'Errore PayPal' }, { status: 500 })
    }

    const approvalUrl = order.links?.find((l: any) => l.rel === 'approve')?.href

    return NextResponse.json({ orderId: order.id, approvalUrl })
  } catch (error: any) {
    console.error('PayPal create-order error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
