import Store from 'electron-store'

export type MemoryFact = {
  id: string
  text: string
  createdAt: string
}

/** Companion emotion memory — how the user feels + what moves them */
export type EmotionMood =
  | 'neutral'
  | 'sad'
  | 'happy'
  | 'lonely'
  | 'angry'
  | 'anxious'
  | 'affectionate'
  | 'intimate'
  | 'excited'
  | 'tired'

export type EmotionMemory = {
  currentMood: EmotionMood
  intensity: number
  lastNote: string
  updatedAt: string
  likes: string[]
  dislikes: string[]
  joyTriggers: string[]
  sadnessTriggers: string[]
  nightMoodNotes: string[]
  intimatePreferences: string[]
  history: Array<{ at: string; mood: EmotionMood; note: string }>
}

export const defaultEmotionMemory = (): EmotionMemory => ({
  currentMood: 'neutral',
  intensity: 2,
  lastNote: '',
  updatedAt: new Date().toISOString(),
  likes: [],
  dislikes: [],
  joyTriggers: [],
  sadnessTriggers: [],
  nightMoodNotes: [],
  intimatePreferences: [],
  history: [],
})

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
  /** Preset: jarvis (male default) | aria (female) */
  voiceName: string
  /** Optional English override (kokoro id or say:Daniel) */
  voiceNameEn: string
  /** Optional Bangla override (piya | bn_m_* | bn_f_*) */
  voiceNameBn: string
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
  emotionMemory: EmotionMemory
  history: ChatMessage[]
  scheduledTasks: ScheduledTask[]
}

const defaults: AppData = {
  settings: {
    geminiApiKey: '',
    model: 'gemini-3.8-flash',
    voiceEnabled: true,
    userName: '',
    voiceName: 'aria',
    voiceNameEn: '',
    voiceNameBn: '',
    whatsappContacts: {},
    gmailUser: '',
    gmailAppPassword: '',
    facebookPageId: '',
    facebookPageToken: '',
  },
  memory: [],
  emotionMemory: defaultEmotionMemory(),
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
    voiceName = 'aria'
  } else if (voiceName === 'piya' || voiceName.startsWith('bn_f_')) {
    // Old female-only default → map to Aria preset
    voiceName = 'aria'
  } else if (voiceName.startsWith('af_') || voiceName.startsWith('bf_')) {
    voiceName = 'aria'
  } else if (voiceName.startsWith('am_') || voiceName.startsWith('bm_') || voiceName === 'Daniel') {
    voiceName = 'jarvis'
  } else if (voiceName !== 'jarvis' && voiceName !== 'aria') {
    voiceName = 'aria'
  }

  return {
    geminiApiKey: raw.geminiApiKey ?? '',
    model,
    voiceEnabled: raw.voiceEnabled ?? true,
    userName: raw.userName ?? '',
    voiceName,
    voiceNameEn: raw.voiceNameEn || '',
    voiceNameBn: raw.voiceNameBn || '',
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

function normalizeEmotionList(list: unknown, max = 24): string[] {
  if (!Array.isArray(list)) return []
  return list
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(-max)
}

export function getEmotionMemory(): EmotionMemory {
  const raw = store.get('emotionMemory') as EmotionMemory | undefined
  if (!raw || typeof raw !== 'object') return defaultEmotionMemory()
  return {
    ...defaultEmotionMemory(),
    ...raw,
    likes: normalizeEmotionList(raw.likes),
    dislikes: normalizeEmotionList(raw.dislikes),
    joyTriggers: normalizeEmotionList(raw.joyTriggers),
    sadnessTriggers: normalizeEmotionList(raw.sadnessTriggers),
    nightMoodNotes: normalizeEmotionList(raw.nightMoodNotes),
    intimatePreferences: normalizeEmotionList(raw.intimatePreferences),
    history: Array.isArray(raw.history) ? raw.history.slice(-40) : [],
    intensity: Math.max(1, Math.min(5, Number(raw.intensity) || 2)),
  }
}

const VALID_MOODS = new Set([
  'neutral',
  'sad',
  'happy',
  'lonely',
  'angry',
  'anxious',
  'affectionate',
  'intimate',
  'excited',
  'tired',
])

export function setEmotionMemory(partial: Partial<EmotionMemory>): EmotionMemory {
  const cur = getEmotionMemory()
  const mood =
    partial.currentMood && VALID_MOODS.has(partial.currentMood)
      ? partial.currentMood
      : cur.currentMood
  const next: EmotionMemory = {
    ...cur,
    ...partial,
    currentMood: mood,
    likes: normalizeEmotionList(partial.likes ?? cur.likes),
    dislikes: normalizeEmotionList(partial.dislikes ?? cur.dislikes),
    joyTriggers: normalizeEmotionList(partial.joyTriggers ?? cur.joyTriggers),
    sadnessTriggers: normalizeEmotionList(partial.sadnessTriggers ?? cur.sadnessTriggers),
    nightMoodNotes: normalizeEmotionList(partial.nightMoodNotes ?? cur.nightMoodNotes),
    intimatePreferences: normalizeEmotionList(
      partial.intimatePreferences ?? cur.intimatePreferences,
    ),
    history: Array.isArray(partial.history) ? partial.history.slice(-40) : cur.history,
    intensity: Math.max(1, Math.min(5, Number(partial.intensity ?? cur.intensity) || 2)),
    updatedAt: new Date().toISOString(),
  }
  if (mood !== cur.currentMood) {
    next.history = [
      ...next.history,
      {
        at: new Date().toISOString(),
        mood,
        note: (partial.lastNote || cur.lastNote || mood).slice(0, 160),
      },
    ].slice(-40)
  }
  store.set('emotionMemory', next)
  return next
}

export function clearEmotionMemory(): EmotionMemory {
  const blank = defaultEmotionMemory()
  store.set('emotionMemory', blank)
  return blank
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
