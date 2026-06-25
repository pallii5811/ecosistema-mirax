import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/utils/supabase/server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2026-02-25.clover',
})

// Map plan IDs to Stripe Price IDs (create these in Stripe Dashboard)
const PLAN_PRICE_MAP: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_STARTER || '',
  pro: process.env.STRIPE_PRICE_PRO || '',
  agency: process.env.STRIPE_PRICE_AGENCY || '',
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })
    }

    const { planId } = await req.json()

    if (!planId || !PLAN_PRICE_MAP[planId]) {
      return NextResponse.json({ error: 'Piano non valido' }, { status: 400 })
    }

    const priceId = PLAN_PRICE_MAP[planId]
    if (!priceId) {
      return NextResponse.json({ error: 'Stripe Price ID non configurato per questo piano' }, { status: 500 })
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.miraxgroup.it'

    // Check if user already has a Stripe customer ID
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single()

    let customerId = profile?.stripe_customer_id

    if (!customerId) {
      // Create a new Stripe customer
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      })
      customerId = customer.id

      // Save customer ID to profile
      await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id)
    }

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/dashboard/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/dashboard/billing?canceled=true`,
      metadata: {
        supabase_user_id: user.id,
        plan_id: planId,
      },
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
          plan_id: planId,
        },
      },
      allow_promotion_codes: true,
    })

    return NextResponse.json({ url: session.url })
  } catch (error: any) {
    console.error('Stripe checkout error:', error)
    return NextResponse.json(
      { error: error.message || 'Errore durante la creazione del checkout' },
      { status: 500 }
    )
  }
}
