import type { DeskStatus, SpecialistId } from '../lib/agents'
import { AgentTown } from './AgentTown'
import { OfficeFloor } from './OfficeFloor'
import { SystemMonitor, type ScheduleItem, type SystemMetrics } from './SystemMonitor'

type Props = {
  status: 'idle' | 'listening' | 'thinking' | 'speaking' | 'working'
  userName: string
  platformLabel: string
  metrics: SystemMetrics | null
  schedules: ScheduleItem[]
  nowMs: number
  onCancelSchedule: (id: string) => void
  activeAgentId: SpecialistId | 'aria' | null
  deskStatuses: Partial<Record<SpecialistId, DeskStatus>>
  lastBrief: string
  routingLabel: string
  onTerminate: () => void
  onMic: () => void
}

export function CorePanel({
  status,
  userName,
  platformLabel,
  metrics,
  schedules,
  nowMs,
  onCancelSchedule,
  activeAgentId,
  deskStatuses,
  lastBrief,
  routingLabel,
  onTerminate,
  onMic,
}: Props) {
  return (
    <section className="core-panel command-center">
      <div className="core-hero office-hero stonic-hero">
        <OfficeFloor
          userName={userName}
          managerStatus={status}
          activeAgentId={activeAgentId}
          deskStatuses={deskStatuses}
          lastBrief={lastBrief}
          routingLabel={routingLabel}
          onTerminate={onTerminate}
          onMic={onMic}
          micDisabled={status === 'thinking' || status === 'working'}
        />
        <div className="core-meta office-meta">
          <div>
            <h1>SYSTEM CORE</h1>
            <p>
              {userName ? `${userName}'s agents` : 'Multi-agent desktop'} · {platformLabel}
            </p>
          </div>
        </div>
      </div>

      <AgentTown activeAgentId={activeAgentId} deskStatuses={deskStatuses} />

      <SystemMonitor
        metrics={metrics}
        schedules={schedules}
        nowMs={nowMs}
        onCancel={onCancelSchedule}
      />
    </section>
  )
}
