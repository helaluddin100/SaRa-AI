import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { deskList, type DeskStatus, type SpecialistId } from '../lib/agents'
import femaleAvatar from '../assets/avatars/female-avatar.png'
import maleAvatar from '../assets/avatars/male-avatar.png'

export type AvatarMood = 'core' | 'female' | 'male'

type Props = {
  userName: string
  managerStatus: 'idle' | 'listening' | 'thinking' | 'speaking' | 'working'
  activeAgentId: SpecialistId | 'aria' | null
  deskStatuses: Partial<Record<SpecialistId, DeskStatus>>
  lastBrief: string
  routingLabel: string
  onTerminate?: () => void
  onMic?: () => void
  micDisabled?: boolean
}

const MANAGER_LABEL: Record<Props['managerStatus'], string> = {
  idle: 'standby',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  working: 'routing',
}

const DESK_STATUS_LABEL: Record<DeskStatus, string> = {
  idle: 'idle',
  thinking: 'thinking',
  working: 'working',
  done: 'done',
}

const AGENT_ICON: Record<SpecialistId, string> = {
  mira: '◈',
  rex: '▣',
  forge: '⚒',
  pixel: '◇',
}

type WirePath = {
  id: string
  accent: string
  d: string
  nodeX: number
  nodeY: number
}

function CoreOrb({ active }: { active: boolean }) {
  return (
    <div className={`core-orb ${active ? 'active' : ''}`} aria-hidden>
      <div className="core-orb-glow" />
      <div className="core-orb-core" />
      <div className="core-orb-ring r1" />
      <div className="core-orb-ring r2" />
      <div className="core-orb-ring r3" />
      <div className="core-orb-particles" />
    </div>
  )
}

function RadarRing() {
  return (
    <svg className="radar-ring" viewBox="0 0 200 200" aria-hidden>
      <defs>
        <linearGradient id="radarGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(125,211,252,0.85)" />
          <stop offset="100%" stopColor="rgba(56,189,248,0.25)" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="108" r="72" fill="none" stroke="rgba(125,211,252,0.28)" strokeWidth="1" />
      <circle
        cx="100"
        cy="108"
        r="72"
        fill="none"
        stroke="url(#radarGrad)"
        strokeWidth="2.2"
        strokeDasharray="2.5 6"
        className="radar-ticks"
      />
      <circle
        cx="100"
        cy="108"
        r="88"
        fill="none"
        stroke="rgba(125,211,252,0.18)"
        strokeWidth="1"
        strokeDasharray="1 11"
        className="radar-ticks reverse"
      />
    </svg>
  )
}

function HoloShimmer({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let t = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = canvas
      canvas.width = Math.max(1, Math.floor(w * dpr))
      canvas.height = Math.max(1, Math.floor(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const dots = Array.from({ length: 36 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.6 + Math.random() * 1.3,
      s: 0.3 + Math.random() * 0.8,
      p: Math.random() * Math.PI * 2,
    }))

    const draw = () => {
      t += active ? 0.028 : 0.012
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      ctx.clearRect(0, 0, w, h)
      for (const d of dots) {
        const x = (d.x + Math.sin(t * d.s + d.p) * 0.04) * w
        const y = (d.y + Math.cos(t * d.s * 0.8 + d.p) * 0.035) * h
        const a = 0.12 + 0.28 * (0.5 + 0.5 * Math.sin(t * 2 + d.p))
        ctx.beginPath()
        ctx.fillStyle = `rgba(186, 230, 253, ${a})`
        ctx.arc(x, y, d.r, 0, Math.PI * 2)
        ctx.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [active])

  return <canvas ref={ref} className="holo-shimmer" aria-hidden />
}

export function OfficeFloor({
  userName,
  managerStatus,
  activeAgentId,
  deskStatuses,
  lastBrief,
  routingLabel,
  onTerminate,
  onMic,
  micDisabled,
}: Props) {
  const [mood, setMood] = useState<AvatarMood>('male')
  const [wires, setWires] = useState<WirePath[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const chipRefs = useRef<(HTMLDivElement | null)[]>([])
  const hudRef = useRef<HTMLDivElement>(null)
  const desks = deskList()
  const live = managerStatus !== 'idle'

  const statusLine = useMemo(() => {
    if (activeAgentId && activeAgentId !== 'aria') {
      const d = desks.find((x) => x.id === activeAgentId)
      return `${d?.name || activeAgentId} is ${DESK_STATUS_LABEL[deskStatuses[activeAgentId] || 'working']}`
    }
    const who = userName?.trim() || 'Aria'
    return `${who} is ${MANAGER_LABEL[managerStatus]}`
  }, [activeAgentId, deskStatuses, desks, managerStatus, userName])

  const holoSrc = mood === 'female' ? femaleAvatar : maleAvatar
  const thinking = managerStatus === 'thinking' || managerStatus === 'working'

  useLayoutEffect(() => {
    const root = rootRef.current
    const hud = hudRef.current
    if (!root || !hud) return

    const rebuild = () => {
      const rr = root.getBoundingClientRect()
      const hr = hud.getBoundingClientRect()
      if (rr.width < 2 || hr.width < 2) return

      const targetX = hr.left - rr.left
      const midY = hr.top - rr.top + hr.height * 0.48
      const n = desks.length
      const spread = Math.min(hr.height * 0.18, 36)

      const next: WirePath[] = desks.map((desk, i) => {
        const chip = chipRefs.current[i]
        if (!chip) {
          return { id: desk.id, accent: desk.accent, d: '', nodeX: 0, nodeY: 0 }
        }
        const cr = chip.getBoundingClientRect()
        const x0 = cr.right - rr.left
        const y0 = cr.top - rr.top + cr.height / 2
        const x1 = targetX
        const y1 = midY + (i - (n - 1) / 2) * (spread / Math.max(1, (n - 1) / 2 || 1))
        const bend = x0 + Math.max(18, (x1 - x0) * 0.42)
        const d = `M ${x0} ${y0} H ${bend} L ${x1} ${y1}`
        return { id: desk.id, accent: desk.accent, d, nodeX: x0, nodeY: y0 }
      })

      setWires((prev) => {
        if (
          prev.length === next.length &&
          prev.every((p, i) => p.d === next[i]?.d && p.accent === next[i]?.accent)
        ) {
          return prev
        }
        return next
      })
    }

    rebuild()
    const ro = new ResizeObserver(() => rebuild())
    ro.observe(root)
    ro.observe(hud)
    chipRefs.current.forEach((el) => el && ro.observe(el))
    window.addEventListener('resize', rebuild)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', rebuild)
    }
    // desks list is static config; only measure on mount/resize
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="stonic-office" ref={rootRef}>
      <aside className="agent-rail" aria-label="Office agents">
        {desks.map((desk, i) => {
          const id = desk.id as SpecialistId
          const st = deskStatuses[id] || 'idle'
          const active = activeAgentId === id
          return (
            <div
              key={id}
              ref={(el) => {
                chipRefs.current[i] = el
              }}
              className={`agent-link accent-${desk.accent} ${active ? 'active' : ''} status-${st}`}
              style={{ ['--rail-i' as string]: String(i) }}
            >
              <div className="agent-chip">
                <span className="agent-chip-icon">{AGENT_ICON[id]}</span>
                <span className="agent-chip-text">
                  <span className="agent-chip-name">{desk.name.toUpperCase()}</span>
                  <span className="agent-chip-role">{desk.title}</span>
                </span>
                <span className={`agent-chip-dot status-${st}`} />
              </div>
            </div>
          )
        })}
      </aside>

      <svg className="wire-overlay" aria-hidden>
        {wires.map((w) =>
          w.d ? (
            <g key={w.id} className={`wire-path accent-${w.accent}`}>
              <path d={w.d} className="wire-line" />
              <path d={w.d} className="wire-pulse" pathLength={100} />
              <circle className="wire-node" cx={w.nodeX} cy={w.nodeY} r="2.4" />
            </g>
          ) : null,
        )}
      </svg>

      <section className={`avatar-stage ${live ? 'live' : ''} mood-${mood}`}>
        <div className="hud-frame" ref={hudRef}>
          <div className="hud-corner tl" />
          <div className="hud-corner tr" />
          <div className="hud-corner bl" />
          <div className="hud-corner br" />
          <div className="hud-grid" />
          <div className="hud-scan" />

          <div className="mood-switch" role="tablist" aria-label="Avatar mood">
            {(['core', 'female', 'male'] as AvatarMood[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mood === m}
                className={`mood-btn ${mood === m ? 'active' : ''}`}
                onClick={() => setMood(m)}
              >
                {m}
              </button>
            ))}
          </div>

          {thinking ? <div className="hud-thinking">THINKING</div> : null}

          <div className="avatar-viewport">
            {mood === 'core' ? (
              <CoreOrb active={live} />
            ) : (
              <div className={`holo-stage ${live ? 'active' : ''}`}>
                <RadarRing />
                <img
                  key={mood}
                  className="holo-img"
                  src={holoSrc}
                  alt={`${mood} holographic avatar`}
                  draggable={false}
                />
                <HoloShimmer active={live} />
              </div>
            )}
          </div>

          <div className="avatar-status">
            <span className={`status-dot ${live ? 'on' : ''}`} />
            <span>{statusLine}</span>
          </div>

          <div className="hud-controls">
            <button type="button" className="terminate-btn" onClick={onTerminate}>
              TERMINATE
            </button>
            <button
              type="button"
              className={`hud-mic ${managerStatus === 'listening' ? 'active' : ''}`}
              onClick={onMic}
              disabled={micDisabled}
              aria-label="Microphone"
              title="Mic"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
                <path
                  fill="currentColor"
                  d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"
                />
              </svg>
            </button>
          </div>

          {(routingLabel || lastBrief) && (
            <div className="avatar-brief" title={lastBrief || routingLabel}>
              {routingLabel || lastBrief}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
