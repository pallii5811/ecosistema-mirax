interface PasswordResetTemplateProps {
  url: string
}

export function PasswordResetTemplate({ url }: PasswordResetTemplateProps) {
  return `<!DOCTYPE html>
  <html lang="it">
    <body style="font-family: Inter, sans-serif; background:#f9f9f9; padding:24px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;padding:40px;">
        <tr>
          <td style="text-align:center;">
            <img src="https://www.miraxgroup.it/email-logo.png" width="120" alt="MIRAX" style="margin-bottom:32px;" />
          </td>
        </tr>
        <tr>
          <td style="font-size:18px;font-weight:600;color:#111;margin-bottom:16px;">Reimposta la tua password</td>
        </tr>
        <tr>
          <td style="font-size:14px;color:#444;line-height:1.6;margin-bottom:24px;">
            Hai richiesto di reimpostare la tua password. Clicca il bottone qui sotto; il link resterà valido 60 minuti.
          </td>
        </tr>
        <tr>
          <td style="text-align:center;margin:32px 0;">
            <a href="${url}" style="background:#7c3aed;color:#ffffff;padding:14px 24px;border-radius:6px;font-size:14px;text-decoration:none;display:inline-block;">Reimposta password</a>
          </td>
        </tr>
        <tr>
          <td style="font-size:12px;color:#666;line-height:1.6;">Se non hai richiesto il reset, puoi ignorare questa email.</td>
        </tr>
        <tr>
          <td style="font-size:12px;color:#999;line-height:1.6;margin-top:32px;">
            MIRAX Group • Via Roma 12, 10100 Torino • <a href="https://www.miraxgroup.it">miraxgroup.it</a>
          </td>
        </tr>
      </table>
    </body>
  </html>`
}
