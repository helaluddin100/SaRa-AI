import { contextBridge, ipcRenderer } from 'electron'

export type JarvisSettings = {
  geminiApiKey: string
  model: string
  voiceEnabled: boolean
  userName: string
  voiceName: string
  whatsappContacts: Record<string, string>
  gmailUser: string
  gmailAppPassword: string
  facebookPageId: string
  facebookPageToken: string
}

export type TaskProgress = {
  taskId: string
  status: 'running' | 'completed' | 'failed'
  step: number
  maxSteps: number
  action?: string
  detail: string
}

export type ScheduledTaskInfo = {
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

export type JarvisAPI = {
  getSettings: () => Promise<JarvisSettings>
  setSettings: (partial: Partial<JarvisSettings>) => Promise<JarvisSettings>
  listMemory: () => Promise<Array<{ id: string; text: string; createdAt: string }>>
  addMemory: (text: string) => Promise<{ id: string; text: string; createdAt: string }>
  clearMemory: () => Promise<[]>
  listHistory: () => Promise<Array<{ role: string; content: string; at: string }>>
  appendHistory: (
    messages: Array<{ role: string; content: string; at: string }>,
  ) => Promise<Array<{ role: string; content: string; at: string }>>
  clearHistory: () => Promise<[]>
  openApp: (name: string) => Promise<{ ok: boolean; message: string }>
  closeApp: (name: string) => Promise<{ ok: boolean; message: string }>
  openUrl: (url: string) => Promise<{ ok: boolean; message: string }>
  systemInfo: () => Promise<Record<string, unknown>>
  knownApps: () => Promise<string[]>
  ensureMicPermission: () => Promise<boolean>
  ensureScreenPermission: () => Promise<boolean>
  platform: () => Promise<string>
  geminiGenerate: (payload: {
    apiKey: string
    model: string
    body: Record<string, unknown>
  }) => Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }>
  listLocalVoices: () => Promise<
    Array<{ id: string; name: string; lang: string; gender: 'female' | 'male' | 'unknown' }>
  >
  speakLocal: (payload: {
    text: string
    voiceId?: string
    rate?: number
    engine?: 'auto' | 'kokoro' | 'piper-bn' | 'system'
  }) => Promise<{ ok: boolean; message?: string }>
  stopLocalSpeak: () => Promise<boolean>
  listKokoroVoices: () => Promise<Array<{ id: string; label: string; engine: string }>>
  listBanglaVoices: () => Promise<
    Array<{ id: string; label: string; engine: string; speakerId: number }>
  >
  openWhatsApp: () => Promise<{ ok: boolean; message: string }>
  sendWhatsApp: (payload: {
    contactOrPhone: string
    message: string
  }) => Promise<{ ok: boolean; message: string; steps?: string[] }>
  checkEmail: () => Promise<{ ok: boolean; message: string; unread?: number; steps?: string[] }>
  checkFacebook: () => Promise<{ ok: boolean; message: string; steps?: string[] }>
  postFacebook: (text: string) => Promise<{ ok: boolean; message: string; steps?: string[] }>
  runComputerTask: (
    goal: string,
  ) => Promise<{ ok: boolean; taskId: string; message: string; steps: string[]; completed: boolean }>
  generateMapsLeads: (payload: {
    query: string
    location?: string
    maxResults?: number
  }) => Promise<{
    ok: boolean
    message: string
    count?: number
    filePath?: string
  }>
  scheduleTask: (payload: {
    title: string
    goal: string
    delayMinutes?: number
    delaySeconds?: number
    kind?: ScheduledTaskInfo['kind']
    payload?: Record<string, unknown>
  }) => Promise<{ ok: boolean; message: string; task?: ScheduledTaskInfo }>
  listScheduledTasks: () => Promise<ScheduledTaskInfo[]>
  cancelScheduledTask: (id: string) => Promise<{ ok: boolean; message: string }>
  onTaskProgress: (cb: (progress: TaskProgress) => void) => () => void
  onSchedulerUpdated: (cb: (tasks: ScheduledTaskInfo[]) => void) => () => void
  onSchedulerFinished: (cb: (task: ScheduledTaskInfo) => void) => () => void
}

const api: JarvisAPI = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  listMemory: () => ipcRenderer.invoke('memory:list'),
  addMemory: (text) => ipcRenderer.invoke('memory:add', text),
  clearMemory: () => ipcRenderer.invoke('memory:clear'),
  listHistory: () => ipcRenderer.invoke('history:list'),
  appendHistory: (messages) => ipcRenderer.invoke('history:append', messages),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  openApp: (name) => ipcRenderer.invoke('pc:openApp', name),
  closeApp: (name) => ipcRenderer.invoke('pc:closeApp', name),
  openUrl: (url) => ipcRenderer.invoke('pc:openUrl', url),
  systemInfo: () => ipcRenderer.invoke('pc:systemInfo'),
  knownApps: () => ipcRenderer.invoke('pc:knownApps'),
  ensureMicPermission: () => ipcRenderer.invoke('mic:ensurePermission'),
  ensureScreenPermission: () => ipcRenderer.invoke('screen:ensurePermission'),
  platform: () => ipcRenderer.invoke('app:platform'),
  geminiGenerate: (payload) => ipcRenderer.invoke('gemini:generate', payload),
  listLocalVoices: () => ipcRenderer.invoke('tts:listVoices'),
  speakLocal: (payload) => ipcRenderer.invoke('tts:speak', payload),
  stopLocalSpeak: () => ipcRenderer.invoke('tts:stop'),
  listKokoroVoices: () => ipcRenderer.invoke('tts:kokoroVoices'),
  listBanglaVoices: () => ipcRenderer.invoke('tts:banglaVoices'),
  openWhatsApp: () => ipcRenderer.invoke('integrations:openWhatsApp'),
  sendWhatsApp: (payload) => ipcRenderer.invoke('integrations:sendWhatsApp', payload),
  checkEmail: () => ipcRenderer.invoke('integrations:checkEmail'),
  checkFacebook: () => ipcRenderer.invoke('integrations:checkFacebook'),
  postFacebook: (text) => ipcRenderer.invoke('integrations:postFacebook', text),
  runComputerTask: (goal) => ipcRenderer.invoke('agent:runTask', goal),
  generateMapsLeads: (payload) => ipcRenderer.invoke('leads:generateMaps', payload),
  scheduleTask: (payload) => ipcRenderer.invoke('scheduler:create', payload),
  listScheduledTasks: () => ipcRenderer.invoke('scheduler:list'),
  cancelScheduledTask: (id) => ipcRenderer.invoke('scheduler:cancel', id),
  onTaskProgress: (cb) => {
    const handler = (_event: unknown, progress: TaskProgress) => cb(progress)
    ipcRenderer.on('agent:taskProgress', handler)
    return () => ipcRenderer.removeListener('agent:taskProgress', handler)
  },
  onSchedulerUpdated: (cb) => {
    const handler = (_event: unknown, tasks: ScheduledTaskInfo[]) => cb(tasks)
    ipcRenderer.on('scheduler:updated', handler)
    return () => ipcRenderer.removeListener('scheduler:updated', handler)
  },
  onSchedulerFinished: (cb) => {
    const handler = (_event: unknown, task: ScheduledTaskInfo) => cb(task)
    ipcRenderer.on('scheduler:finished', handler)
    return () => ipcRenderer.removeListener('scheduler:finished', handler)
  },
}

contextBridge.exposeInMainWorld('jarvis', api)
