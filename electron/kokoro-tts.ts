import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { stopLocalSpeak, trackSpeakingProc } from './local-tts'

type KokoroAudio = {
  audio: Float32Array | number[]
  sampling_rate: number
}

type KokoroInstance = {
  generate: (
    text: string,
    opts: { voice: string; speed?: number },
  ) => Promise<KokoroAudio>
}

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

export const KOKORO_FEMALE_VOICES = [
  { id: 'af_heart', label: 'Heart — natural US female (best)' },
  { id: 'af_bella', label: 'Bella — warm US female' },
  { id: 'af_nicole', label: 'Nicole — clear US female' },
  { id: 'af_sarah', label: 'Sarah — soft US female' },
  { id: 'af_aoede', label: 'Aoede — breezy US female' },
  { id: 'bf_emma', label: 'Emma — British female' },
  { id: 'bf_isabella', label: 'Isabella — British female' },
] as const

export const KOKORO_MALE_VOICES = [
  { id: 'bm_daniel', label: 'Jarvis / Daniel — British male' },
  { id: 'bm_george', label: 'George — British male' },
  { id: 'bm_lewis', label: 'Lewis — British male' },
  { id: 'am_michael', label: 'Michael — US male' },
  { id: 'am_fenrir', label: 'Fenrir — deep US male' },
  { id: 'am_puck', label: 'Puck — bright US male' },
] as const

export const KOKORO_VOICES = [...KOKORO_MALE_VOICES, ...KOKORO_FEMALE_VOICES] as const

let ttsPromise: Promise<KokoroInstance> | null = null
let ready = false

function floatToWavBuffer(samples: Float32Array, sampleRate: number): Buffer {
  const numChannels = 1
  const bitsPerSample = 16
  const blockAlign = (numChannels * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * blockAlign
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  let offset = 44
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0))
    buffer.writeInt16LE((s * 32767) | 0, offset)
    offset += 2
  }
  return buffer
}

async function getTts(): Promise<KokoroInstance> {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      console.log('[kokoro] loading local neural voice model…')
      const started = Date.now()
      const { KokoroTTS } = await import('kokoro-js')
      const tts = (await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        device: 'cpu',
      })) as KokoroInstance
      ready = true
      console.log(`[kokoro] ready in ${Date.now() - started}ms`)
      return tts
    })().catch((err) => {
      ttsPromise = null
      ready = false
      throw err
    })
  }
  return ttsPromise
}

export function isKokoroReady() {
  return ready
}

export function warmupKokoro() {
  void getTts().catch((err) => {
    console.error('[kokoro] warmup failed:', err instanceof Error ? err.message : err)
  })
}

export async function speakWithKokoro(options: {
  text: string
  voiceId?: string
  speed?: number
  pitch?: number
}): Promise<{ ok: boolean; message?: string }> {
  const text = options.text.trim()
  if (!text) return { ok: true }

  try {
    const tts = await getTts()
    const voice = options.voiceId && KOKORO_VOICES.some((v) => v.id === options.voiceId)
      ? options.voiceId
      : 'bm_daniel'

    const generatePromise = tts.generate(text, {
      voice,
      speed: options.speed ?? 1,
    })
    const timeoutMs = Math.min(45000, 8000 + text.length * 40)
    const result = await Promise.race([
      generatePromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`kokoro generate timeout ${timeoutMs}ms`)), timeoutMs),
      ),
    ])

    const raw = result.audio
    const samples =
      raw instanceof Float32Array ? raw : Float32Array.from(raw as number[])
    const wav = floatToWavBuffer(samples, result.sampling_rate || 24000)

    const tmp = path.join(os.tmpdir(), `aria-kokoro-${Date.now()}.wav`)
    fs.writeFileSync(tmp, wav)

    const playRate = Math.max(0.85, Math.min(1.25, options.pitch ?? 1.06))
    await stopLocalSpeak()
    await playWavFile(tmp, playRate)
    fs.promises.unlink(tmp).catch(() => undefined)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[kokoro] speak failed:', message)
    return { ok: false, message }
  }
}

function playWavFile(filePath: string, rate = 1): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform
    const clamped = Math.max(0.85, Math.min(1.35, rate))
    const child =
      platform === 'darwin'
        ? spawn('afplay', ['-r', String(clamped), filePath], { stdio: 'ignore' })
        : platform === 'win32'
          ? spawn(
              'powershell.exe',
              [
                '-NoProfile',
                '-Command',
                `Add-Type -AssemblyName PresentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([Uri]'${filePath.replace(/'/g, "''")}'); $p.SpeedRatio = ${clamped}; $p.Play(); while($p.Position -lt $p.NaturalDuration.TimeSpan){ Start-Sleep -Milliseconds 100 }`,
              ],
              { stdio: 'ignore', windowsHide: true },
            )
          : spawn('aplay', [filePath], { stdio: 'ignore' })

    trackSpeakingProc(child as ChildProcessWithoutNullStreams)
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`audio play killed (${signal})`))
      else if (code && code !== 0) reject(new Error(`audio play exited ${code}`))
      else resolve()
    })
  })
}

export function textMostlyBangla(text: string): boolean {
  const bn = (text.match(/[\u0980-\u09FF]/g) || []).join('').length
  const latin = (text.match(/[A-Za-z]/g) || []).join('').length
  return bn > 8 && bn >= latin
}
