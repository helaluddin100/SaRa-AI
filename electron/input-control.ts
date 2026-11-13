import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'

const execFileAsync = promisify(execFile)
const platform = os.platform()

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function osascript(source: string): Promise<string> {
  const { stdout } = await execFileAsync('osascript', ['-e', source], {
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  })
  return String(stdout || '').trim()
}

export async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

export async function activateApp(appName: string): Promise<{ ok: boolean; message: string }> {
  const name = appName.trim()
  if (!name) return { ok: false, message: 'App name empty' }
  try {
    if (platform === 'darwin') {
      await execFileAsync('open', ['-a', name])
      await sleep(700)
      return { ok: true, message: `${name} activated` }
    }
    if (platform === 'win32') {
      await execFileAsync('powershell', [
        '-NoProfile',
        '-Command',
        `Start-Process '${name.replace(/'/g, "''")}'`,
      ])
      return { ok: true, message: `${name} started` }
    }
    return { ok: false, message: 'Unsupported platform' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function hotkey(
  key: string,
  modifiers: Array<'command' | 'shift' | 'option' | 'control'> = [],
): Promise<{ ok: boolean; message: string }> {
  try {
    if (platform === 'darwin') {
      const mods = modifiers.map((m) => `${m} down`).join(', ')
      const using = mods ? ` using {${mods}}` : ''
      const k = key.length === 1 ? `keystroke "${escapeAppleScriptString(key.toLowerCase())}"` : keyCodeLine(key)
      await osascript(`
tell application "System Events"
  ${k}${using}
end tell
`)
      return { ok: true, message: `hotkey ${modifiers.join('+')}+${key}` }
    }
    return { ok: false, message: 'hotkey only implemented on macOS for now' }
  } catch (error) {
    return accessibilityFail(error)
  }
}

function keyCodeLine(key: string): string {
  const map: Record<string, number> = {
    return: 36,
    enter: 36,
    tab: 48,
    escape: 53,
    delete: 51,
    backspace: 51,
    space: 49,
    up: 126,
    down: 125,
    left: 123,
    right: 124,
  }
  const code = map[key.toLowerCase()]
  if (code == null) return `keystroke "${escapeAppleScriptString(key)}"`
  return `key code ${code}`
}

export async function pressKey(key: string): Promise<{ ok: boolean; message: string }> {
  try {
    if (platform === 'darwin') {
      await osascript(`
tell application "System Events"
  ${keyCodeLine(key)}
end tell
`)
      return { ok: true, message: `key ${key}` }
    }
    return { ok: false, message: 'pressKey macOS only for now' }
  } catch (error) {
    return accessibilityFail(error)
  }
}

/** Type / paste text into the focused field (clipboard paste is Unicode-safe). */
export async function typeText(text: string): Promise<{ ok: boolean; message: string }> {
  try {
    if (platform === 'darwin') {
      await osascript(`set the clipboard to "${escapeAppleScriptString(text)}"`)
      await osascript(`
tell application "System Events"
  keystroke "v" using command down
end tell
`)
      return { ok: true, message: `typed ${text.slice(0, 40)}${text.length > 40 ? '…' : ''}` }
    }
    return { ok: false, message: 'typeText macOS only for now' }
  } catch (error) {
    return accessibilityFail(error)
  }
}

/**
 * Click at screen coordinates (logical points, same as Electron display size).
 * Uses Python ctypes → CoreGraphics (no pyobjc). Falls back to System Events.
 */
export async function clickAt(
  x: number,
  y: number,
  button: 'left' | 'right' = 'left',
  times = 1,
): Promise<{ ok: boolean; message: string }> {
  const ix = Math.round(x)
  const iy = Math.round(y)
  const clicks = Math.max(1, Math.min(3, Math.round(times) || 1))
  if (platform !== 'darwin') {
    return { ok: false, message: 'clickAt macOS only for now' }
  }

  // 1) CoreGraphics via ctypes — no pyobjc/Quartz pip package needed
  try {
    const py = `
import ctypes, time
from ctypes import Structure, c_double, c_void_p, c_uint32, c_int64

class CGPoint(Structure):
  _fields_ = [("x", c_double), ("y", c_double)]

cg = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
cg.CGEventCreateMouseEvent.restype = c_void_p
cg.CGEventCreateMouseEvent.argtypes = [c_void_p, c_uint32, CGPoint, c_uint32]
cg.CGEventPost.argtypes = [c_uint32, c_void_p]
cg.CGEventSetIntegerValueField.argtypes = [c_void_p, c_uint32, c_int64]
cg.CFRelease.argtypes = [c_void_p]

kCGHIDEventTap = 0
kCGEventMouseMoved = 5
kCGEventLeftMouseDown = 1
kCGEventLeftMouseUp = 2
kCGEventRightMouseDown = 3
kCGEventRightMouseUp = 4
kCGMouseEventClickState = 1

x, y = float(${ix}), float(${iy})
btn = "${button}"
clicks = ${clicks}
pt = CGPoint(x, y)
down = kCGEventRightMouseDown if btn == "right" else kCGEventLeftMouseDown
up = kCGEventRightMouseUp if btn == "right" else kCGEventLeftMouseUp
mouse_btn = 1 if btn == "right" else 0

move = cg.CGEventCreateMouseEvent(None, kCGEventMouseMoved, pt, mouse_btn)
if move:
  cg.CGEventPost(kCGHIDEventTap, move)
  cg.CFRelease(move)
time.sleep(0.05)
for i in range(clicks):
  e1 = cg.CGEventCreateMouseEvent(None, down, pt, mouse_btn)
  e2 = cg.CGEventCreateMouseEvent(None, up, pt, mouse_btn)
  if e1:
    cg.CGEventSetIntegerValueField(e1, kCGMouseEventClickState, i + 1)
    cg.CGEventPost(kCGHIDEventTap, e1)
    cg.CFRelease(e1)
  time.sleep(0.04)
  if e2:
    cg.CGEventSetIntegerValueField(e2, kCGMouseEventClickState, i + 1)
    cg.CGEventPost(kCGHIDEventTap, e2)
    cg.CFRelease(e2)
  time.sleep(0.08)
print("ok")
`
    const { stdout } = await execFileAsync('/usr/bin/python3', ['-c', py], {
      timeout: 10000,
    })
    if (String(stdout || '').includes('ok')) {
      return {
        ok: true,
        message: `${clicks > 1 ? 'double-' : ''}clicked (${ix},${iy})`,
      }
    }
  } catch {
    // fall through
  }

  // 2) System Events — needs Accessibility for Electron/Jarvis
  try {
    for (let i = 0; i < clicks; i += 1) {
      await osascript(`
tell application "System Events"
  click at {${ix}, ${iy}}
end tell
`)
      await sleep(80)
    }
    return { ok: true, message: `clicked (${ix},${iy}) via System Events` }
  } catch (error) {
    return accessibilityFail(error)
  }
}

function accessibilityFail(error: unknown): { ok: boolean; message: string } {
  const msg = error instanceof Error ? error.message : String(error)
  if (/not allowed|assistive|accessibility|1002|permission/i.test(msg)) {
    return {
      ok: false,
      message:
        'Accessibility permission লাগবে। System Settings → Privacy & Security → Accessibility → Electron/Jarvis চালু করো।',
    }
  }
  return { ok: false, message: msg }
}
