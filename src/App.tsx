import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { CorePanel } from './components/CorePanel'
import { SettingsModal } from './components/SettingsModal'
import { askJarvis } from './lib/ai'
import { JARVIS_CHARACTER, type UiMessage } from './lib/character'
import { formatGeminiError } from './lib/errors'
import { inferVoiceStyle } from './lib/voices'
import {
  speak,
  startMicCapture,
  stopSpeaking,
  transcribeWithGemini,
  type MicSession,
} from './lib/voice'

type Settings = {
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

type Status = 'idle' | 'listening' | 'thinking' | 'speaking' | 'working'

type TaskProgress = {
  taskId: string
  status: 'running' | 'completed' | 'failed'
  step: number
  maxSteps: number
  action?: string
  detail: string
}

type ScheduledTaskInfo = {
  id: string
  title: string
  goal: string
  kind: string
  runAt: string
  status: string
  resultMessage?: string
}

function uid() {
  return crypto.randomUUID()
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [platform, setPlatform] = useState('')
  const [partial, setPartial] = useState('')
  const [taskProgress, setTaskProgress] = useState<TaskProgress | null>(null)
  const [scheduled, setScheduled] = useState<ScheduledTaskInfo[]>([])
  const [metrics, setMetrics] = useState<{
    cpuPercent: number
    memPercent: number
    usedMemGB: number
    totalMemGB: number
    freeMemGB: number
    cpus: number
    load1: number
  } | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const listRef = useRef<HTMLDivElement>(null)
  const listeningRef = useRef(false)
  const micSessionRef = useRef<MicSession | null>(null)
  const settingsRef = useRef<Settings | null>(null)

  const platformLabel = useMemo(() => {
    if (platform === 'darwin') return 'macOS'
    if (platform === 'win32') return 'Windows'
    return platform || 'Desktop'
  }, [platform])

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    let alive = true
    async function tickMetrics() {
      try {
        const info = await window.jarvis.systemInfo()
        if (!alive) return
        setMetrics({
          cpuPercent: Number(info.cpuPercent ?? 0),
          memPercent: Number(info.memPercent ?? 0),
          usedMemGB: Number(info.usedMemGB ?? 0),
          totalMemGB: Number(info.totalMemGB ?? 0),
          freeMemGB: Number(info.freeMemGB ?? 0),
          cpus: Number(info.cpus ?? 0),
          load1: Number(info.load1 ?? 0),
        })
      } catch {
        // ignore transient IPC errors
      }
    }
    void tickMetrics()
    const metricsTimer = window.setInterval(() => void tickMetrics(), 1500)
    const clockTimer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => {
      alive = false
      window.clearInterval(metricsTimer)
      window.clearInterval(clockTimer)
    }
  }, [])

  useEffect(() => {
    async function boot() {
      const [s, history, plat, tasks] = await Promise.all([
        window.jarvis.getSettings(),
        window.jarvis.listHistory(),
        window.jarvis.platform(),
        window.jarvis.listScheduledTasks(),
      ])
      setSettings(s)
      setPlatform(plat)
      setScheduled(tasks)

      if (history.length === 0) {
        const greeting: UiMessage = {
          id: uid(),
          role: 'assistant',
          content: JARVIS_CHARACTER.greeting(s.userName),
          at: new Date().toISOString(),
        }
        setMessages([greeting])
        await window.jarvis.appendHistory([
          { role: 'assistant', content: greeting.content, at: greeting.at },
        ])
      } else {
        setMessages(
          history.map((h) => ({
            id: uid(),
            role: h.role as UiMessage['role'],
            content: h.content,
            at: h.at,
          })),
        )
      }

      if (!s.geminiApiKey) setShowSettings(true)
    }

    boot().catch((err) => setError(String(err)))
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, partial, status, taskProgress])

  useEffect(() => {
    const off = window.jarvis.onTaskProgress((progress) => {
      setTaskProgress(progress)
      if (progress.status === 'running') setStatus('working')
      if (progress.status === 'completed' || progress.status === 'failed') {
        // keep banner briefly; handleSend finally resets status
        window.setTimeout(() => {
          setTaskProgress((cur) => (cur?.taskId === progress.taskId ? null : cur))
        }, 4000)
      }
    })
    return off
  }, [])

  useEffect(() => {
    const offUpdated = window.jarvis.onSchedulerUpdated((tasks) => setScheduled(tasks))
    const offFinished = window.jarvis.onSchedulerFinished((task) => {
      const ok = task.status === 'done'
      const text = ok
        ? `শিডিউল শেষ: ${task.title}। ${task.resultMessage || 'কাজ সম্পন্ন।'}`
        : `শিডিউল ব্যর্থ: ${task.title}। ${task.resultMessage || ''}`
      const assistantMsg: UiMessage = {
        id: uid(),
        role: 'assistant',
        content: text,
        at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, assistantMsg])
      void window.jarvis.appendHistory([
        { role: 'assistant', content: assistantMsg.content, at: assistantMsg.at },
      ])
      const s = settingsRef.current
      if (s?.voiceEnabled) {
        setStatus('speaking')
        void speak({
          text,
          enabled: true,
          voiceName: s.voiceName,
          voiceStyle: ok ? 'warm satisfied update' : 'gentle apologetic',
        }).finally(() => setStatus('idle'))
      }
    })
    return () => {
      offUpdated()
      offFinished()
    }
  }, [])

  async function handleSend(text?: string) {
    if (!settings) return
    const content = (text ?? input).trim()
    if (!content || status === 'thinking' || status === 'working') return

    setError('')
    setInput('')
    setPartial('')
    setTaskProgress(null)
    stopSpeaking()
    void window.jarvis.ensureScreenPermission()

    const userMsg: UiMessage = {
      id: uid(),
      role: 'user',
      content,
      at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])
    setStatus('thinking')

    try {
      const history = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

      const reply = await askJarvis({
        apiKey: settings.geminiApiKey,
        model: settings.model,
        userName: settings.userName,
        userText: content,
        history,
      })

      const assistantMsg: UiMessage = {
        id: uid(),
        role: 'assistant',
        content: reply.text,
        at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, assistantMsg])
      await window.jarvis.appendHistory([
        { role: 'user', content: userMsg.content, at: userMsg.at },
        { role: 'assistant', content: assistantMsg.content, at: assistantMsg.at },
      ])

      if (settings.voiceEnabled) {
        setStatus('speaking')
        await speak({
          text: reply.text,
          enabled: true,
          voiceName: settings.voiceName,
          voiceStyle: reply.voiceStyle || inferVoiceStyle(reply.text),
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(formatGeminiError(message))
    } finally {
      setStatus('idle')
    }
  }

  async function toggleListen() {
    if (!settings) return
    if (status === 'thinking' || status === 'speaking') return

    // Second click: stop recording → Gemini STT → send
    if (listeningRef.current && micSessionRef.current) {
      listeningRef.current = false
      setPartial('Transcribing…')
      setStatus('thinking')
      try {
        const audio = await micSessionRef.current.stop()
        micSessionRef.current = null
        const transcript = await transcribeWithGemini({
          apiKey: settings.geminiApiKey,
          model: settings.model,
          base64: audio.base64,
          mimeType: audio.mimeType,
        })
        setPartial('')
        if (!transcript) {
          setError('Could not hear anything. Click Mic, speak, then click Mic again.')
          setStatus('idle')
          return
        }
        await handleSend(transcript)
      } catch (err) {
        micSessionRef.current = null
        setPartial('')
        setError(err instanceof Error ? err.message : String(err))
        setStatus('idle')
      }
      return
    }

    try {
      const ok = await window.jarvis.ensureMicPermission()
      if (!ok) {
        setError('Microphone permission denied. Allow mic for Electron/Jarvis in System Settings.')
        return
      }
      if (!settings.geminiApiKey.trim()) {
        setError('Gemini API key needed for voice. Open Settings.')
        setShowSettings(true)
        return
      }

      const session = await startMicCapture()
      micSessionRef.current = session
      listeningRef.current = true
      setError('')
      setPartial('Listening… click Mic again when done')
      setStatus('listening')
    } catch (err) {
      listeningRef.current = false
      micSessionRef.current = null
      const message = err instanceof Error ? err.message : String(err)
      setError(
        /Permission|NotAllowed|denied/i.test(message)
          ? 'Microphone permission denied. Allow mic in System Settings → Privacy → Microphone.'
          : message,
      )
      setStatus('idle')
    }
  }

  async function saveSettings(next: Settings) {
    const saved = await window.jarvis.setSettings(next)
    setSettings(saved)
  }

  async function clearChat() {
    await window.jarvis.clearHistory()
    const greeting: UiMessage = {
      id: uid(),
      role: 'assistant',
      content: JARVIS_CHARACTER.greeting(settings?.userName),
      at: new Date().toISOString(),
    }
    setMessages([greeting])
    await window.jarvis.appendHistory([
      { role: 'assistant', content: greeting.content, at: greeting.at },
    ])
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void handleSend()
  }

  if (!settings) {
    return (
      <div className="app">
        <div className="titlebar">
          <div className="brand">Jarvis Desktop</div>
        </div>
        <div className="stage" style={{ placeItems: 'center' }}>
          Booting core…
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="titlebar">
        <div className="brand">Jarvis Desktop · Gen 0.1</div>
        <div className="actions">
          <button className="icon-btn" type="button" onClick={() => void clearChat()}>
            Clear
          </button>
          <button className="icon-btn" type="button" onClick={() => setShowSettings(true)}>
            Settings
          </button>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {taskProgress ? (
        <div className={`task-banner ${taskProgress.status}`}>
          <strong>
            {taskProgress.status === 'completed'
              ? 'Task done'
              : taskProgress.status === 'failed'
                ? 'Task failed'
                : 'Working'}
          </strong>
          <span>
            {taskProgress.step}/{taskProgress.maxSteps}
            {taskProgress.action ? ` · ${taskProgress.action}` : ''} — {taskProgress.detail}
          </span>
        </div>
      ) : null}

      <div className="stage">
        <CorePanel
          status={status}
          userName={settings.userName}
          platformLabel={platformLabel}
          metrics={metrics}
          schedules={scheduled}
          nowMs={nowMs}
          onCancelSchedule={(id) => void window.jarvis.cancelScheduledTask(id)}
        />

        <section className="chat-panel">
          <div className="chat-header">
            <h2>Conversation</h2>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              {settings.geminiApiKey ? 'Gemini + screen agent' : 'API key needed'}
            </span>
          </div>

          <div className="messages" ref={listRef}>
            {messages.map((m) => (
              <div key={m.id} className={`bubble ${m.role}`}>
                {m.content}
              </div>
            ))}
            {partial ? <div className="bubble user">{partial}…</div> : null}
            {status === 'thinking' ? <div className="bubble system">Processing request…</div> : null}
            {status === 'working' ? (
              <div className="bubble system">স্ক্রিন দেখে টাস্ক করছি… শেষ হলে জানাব।</div>
            ) : null}
          </div>

          <form className="composer" onSubmit={onSubmit}>
            <button
              type="button"
              className={`mic-btn ${status === 'listening' ? 'active' : ''}`}
              onClick={toggleListen}
              disabled={status === 'thinking' || status === 'working'}
              title="Click to talk, click again to send"
            >
              {status === 'listening' ? 'Stop' : 'Mic'}
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Try: "Gulshan e dentist lead generate koro" / "5 min pore Joya ke message pathao"'
              rows={2}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
            />
            <button
              className="send-btn"
              type="submit"
              disabled={status === 'thinking' || status === 'working' || !input.trim()}
            >
              Send
            </button>
          </form>
        </section>
      </div>

      <div className="footer">
        <span>Aria · Bangla female neural (local) · Mic + PC control</span>
        <span>Auth later · Mac + Windows</span>
      </div>

      {showSettings ? (
        <SettingsModal
          initial={settings}
          onClose={() => setShowSettings(false)}
          onSave={saveSettings}
        />
      ) : null}
    </div>
  )
}
