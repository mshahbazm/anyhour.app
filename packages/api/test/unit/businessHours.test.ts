import { afterAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { db } from '../../src/db'
import {
  isTimeZone,
  openWindows,
  outsideHoursSql,
} from '../../src/services/workspace/businessHours'
import { readWeek } from '../../src/services/workspace/hoursFromKnowledge'
import type { tBusinessHours } from '../../src/types/businessHours.types'

// The rule runs in Postgres (month stats), so it's checked there: a stored
// timestamp is UTC without an offset, like conversation.createdAt.
async function outside(
  utc: string,
  hours: tBusinessHours | null,
  timeZone: string | null,
) {
  const result = await db.execute<{ outside: boolean }>(
    sql`select ${outsideHoursSql(sql`${utc}::timestamp`, hours, timeZone)} as outside`,
  )
  return result.rows[0].outside
}

const nineToFive: tBusinessHours = [
  ...Array.from({ length: 5 }, () => [{ opens: '09:00', closes: '17:00' }]),
  [{ opens: '10:00', closes: '14:00' }],
  [],
]

afterAll(() => db.$client.end())

describe('opening hours', () => {
  test('uses the hours in the workspace’s time zone', async () => {
    // Monday 2 Nov 2026. Karachi is UTC+5: 04:30 UTC is 09:30 there.
    expect(await outside('2026-11-02 04:30', nineToFive, 'Asia/Karachi')).toBe(
      false,
    )
    // The same instant is 04:30 in UTC, before opening.
    expect(await outside('2026-11-02 04:30', nineToFive, null)).toBe(true)
    // 12:30 UTC is 17:30 in Karachi: closed.
    expect(await outside('2026-11-02 12:30', nineToFive, 'Asia/Karachi')).toBe(
      true,
    )
    // Saturday 7 Nov, 11:00 in New York (UTC-5) is open; Sunday is closed.
    expect(
      await outside('2026-11-07 16:00', nineToFive, 'America/New_York'),
    ).toBe(false)
    expect(
      await outside('2026-11-08 16:00', nineToFive, 'America/New_York'),
    ).toBe(true)
    // Sunday evening in UTC is Monday 10:00 in Auckland (UTC+13).
    expect(
      await outside('2026-11-01 21:00', nineToFive, 'Pacific/Auckland'),
    ).toBe(false)
  })

  test('unknown hours fall back to 08:00–18:00 weekdays, local when the zone is known', async () => {
    // Monday 07:30 UTC is before 08:00 in UTC, but 08:30 in Berlin (UTC+1).
    expect(await outside('2026-11-02 07:30', null, null)).toBe(true)
    expect(await outside('2026-11-02 07:30', null, 'Europe/Berlin')).toBe(false)
    expect(await outside('2026-11-02 17:30', null, 'Europe/Berlin')).toBe(true)
    // Saturday is closed.
    expect(await outside('2026-11-07 12:00', null, 'Europe/Berlin')).toBe(true)
  })

  test('a range past midnight runs into the next day', () => {
    const late: tBusinessHours = [
      [],
      [],
      [],
      [],
      [{ opens: '18:00', closes: '02:00' }],
      [],
      [],
    ]
    expect(openWindows(late)).toEqual([
      { day: 5, from: 18 * 60, to: 24 * 60 },
      { day: 6, from: 0, to: 120 },
    ])
  })

  test('time zones are checked', () => {
    expect(isTimeZone('Europe/London')).toBe(true)
    expect(isTimeZone('UTC')).toBe(true)
    expect(isTimeZone('Mars/Olympus')).toBe(false)
    expect(isTimeZone("Europe/London'; drop")).toBe(false)
  })

  test('a week with nothing open, or not found, is not saved', () => {
    const closed = { closed: true, ranges: [] }
    const week = {
      monday: closed,
      tuesday: closed,
      wednesday: closed,
      thursday: closed,
      friday: closed,
      saturday: closed,
      sunday: closed,
    }
    expect(readWeek({ found: true, timeZone: null, week })).toBeNull()
    expect(
      readWeek({
        found: false,
        timeZone: null,
        week: {
          ...week,
          monday: {
            closed: false,
            ranges: [{ opens: '09:00', closes: '17:00' }],
          },
        },
      }),
    ).toBeNull()
    expect(
      readWeek({
        found: true,
        timeZone: null,
        week: {
          ...week,
          monday: {
            closed: false,
            ranges: [
              { opens: '9am', closes: '17:00' },
              { opens: '09:00', closes: '17:00' },
            ],
          },
        },
      })?.[0],
    ).toEqual([{ opens: '09:00', closes: '17:00' }])
  })
})
