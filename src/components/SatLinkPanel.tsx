const HEADLINES = [
  { id: 1, tag: 'GEO', title: 'Global ops pulse — markets & routes' },
  { id: 2, tag: 'AI', title: 'Desktop agents routing live tasks' },
  { id: 3, tag: 'SEC', title: 'Screen + mic permissions healthy' },
  { id: 4, tag: 'NET', title: 'Gemini link ready for Aria office' },
]

const HOTSPOTS = [
  { x: 22, y: 38, label: 'NYC', tone: 'amber' },
  { x: 48, y: 32, label: 'LON', tone: 'lime' },
  { x: 72, y: 42, label: 'DXB', tone: 'amber' },
  { x: 82, y: 55, label: 'DAC', tone: 'cyan' },
  { x: 88, y: 68, label: 'SYD', tone: 'lime' },
]

type Props = {
  metricsLabel?: string
}

export function SatLinkPanel({ metricsLabel }: Props) {
  return (
    <aside className="sat-panel hud-panel">
      <header className="sat-head">
        <div>
          <div className="sat-kicker">SAT-LINK FEED</div>
          <h2>Satellite stream</h2>
        </div>
        <div className="sat-modes">
          <button type="button" className="sat-mode active">
            1D
          </button>
          <button type="button" className="sat-mode">
            3D
          </button>
        </div>
      </header>

      <div className="sat-map" aria-hidden>
        <svg className="sat-map-svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="satGrid" width="16" height="16" patternUnits="userSpaceOnUse">
              <path d="M16 0H0V16" fill="none" stroke="rgba(52,211,153,0.18)" strokeWidth="0.6" />
            </pattern>
          </defs>
          <rect width="320" height="180" fill="#041016" />
          <rect width="320" height="180" fill="url(#satGrid)" />
          {/* crude continents */}
          <path
            d="M40 70 C55 40 90 45 110 60 C130 50 150 55 160 70 C145 95 110 100 80 95 C55 100 35 90 40 70Z"
            fill="rgba(16,185,129,0.22)"
            stroke="rgba(52,211,153,0.45)"
            strokeWidth="1"
          />
          <path
            d="M175 55 C200 40 230 48 245 65 C255 85 240 105 215 108 C190 110 170 90 175 55Z"
            fill="rgba(16,185,129,0.2)"
            stroke="rgba(52,211,153,0.4)"
            strokeWidth="1"
          />
          <path
            d="M250 95 C270 90 295 100 300 120 C290 140 265 145 250 130 C240 115 242 100 250 95Z"
            fill="rgba(16,185,129,0.18)"
            stroke="rgba(52,211,153,0.35)"
            strokeWidth="1"
          />
          <circle cx="160" cy="90" r="58" fill="none" stroke="rgba(52,211,153,0.2)" strokeDasharray="2 4" />
        </svg>
        {HOTSPOTS.map((h) => (
          <span
            key={h.label}
            className={`sat-hot tone-${h.tone}`}
            style={{ left: `${h.x}%`, top: `${h.y}%` }}
            title={h.label}
          >
            <i />
            <em>{h.label}</em>
          </span>
        ))}
        <div className="sat-zoom">
          <span>+</span>
          <span>−</span>
        </div>
        {metricsLabel ? <div className="sat-live">{metricsLabel}</div> : null}
      </div>

      <div className="sat-news">
        <div className="sat-news-title">Today headlines</div>
        <ol>
          {HEADLINES.map((h) => (
            <li key={h.id}>
              <span className="sat-news-num">{h.id}</span>
              <div>
                <strong>{h.tag}</strong>
                <p>{h.title}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  )
}
