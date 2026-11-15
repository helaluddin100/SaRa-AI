import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'

const execFileAsync = promisify(execFile)
const platform = os.platform()

const APP_ALIASES: Record<string, { mac: string; win: string }> = {
  chrome: { mac: 'Google Chrome', win: 'chrome' },
  'google chrome': { mac: 'Google Chrome', win: 'chrome' },
  safari: { mac: 'Safari', win: 'msedge' },
  edge: { mac: 'Microsoft Edge', win: 'msedge' },
  firefox: { mac: 'Firefox', win: 'firefox' },
  spotify: { mac: 'Spotify', win: 'spotify' },
  steam: { mac: 'Steam', win: 'steam' },
  vscode: { mac: 'Visual Studio Code', win: 'Code' },
  code: { mac: 'Visual Studio Code', win: 'Code' },
  cursor: { mac: 'Cursor', win: 'Cursor' },
  'cursor.app': { mac: 'Cursor', win: 'Cursor' },
  terminal: { mac: 'Terminal', win: 'wt' },
  finder: { mac: 'Finder', win: 'explorer' },
  explorer: { mac: 'Finder', win: 'explorer' },
  notes: { mac: 'Notes', win: 'notepad' },
  notepad: { mac: 'TextEdit', win: 'notepad' },
  calculator: { mac: 'Calculator', win: 'calc' },
  music: { mac: 'Music', win: 'ms-windows-store://pdp/?productid=9WZDNCRFJ3PT' },
  youtube: { mac: 'https://www.youtube.com', win: 'https://www.youtube.com' },
  settings: { mac: 'System Settings', win: 'ms-settings:' },
  whatsapp: { mac: 'WhatsApp', win: 'whatsapp:' },
  mail: { mac: 'Mail', win: 'outlookmail:' },
  gmail: { mac: 'https://mail.google.com', win: 'https://mail.google.com' },
  facebook: { mac: 'https://www.facebook.com', win: 'https://www.facebook.com' },
}

function resolveAppName(raw: string): { mac: string; win: string } {
  const key = raw.trim().toLowerCase()
  return APP_ALIASES[key] ?? { mac: raw.trim(), win: raw.trim() }
}

export async function openApp(appName: string): Promise<{ ok: boolean; message: string }> {
  const resolved = resolveAppName(appName)

  try {
    if (platform === 'darwin') {
      if (resolved.mac.startsWith('http')) {
        await execFileAsync('open', [resolved.mac])
      } else {
        await execFileAsync('open', ['-a', resolved.mac])
      }
      return { ok: true, message: `Opened ${resolved.mac}` }
    }

    if (platform === 'win32') {
      const target = resolved.win
      // Prefer Start-Process for .exe names; start for URLs / protocols
      if (target.startsWith('http') || target.includes(':')) {
        spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref()
      } else {
        try {
          await execFileAsync(
            'powershell.exe',
            [
              '-NoProfile',
              '-Command',
              `try { Start-Process '${target.replace(/'/g, "''")}' } catch { Start-Process cmd.exe -ArgumentList '/c','start','','${target.replace(/'/g, "''")}' }`,
            ],
            { windowsHide: true, timeout: 15000 },
          )
        } catch {
          spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref()
        }
      }
      return { ok: true, message: `Opened ${target}` }
    }

    return { ok: false, message: `Unsupported platform: ${platform}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `Failed to open ${appName}: ${message}` }
  }
}

export async function closeApp(appName: string): Promise<{ ok: boolean; message: string }> {
  const resolved = resolveAppName(appName)

  try {
    if (platform === 'darwin') {
      if (resolved.mac.startsWith('http')) {
        return { ok: false, message: 'Cannot close a website URL' }
      }
      await execFileAsync('osascript', [
        '-e',
        `tell application "${resolved.mac}" to quit`,
      ])
      return { ok: true, message: `Closed ${resolved.mac}` }
    }

    if (platform === 'win32') {
      // Map aliases / protocols → real process image names
      const key = appName.trim().toLowerCase()
      const processMap: Record<string, string> = {
        chrome: 'chrome.exe',
        'google chrome': 'chrome.exe',
        edge: 'msedge.exe',
        safari: 'msedge.exe',
        firefox: 'firefox.exe',
        spotify: 'Spotify.exe',
        vscode: 'Code.exe',
        code: 'Code.exe',
        cursor: 'Cursor.exe',
        'cursor.app': 'Cursor.exe',
        whatsapp: 'WhatsApp.exe',
        notepad: 'notepad.exe',
        calculator: 'Calculator.exe',
        terminal: 'WindowsTerminal.exe',
        explorer: 'explorer.exe',
      }
      const processName =
        processMap[key] ||
        (resolved.win.includes(':') ? undefined : `${resolved.win.replace(/\.exe$/i, '')}.exe`)

      if (!processName) {
        return { ok: false, message: `Cannot close protocol/url target: ${resolved.win}` }
      }

      await execFileAsync('taskkill', ['/IM', processName, '/F'])
      return { ok: true, message: `Closed ${processName}` }
    }

    return { ok: false, message: `Unsupported platform: ${platform}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `Failed to close ${appName}: ${message}` }
  }
}

export async function openUrl(url: string): Promise<{ ok: boolean; message: string }> {
  try {
    const safe = url.startsWith('http') ? url : `https://${url}`
    if (platform === 'darwin') {
      await execFileAsync('open', [safe])
    } else if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', safe], { detached: true, stdio: 'ignore' }).unref()
    } else {
      return { ok: false, message: `Unsupported platform: ${platform}` }
    }
    return { ok: true, message: `Opened ${safe}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `Failed to open URL: ${message}` }
  }
}

type CpuSample = { idle: number; total: number }

let lastCpuSample: CpuSample | null = null

function readCpuSample(): CpuSample {
  let idle = 0
  let total = 0
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq
  }
  return { idle, total }
}

/** Instant CPU % from successive samples (call periodically). */
function measureCpuPercent(): number {
  const current = readCpuSample()
  if (!lastCpuSample) {
    lastCpuSample = current
    // First call: approximate from load average
    const cores = Math.max(1, os.cpus().length)
    const load = os.loadavg()[0] || 0
    return Math.max(0, Math.min(100, Math.round((load / cores) * 100)))
  }
  const idleDelta = current.idle - lastCpuSample.idle
  const totalDelta = current.total - lastCpuSample.total
  lastCpuSample = current
  if (totalDelta <= 0) return 0
  const usage = 1 - idleDelta / totalDelta
  return Math.max(0, Math.min(100, Math.round(usage * 1000) / 10))
}

export async function getSystemInfo(): Promise<{
  platform: string
  hostname: string
  arch: string
  cpus: number
  cpuPercent: number
  load1: number
  freeMemGB: number
  usedMemGB: number
  totalMemGB: number
  memPercent: number
  uptimeHours: number
  at: string
}> {
  const total = os.totalmem()
  const free = os.freemem()
  const used = total - free
  const toGb = (n: number) => Math.round((n / 1024 / 1024 / 1024) * 10) / 10
  return {
    platform: platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform,
    hostname: os.hostname(),
    arch: os.arch(),
    cpus: os.cpus().length,
    cpuPercent: measureCpuPercent(),
    load1: Math.round((os.loadavg()[0] || 0) * 100) / 100,
    freeMemGB: toGb(free),
    usedMemGB: toGb(used),
    totalMemGB: toGb(total),
    memPercent: Math.round((used / total) * 1000) / 10,
    uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
    at: new Date().toISOString(),
  }
}

export function listKnownApps(): string[] {
  return Object.keys(APP_ALIASES)
}
