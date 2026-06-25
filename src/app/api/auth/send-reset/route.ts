import { NextResponse } from 'next/server'
import { PasswordResetTemplate } from '@/emails/PasswordResetTemplate'
import { resend } from '@/lib/resend'
import { createServiceRoleClient } from '@/utils/supabase/server'

export async function POST(req: Request) {
  try {
    const { email } = await req.json()
    if (!email) return NextResponse.json({ error: 'Missing email' }, { status: 400 })

    const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL
    if (!SITE_URL) return NextResponse.json({ error: 'Missing SITE_URL' }, { status: 500 })

    // Generate recovery link via service role
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase.auth.admin.generateLink({
      email,
      type: 'recovery',
      options: { redirectTo: `${SITE_URL}/auth/update-password` },
    })
    if (error || !data?.properties?.action_link)
      return NextResponse.json({ error: error?.message || 'Unable to generate link' }, { status: 500 })

    const actionLink = data.properties.action_link

    // Send email via Resend
    await resend.emails.send({
      from: 'MIRAX <no-reply@miraxgroup.it>',
      to: email,
      subject: 'MIRAX — Reimposta la tua password',
      html: PasswordResetTemplate({ url: actionLink }),
      text: `Hai richiesto di reimpostare la tua password. Copia e incolla questo link nel browser:\n${actionLink}\n\nSe non hai effettuato la richiesta, puoi ignorare questa email.`,
      headers: {
        'X-Priority': '1 (Highest)',
        'X-Mirax-Transactional': 'reset-password',
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('send-reset error', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
