import { desktopCapturer, screen as electronScreen } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const execFileAsync = promisify(execFile)

export type ScreenShot = {
  ok: boolean
  message?: string
  /** PNG base64 without data: prefix */
  base64?: string
  mimeType?: string
  width?: number
  height?: number
  scaleFactor?: number
}

export function getPrimaryDisplayMetrics() {
  const d = electronScreen.getPrimaryDisplay()
  return {
    width: d.size.width,
    height: d.size.height,
    scaleFactor: d.scaleFactor,
    bounds: d.bounds,
  }
}

async function captureViaScreencapture(): Promise<ScreenShot> {
  const file = path.join(os.tmpdir(), `jarvis-screen-${Date.now()}.png`)
  try {
    // -x = no sound, full main display
    await execFileAsync('screencapture', ['-x', '-C', file], { timeout: 15000 })
    const buf = await fs.readFile(file)
    const metrics = getPrimaryDisplayMetrics()
    return {
      ok: true,
      base64: buf.toString('base64'),
      mimeType: 'image/png',
      width: metrics.width,
      height: metrics.height,
      scaleFactor: metrics.scaleFactor,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/not authorized|permission|capture/i.test(message)) {
      return {
        ok: false,
        message:
          'Screen Recording permission লাগবে। System Settings → Privacy & Security → Screen Recording → Jarvis/Electron চালু করো।',
      }
    }
    return { ok: false, message: `Screenshot failed: ${message}` }
  } finally {
    try {
      await fs.unlink(file)
    } catch {
      // ignore
    }
  }
}

async function captureViaDesktopCapturer(): Promise<ScreenShot> {
  const metrics = getPrimaryDisplayMetrics()
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.min(1280, metrics.width),
      height: Math.min(800, metrics.height),
    },
  })
  const primary = sources[0]
  if (!primary?.thumbnail || primary.thumbnail.isEmpty()) {
    return {
      ok: false,
      message:
        'Screen capture খালি। System Settings → Privacy → Screen Recording → Electron/Jarvis allow করো।',
    }
  }
  const png = primary.thumbnail.toPNG()
  const size = primary.thumbnail.getSize()
  return {
    ok: true,
    base64: png.toString('base64'),
    mimeType: 'image/png',
    width: size.width,
    height: size.height,
    scaleFactor: metrics.scaleFactor,
  }
}

/** Capture primary display as PNG base64 for Gemini vision. */
export async function captureScreen(): Promise<ScreenShot> {
  if (process.platform === 'darwin') {
    const shot = await captureViaScreencapture()
    if (shot.ok) return shot
    // fallback
    const alt = await captureViaDesktopCapturer()
    if (alt.ok) return alt
    return shot.message ? shot : alt
  }
  return captureViaDesktopCapturer()
}
