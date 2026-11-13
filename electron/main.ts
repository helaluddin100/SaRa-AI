import { app, BrowserWindow, ipcMain, session, shell, systemPreferences } from 'electron'
import path from 'node:path'
import { geminiGenerateContent, type GeminiGeneratePayload } from './gemini'
import { runComputerTask } from './computer-agent'
import {
  checkEmail,
  checkFacebookPageMessages,
  openWhatsApp,
  postFacebookStatus,
  sendWhatsAppMessage,
} from './integrations'
import { generateMapsLeads } from './leads'
import { speakWithKokoro, textMostlyBangla, warmupKokoro } from './kokoro-tts'
import { listLocalVoices, speakLocal, stopLocalSpeak } from './local-tts'
import { getLocalDateTime, getLocalWeather } from './local-context'
import { BANGLA_FEMALE_VOICES, speakBanglaPiper, warmupPiperBangla } from './piper-bangla'
import { closeApp, getSystemInfo, listKnownApps, openApp, openUrl } from './pc-control'
import {
  cancelTask,
  initScheduler,
  listPendingAndRecent,
  scheduleTask,
} from './scheduler'
import {
  addMemory,
  appendHistory,
  clearHistory,
  clearMemory,
  getHistory,
  getMemory,
  getSettings,
  setSettings,
  type AppSettings,
  type ChatMessage,
  type ScheduledTask,
} from './store'

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null = null
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#05070f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(process.env.DIST!, 'index.html'))
  }
}

function registerIpc() {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, partial: Partial<AppSettings>) => setSettings(partial))

  ipcMain.handle('memory:list', () => getMemory())
  ipcMain.handle('memory:add', (_e, text: string) => addMemory(text))
  ipcMain.handle('memory:clear', () => {
    clearMemory()
    return []
  })

  ipcMain.handle('history:list', () => getHistory())
  ipcMain.handle('history:append', (_e, messages: ChatMessage[]) => appendHistory(messages))
  ipcMain.handle('history:clear', () => {
    clearHistory()
    return []
  })

  ipcMain.handle('pc:openApp', (_e, name: string) => openApp(name))
  ipcMain.handle('pc:closeApp', (_e, name: string) => closeApp(name))
  ipcMain.handle('pc:openUrl', (_e, url: string) => openUrl(url))
  ipcMain.handle('pc:systemInfo', () => getSystemInfo())
  ipcMain.handle('pc:knownApps', () => listKnownApps())
  ipcMain.handle('local:datetime', () => getLocalDateTime())
  ipcMain.handle('local:weather', (_e, city?: string) => getLocalWeather(city))

  ipcMain.handle('integrations:openWhatsApp', () => openWhatsApp())
  ipcMain.handle(
    'integrations:sendWhatsApp',
    async (_e, payload: { contactOrPhone: string; message: string }) => {
      // Screen-aware agent (sees display, completes task, reports back)
      const vision = await runComputerTask(
        `Open WhatsApp Desktop on this Mac. Find the chat/contact named "${payload.contactOrPhone}". Open that chat. Type this exact message and SEND it: ${payload.message}. When the message is clearly sent, finish.`,
        win,
      )
      if (vision.ok) return { ok: true, message: vision.message, steps: vision.steps }
      // Fallback: keyboard-only automation without vision
      const fallback = await sendWhatsAppMessage(
        getSettings(),
        payload.contactOrPhone,
        payload.message,
      )
      return {
        ok: fallback.ok,
        message: fallback.ok
          ? fallback.message
          : `${vision.message} | fallback: ${fallback.message}`,
        steps: vision.steps,
      }
    },
  )
  ipcMain.handle('integrations:checkEmail', async () => {
    const vision = await runComputerTask(
      'Open Gmail in the already-logged-in browser (Chrome preferred). Look at the inbox on screen and summarize any important/unread emails. Then finish with the summary.',
      win,
    )
    if (vision.ok) return { ok: true, message: vision.message, steps: vision.steps }
    const fallback = await checkEmail(getSettings())
    return { ...fallback, steps: vision.steps }
  })
  ipcMain.handle('integrations:checkFacebook', async () => {
    const vision = await runComputerTask(
      'Open the already-logged-in Chrome/Safari Facebook Page inbox (business.facebook.com/latest/inbox or the Page inbox). Look at the screen and summarize recent/unread page messages. Then finish.',
      win,
    )
    if (vision.ok) return { ok: true, message: vision.message, steps: vision.steps }
    const fallback = await checkFacebookPageMessages(getSettings())
    return { ...fallback, steps: vision.steps }
  })
  ipcMain.handle('integrations:postFacebook', async (_e, text: string) => {
    const body = String(text || '').trim()
    // Deterministic Chrome DOM path first (composer focus is fragile for vision clicks)
    const direct = await postFacebookStatus(body)
    if (direct.ok) return { ...direct, steps: ['dom:postFacebookStatus'] }

    const vision = await runComputerTask(
      `Open Facebook in the already-logged-in Chrome browser at https://www.facebook.com/. ` +
        `Click the "What's on your mind?" / create post composer, wait until the textbox is focused, ` +
        `type this EXACT post text, then click the Post button and confirm it published: ${body}`,
      win,
    )
    if (vision.ok) return { ok: true, message: vision.message, steps: vision.steps }
    return {
      ok: false,
      message: `${direct.message} | vision: ${vision.message}`,
      steps: vision.steps,
    }
  })

  ipcMain.handle('agent:runTask', async (_e, goal: string) => runComputerTask(String(goal || ''), win))

  ipcMain.handle(
    'leads:generateMaps',
    async (
      _e,
      payload: { query: string; location?: string; maxResults?: number },
    ) => generateMapsLeads(payload || { query: '' }, win),
  )

  ipcMain.handle(
    'scheduler:create',
    (
      _e,
      payload: {
        title: string
        goal: string
        delayMinutes?: number
        delaySeconds?: number
        kind?: ScheduledTask['kind']
        payload?: Record<string, unknown>
      },
    ) => scheduleTask(payload),
  )
  ipcMain.handle('scheduler:list', () => listPendingAndRecent())
  ipcMain.handle('scheduler:cancel', (_e, id: string) => cancelTask(String(id || '')))

  ipcMain.handle('mic:ensurePermission', async () => {
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('microphone')
      if (status === 'granted') return true
      return systemPreferences.askForMediaAccess('microphone')
    }
    return true
  })

  ipcMain.handle('screen:ensurePermission', async () => {
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('screen')
      if (status !== 'granted') {
        // Opens Screen Recording pane; user must toggle Electron/Jarvis
        await shell.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
        )
      }
      return status === 'granted'
    }
    return true
  })

  ipcMain.handle('app:platform', () => process.platform)

  ipcMain.handle('gemini:generate', async (_e, payload: GeminiGeneratePayload) => {
    const started = Date.now()
    const result = await geminiGenerateContent(payload)
    console.log(
      `[gemini] model=${payload.model} ok=${result.ok} status=${'status' in result ? result.status : 200} ms=${Date.now() - started}`,
    )
    if (!result.ok) console.error('[gemini] error:', result.error.slice(0, 500))
    return result
  })

  ipcMain.handle('tts:listVoices', () => listLocalVoices())
  ipcMain.handle(
    'tts:speak',
    async (
      _e,
      payload: {
        text: string
        voiceId?: string
        rate?: number
        pitch?: number
        engine?: 'auto' | 'kokoro' | 'piper-bn' | 'system'
      },
    ) => {
      const engine = payload.engine || 'auto'
      const banglaVoice = Boolean(payload.voiceId?.startsWith('bn_f_'))
      const useBangla =
        engine === 'piper-bn' ||
        banglaVoice ||
        (engine === 'auto' && textMostlyBangla(payload.text))

      if (useBangla) {
        const bn = await speakBanglaPiper({
          text: payload.text,
          voiceId: payload.voiceId,
          rate: payload.rate,
          pitch: payload.pitch ?? 1.08,
        })
        if (bn.ok || engine === 'piper-bn' || banglaVoice) return bn
        // fallback Piya
        return speakLocal({ ...payload, voiceId: 'Piya' })
      }

      if (engine === 'kokoro' || engine === 'auto') {
        const neural = await speakWithKokoro({
          text: payload.text,
          voiceId: payload.voiceId,
          speed: payload.rate ?? 1,
          pitch: payload.pitch ?? 1.08,
        })
        if (neural.ok || engine === 'kokoro') return neural
      }

      return speakLocal(payload)
    },
  )
  ipcMain.handle('tts:stop', () => {
    stopLocalSpeak()
    return true
  })
  ipcMain.handle('tts:kokoroVoices', () => {
    return [
      { id: 'af_heart', label: 'Heart — natural US female', engine: 'kokoro' },
      { id: 'af_bella', label: 'Bella — warm US female', engine: 'kokoro' },
      { id: 'af_nicole', label: 'Nicole — clear US female', engine: 'kokoro' },
      { id: 'af_sarah', label: 'Sarah — soft US female', engine: 'kokoro' },
      { id: 'bf_emma', label: 'Emma — British female', engine: 'kokoro' },
    ]
  })
  ipcMain.handle('tts:banglaVoices', () =>
    BANGLA_FEMALE_VOICES.map((v) => ({
      id: v.id,
      label: v.label,
      engine: 'piper-bn',
      speakerId: v.speakerId,
    })),
  )
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  if (process.platform === 'darwin') {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone')
    if (micStatus !== 'granted') {
      await systemPreferences.askForMediaAccess('microphone')
    }
  }

  registerIpc()
  createWindow()
  // Local neural voices (download once, then offline)
  warmupKokoro()
  warmupPiperBangla()

  initScheduler({
    getWindow: () => win,
    runHandler: async (task) => {
      if (task.kind === 'leads') {
        const query = String(task.payload?.query || task.goal || '')
        const location = task.payload?.location ? String(task.payload.location) : undefined
        const maxResults = task.payload?.maxResults
          ? Number(task.payload.maxResults)
          : undefined
        return generateMapsLeads({ query, location, maxResults }, win)
      }
      if (task.kind === 'whatsapp') {
        const contact = String(task.payload?.contact || '')
        const message = String(task.payload?.message || task.goal || '')
        const vision = await runComputerTask(
          `Open WhatsApp Desktop. Find contact "${contact}". Open chat. Type and SEND: ${message}. Confirm sent.`,
          win,
        )
        if (vision.ok) return { ok: true, message: vision.message }
        return sendWhatsAppMessage(getSettings(), contact, message)
      }
      if (task.kind === 'facebook_post') {
        const text = String(task.payload?.text || task.goal || '')
        const direct = await postFacebookStatus(text)
        if (direct.ok) return direct
        return runComputerTask(
          `Open Facebook, create a post with this exact text and publish: ${text}`,
          win,
        )
      }
      // Default: screen agent completes the natural-language goal
      return runComputerTask(task.goal, win)
    },
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
