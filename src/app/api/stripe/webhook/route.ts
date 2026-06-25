import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServiceRoleClient } from '@/utils/supabase/server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2026-02-25.clover',
})

const PLAN_CREDITS: Record<string, number> = {
  starter: 1200,
  pro: 3000,
  agency: 10000,
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    )
  } catch (err: any) {
    console.error('Stripe webhook signature verification failed:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const db = createServiceRoleClient()

  try {
    switch (event.type) {
      // New subscription created or payment succeeded
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = session.metadata?.supabase_user_id
        const planId = session.metadata?.plan_id

        if (userId && planId) {
          const credits = PLAN_CREDITS[planId] || 0
          await db.from('profiles').update({
            plan_type: planId,
            credits,
            stripe_subscription_id: session.subscription as string,
            stripe_customer_id: session.customer as string,
          }).eq('id', userId)

          console.log(`[STRIPE] User ${userId} upgraded to ${planId} (${credits} credits)`)
        }
        break
      }

      // Recurring payment succeeded (monthly renewal)
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice & { subscription?: string | { id: string } }
        const sub = invoice.subscription
        const subscriptionId = typeof sub === 'string' ? sub : sub?.id

        if (subscriptionId && invoice.billing_reason === 'subscription_cycle') {
          // Find user by subscription ID
          const { data: profile } = await db
            .from('profiles')
            .select('id, plan_type')
            .eq('stripe_subscription_id', subscriptionId)
            .single()

          if (profile) {
            const credits = PLAN_CREDITS[profile.plan_type] || 0
            await db.from('profiles').update({ credits }).eq('id', profile.id)
            console.log(`[STRIPE] Renewed ${profile.plan_type} for user ${profile.id} (${credits} credits)`)
          }
        }
        break
      }

      // Subscription cancelled
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata?.supabase_user_id

        if (userId) {
          await db.from('profiles').update({
            plan_type: 'free',
            credits: 10,
            stripe_subscription_id: null,
          }).eq('id', userId)

          console.log(`[STRIPE] User ${userId} subscription cancelled, downgraded to free`)
        }
        break
      }

      // Payment failed
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        console.warn(`[STRIPE] Payment failed for invoice ${invoice.id}`)
        break
      }
    }
  } catch (error) {
    console.error('[STRIPE] Webhook handler error:', error)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
