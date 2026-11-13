import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'

const execFileAsync = promisify(execFile)
const platform = os.platform()

export type LocalVoice = {
  id: string
  name: string
  lang: string
  gender: 'female' | 'male' | 'unknown'
}

let speakingProc: ChildProcessWithoutNullStreams | null = null

function guessGender(name: string, lang: string): LocalVoice['gender'] {
  const n = `${name} ${lang}`.toLowerCase()
  if (/piya|samantha|karen|moira|fiona|veena|lekha|zira|susan|kate|serena|ava|allison|victoria|tessa|martha|linda|heera|neel|female/.test(n)) {
    return 'female'
  }
  if (/daniel|alex|fred|tom|david|mark|ravi|male|ralph/.test(n)) return 'male'
  return 'unknown'
}

export async function listLocalVoices(): Promise<LocalVoice[]> {
  try {
    if (platform === 'darwin') {
      const { stdout } = await execFileAsync('say', ['-v', '?'], { encoding: 'utf8' })
      return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          // "Piya                bn_IN    # Hello!..."
          const m = line.match(/^(\S+)\s+(\S+)/)
          if (!m) return null
          const name = m[1]
          const lang = m[2]
          return {
            id: name,
            name,
            lang,
            gender: guessGender(name, lang),
          } satisfies LocalVoice
        })
        .filter((v): v is LocalVoice => Boolean(v))
    }

    if (platform === 'win32') {
      const script = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.GetInstalledVoices() | ForEach-Object {
  $i = $_.VoiceInfo
  Write-Output ($i.Name + '|' + $i.Culture + '|' + $i.Gender)
}
`
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-Command', script],
        { encoding: 'utf8', windowsHide: true },
      )
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [name, lang, genderRaw] = line.split('|')
          const gender =
            /female/i.test(genderRaw || '')
              ? 'female'
              : /male/i.test(genderRaw || '')
                ? 'male'
                : guessGender(name || '', lang || '')
          return {
            id: name,
            name,
            lang: lang || '',
            gender,
          } satisfies LocalVoice
        })
    }

    return []
  } catch {
    return []
  }
}

export function pickDefaultLocalVoice(voices: LocalVoice[], preferBangla = true): string {
  const female = voices.filter((v) => v.gender === 'female')
  const pool = female.length ? female : voices
  if (preferBangla) {
    const bn = pool.find((v) => /^(bn)/i.test(v.lang) || /bangla|bengali|piya/i.test(`${v.name} ${v.lang}`))
    if (bn) return bn.id
  }
  const enFemale =
    pool.find((v) => /samantha/i.test(v.name)) ||
    pool.find((v) => /karen|moira|zira/i.test(v.name)) ||
    pool.find((v) => /^en/i.test(v.lang))
  return enFemale?.id || pool[0]?.id || ''
}

export function stopLocalSpeak() {
  if (speakingProc) {
    try {
      speakingProc.kill('SIGTERM')
    } catch {
      // ignore
    }
    speakingProc = null
  }
  if (platform === 'darwin') {
    spawn('killall', ['say'], { stdio: 'ignore' }).on('error', () => undefined)
  }
}

export async function speakLocal(options: {
  text: string
  voiceId?: string
  /** 0.5 – 1.5 typical */
  rate?: number
}): Promise<{ ok: boolean; message?: string }> {
  const text = options.text.trim()
  if (!text) return { ok: true }

  stopLocalSpeak()

  try {
    if (platform === 'darwin') {
      const args: string[] = []
      if (options.voiceId) args.push('-v', options.voiceId)
      // say -r words-per-minute; default ~175. Map 0.5–1.5 → ~120–260
      const rate = Math.round(175 * (options.rate ?? 1))
      args.push('-r', String(Math.min(300, Math.max(90, rate))), text)

      await new Promise<void>((resolve, reject) => {
        const child = spawn('say', args, { stdio: 'ignore' })
        speakingProc = child as ChildProcessWithoutNullStreams
        child.on('error', reject)
        child.on('exit', (code) => {
          speakingProc = null
          if (code && code !== 0) reject(new Error(`say exited ${code}`))
          else resolve()
        })
      })
      return { ok: true }
    }

    if (platform === 'win32') {
      const voice = (options.voiceId || '').replace(/'/g, "''")
      const rate = Math.max(-8, Math.min(8, Math.round(((options.rate ?? 1) - 1) * 10)))
      const safe = text.replace(/'/g, "''")
      const script = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = ${rate}
${voice ? `try { $s.SelectVoice('${voice}') } catch {}` : ''}
$s.Speak('${safe}')
`
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-Command', script],
          { stdio: 'ignore', windowsHide: true },
        )
        speakingProc = child as ChildProcessWithoutNullStreams
        child.on('error', reject)
        child.on('exit', (code) => {
          speakingProc = null
          if (code && code !== 0) reject(new Error(`SAPI exited ${code}`))
          else resolve()
        })
      })
      return { ok: true }
    }

    return { ok: false, message: `Unsupported platform: ${platform}` }
  } catch (error) {
    speakingProc = null
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message }
  }
}
