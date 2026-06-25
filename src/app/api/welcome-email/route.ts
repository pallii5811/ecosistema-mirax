import { NextRequest, NextResponse } from 'next/server'
import { resend } from '@/lib/resend'

export async function POST(req: NextRequest) {
  try {
    const { email, name } = await req.json()

    if (!email) {
      return NextResponse.json({ error: 'Email mancante' }, { status: 400 })
    }

    const from = process.env.RESEND_FROM
    if (!from) {
      return NextResponse.json({ error: 'RESEND_FROM non configurato' }, { status: 500 })
    }

    const displayName = name || email.split('@')[0]

    const html = `
<!DOCTYPE html>
<html lang="it">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
    
    <div style="background:linear-gradient(135deg,#6366F1,#8B5CF6);padding:40px 32px;text-align:center;">
      <h1 style="color:white;font-size:28px;font-weight:800;margin:0 0 8px;letter-spacing:-0.02em;">
        Benvenuto su mirax
      </h1>
      <p style="color:rgba(255,255,255,0.8);font-size:15px;margin:0;">
        Il tuo account è stato creato con successo
      </p>
    </div>

    <div style="padding:32px;">
      <p style="font-size:16px;color:#1e293b;line-height:1.6;margin:0 0 20px;">
        Ciao <strong>${displayName}</strong>,
      </p>
      <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 24px;">
        Grazie per esserti registrato su MIRAX. Hai ricevuto <strong>10 crediti gratuiti</strong> 
        per iniziare a trovare i tuoi primi lead qualificati.
      </p>

      <div style="background:#f1f5f9;border-radius:12px;padding:20px;margin:0 0 24px;">
        <p style="font-size:13px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px;">
          Come iniziare in 3 step
        </p>
        <div style="font-size:14px;color:#334155;line-height:1.8;">
          <div>1️⃣ Cerca una categoria + città (es. "ristoranti a Milano")</div>
          <div>2️⃣ Analizza i lead con score, audit tecnico e problemi digitali</div>
          <div>3️⃣ Genera un pitch AI personalizzato e contatta il cliente</div>
        </div>
      </div>

      <div style="text-align:center;margin:32px 0;">
        <a href="https://miraxgroup.it/dashboard" 
           style="display:inline-block;background:linear-gradient(135deg,#6366F1,#8B5CF6);color:white;font-size:15px;font-weight:700;padding:14px 32px;border-radius:12px;text-decoration:none;">
          Vai alla Dashboard →
        </a>
      </div>

      <p style="font-size:13px;color:#94a3b8;line-height:1.6;margin:0;border-top:1px solid #f1f5f9;padding-top:20px;">
        Hai domande? Rispondi direttamente a questa email o scrivi a 
        <a href="mailto:supporto@miraxgroup.it" style="color:#6366f1;">supporto@miraxgroup.it</a>.
      </p>
    </div>

    <div style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #f1f5f9;">
      <p style="font-size:12px;color:#94a3b8;margin:0;">
        © ${new Date().getFullYear()} MIRAX — Tutti i diritti riservati
      </p>
    </div>
  </div>
</body>
</html>`

    await resend.emails.send({
      from,
      to: email,
      subject: 'Benvenuto su MIRAX — I tuoi primi 10 crediti ti aspettano',
      html,
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Welcome email error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
