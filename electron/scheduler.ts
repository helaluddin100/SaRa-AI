import { BrowserWindow } from 'electron'
import {
  cancelScheduledTask as cancelInStore,
  getScheduledTasks,
  upsertScheduledTask,
  type ScheduledTask,
} from './store'

type ScheduleInput = {
  title: string
  goal: string
  delayMinutes?: number
  delaySeconds?: number
  kind?: ScheduledTask['kind']
  payload?: Record<string, unknown>
}

type RunHandler = (task: ScheduledTask) => Promise<{ ok: boolean; message: string }>

const timers = new Map<string, NodeJS.Timeout>()
let runHandler: RunHandler | null = null
let getWindow: (() => BrowserWindow | null) | null = null

function emit(event: string, payload: unknown) {
  const win = getWindow?.()
  try {
    win?.webContents.send(event, payload)
  } catch {
    // ignore
  }
}

function clearTimer(id: string) {
  const t = timers.get(id)
  if (t) {
    clearTimeout(t)
    timers.delete(id)
  }
}

async function fireTask(task: ScheduledTask) {
  clearTimer(task.id)
  const running: ScheduledTask = {
    ...task,
    status: 'running',
  }
  upsertScheduledTask(running)
  emit('scheduler:updated', listPendingAndRecent())
  emit('scheduler:running', running)

  try {
    if (!runHandler) throw new Error('Scheduler runner not ready')
    const result = await runHandler(running)
    const done: ScheduledTask = {
      ...running,
      status: result.ok ? 'done' : 'failed',
      resultMessage: result.message,
      finishedAt: new Date().toISOString(),
    }
    upsertScheduledTask(done)
    emit('scheduler:finished', done)
    emit('scheduler:updated', listPendingAndRecent())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failed: ScheduledTask = {
      ...running,
      status: 'failed',
      resultMessage: message,
      finishedAt: new Date().toISOString(),
    }
    upsertScheduledTask(failed)
    emit('scheduler:finished', failed)
    emit('scheduler:updated', listPendingAndRecent())
  }
}

function armTask(task: ScheduledTask) {
  clearTimer(task.id)
  if (task.status !== 'pending') return
  const runAt = new Date(task.runAt).getTime()
  const delay = Math.max(0, runAt - Date.now())
  const timer = setTimeout(() => {
    void fireTask(task)
  }, delay)
  timers.set(task.id, timer)
}

export function listPendingAndRecent(): ScheduledTask[] {
  const all = getScheduledTasks()
  const pending = all.filter((t) => t.status === 'pending' || t.status === 'running')
  const recent = all
    .filter((t) => t.status === 'done' || t.status === 'failed')
    .slice(-8)
  return [...pending, ...recent].sort(
    (a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime(),
  )
}

export function scheduleTask(input: ScheduleInput): {
  ok: boolean
  message: string
  task?: ScheduledTask
} {
  const title = String(input.title || '').trim() || 'Scheduled task'
  const goal = String(input.goal || '').trim()
  if (!goal) return { ok: false, message: 'কী কাজ শিডিউল করব? গোল বলে দাও।' }

  const delaySecRaw =
    input.delaySeconds != null
      ? Number(input.delaySeconds)
      : input.delayMinutes != null
        ? Number(input.delayMinutes) * 60
        : NaN
  if (!Number.isFinite(delaySecRaw) || delaySecRaw < 0) {
    return { ok: false, message: 'কতক্ষণ পরে? মিনিট/সেকেন্ড বলে দাও।' }
  }
  const delaySec = Math.min(7 * 24 * 3600, Math.max(5, Math.round(delaySecRaw)))
  const runAt = new Date(Date.now() + delaySec * 1000).toISOString()

  const task: ScheduledTask = {
    id: crypto.randomUUID(),
    title,
    goal,
    kind: input.kind || 'computer_task',
    payload: input.payload || {},
    runAt,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  upsertScheduledTask(task)
  armTask(task)
  emit('scheduler:updated', listPendingAndRecent())

  const mins = Math.round(delaySec / 60)
  const when =
    delaySec < 60
      ? `${delaySec} সেকেন্ড`
      : mins < 60
        ? `${mins} মিনিট`
        : `${(mins / 60).toFixed(1)} ঘণ্টা`

  return {
    ok: true,
    task,
    message: `শিডিউল সেট: "${title}" — ${when} পরে চলবে (${new Date(runAt).toLocaleTimeString()}).`,
  }
}

export function cancelTask(id: string): { ok: boolean; message: string } {
  const task = getScheduledTasks().find((t) => t.id === id)
  if (!task) return { ok: false, message: 'শিডিউল পাওয়া যায়নি।' }
  if (task.status !== 'pending') {
    return { ok: false, message: `এই টাস্ক আর pending নেই (${task.status}).` }
  }
  clearTimer(id)
  cancelInStore(id)
  emit('scheduler:updated', listPendingAndRecent())
  return { ok: true, message: `শিডিউল বাতিল: ${task.title}` }
}

export function initScheduler(options: {
  getWindow: () => BrowserWindow | null
  runHandler: RunHandler
}) {
  getWindow = options.getWindow
  runHandler = options.runHandler

  // Restore pending timers after restart
  for (const task of getScheduledTasks()) {
    if (task.status === 'pending') {
      if (new Date(task.runAt).getTime() <= Date.now()) {
        void fireTask(task)
      } else {
        armTask(task)
      }
    } else if (task.status === 'running') {
      // App quit mid-run — mark failed so it doesn't stick
      upsertScheduledTask({
        ...task,
        status: 'failed',
        resultMessage: 'অ্যাপ রিস্টার্টের সময় টাস্ক থেমে যায় — আবার শিডিউল করো।',
        finishedAt: new Date().toISOString(),
      })
    }
  }
  emit('scheduler:updated', listPendingAndRecent())
}
