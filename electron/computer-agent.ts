import { BrowserWindow } from 'electron'
import { geminiGenerateContent } from './gemini'
import { activateApp, clickAt, hotkey, pressKey, sleep, typeText } from './input-control'
import { openApp, openUrl } from './pc-control'
import { captureScreen, getPrimaryDisplayMetrics } from './screen'
import { getSettings } from './store'

export type TaskProgress = {
  taskId: string
  status: 'running' | 'completed' | 'failed'
  step: number
  maxSteps: number
  action?: string
  detail: string
}

export type TaskResult = {
  ok: boolean
  taskId: string
  message: string
  steps: string[]
  completed: boolean
}

type AgentAction =
  | { action: 'observe'; reason?: string }
  | { action: 'open_app'; app: string; reason?: string }
  | { action: 'open_url'; url: string; reason?: string }
  | { action: 'activate_app'; app: string; reason?: string }
  | { action: 'click'; x_norm: number; y_norm: number; reason?: string }
  | { action: 'double_click'; x_norm: number; y_norm: number; reason?: string }
  | { action: 'type'; text: string; reason?: string }
  | { action: 'hotkey'; key: string; modifiers?: Array<'command' | 'shift' | 'option' | 'control'>; reason?: string }
  | { action: 'press'; key: string; reason?: string }
  | { action: 'wait'; ms?: number; reason?: string }
  | { action: 'done'; summary: string }
  | { action: 'fail'; summary: string }

function emitProgress(win: BrowserWindow | null, progress: TaskProgress) {
  try {
    win?.webContents.send('agent:taskProgress', progress)
  } catch {
    // ignore
  }
}

function extractJsonObject(text: string): AgentAction | null {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as AgentAction
  } catch {
    return null
  }
}

function extractModelText(data: unknown): string {
  const d = data as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>
  }
  const parts = d.candidates?.[0]?.content?.parts || []
  return parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text || '')
    .join('\n')
    .trim()
}

async function decideNextAction(options: {
  apiKey: string
  model: string
  goal: string
  history: string[]
  screenshotBase64: string
  mimeType: string
  width: number
  height: number
}): Promise<AgentAction> {
  const metrics = getPrimaryDisplayMetrics()
  const isWin = process.platform === 'win32'
  const mod = isWin ? 'Ctrl' : 'Cmd'
  const modJson = isWin ? 'control' : 'command'
  const browserName = isWin ? 'Chrome or Edge' : 'Google Chrome'
  const system = `You are Aria's computer-use brain. You SEE the user's ${isWin ? 'Windows' : 'Mac'} screen screenshot and must finish ONE goal by choosing the next single UI action.

Rules:
- Coordinates: x_norm and y_norm are 0–1000 relative to the screenshot (0,0 = top-left; 1000,1000 = bottom-right).
- Prefer keyboard shortcuts when reliable (WhatsApp: ${mod}+N search contact, Return, type message, Return to send).
- For WhatsApp message goals: open/activate WhatsApp → hotkey n with modifiers ["${modJson}"] → type contact name → Down/Return → type message → Return.
- For Facebook STATUS/POST goals (critical):
  1) open_url https://www.facebook.com/ and wait until feed is visible
  2) activate_app "${isWin ? 'Chrome' : 'Google Chrome'}" (or Edge if Chrome missing on Windows)
  3) click the center of "What's on your mind?" / create-post chip (NOT Stories, NOT Reels)
  4) wait 1000ms, verify a dialog/textbox is open; if not, click again a bit lower on the same chip
  5) ONLY then type the EXACT post text from the goal
  6) click the blue/primary "Post" / "পোস্ট" button inside the dialog (bottom-right of composer)
  7) wait and confirm the dialog closed / post appears, then done
  Never claim done until Post was clicked and the composer dialog is gone.
- For Facebook Page inbox: open ${browserName} to business.facebook.com/latest/inbox or facebook page inbox, wait, then done with what you see.
- For Gmail: open mail.google.com, wait, summarize from screenshot in done.summary.
- On Windows use modifiers ["control"] not ["command"]. Option = alt on Windows.
- One JSON object ONLY. No markdown.
- If the goal is already done on screen, action=done.
- If blocked (login wall, permission dialog), action=fail with clear Bangla+English summary.

JSON schema (pick one):
{"action":"open_app","app":"WhatsApp"}
{"action":"activate_app","app":"${isWin ? 'Chrome' : 'Google Chrome'}"}
{"action":"open_url","url":"https://..."}
{"action":"click","x_norm":500,"y_norm":400,"reason":"..."}
{"action":"double_click","x_norm":500,"y_norm":400,"reason":"..."}
{"action":"type","text":"..."}
{"action":"hotkey","key":"n","modifiers":["${modJson}"]}
{"action":"press","key":"return"|"down"|"tab"|"escape"}
{"action":"wait","ms":800}
{"action":"done","summary":"what was completed"}
{"action":"fail","summary":"why blocked"}`

  const userText = `GOAL: ${options.goal}

Screen size (logical points): ${metrics.width}x${metrics.height}
Screenshot pixels: ${options.width}x${options.height}

Actions already taken:
${options.history.length ? options.history.map((h, i) => `${i + 1}. ${h}`).join('\n') : '(none)'}

Look at the screenshot. Return the NEXT single action JSON.`

  const result = await geminiGenerateContent(
    {
      apiKey: options.apiKey,
      model: options.model,
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [
          {
            role: 'user',
            parts: [
              { text: userText },
              {
                inlineData: {
                  mimeType: options.mimeType,
                  data: options.screenshotBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          thinkingConfig: { thinkingLevel: 'low' },
        },
      },
    },
    90_000,
  )

  if (!result.ok) {
    return { action: 'fail', summary: `Vision model error: ${result.error}` }
  }

  const text = extractModelText(result.data)
  const parsed = extractJsonObject(text)
  if (!parsed?.action) {
    return { action: 'fail', summary: `Could not parse action from model: ${text.slice(0, 200)}` }
  }
  return parsed
}

async function runAction(
  action: AgentAction,
  shotWidth: number,
  shotHeight: number,
): Promise<{ ok: boolean; detail: string }> {
  const metrics = getPrimaryDisplayMetrics()

  switch (action.action) {
    case 'observe':
      return { ok: true, detail: action.reason || 'observe' }
    case 'open_app': {
      const r = await openApp(action.app)
      return { ok: r.ok, detail: r.message }
    }
    case 'activate_app': {
      const r = await activateApp(action.app)
      return { ok: r.ok, detail: r.message }
    }
    case 'open_url': {
      const r = await openUrl(action.url)
      return { ok: r.ok, detail: r.message }
    }
    case 'click':
    case 'double_click': {
      const xn = Math.max(0, Math.min(1000, Number(action.x_norm) || 0))
      const yn = Math.max(0, Math.min(1000, Number(action.y_norm) || 0))
      // Map normalized → logical screen points (include multi-monitor origin)
      const x = metrics.bounds.x + (xn / 1000) * metrics.width
      const y = metrics.bounds.y + (yn / 1000) * metrics.height
      void shotWidth
      void shotHeight
      const times = action.action === 'double_click' ? 2 : 1
      const r = await clickAt(x, y, 'left', times)
      // Give Facebook/web composers time to focus after click
      await sleep(times === 2 ? 450 : 280)
      return { ok: r.ok, detail: `${r.message}${action.reason ? ` — ${action.reason}` : ''}` }
    }
    case 'type': {
      // Ensure frontmost app keeps keyboard focus before paste
      await sleep(120)
      const r = await typeText(action.text || '')
      return { ok: r.ok, detail: r.message }
    }
    case 'hotkey': {
      // Model may still emit macOS "command" — input-control maps command→Ctrl on Windows
      const r = await hotkey(action.key, action.modifiers || [])
      return { ok: r.ok, detail: r.message }
    }
    case 'press': {
      const r = await pressKey(action.key)
      return { ok: r.ok, detail: r.message }
    }
    case 'wait': {
      await sleep(Math.min(5000, Math.max(200, action.ms || 800)))
      return { ok: true, detail: `waited ${action.ms || 800}ms` }
    }
    case 'done':
      return { ok: true, detail: action.summary }
    case 'fail':
      return { ok: false, detail: action.summary }
    default:
      return { ok: false, detail: 'unknown action' }
  }
}

/**
 * Screen-aware task runner: see screen → act → verify loop → notify completion.
 */
export async function runComputerTask(
  goal: string,
  win: BrowserWindow | null,
): Promise<TaskResult> {
  const taskId = crypto.randomUUID()
  const settings = getSettings()
  const apiKey = settings.geminiApiKey?.trim()
  const model = settings.model || 'gemini-3.8-flash'
  const maxSteps = /facebook|ফেসবুক|post/i.test(goal) ? 18 : 14
  const steps: string[] = []

  if (!goal.trim()) {
    return { ok: false, taskId, message: 'টাস্ক খালি। কী করতে হবে বলো।', steps, completed: false }
  }
  if (!apiKey) {
    return {
      ok: false,
      taskId,
      message: 'Gemini API key লাগবে (Settings) — স্ক্রিন দেখে কাজ করতে vision দরকার।',
      steps,
      completed: false,
    }
  }

  // Hide Jarvis so it doesn't cover the target UI
  const wasVisible = win?.isVisible() ?? false
  const wasMinimized = win?.isMinimized() ?? false
  try {
    if (win && !win.isDestroyed()) {
      win.minimize()
      await sleep(450)
    }

    emitProgress(win, {
      taskId,
      status: 'running',
      step: 0,
      maxSteps,
      detail: `টাস্ক শুরু: ${goal}`,
    })

    for (let step = 1; step <= maxSteps; step += 1) {
      const shot = await captureScreen()
      if (!shot.ok || !shot.base64) {
        const message = shot.message || 'Screen capture failed'
        emitProgress(win, {
          taskId,
          status: 'failed',
          step,
          maxSteps,
          detail: message,
        })
        return { ok: false, taskId, message, steps, completed: false }
      }

      emitProgress(win, {
        taskId,
        status: 'running',
        step,
        maxSteps,
        action: 'see_screen',
        detail: `স্ক্রিন দেখছি… (ধাপ ${step}/${maxSteps})`,
      })

      const decision = await decideNextAction({
        apiKey,
        model,
        goal,
        history: steps,
        screenshotBase64: shot.base64,
        mimeType: shot.mimeType || 'image/png',
        width: shot.width || 1280,
        height: shot.height || 800,
      })

      if (decision.action === 'done') {
        const summary = decision.summary || 'টাস্ক সম্পন্ন।'
        steps.push(`done: ${summary}`)
        emitProgress(win, {
          taskId,
          status: 'completed',
          step,
          maxSteps,
          action: 'done',
          detail: summary,
        })
        return {
          ok: true,
          taskId,
          message: `✅ টাস্ক সম্পন্ন। ${summary}`,
          steps,
          completed: true,
        }
      }

      if (decision.action === 'fail') {
        const summary = decision.summary || 'ব্যর্থ'
        steps.push(`fail: ${summary}`)
        emitProgress(win, {
          taskId,
          status: 'failed',
          step,
          maxSteps,
          action: 'fail',
          detail: summary,
        })
        return { ok: false, taskId, message: `❌ ${summary}`, steps, completed: false }
      }

      const result = await runAction(decision, shot.width || 1280, shot.height || 800)
      const line = `${decision.action}: ${result.detail}`
      steps.push(line)

      emitProgress(win, {
        taskId,
        status: 'running',
        step,
        maxSteps,
        action: decision.action,
        detail: result.detail,
      })

      if (!result.ok) {
        emitProgress(win, {
          taskId,
          status: 'failed',
          step,
          maxSteps,
          detail: result.detail,
        })
        return { ok: false, taskId, message: `❌ ${result.detail}`, steps, completed: false }
      }

      await sleep(650)
    }

    const message = 'টাস্ক ধাপ শেষ — পুরোপুরি নিশ্চিত করা যায়নি। আবার চেষ্টা করো বা ছোট করে বলো।'
    emitProgress(win, {
      taskId,
      status: 'failed',
      step: maxSteps,
      maxSteps,
      detail: message,
    })
    return { ok: false, taskId, message, steps, completed: false }
  } finally {
    if (win && !win.isDestroyed() && wasVisible) {
      if (wasMinimized) {
        // leave minimized if it was
      } else {
        win.restore()
        win.show()
      }
    }
  }
}
