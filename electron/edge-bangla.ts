import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stopLocalSpeak, trackSpeakingProc } from './local-tts'

const execFileAsync = promisify(execFile)

/** Free Microsoft Edge neural Bangla voices (same family as Azure). Needs network. */
export const EDGE_BANGLA_VOICES = [
  { id: 'bn-BD-PradeepNeural', label: 'Pradeep — বাংলা Male (BD, clear)', gender: 'male' as const },
  { id: 'bn-BD-NabanitaNeural', label: 'Nabanita — বাংলা Female (BD, clear)', gender: 'female' as const },
  { id: 'bn-IN-BashkarNeural', label: 'Bashkar — বাংলা Male (IN)', gender: 'male' as const },
  { id: 'bn-IN-TanishaaNeural', label: 'Tanishaa — বাংলা Female (IN)', gender: 'female' as const },
] as const

export type EdgeBanglaVoiceId = (typeof EDGE_BANGLA_VOICES)[number]['id']

function resolveEdgeVoice(voiceId?: string, preferMale = true): string {
  if (voiceId && EDGE_BANGLA_VOICES.some((v) => v.id === voiceId)) return voiceId
  if (voiceId === 'piya' || voiceId === 'Piya') return 'bn-BD-NabanitaNeural'
  if (voiceId?.startsWith('bn_m_')) return 'bn-BD-PradeepNeural'
  if (voiceId?.startsWith('bn_f_')) return 'bn-BD-NabanitaNeural'
  return preferMale ? 'bn-BD-PradeepNeural' : 'bn-BD-NabanitaNeural'
}

function pythonBin(): string {
  return process.env.EDGE_TTS_PYTHON || 'python3'
}

/** Rate string for edge-tts, e.g. "-8%" slower = clearer. */
function edgeRate(rate?: number): string {
  const r = rate ?? 1
  // Map 0.85–1.15 → about -15% … +10%
  const pct = Math.round((r - 1) * 100)
  const clamped = Math.max(-20, Math.min(15, pct - 6)) // bias slightly slower for clarity
  return `${clamped >= 0 ? '+' : ''}${clamped}%`
}

function playMedia(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child =
      process.platform === 'darwin'
        ? spawn('afplay', [filePath], { stdio: 'ignore' })
        : spawn('ffplay', ['-nodisp', '-autoexit', filePath], { stdio: 'ignore' })
    trackSpeakingProc(child as ChildProcessWithoutNullStreams)
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`edge play killed (${signal})`))
      else if (code) reject(new Error(`edge play exited ${code}`))
      else resolve()
    })
  })
}

export async function speakBanglaEdge(options: {
  text: string
  voiceId?: string
  rate?: number
  preferMale?: boolean
  /** False when a newer utterance replaced this one — do not stop or play. */
  isCurrent?: () => boolean
}): Promise<{ ok: boolean; message?: string; interrupted?: boolean }> {
  const text = options.text.trim()
  if (!text) return { ok: true }

  const voice = resolveEdgeVoice(options.voiceId, options.preferMale !== false)
  const tmp = path.join(os.tmpdir(), `jarvis-edge-bn-${Date.now()}.mp3`)

  try {
    // Prefer `python3 -m edge_tts` so PATH to user site-packages works
    // Use --rate=-8% (one argv) — a bare "-8%" is parsed as a new flag
    await execFileAsync(
      pythonBin(),
      [
        '-m',
        'edge_tts',
        '--voice',
        voice,
        `--rate=${edgeRate(options.rate)}`,
        '--text',
        text,
        '--write-media',
        tmp,
      ],
      {
        timeout: 45000,
        env: {
          ...process.env,
          PATH: `${process.env.HOME}/Library/Python/3.9/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`,
          PYTHONPATH: [
            `${process.env.HOME}/Library/Python/3.9/lib/python/site-packages`,
            process.env.PYTHONPATH || '',
          ]
            .filter(Boolean)
            .join(path.delimiter),
        },
      },
    )

    if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 200) {
      return { ok: false, message: 'edge-tts produced empty audio' }
    }

    if (options.isCurrent && !options.isCurrent()) {
      return { ok: false, interrupted: true, message: 'interrupted' }
    }

    await stopLocalSpeak()
    if (options.isCurrent && !options.isCurrent()) {
      return { ok: false, interrupted: true, message: 'interrupted' }
    }
    await playMedia(tmp)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const interrupted = /killed|SIGTERM|SIGINT/i.test(message)
    if (!interrupted) console.error('[edge-bn] speak failed:', message)
    else console.log('[edge-bn] playback interrupted (newer speech took over)')
    return { ok: false, interrupted, message }
  } finally {
    fs.promises.unlink(tmp).catch(() => undefined)
  }
}
