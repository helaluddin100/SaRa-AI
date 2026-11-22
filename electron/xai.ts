import https from 'node:https'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { stopLocalSpeak, trackSpeakingProc } from './local-tts'

export type XaiChatPayload = {
  apiKey: string
  model: string
  messages: Array<Record<string, unknown>>
  tools?: Array<Record<string, unknown>>
  temperature?: number
  tool_choice?: 'auto' | 'none' | 'required'
}

export type XaiChatResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; error: string }

function postJson(
  urlPath: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ status: number; text: string; buffer: Buffer; contentType: string }> {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: 'https:',
        hostname: 'api.x.ai',
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          Authorization: `Bearer ${apiKey}`,
          Accept: '*/*',
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        res.on('end', () => {
          const buffer = Buffer.concat(chunks)
          resolve({
            status: res.statusCode || 0,
            text: buffer.toString('utf8'),
            buffer,
            contentType: String(res.headers['content-type'] || ''),
          })
        })
      },
    )
    req.on('timeout', () => {
      req.destroy(new Error(`xAI timed out after ${Math.round(timeoutMs / 1000)}s`))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function getJson(
  urlPath: string,
  apiKey: string,
  timeoutMs: number,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: 'https:',
        hostname: 'api.x.ai',
        path: urlPath,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
      req.destroy(new Error(`xAI timed out after ${Math.round(timeoutMs / 1000)}s`))
    })
    req.on('error', reject)
    req.end()
  })
}

/** OpenAI-compatible chat completions (Grok). */
export async function xaiChatCompletions(
  payload: XaiChatPayload,
  timeoutMs = 90000,
): Promise<XaiChatResult> {
  const { apiKey, model, messages, tools, temperature, tool_choice } = payload
  try {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: temperature ?? 0.55,
    }
    if (tools?.length) {
      body.tools = tools
      body.tool_choice = tool_choice || 'auto'
    }
    const { status, text } = await postJson('/v1/chat/completions', apiKey, body, timeoutMs)
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

export type GrokVoice = { voice_id: string; name: string; language?: string }

export async function listGrokVoices(apiKey: string): Promise<GrokVoice[]> {
  try {
    const { status, text } = await getJson('/v1/tts/voices', apiKey, 20000)
    if (status < 200 || status >= 300) return GROK_BUILTIN_VOICES
    const data = JSON.parse(text) as { voices?: GrokVoice[] } | GrokVoice[]
    const list = Array.isArray(data) ? data : data.voices || []
    return list.length ? list : GROK_BUILTIN_VOICES
  } catch {
    return GROK_BUILTIN_VOICES
  }
}

/** Built-in fallbacks (docs: eve default; ara/rex also referenced). */
export const GROK_BUILTIN_VOICES: GrokVoice[] = [
  { voice_id: 'eve', name: 'Eve — default female' },
  { voice_id: 'ara', name: 'Ara — warm female' },
  { voice_id: 'rex', name: 'Rex — male' },
]

function playMediaFile(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    if (process.platform === 'darwin') {
      child = spawn('afplay', [filePath], { stdio: 'ignore' }) as ChildProcessWithoutNullStreams
    } else if (process.platform === 'win32') {
      const safe = filePath.replace(/'/g, "''")
      child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Add-Type -AssemblyName PresentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([Uri]'${safe}'); $p.Play(); Start-Sleep -Milliseconds 400; $deadline = (Get-Date).AddSeconds(180); while($p.NaturalDuration.HasTimeSpan -eq $false -and (Get-Date) -lt $deadline){ Start-Sleep -Milliseconds 50 }; if($p.NaturalDuration.HasTimeSpan){ while($p.Position -lt $p.NaturalDuration.TimeSpan -and (Get-Date) -lt $deadline){ Start-Sleep -Milliseconds 100 } }`,
        ],
        { stdio: 'ignore', windowsHide: true },
      ) as ChildProcessWithoutNullStreams
    } else {
      child = spawn('ffplay', ['-nodisp', '-autoexit', filePath], {
        stdio: 'ignore',
      }) as ChildProcessWithoutNullStreams
    }
    trackSpeakingProc(child)
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`grok play killed (${signal})`))
      else if (code) reject(new Error(`grok play exited ${code}`))
      else resolve()
    })
  })
}

export async function speakWithGrokTts(options: {
  apiKey: string
  text: string
  voiceId?: string
  /** BCP-47 or auto — bn supported */
  language?: string
  rate?: number
  isCurrent?: () => boolean
}): Promise<{ ok: boolean; message?: string; interrupted?: boolean }> {
  const text = options.text.trim()
  if (!text) return { ok: true }
  if (!options.apiKey.trim()) {
    return { ok: false, message: 'xAI API key missing for Grok voice' }
  }

  const voice_id = options.voiceId || 'ara'
  const language = options.language || 'auto'
  const speed = Math.max(0.7, Math.min(1.5, options.rate ?? 1))
  const tmp = path.join(os.tmpdir(), `jarvis-grok-tts-${Date.now()}.mp3`)

  try {
    const { status, text: bodyText, buffer, contentType } = await postJson(
      '/v1/tts',
      options.apiKey.trim(),
      {
        text,
        voice_id,
        language,
        speed,
        text_normalization: true,
        output_format: { codec: 'mp3', sample_rate: 24000, bit_rate: 128000 },
      },
      60000,
    )

    if (status < 200 || status >= 300) {
      return { ok: false, message: bodyText.slice(0, 400) || `Grok TTS HTTP ${status}` }
    }

    let audio = buffer
    if (/application\/json/i.test(contentType) || bodyText.trimStart().startsWith('{')) {
      try {
        const parsed = JSON.parse(bodyText) as {
          audio?: string
          content_type?: string
          error?: unknown
        }
        if (!parsed.audio) {
          return { ok: false, message: bodyText.slice(0, 400) || 'Grok TTS empty audio' }
        }
        audio = Buffer.from(parsed.audio, 'base64')
      } catch {
        // treat as raw audio
      }
    }

    if (!audio.length || audio.length < 200) {
      return { ok: false, message: 'Grok TTS produced empty audio' }
    }

    fs.writeFileSync(tmp, audio)

    if (options.isCurrent && !options.isCurrent()) {
      return { ok: false, interrupted: true, message: 'interrupted' }
    }

    await stopLocalSpeak()
    if (options.isCurrent && !options.isCurrent()) {
      return { ok: false, interrupted: true, message: 'interrupted' }
    }
    await playMediaFile(tmp)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const interrupted = /killed|SIGTERM|SIGINT/i.test(message)
    if (!interrupted) console.error('[grok-tts] failed:', message)
    return { ok: false, interrupted, message }
  } finally {
    fs.promises.unlink(tmp).catch(() => undefined)
  }
}
