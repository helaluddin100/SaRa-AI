import { SystemMonitor, type ScheduleItem, type SystemMetrics } from './SystemMonitor'

type Props = {
  status: 'idle' | 'listening' | 'thinking' | 'speaking' | 'working'
  userName: string
  platformLabel: string
  metrics: SystemMetrics | null
  schedules: ScheduleItem[]
  nowMs: number
  onCancelSchedule: (id: string) => void
}

const STATUS_LABEL: Record<Props['status'], string> = {
  idle: 'Standby',
  listening: 'Listening',
  thinking: 'Processing',
  speaking: 'Speaking',
  working: 'On task',
}

export function CorePanel({
  status,
  userName,
  platformLabel,
  metrics,
  schedules,
  nowMs,
  onCancelSchedule,
}: Props) {
  return (
    <section className="core-panel">
      <div className="core-hero">
        <div className="orb-wrap">
          <div className="orb-ring" />
          <div className={`orb ${status}`} />
        </div>
        <div className="core-meta">
          <div>
            <h1>ARIA</h1>
            <p>
              {userName ? `${userName}-এর সঙ্গী` : 'Emotional desktop companion'} · {platformLabel}
            </p>
          </div>
          <div className="status-pill">{STATUS_LABEL[status]}</div>
        </div>
      </div>

      <SystemMonitor
        metrics={metrics}
        schedules={schedules}
        nowMs={nowMs}
        onCancel={onCancelSchedule}
      />
    </section>
  )
}
