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

/** Prefer env override, then python3, then python (Windows often only has `python`). */
function pythonBin(): string {
  if (process.env.EDGE_TTS_PYTHON) return process.env.EDGE_TTS_PYTHON
  return process.platform === 'win32' ? 'python' : 'python3'
}

/** Rate string for edge-tts, e.g. "-8%" slower = clearer. */
function edgeRate(rate?: number): string {
  const r = rate ?? 1
  // Map 0.85–1.15 → about -15% … +10%
  const pct = Math.round((r - 1) * 100)
  const clamped = Math.max(-20, Math.min(15, pct - 6)) // bias slightly slower for clarity
  return `${clamped >= 0 ? '+' : ''}${clamped}%`
}

function buildPythonEnv(): NodeJS.ProcessEnv {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const pathParts = (process.env.PATH || '').split(path.delimiter).filter(Boolean)

  if (process.platform === 'darwin') {
    for (const extra of [
      path.join(home, 'Library/Python/3.9/bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ]) {
      if (!pathParts.includes(extra)) pathParts.unshift(extra)
    }
  } else if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || ''
    const roaming = process.env.APPDATA || ''
    for (const extra of [
      path.join(local, 'Python', 'bin'),
      path.join(roaming, 'Python', 'Python315', 'Scripts'),
      path.join(roaming, 'Python', 'Python314', 'Scripts'),
      path.join(roaming, 'Python', 'Python313', 'Scripts'),
      'C:\\Python314',
      'C:\\Python314\\Scripts',
    ]) {
      if (extra && !pathParts.includes(extra)) pathParts.unshift(extra)
    }
  }

  const pythonPathParts = [process.env.PYTHONPATH || ''].filter(Boolean)
  if (process.platform === 'darwin') {
    pythonPathParts.unshift(path.join(home, 'Library/Python/3.9/lib/python/site-packages'))
  }

  return {
    ...process.env,
    PATH: pathParts.join(path.delimiter),
    PYTHONPATH: pythonPathParts.join(path.delimiter),
    PYTHONIOENCODING: 'utf-8',
  }
}

function playMedia(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    if (process.platform === 'darwin') {
      child = spawn('afplay', [filePath], {
        stdio: 'ignore',
      }) as ChildProcessWithoutNullStreams
    } else if (process.platform === 'win32') {
      // No ffplay required — use WPF MediaPlayer (same approach as piper-bangla)
      const safe = filePath.replace(/'/g, "''")
      child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Add-Type -AssemblyName PresentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([Uri]'${safe}'); $p.Play(); Start-Sleep -Milliseconds 400; $deadline = (Get-Date).AddSeconds(120); while($p.NaturalDuration.HasTimeSpan -eq $false -and (Get-Date) -lt $deadline){ Start-Sleep -Milliseconds 50 }; if($p.NaturalDuration.HasTimeSpan){ while($p.Position -lt $p.NaturalDuration.TimeSpan -and (Get-Date) -lt $deadline){ Start-Sleep -Milliseconds 100 } }`,
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
      if (signal) reject(new Error(`edge play killed (${signal})`))
      else if (code) reject(new Error(`edge play exited ${code}`))
      else resolve()
    })
  })
}

async function runEdgeTts(args: string[]): Promise<void> {
  const env = buildPythonEnv()
  const candidates =
    process.platform === 'win32'
      ? [pythonBin(), 'python', 'python3', 'py']
      : [pythonBin(), 'python3', 'python']

  const tried = new Set<string>()
  let lastError: unknown

  for (const bin of candidates) {
    if (tried.has(bin)) continue
    tried.add(bin)
    try {
      await execFileAsync(bin, ['-m', 'edge_tts', ...args], {
        timeout: 45000,
        env,
        windowsHide: true,
      })
      return
    } catch (error) {
      lastError = error
      const msg = error instanceof Error ? error.message : String(error)
      // Only try next interpreter when the module / binary is missing
      if (!/No module named edge_tts|ENOENT|not found|cannot find/i.test(msg)) {
        throw error
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError || 'edge_tts failed'))
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
    // Prefer `python -m edge_tts` so PATH to user site-packages works
    // Use --rate=-8% (one argv) — a bare "-8%" is parsed as a new flag
    await runEdgeTts([
      '--voice',
      voice,
      `--rate=${edgeRate(options.rate)}`,
      '--text',
      text,
      '--write-media',
      tmp,
    ])

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
