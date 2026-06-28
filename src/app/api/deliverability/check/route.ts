import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { checkDomainDeliverability } from '@/lib/deliverability/dns-check'
import { fetchResendDomains } from '@/lib/deliverability/resend-status'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as { domain?: string } | null
  const domain = typeof body?.domain === 'string' ? body.domain.trim() : ''
  if (!domain) {
    return NextResponse.json({ error: 'Dominio richiesto' }, { status: 400 })
  }

  try {
    const report = await checkDomainDeliverability(domain)
    const resend = await fetchResendDomains()
    const resendMatch = resend.domains.find((d) => d.name === report.domain || report.domain.endsWith(d.name))

    return NextResponse.json({
      report,
      resend: {
        ...resend,
        domainVerified: resendMatch?.status === 'verified',
        matchedDomain: resendMatch?.name ?? null,
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Check fallito' },
      { status: 400 },
    )
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const resend = await fetchResendDomains()
  return NextResponse.json({ resend })
}
