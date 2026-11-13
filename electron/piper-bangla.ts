import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { app } from 'electron'
import { stopLocalSpeak, trackSpeakingProc } from './local-tts'

type PiperResult = {
  audio: Buffer | Int16Array | Float32Array | Uint8Array
  sampleRate: number
}

type PiperTts = {
  synthesize: (text: string, opts?: { speakerId?: number }) => Promise<PiperResult>
}

/** Hand-picked speakers from bn_BD google multi-speaker model */
export const BANGLA_FEMALE_VOICES = [
  { id: 'bn_f_10', label: 'বাংলা Female A (bright)', speakerId: 10 },
  { id: 'bn_f_13', label: 'বাংলা Female B (soft)', speakerId: 13 },
  { id: 'bn_f_15', label: 'বাংলা Female C', speakerId: 15 },
  { id: 'bn_f_3', label: 'বাংলা Female D', speakerId: 3 },
] as const

export const BANGLA_MALE_VOICES = [
  { id: 'bn_m_0', label: 'বাংলা Male A (Jarvis BN)', speakerId: 0 },
  { id: 'bn_m_3', label: 'বাংলা Male B', speakerId: 3 },
  { id: 'bn_m_1', label: 'বাংলা Male C', speakerId: 1 },
] as const

export const BANGLA_VOICES = [...BANGLA_MALE_VOICES, ...BANGLA_FEMALE_VOICES] as const

let piperPromise: Promise<PiperTts> | null = null

function modelsDir() {
  // Prefer project ./models in dev; userData in production
  const dev = path.join(process.cwd(), 'models')
  if (fs.existsSync(path.join(dev, 'google-bengali-bd-medium.onnx'))) return dev
  const dir = path.join(app.getPath('userData'), 'models')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function ensureEspeakPath() {
  const extras = ['/opt/homebrew/bin', '/usr/local/bin']
  const parts = (process.env.PATH || '').split(path.delimiter)
  for (const p of extras) {
    if (!parts.includes(p)) parts.unshift(p)
  }
  process.env.PATH = parts.join(path.delimiter)
}

async function getPiper(): Promise<PiperTts> {
  if (!piperPromise) {
    piperPromise = (async () => {
      ensureEspeakPath()
      console.log('[piper-bn] loading Bangla neural voice…')
      const started = Date.now()
      const { PiperNativeTTS } = await import('pipertts')
      const tts = (await PiperNativeTTS.load({
        model: 'hub:google-bengali-bd-medium',
        modelsDir: modelsDir(),
      })) as PiperTts
      console.log(`[piper-bn] ready in ${Date.now() - started}ms`)
      return tts
    })().catch((err) => {
      piperPromise = null
      throw err
    })
  }
  return piperPromise
}

export function warmupPiperBangla() {
  void getPiper().catch((err) => {
    console.error('[piper-bn] warmup failed:', err instanceof Error ? err.message : err)
  })
}

function toInt16(audio: PiperResult['audio']): Int16Array {
  if (audio instanceof Int16Array) return audio
  if (Buffer.isBuffer(audio) || audio instanceof Uint8Array) {
    return new Int16Array(audio.buffer, audio.byteOffset, Math.floor(audio.byteLength / 2))
  }
  if (audio instanceof Float32Array) {
    const out = new Int16Array(audio.length)
    for (let i = 0; i < audio.length; i += 1) {
      const s = Math.max(-1, Math.min(1, audio[i] ?? 0))
      out[i] = (s * 32767) | 0
    }
    return out
  }
  throw new Error(`Unsupported piper audio type: ${(audio as { constructor?: { name?: string } })?.constructor?.name}`)
}

function writeWav(int16: Int16Array, sampleRate: number): Buffer {
  const dataSize = int16.byteLength
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  Buffer.from(int16.buffer, int16.byteOffset, dataSize).copy(buf, 44)
  return buf
}

export function resolveBanglaSpeakerId(voiceId?: string): number {
  const found = BANGLA_VOICES.find((v) => v.id === voiceId)
  if (found) return found.speakerId
  if (voiceId?.startsWith('bn_m_')) return 0
  // Default Piper female = bn_f_10 (clearest free neural BN female we ship)
  return 10
}

function playWavFile(filePath: string, rate = 1): Promise<void> {
  return new Promise((resolve, reject) => {
    const clamped = Math.max(0.85, Math.min(1.35, rate))
    const child =
      process.platform === 'darwin'
        ? spawn('afplay', ['-r', String(clamped), filePath], { stdio: 'ignore' })
        : process.platform === 'win32'
          ? spawn(
              'powershell.exe',
              [
                '-NoProfile',
                '-Command',
                `Add-Type -AssemblyName PresentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([Uri]'${filePath.replace(/'/g, "''")}'); $p.SpeedRatio = ${clamped}; $p.Play(); Start-Sleep -Milliseconds 300; while($p.Position -lt $p.NaturalDuration.TimeSpan){ Start-Sleep -Milliseconds 100 }`,
              ],
              { stdio: 'ignore', windowsHide: true },
            )
          : spawn('aplay', [filePath], { stdio: 'ignore' })
    trackSpeakingProc(child as ChildProcessWithoutNullStreams)
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`audio play killed (${signal})`))
      else if (code) reject(new Error(`audio play exited ${code}`))
      else resolve()
    })
  })
}

export async function speakBanglaPiper(options: {
  text: string
  voiceId?: string
  rate?: number
  pitch?: number
}): Promise<{ ok: boolean; message?: string }> {
  const text = options.text.trim()
  if (!text) return { ok: true }

  try {
    const tts = await getPiper()
    const speakerId = resolveBanglaSpeakerId(options.voiceId)
    // Map UI rate → Piper lengthScale (>1 slower/clearer). Do NOT abuse afplay -r as pitch —
    // that chirps consonants and makes Bangla sound garbled.
    const rate = options.rate ?? 1
    const lengthScale = Math.max(0.85, Math.min(1.35, 1 / rate))
    const result = await tts.synthesize(text, {
      speakerId,
      // Clearer Bangla: slightly slower, less stochastic noise than model defaults
      lengthScale,
      noiseScale: 0.45,
      noiseWScale: 0.6,
      sentenceSilence: 0.25,
      normalizeAudio: true,
      outputFormat: 'wav',
    } as {
      speakerId?: number
      lengthScale?: number
      noiseScale?: number
      noiseWScale?: number
      sentenceSilence?: number
      normalizeAudio?: boolean
      outputFormat?: string
    })

    const tmp = path.join(os.tmpdir(), `aria-bn-${Date.now()}.wav`)
    // pipertts default audio is already a WAV Buffer — do NOT re-wrap as PCM (that garbling bug)
    const raw = result.audio
    if (Buffer.isBuffer(raw) && raw.length >= 12 && raw.toString('ascii', 0, 4) === 'RIFF') {
      fs.writeFileSync(tmp, raw)
    } else if (raw instanceof Uint8Array && raw.byteLength >= 12) {
      const view = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
      if (view.toString('ascii', 0, 4) === 'RIFF') fs.writeFileSync(tmp, view)
      else fs.writeFileSync(tmp, writeWav(toInt16(raw), result.sampleRate || 22050))
    } else {
      fs.writeFileSync(tmp, writeWav(toInt16(raw), result.sampleRate || 22050))
    }

    await stopLocalSpeak()
    // Play at native speed (1.0) — prosody already applied via lengthScale
    await playWavFile(tmp, 1)
    fs.promises.unlink(tmp).catch(() => undefined)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[piper-bn] speak failed:', message)
    return { ok: false, message }
  }
}
