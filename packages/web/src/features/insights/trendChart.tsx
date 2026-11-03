import type { iInsights } from './useInsights'

const size = { width: 700, height: 160, top: 12 }

function dayLabel(day: string, long = false) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    weekday: long ? 'short' : undefined,
    timeZone: 'UTC',
  })
}

// Visitors as a soft area, conversations as bars on the same days. Each day
// is a hover column with its own tooltip, so no measuring is needed.
export function TrendChart({ daily }: { daily: iInsights['daily'] }) {
  const max = Math.max(
    1,
    ...daily.map((row) => Math.max(row.visitors, row.conversations)),
  )
  const step = size.width / daily.length
  const y = (value: number) =>
    size.height - (value / max) * (size.height - size.top)
  const points = daily.map(
    (row, index) => `${(index + 0.5) * step},${y(row.visitors)}`,
  )
  const line = `M${points.join(' L')}`
  const area = `${line} L${(daily.length - 0.5) * step},${size.height} L${0.5 * step},${size.height} Z`
  const middle = daily[Math.floor(daily.length / 2)]
  return (
    <figure className="trendChart">
      <figcaption className="trendLegend">
        <span className="is-visitors">Visitors</span>
        <span className="is-chats">Conversations</span>
      </figcaption>
      <div className="trendPlot">
        <svg
          viewBox={`0 0 ${size.width} ${size.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--accent-brand)"
                stopOpacity="0.22"
              />
              <stop
                offset="100%"
                stopColor="var(--accent-brand)"
                stopOpacity="0"
              />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((share) => (
            <line
              key={share}
              className="trendGrid"
              x1="0"
              x2={size.width}
              y1={y(max * share)}
              y2={y(max * share)}
            />
          ))}
          {daily.map((row, index) =>
            row.conversations ? (
              <rect
                key={row.day}
                className="trendBar"
                x={index * step + step * 0.3}
                width={step * 0.4}
                y={y(row.conversations)}
                height={size.height - y(row.conversations)}
                rx={Math.min(3, step * 0.2)}
              />
            ) : null,
          )}
          <path d={area} fill="url(#trendFill)" />
          <path
            d={line}
            className="trendLine"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="trendColumns">
          {daily.map((row) => (
            <div key={row.day} className="trendColumn">
              <div className="trendTip" role="tooltip">
                <strong>{dayLabel(row.day, true)}</strong>
                <span>
                  {row.visitors} visitor{row.visitors === 1 ? '' : 's'}
                </span>
                <span>
                  {row.conversations} conversation
                  {row.conversations === 1 ? '' : 's'}
                </span>
                {row.leads > 0 && (
                  <span>
                    {row.leads} lead{row.leads === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="trendAxis" aria-hidden="true">
        <span>{dayLabel(daily[0].day)}</span>
        {daily.length > 2 && <span>{dayLabel(middle.day)}</span>}
        <span>{dayLabel(daily[daily.length - 1].day)}</span>
      </div>
    </figure>
  )
}
