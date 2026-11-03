import { Clock } from 'lucide-react'

// Mirrors tBusinessHours in packages/api/src/types/businessHours.types.ts:
// seven days, Monday first, each empty when closed.
export interface iOpeningRange {
  opens: string
  closes: string
}
export type tBusinessHours = iOpeningRange[][]

const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// "09:00" → "9:00".
const time = (value: string) => value.replace(/^0(\d)/, '$1')

/** "Mon–Fri 9:00–17:00, Sat 10:00–14:00": days with the same hours grouped. */
export function formatHours(hours: tBusinessHours) {
  const labels = hours
    .slice(0, 7)
    .map((ranges) =>
      ranges
        .map((range) => `${time(range.opens)}–${time(range.closes)}`)
        .join(' and '),
    )
  const groups: Array<{ from: number; to: number; label: string }> = []
  labels.forEach((label, day) => {
    const last = groups.at(-1)
    if (last && last.label === label && last.to === day - 1) last.to = day
    else groups.push({ from: day, to: day, label })
  })
  return groups
    .filter((group) => group.label)
    .map((group) => {
      const days =
        group.from === group.to
          ? dayNames[group.from]
          : `${dayNames[group.from]}–${dayNames[group.to]}`
      return `${days} ${group.label}`
    })
    .join(', ')
}

// One quiet line near the top of Your business. Hours are read from what
// the AI knows; changing them is telling a fact, never a form.
export function OpeningHours(props: {
  hours: tBusinessHours | null
  timeZone: string | null
  botName: string
  /** Opens the tell box with "We're open " typed. */
  onTell?: () => void
}) {
  const known = props.hours && props.hours.some((ranges) => ranges.length)
  return (
    <p className="openingHours">
      <Clock size={14} aria-hidden="true" />
      {known && props.hours ? (
        <span>
          Opening hours: {formatHours(props.hours)}
          {props.timeZone && (
            <span className="openingHoursZone">
              {' · '}
              {props.timeZone.replace(/_/g, ' ')}
            </span>
          )}
        </span>
      ) : (
        <span>
          Opening hours not found yet.
          {props.onTell && (
            <>
              {' '}
              <button
                type="button"
                className="openingHoursTell"
                onClick={props.onTell}
              >
                Tell {props.botName} your hours.
              </button>
            </>
          )}
        </span>
      )}
    </p>
  )
}
