import { deskList, type DeskStatus, type SpecialistId } from '../lib/agents'

type Props = {
  activeAgentId: SpecialistId | 'aria' | null
  deskStatuses: Partial<Record<SpecialistId, DeskStatus>>
}

const SEAT_POS: Record<SpecialistId, { col: number; row: number }> = {
  mira: { col: 1, row: 1 },
  rex: { col: 2, row: 1 },
  forge: { col: 1, row: 2 },
  pixel: { col: 2, row: 2 },
}

export function AgentTown({ activeAgentId, deskStatuses }: Props) {
  const desks = deskList()
  const working = desks.filter((d) => {
    const st = deskStatuses[d.id as SpecialistId]
    return st === 'working' || st === 'thinking' || activeAgentId === d.id
  }).length

  return (
    <section className="agent-town hud-panel">
      <header className="town-head">
        <div>
          <div className="sat-kicker">AGENT TOWN</div>
          <h2>Office floor</h2>
        </div>
        <div className="town-avatars">
          {desks.map((d) => {
            const id = d.id as SpecialistId
            const st = deskStatuses[id] || 'idle'
            const on = activeAgentId === id || st === 'working' || st === 'thinking'
            return (
              <div key={id} className={`town-avatar accent-${d.accent} ${on ? 'on' : ''}`} title={d.name}>
                <span>{d.name.slice(0, 1)}</span>
                <em>{d.name}</em>
              </div>
            )
          })}
        </div>
      </header>

      <div className="town-floor">
        <div className="town-room lobby">
          <span>Lobby</span>
        </div>
        <div className="town-room work">
          <div className="town-desks">
            {desks.map((d) => {
              const id = d.id as SpecialistId
              const pos = SEAT_POS[id]
              const st = deskStatuses[id] || 'idle'
              const on = activeAgentId === id || st === 'working' || st === 'thinking'
              return (
                <div
                  key={id}
                  className={`town-desk accent-${d.accent} status-${st} ${on ? 'on' : ''}`}
                  style={{ gridColumn: pos.col, gridRow: pos.row }}
                >
                  <div className="town-pc" />
                  <div className="town-sprite">{d.name.slice(0, 1)}</div>
                  <div className="town-desk-name">{d.name}</div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="town-room lounge">
          <span>Break</span>
        </div>
        <div className="town-room private">
          <span>Aria</span>
        </div>
      </div>

      <footer className="town-foot">
        <span className="town-online">
          <i /> Online
        </span>
        <div className="town-bar">
          <span>Four desk set</span>
          <div className="town-bar-track">
            <div className="town-bar-fill" style={{ width: `${25 + working * 18}%` }} />
          </div>
        </div>
        <span className="town-seats">{working}/4 seat</span>
      </footer>
    </section>
  )
}
