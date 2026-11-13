export type SystemMetrics = {
  cpuPercent: number
  memPercent: number
  usedMemGB: number
  totalMemGB: number
  freeMemGB: number
  cpus: number
  load1: number
}

export type ScheduleItem = {
  id: string
  title: string
  goal: string
  kind: string
  runAt: string
  status: string
}

type Props = {
  metrics: SystemMetrics | null
  schedules: ScheduleItem[]
  nowMs: number
  onCancel: (id: string) => void
}

function formatCountdown(runAt: string, nowMs: number): string {
  const ms = new Date(runAt).getTime() - nowMs
  if (ms <= 0) return 'এখন'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  if (min < 60) return `${min}m ${rem}s`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

function Meter({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: number
  detail: string
  tone: 'cyan' | 'violet' | 'amber'
}) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div className={`meter meter-${tone}`}>
      <div className="meter-head">
        <span>{label}</span>
        <strong>{clamped.toFixed(clamped >= 10 ? 0 : 1)}%</strong>
      </div>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${clamped}%` }} />
      </div>
      <div className="meter-detail">{detail}</div>
    </div>
  )
}

export function SystemMonitor({ metrics, schedules, nowMs, onCancel }: Props) {
  const active = schedules
    .filter((t) => t.status === 'pending' || t.status === 'running')
    .sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime())

  return (
    <div className="system-monitor">
      <div className="monitor-block">
        <div className="monitor-title">Live system</div>
        {metrics ? (
          <div className="meter-grid">
            <Meter
              label="CPU"
              value={metrics.cpuPercent}
              detail={`${metrics.cpus} cores · load ${metrics.load1}`}
              tone="cyan"
            />
            <Meter
              label="RAM"
              value={metrics.memPercent}
              detail={`${metrics.usedMemGB} / ${metrics.totalMemGB} GB · free ${metrics.freeMemGB} GB`}
              tone="violet"
            />
          </div>
        ) : (
          <div className="monitor-empty">Reading sensors…</div>
        )}
      </div>

      <div className="monitor-block">
        <div className="monitor-title">
          Schedules
          <span className="monitor-count">{active.length}</span>
        </div>
        {active.length === 0 ? (
          <div className="monitor-empty">কোনো pending schedule নেই</div>
        ) : (
          <ul className="schedule-list">
            {active.map((t) => (
              <li key={t.id} className={`schedule-row ${t.status}`}>
                <div className="schedule-main">
                  <div className="schedule-top">
                    <span className={`sched-pill ${t.status}`}>{t.status}</span>
                    <span className="schedule-eta">{formatCountdown(t.runAt, nowMs)}</span>
                  </div>
                  <div className="schedule-title">{t.title}</div>
                  <div className="schedule-meta">
                    {t.kind} · {new Date(t.runAt).toLocaleTimeString()}
                  </div>
                  <div className="schedule-goal" title={t.goal}>
                    {t.goal}
                  </div>
                </div>
                {t.status === 'pending' ? (
                  <button type="button" className="sched-cancel" onClick={() => onCancel(t.id)}>
                    Cancel
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
