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
  // Keep aspect ratio — wrong aspect breaks click mapping (esp. Windows)
  const maxW = 1600
  const maxH = 900
  const fit = Math.min(maxW / metrics.width, maxH / metrics.height, 1)
  const thumbW = Math.max(640, Math.round(metrics.width * fit))
  const thumbH = Math.max(360, Math.round(metrics.height * fit))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: thumbW,
      height: thumbH,
    },
  })
  // Prefer primary display source when multiple monitors exist
  const primaryBounds = metrics.bounds
  const primary =
    sources.find((s) => /screen 1|entire screen|display 1/i.test(s.name)) ||
    sources[0]
  if (!primary?.thumbnail || primary.thumbnail.isEmpty()) {
    return {
      ok: false,
      message:
        process.platform === 'win32'
          ? 'Screen capture খালি। Windows Settings → Privacy → Screen recording / Desktop capture allow করো, অথবা app restart করো।'
          : 'Screen capture খালি। System Settings → Privacy → Screen Recording → Electron/Jarvis allow করো।',
    }
  }
  void primaryBounds
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
