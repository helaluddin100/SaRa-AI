import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import { screen as electronScreen } from 'electron'

const execFileAsync = promisify(execFile)
const platform = os.platform()

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapePsSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

async function osascript(source: string): Promise<string> {
  const { stdout } = await execFileAsync('osascript', ['-e', source], {
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  })
  return String(stdout || '').trim()
}

async function runPowerShell(script: string, timeoutMs = 30_000): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: timeoutMs, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
  )
  return String(stdout || '').trim()
}

/** Shared Win32 helpers for mouse / keyboard / focus. */
const WIN_INPUT_TYPE = `
Add-Type -AssemblyName System.Windows.Forms
if (-not ("WinInput" -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const byte VK_CONTROL = 0x11;
  public const byte VK_SHIFT = 0x10;
  public const byte VK_MENU = 0x12; // Alt
  public const byte VK_LWIN = 0x5B;
  public const int SW_RESTORE = 9;
}
"@
}
`

export async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

/** Map Electron DIP → Windows physical pixels for SetCursorPos. */
function dipToPhysical(x: number, y: number): { x: number; y: number } {
  try {
    const point = electronScreen.dipToScreenPoint({ x, y })
    return { x: Math.round(point.x), y: Math.round(point.y) }
  } catch {
    const d = electronScreen.getPrimaryDisplay()
    const scale = d.scaleFactor || 1
    return { x: Math.round(x * scale), y: Math.round(y * scale) }
  }
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
      const needle = escapePsSingleQuoted(name)
      const script = `
${WIN_INPUT_TYPE}
$target = '${needle}'.ToLower()
$found = $false
$procNames = @($target, ($target -replace '\\s',''), 'chrome','msedge','Code','Cursor','WhatsApp','spotify','firefox')
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
  $title = $_.MainWindowTitle
  $pn = $_.ProcessName.ToLower()
  if ($title -and ($title.ToLower().Contains($target) -or $pn.Contains($target) -or $target.Contains($pn))) {
    $hwnd = $_.MainWindowHandle
    if ([WinInput]::IsIconic($hwnd)) { [void][WinInput]::ShowWindow($hwnd, [WinInput]::SW_RESTORE) }
    $fore = [WinInput]::GetForegroundWindow()
    $foreTid = 0; [void][WinInput]::GetWindowThreadProcessId($fore, [ref]$foreTid)
    $curTid = [WinInput]::GetCurrentThreadId()
    $targetTid = 0; [void][WinInput]::GetWindowThreadProcessId($hwnd, [ref]$targetTid)
    if ($foreTid -ne $targetTid) { [void][WinInput]::AttachThreadInput($curTid, $foreTid, $true); [void][WinInput]::AttachThreadInput($curTid, $targetTid, $true) }
    [void][WinInput]::SetForegroundWindow($hwnd)
    if ($foreTid -ne $targetTid) { [void][WinInput]::AttachThreadInput($curTid, $foreTid, $false); [void][WinInput]::AttachThreadInput($curTid, $targetTid, $false) }
    $wshell = New-Object -ComObject WScript.Shell
    [void]$wshell.AppActivate($_.Id)
    $found = $true
  }
}
if (-not $found) {
  try { Start-Process '${needle}' -ErrorAction Stop; Start-Sleep -Milliseconds 800; $found = $true } catch {}
}
if ($found) { Write-Output 'ok' } else { Write-Output 'fail' }
`
      const out = await runPowerShell(script, 20_000)
      if (out.includes('ok')) {
        await sleep(400)
        return { ok: true, message: `${name} activated` }
      }
      return { ok: false, message: `Could not activate ${name}` }
    }
    return { ok: false, message: 'Unsupported platform' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

function winVkForKey(key: string): number | null {
  const k = key.toLowerCase()
  const map: Record<string, number> = {
    return: 0x0d,
    enter: 0x0d,
    tab: 0x09,
    escape: 0x1b,
    esc: 0x1b,
    delete: 0x2e,
    backspace: 0x08,
    space: 0x20,
    up: 0x26,
    down: 0x28,
    left: 0x25,
    right: 0x27,
    home: 0x24,
    end: 0x23,
  }
  if (map[k] != null) return map[k]
  if (k.length === 1) {
    const ch = k.toUpperCase().charCodeAt(0)
    if (ch >= 0x30 && ch <= 0x39) return ch // 0-9
    if (ch >= 0x41 && ch <= 0x5a) return ch // A-Z
  }
  return null
}

function sendKeysToken(key: string): string {
  const k = key.toLowerCase()
  const map: Record<string, string> = {
    return: '{ENTER}',
    enter: '{ENTER}',
    tab: '{TAB}',
    escape: '{ESC}',
    esc: '{ESC}',
    delete: '{DELETE}',
    backspace: '{BACKSPACE}',
    space: ' ',
    up: '{UP}',
    down: '{DOWN}',
    left: '{LEFT}',
    right: '{RIGHT}',
  }
  if (map[k]) return map[k]
  if (k.length === 1) {
    // SendKeys special chars
    if ('+^%~(){}[]'.includes(k)) return `{${k}}`
    return k
  }
  return `{${key.toUpperCase()}}`
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

    if (platform === 'win32') {
      // On Windows, Cmd → Ctrl (same shortcuts in Chromium / WhatsApp Desktop)
      const mods = modifiers.map((m) => (m === 'command' ? 'control' : m === 'option' ? 'alt' : m))
      const uniq = [...new Set(mods)]
      const vk = winVkForKey(key)
      if (vk != null) {
        const downMods: string[] = []
        const upMods: string[] = []
        for (const m of uniq) {
          const modVk =
            m === 'control'
              ? '[WinInput]::VK_CONTROL'
              : m === 'shift'
                ? '[WinInput]::VK_SHIFT'
                : m === 'alt'
                  ? '[WinInput]::VK_MENU'
                  : null
          if (!modVk) continue
          downMods.push(`[WinInput]::keybd_event(${modVk}, 0, 0, [UIntPtr]::Zero)`)
          upMods.unshift(`[WinInput]::keybd_event(${modVk}, 0, [WinInput]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)`)
        }
        const script = `
${WIN_INPUT_TYPE}
${downMods.join('; ')}
Start-Sleep -Milliseconds 30
[WinInput]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 30
[WinInput]::keybd_event(${vk}, 0, [WinInput]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 30
${upMods.join('; ')}
Write-Output 'ok'
`
        await runPowerShell(script)
        return { ok: true, message: `hotkey ${uniq.join('+')}+${key}` }
      }

      // Fallback SendKeys
      let prefix = ''
      if (uniq.includes('control')) prefix += '^'
      if (uniq.includes('shift')) prefix += '+'
      if (uniq.includes('alt')) prefix += '%'
      const token = sendKeysToken(key)
      await runPowerShell(`
${WIN_INPUT_TYPE}
[System.Windows.Forms.SendKeys]::SendWait('${escapePsSingleQuoted(prefix + token)}')
Write-Output 'ok'
`)
      return { ok: true, message: `hotkey ${uniq.join('+')}+${key}` }
    }

    return { ok: false, message: 'hotkey unsupported on this platform' }
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
    if (platform === 'win32') {
      const vk = winVkForKey(key)
      if (vk != null) {
        await runPowerShell(`
${WIN_INPUT_TYPE}
[WinInput]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 40
[WinInput]::keybd_event(${vk}, 0, [WinInput]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
Write-Output 'ok'
`)
        return { ok: true, message: `key ${key}` }
      }
      const token = sendKeysToken(key)
      await runPowerShell(`
${WIN_INPUT_TYPE}
[System.Windows.Forms.SendKeys]::SendWait('${escapePsSingleQuoted(token)}')
Write-Output 'ok'
`)
      return { ok: true, message: `key ${key}` }
    }
    return { ok: false, message: 'pressKey unsupported on this platform' }
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
    if (platform === 'win32') {
      // Set-Clipboard handles Unicode (Bangla) safely; Ctrl+V pastes into focused field
      const b64 = Buffer.from(text, 'utf8').toString('base64')
      await runPowerShell(`
${WIN_INPUT_TYPE}
$bytes = [Convert]::FromBase64String('${b64}')
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
Set-Clipboard -Value $text
Start-Sleep -Milliseconds 120
[WinInput]::keybd_event([WinInput]::VK_CONTROL, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 20
[WinInput]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero) # V
Start-Sleep -Milliseconds 30
[WinInput]::keybd_event(0x56, 0, [WinInput]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 20
[WinInput]::keybd_event([WinInput]::VK_CONTROL, 0, [WinInput]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
Write-Output 'ok'
`)
      return { ok: true, message: `typed ${text.slice(0, 40)}${text.length > 40 ? '…' : ''}` }
    }
    return { ok: false, message: 'typeText unsupported on this platform' }
  } catch (error) {
    return accessibilityFail(error)
  }
}

/**
 * Click at screen coordinates (logical DIP points, same as Electron display size).
 * macOS: CoreGraphics / System Events. Windows: user32 SetCursorPos + mouse_event.
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

  if (platform === 'win32') {
    const phys = dipToPhysical(ix, iy)
    const down =
      button === 'right' ? '[WinInput]::MOUSEEVENTF_RIGHTDOWN' : '[WinInput]::MOUSEEVENTF_LEFTDOWN'
    const up =
      button === 'right' ? '[WinInput]::MOUSEEVENTF_RIGHTUP' : '[WinInput]::MOUSEEVENTF_LEFTUP'
    try {
      const script = `
${WIN_INPUT_TYPE}
[void][WinInput]::SetCursorPos(${phys.x}, ${phys.y})
Start-Sleep -Milliseconds 50
for ($i = 0; $i -lt ${clicks}; $i++) {
  [WinInput]::mouse_event(${down}, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [WinInput]::mouse_event(${up}, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
}
Write-Output 'ok'
`
      const out = await runPowerShell(script)
      if (out.includes('ok')) {
        return {
          ok: true,
          message: `${clicks > 1 ? 'double-' : ''}clicked (${ix},${iy}) [phys ${phys.x},${phys.y}]`,
        }
      }
      return { ok: false, message: `click failed at (${ix},${iy})` }
    } catch (error) {
      return accessibilityFail(error)
    }
  }

  if (platform !== 'darwin') {
    return { ok: false, message: 'clickAt unsupported on this platform' }
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
        platform === 'win32'
          ? 'Windows input blocked — app কে admin / foreground permission দরকার হতে পারে। Target window focus করে আবার চেষ্টা করো।'
          : 'Accessibility permission লাগবে। System Settings → Privacy & Security → Accessibility → Electron/Jarvis চালু করো।',
    }
  }
  return { ok: false, message: msg }
}
