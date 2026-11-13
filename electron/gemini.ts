import https from 'node:https'

export type GeminiGeneratePayload = {
  apiKey: string
  model: string
  body: Record<string, unknown>
}

function postJson(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ status: number; text: string }> {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  const parsed = new URL(url)

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          'x-goog-api-key': apiKey,
          Accept: 'application/json',
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            text: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )

    req.on('timeout', () => {
      req.destroy(new Error(`Gemini timed out after ${Math.round(timeoutMs / 1000)}s`))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

export async function geminiGenerateContent(
  payload: GeminiGeneratePayload,
  timeoutMs = 60000,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
  const { apiKey, model, body } = payload
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`

  try {
    const { status, text } = await postJson(endpoint, apiKey, body, timeoutMs)
    if (status < 200 || status >= 300) {
      return { ok: false, status, error: text || `HTTP ${status}` }
    }
    try {
      return { ok: true, data: JSON.parse(text) }
    } catch {
      return { ok: false, status, error: `Invalid JSON: ${text.slice(0, 400)}` }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const timedOut = /timed out/i.test(message)
    return { ok: false, status: timedOut ? 408 : 0, error: message }
  }
}
