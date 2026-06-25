type SendToWebhookArgs = {
  webhookUrl: string
  payload: unknown
  timeoutMs?: number
}

export async function sendToWebhook({ webhookUrl, payload, timeoutMs = 6000 }: SendToWebhookArgs) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MIRAX/1.0',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: 'no-store',
    })

    const text = await res.text().catch(() => '')

    return {
      ok: res.ok,
      status: res.status,
      responseText: text,
    }
  } finally {
    clearTimeout(id)
  }
}
