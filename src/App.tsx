import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { CorePanel } from './components/CorePanel'
import { SatLinkPanel } from './components/SatLinkPanel'
import { SettingsModal } from './components/SettingsModal'
import type { DeskStatus, SpecialistId } from './lib/agents'
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
  const [activeAgentId, setActiveAgentId] = useState<SpecialistId | 'aria' | null>(null)
  const [deskStatuses, setDeskStatuses] = useState<Partial<Record<SpecialistId, DeskStatus>>>({})
  const [lastBrief, setLastBrief] = useState('')
  const [routingLabel, setRoutingLabel] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const listeningRef = useRef(false)
  const micSessionRef = useRef<MicSession | null>(null)
  const settingsRef = useRef<Settings | null>(null)
  const voiceChatRef = useRef(false)
  const busyRef = useRef(false)
  const [voiceChat, setVoiceChat] = useState(false)
  const handleSendRef = useRef<(text?: string) => Promise<void>>(async () => undefined)
  const beginListenRef = useRef<() => Promise<void>>(async () => undefined)

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

  async function processVoiceAudio(audio: {
    base64: string
    mimeType: string
  }) {
    const s = settingsRef.current
    if (!s) return
    setPartial('Transcribing…')
    setStatus('thinking')
    try {
      const transcript = await transcribeWithGemini({
        apiKey: s.geminiApiKey,
        model: s.model,
        base64: audio.base64,
        mimeType: audio.mimeType,
      })
      setPartial('')
      if (!transcript) {
        setError('কিছু শোনা যায়নি — আবার বলো।')
        setStatus('idle')
        if (voiceChatRef.current) {
          window.setTimeout(() => void beginListenRef.current(), 500)
        }
        return
      }
      await handleSendRef.current(transcript)
    } catch (err) {
      setPartial('')
      setError(err instanceof Error ? err.message : String(err))
      setStatus('idle')
      if (voiceChatRef.current) {
        window.setTimeout(() => void beginListenRef.current(), 800)
      }
    }
  }

  async function beginListenTurn() {
    const s = settingsRef.current
    if (!s || !voiceChatRef.current) return
    if (listeningRef.current) return

    try {
      const ok = await window.jarvis.ensureMicPermission()
      if (!ok) {
        setError('Microphone permission denied.')
        return
      }
      if (!s.geminiApiKey.trim()) {
        setError('Gemini API key needed for voice. Open Settings.')
        setShowSettings(true)
        return
      }

      const session = await startMicCapture({
        vad: true,
        silenceMs: 1300,
        maxMs: 25000,
      })
      micSessionRef.current = session
      listeningRef.current = true
      setError('')
      setPartial('শুনছি… থামলেই জবাব দিব (Mic = কথোপকথন বন্ধ)')
      setStatus('listening')

      // Wait until silence VAD or user stops
      const audio = await session.result
      micSessionRef.current = null
      listeningRef.current = false
      if (!voiceChatRef.current) {
        setStatus('idle')
        setPartial('')
        return
      }
      await processVoiceAudio(audio)
    } catch (err) {
      listeningRef.current = false
      micSessionRef.current = null
      const message = err instanceof Error ? err.message : String(err)
      if (!voiceChatRef.current) {
        setStatus('idle')
        setPartial('')
        return
      }
      setError(
        /Permission|NotAllowed|denied/i.test(message)
          ? 'Microphone permission denied.'
          : /No speech|Already stopped/i.test(message)
            ? ''
            : message,
      )
      setStatus('idle')
      setPartial('')
      if (voiceChatRef.current && !/Permission|NotAllowed|denied/i.test(message)) {
        window.setTimeout(() => void beginListenRef.current(), 600)
      }
    }
  }
  beginListenRef.current = () => beginListenTurn()

  async function handleSend(text?: string) {
    if (!settings) return
    const content = (text ?? input).trim()
    if (!content || busyRef.current) return
    busyRef.current = true

    setError('')
    setInput('')
    setPartial('')
    setTaskProgress(null)
    setLastBrief('')
    setRoutingLabel('Aria…')
    setActiveAgentId('aria')
    stopSpeaking()
    // Do NOT request screen permission for chat / date / weather — only specialists need it

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
        onOfficeStatus: (ev) => {
          setActiveAgentId(ev.activeAgentId)
          setDeskStatuses((prev) => ({ ...prev, ...ev.deskStatuses }))
          if (ev.lastBrief) {
            setLastBrief(ev.lastBrief)
            if (ev.activeAgentId && ev.activeAgentId !== 'aria') {
              setRoutingLabel(`Assigned → ${ev.activeAgentId}`)
              setStatus('working')
            }
          }
          if (ev.activeAgentId === 'aria') {
            setRoutingLabel('Aria…')
          }
        },
      })

      const assistantMsg: UiMessage = {
        id: uid(),
        role: 'assistant',
        content: reply.text,
        at: new Date().toISOString(),
        agentId: reply.agentId || 'aria',
        agentName: reply.agentName || 'Aria',
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
      busyRef.current = false
      setStatus('idle')
      setActiveAgentId(null)
      setRoutingLabel(voiceChatRef.current ? 'Live talk on' : '')
      setDeskStatuses({ mira: 'idle', rex: 'idle', forge: 'idle', pixel: 'idle' })
      if (voiceChatRef.current) {
        window.setTimeout(() => void beginListenRef.current(), 350)
      }
    }
  }
  handleSendRef.current = handleSend

  async function toggleListen() {
    if (!settings) return
    if (status === 'thinking' || status === 'speaking' || status === 'working') return

    // Already in live talk + listening → stop conversation
    if (voiceChatRef.current && listeningRef.current && micSessionRef.current) {
      voiceChatRef.current = false
      setVoiceChat(false)
      listeningRef.current = false
      try {
        await micSessionRef.current.stop()
      } catch {
        // ignore
      }
      micSessionRef.current = null
      setPartial('')
      setStatus('idle')
      setRoutingLabel('')
      return
    }

    // Live talk idle → stop mode
    if (voiceChatRef.current && !listeningRef.current) {
      voiceChatRef.current = false
      setVoiceChat(false)
      setPartial('')
      setRoutingLabel('')
      return
    }

    // Start continuous conversation (listen → reply → listen)
    voiceChatRef.current = true
    setVoiceChat(true)
    setRoutingLabel('Live talk on')
    await beginListenTurn()
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

  function terminateSession() {
    voiceChatRef.current = false
    setVoiceChat(false)
    busyRef.current = false
    stopSpeaking()
    if (listeningRef.current && micSessionRef.current) {
      listeningRef.current = false
      void micSessionRef.current.stop().catch(() => undefined)
      micSessionRef.current = null
    }
    setPartial('')
    setTaskProgress(null)
    setStatus('idle')
    setActiveAgentId(null)
    setRoutingLabel('')
    setDeskStatuses({ mira: 'idle', rex: 'idle', forge: 'idle', pixel: 'idle' })
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

      <div className="stage command-deck">
        <SatLinkPanel
          metricsLabel={
            metrics
              ? `CPU ${metrics.cpuPercent.toFixed(0)}% · RAM ${metrics.memPercent.toFixed(0)}%`
              : undefined
          }
        />

        <CorePanel
          status={status}
          userName={settings.userName}
          platformLabel={platformLabel}
          metrics={metrics}
          schedules={scheduled}
          nowMs={nowMs}
          onCancelSchedule={(id) => void window.jarvis.cancelScheduledTask(id)}
          activeAgentId={activeAgentId}
          deskStatuses={deskStatuses}
          lastBrief={lastBrief}
          routingLabel={routingLabel}
          onTerminate={terminateSession}
          onMic={() => void toggleListen()}
        />

        <section className="chat-panel stonic-chat">
          <div className="chat-tabs" role="tablist">
            <button
              type="button"
              className={`chat-tab ${voiceChat ? 'active' : ''}`}
              role="tab"
              onClick={() => void toggleListen()}
              title="Live voice conversation"
            >
              {voiceChat ? 'Live ●' : 'Voice'}
            </button>
            <button type="button" className="chat-tab" role="tab">
              Agent
            </button>
            <button type="button" className="chat-tab" role="tab">
              Notes
            </button>
          </div>

          <div className="chat-header">
            <h2>Aria link</h2>
            <span className="chat-link-status">
              {settings.geminiApiKey ? 'Gemini Live' : 'API key needed'}
            </span>
          </div>

          <div className="messages" ref={listRef}>
            {messages.map((m) => (
              <div key={m.id} className={`bubble ${m.role}`}>
                <div className="bubble-who">{m.role === 'user' ? 'YOU' : m.agentName || 'ARIA'}</div>
                {m.content}
              </div>
            ))}
            {partial ? <div className="bubble user"><div className="bubble-who">YOU</div>{partial}…</div> : null}
            {status === 'thinking' ? (
              <div className="bubble system">
                <div className="module-chip">Module: assign_agent · routing</div>
                Aria routing…
              </div>
            ) : null}
            {status === 'working' ? (
              <div className="bubble system">
                <div className="module-chip">
                  Module: desk_{activeAgentId && activeAgentId !== 'aria' ? activeAgentId : 'screen'}
                </div>
                {activeAgentId && activeAgentId !== 'aria'
                  ? `${activeAgentId} ডেস্কে কাজ চলছে…`
                  : 'স্ক্রিন দেখে টাস্ক করছি… শেষ হলে জানাব।'}
              </div>
            ) : null}
          </div>

          <form className="composer" onSubmit={onSubmit}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type to Assistant (Gemini Live)…"
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
              →
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
