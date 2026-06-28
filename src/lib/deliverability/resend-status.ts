export type ResendDomainStatus = {
  configured: boolean
  domains: Array<{ name: string; status: string; region?: string }>
  message: string
}

/** Elenco domini verificati su Resend (se API key server presente). */
export async function fetchResendDomains(): Promise<ResendDomainStatus> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return {
      configured: false,
      domains: [],
      message: 'RESEND_API_KEY non configurata sul server.',
    }
  }

  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    })
    const data = (await res.json().catch(() => null)) as { data?: Array<{ name: string; status: string; region?: string }> } | null
    if (!res.ok) {
      return {
        configured: true,
        domains: [],
        message: 'Impossibile leggere domini Resend — verifica la API key.',
      }
    }
    const domains = Array.isArray(data?.data) ? data!.data! : []
    return {
      configured: true,
      domains: domains.map((d) => ({ name: d.name, status: d.status, region: d.region })),
      message: domains.length > 0 ? `${domains.length} dominio/i su Resend.` : 'Nessun dominio verificato su Resend.',
    }
  } catch {
    return { configured: true, domains: [], message: 'Errore rete verso Resend.' }
  }
}

export const SPF_DKIM_GUIDE = {
  title: 'Guida SPF / DKIM / DMARC (MIRAX + Resend)',
  steps: [
    {
      title: '1. Aggiungi il dominio in Resend',
      body: 'Dashboard Resend → Domains → Add domain. Usa un sottodominio dedicato (es. mail.tuodominio.it) — non comprare domini automaticamente.',
    },
    {
      title: '2. Pubblica i record DNS',
      body: 'Resend fornisce TXT per SPF e CNAME/TXT per DKIM. Copiali nel pannello DNS del tuo registrar (Aruba, Cloudflare, ecc.).',
    },
    {
      title: '3. Attiva DMARC',
      body: 'Aggiungi TXT su _dmarc.tuodominio.it: v=DMARC1; p=none; rua=mailto:dmarc@tuodominio.it — poi passa a quarantine quando sei sicuro.',
    },
    {
      title: '4. Warmup manuale',
      body: 'Inizia con 20–40 email/giorno verso lead qualificati. MIRAX non invia in automatico — tu approvi ogni messaggio (HITL).',
    },
    {
      title: '5. Mailgun (alternativa)',
      body: 'Se usi Mailgun, la logica DNS è analoga: SPF include mailgun.org, DKIM dal pannello Mailgun. MIRAX sequenze usa Resend di default.',
    },
  ],
} as const
