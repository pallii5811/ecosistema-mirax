import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceRoleClient } from '@/utils/supabase/server'

const PAYPAL_API = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com'

const PLAN_CREDITS: Record<string, number> = {
  starter: 1200,
  pro: 3000,
  agency: 10000,
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

    const { orderId } = await req.json()

    if (!orderId) {
      return NextResponse.json({ error: 'orderId mancante' }, { status: 400 })
    }

    const accessToken = await getPayPalAccessToken()

    // Capture the order
    const captureRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    const capture = await captureRes.json()

    if (capture.status !== 'COMPLETED') {
      console.error('PayPal capture failed:', capture)
      return NextResponse.json({ error: 'Pagamento non completato' }, { status: 400 })
    }

    // Extract plan info from custom_id
    const customId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id
      || capture.purchase_units?.[0]?.custom_id

    let planId = ''
    let userId = user.id

    try {
      const parsed = JSON.parse(customId || '{}')
      planId = parsed.plan_id || ''
      userId = parsed.user_id || user.id
    } catch {
      console.error('Failed to parse PayPal custom_id:', customId)
      return NextResponse.json({ error: 'Dati ordine non validi' }, { status: 400 })
    }

    if (!planId || !PLAN_CREDITS[planId]) {
      return NextResponse.json({ error: 'Piano non valido' }, { status: 400 })
    }

    // Update user profile with new plan
    const db = createServiceRoleClient()
    const credits = PLAN_CREDITS[planId]

    await db.from('profiles').update({
      plan_type: planId,
      credits,
      paypal_order_id: orderId,
    }).eq('id', userId)

    console.log(`[PAYPAL] User ${userId} upgraded to ${planId} (${credits} credits)`)

    return NextResponse.json({
      success: true,
      plan: planId,
      credits,
    })
  } catch (error: any) {
    console.error('PayPal capture-order error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
