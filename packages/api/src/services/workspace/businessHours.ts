import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { tBusinessHours } from '../../types/businessHours.types'

// Opening hours (docs/glossary.md): read from Your business by
// hoursFromKnowledge.ts, local to the workspace's time zone.

/** Until the hours are found: 08:00–18:00 on weekdays. */
export const fallbackHours: tBusinessHours = [
  ...Array.from({ length: 5 }, () => [{ opens: '08:00', closes: '18:00' }]),
  [],
  [],
]

const clock = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/

/** Minutes since midnight for 'HH:MM', or null when it isn't a time. */
export function minutesOf(time: string) {
  if (!clock.test(time)) return null
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/** A real IANA time zone name, as browsers and Postgres know them. */
export function isTimeZone(value: string) {
  if (!value || value.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(value))
    return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

interface iOpenWindow {
  /** ISO day: 1 is Monday. */
  day: number
  from: number
  to: number
}

// The week as open stretches of minutes per day. A range that closes at or
// before it opens runs past midnight into the next day.
export function openWindows(hours: tBusinessHours): iOpenWindow[] {
  const windows: iOpenWindow[] = []
  hours.slice(0, 7).forEach((ranges, index) => {
    const day = index + 1
    for (const range of ranges) {
      const from = minutesOf(range.opens)
      const to = minutesOf(range.closes)
      if (from === null || to === null) continue
      if (to > from) windows.push({ day, from, to })
      else {
        windows.push({ day, from, to: 24 * 60 })
        if (to > 0) windows.push({ day: (day % 7) + 1, from: 0, to })
      }
    }
  })
  return windows
}

/**
 * True when a stored (UTC) timestamp falls outside the opening hours, in the
 * given time zone. Unknown hours use the fallback; an unknown zone is UTC.
 */
export function outsideHoursSql(
  at: AnyPgColumn | SQL,
  hours: tBusinessHours | null,
  timeZone: string | null,
): SQL<boolean> {
  const zone = timeZone && isTimeZone(timeZone) ? timeZone : 'UTC'
  const local = sql`((${at}) at time zone 'UTC' at time zone ${zone})`
  const day = sql`extract(isodow from ${local})`
  const minute = sql`(extract(hour from ${local}) * 60 + extract(minute from ${local}))`
  const windows = openWindows(hours ?? fallbackHours)
  if (!windows.length) return sql<boolean>`true`
  const open = sql.join(
    windows.map(
      (window) =>
        sql`(${day} = ${sql.raw(String(window.day))} and ${minute} >= ${sql.raw(String(window.from))} and ${minute} < ${sql.raw(String(window.to))})`,
    ),
    sql` or `,
  )
  return sql<boolean>`not (${open})`
}
