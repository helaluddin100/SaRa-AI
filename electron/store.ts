import Store from 'electron-store'

export type MemoryFact = {
  id: string
  text: string
  createdAt: string
}

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
  at: string
}

export type AppSettings = {
  geminiApiKey: string
  model: string
  voiceEnabled: boolean
  userName: string
  voiceName: string
  /** name -> phone (E.164 without + preferred, e.g. 88017...) */
  whatsappContacts: Record<string, string>
  gmailUser: string
  /** Google App Password (not normal password) */
  gmailAppPassword: string
  facebookPageId: string
  facebookPageToken: string
}

export type ScheduledTask = {
  id: string
  title: string
  goal: string
  kind: 'computer_task' | 'whatsapp' | 'facebook_post' | 'leads' | 'custom'
  payload?: Record<string, unknown>
  runAt: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
  createdAt: string
  finishedAt?: string
  resultMessage?: string
}

export type AppData = {
  settings: AppSettings
  memory: MemoryFact[]
  history: ChatMessage[]
  scheduledTasks: ScheduledTask[]
}

const defaults: AppData = {
  settings: {
    geminiApiKey: '',
    model: 'gemini-3.8-flash',
    voiceEnabled: true,
    userName: '',
    voiceName: 'bn_f_10',
    whatsappContacts: {},
    gmailUser: '',
    gmailAppPassword: '',
    facebookPageId: '',
    facebookPageToken: '',
  },
  memory: [],
  history: [],
  scheduledTasks: [],
}

const RETIRED_CHAT_MODELS = new Set([
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
])

const LEGACY_VOICE_NAMES = new Set([
  'Kore',
  'Aoede',
  'Leda',
  'Zephyr',
  'Autonoe',
  'Callirrhoe',
  'Piya',
  'Samantha',
])

export const store = new Store<AppData>({
  name: 'jarvis-desktop',
  defaults,
})

export function getSettings(): AppSettings {
  const raw = store.get('settings') as AppSettings & {
    openaiApiKey?: string
    ttsModel?: string
  }

  const model =
    !raw.model || raw.model.startsWith('gpt') || RETIRED_CHAT_MODELS.has(raw.model)
      ? defaults.settings.model
      : raw.model

  let voiceName = raw.voiceName || defaults.settings.voiceName
  if (LEGACY_VOICE_NAMES.has(voiceName)) {
    voiceName = defaults.settings.voiceName
  } else if (
    !voiceName.startsWith('bn_f_') &&
    !voiceName.startsWith('af_') &&
    !voiceName.startsWith('bf_')
  ) {
    voiceName = defaults.settings.voiceName
  }

  return {
    geminiApiKey: raw.geminiApiKey ?? '',
    model,
    voiceEnabled: raw.voiceEnabled ?? true,
    userName: raw.userName ?? '',
    voiceName,
    whatsappContacts: raw.whatsappContacts || {},
    gmailUser: raw.gmailUser || '',
    gmailAppPassword: raw.gmailAppPassword || '',
    facebookPageId: raw.facebookPageId || '',
    facebookPageToken: raw.facebookPageToken || '',
  }
}

export function setSettings(partial: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...partial }
  store.set('settings', next)
  return next
}

export function getMemory(): MemoryFact[] {
  return store.get('memory')
}

export function addMemory(text: string): MemoryFact {
  const fact: MemoryFact = {
    id: crypto.randomUUID(),
    text: text.trim(),
    createdAt: new Date().toISOString(),
  }
  const memory = [...getMemory(), fact].slice(-50)
  store.set('memory', memory)
  return fact
}

export function clearMemory(): void {
  store.set('memory', [])
}

export function getHistory(): ChatMessage[] {
  return store.get('history')
}

export function appendHistory(messages: ChatMessage[]): ChatMessage[] {
  const history = [...getHistory(), ...messages].slice(-40)
  store.set('history', history)
  return history
}

export function clearHistory(): void {
  store.set('history', [])
}

export function getScheduledTasks(): ScheduledTask[] {
  return (store.get('scheduledTasks') as ScheduledTask[] | undefined) || []
}

export function upsertScheduledTask(task: ScheduledTask): ScheduledTask[] {
  const list = getScheduledTasks()
  const idx = list.findIndex((t) => t.id === task.id)
  const next =
    idx >= 0
      ? list.map((t, i) => (i === idx ? task : t))
      : [...list, task]
  // Keep last 80 jobs
  const trimmed = next.slice(-80)
  store.set('scheduledTasks', trimmed)
  return trimmed
}

export function cancelScheduledTask(id: string): ScheduledTask[] {
  const next = getScheduledTasks().map((t) =>
    t.id === id && t.status === 'pending'
      ? { ...t, status: 'cancelled' as const, finishedAt: new Date().toISOString() }
      : t,
  )
  store.set('scheduledTasks', next)
  return next
}
