import { createHmac } from 'node:crypto'
import { lt, sql } from 'drizzle-orm'
import { db } from '../../db'
import { siteStatDaily, siteVisitorDaily } from '../../db/schema'
import { env } from '../../env'
import { timezoneCountries } from '../../config/timezoneCountries'
import { defaultTracking, insightsLimits } from '../../config/tracking.config'
import type { tTracking } from '../../config/tracking.config'

// Website insights are counted in memory and written in one batch every few
// seconds, so a busy website costs a handful of upserts a minute rather than
// a write per page view. A crash loses at most those few seconds of counts.

export interface iBeacon {
  tz?: string
  w?: number
  e: Array<{ k: string; p?: string; r?: string }>
}

interface iVisit {
  assistantId: string
  day: string
  visitorHash: string
  country: string | null
  device: string | null
  browser: string | null
}

const separator = '\u0000'
let counts = new Map<string, number>()
let visits = new Map<string, iVisit>()
/** Values seen today per bot and metric, to cap pages and sources per day. */
const distinct = new Map<string, Set<string>>()
const beacons = new Map<string, number>()
let beaconMinute = 0
let lastPrune = 0

const robots =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom|preview|monitor/i

function add(
  assistantId: string,
  day: string,
  metric: string,
  value = '',
  by = 1,
) {
  if (value) {
    const key = [assistantId, day, metric].join(separator)
    const seen = distinct.get(key) ?? new Set<string>()
    distinct.set(key, seen)
    if (!seen.has(value)) {
      if (seen.size >= insightsLimits.valuesPerDay) value = 'other'
      else seen.add(value)
    }
  }
  const key = [assistantId, day, metric, value].join(separator)
  counts.set(key, (counts.get(key) ?? 0) + by)
}

function cleanPath(path: string | undefined) {
  if (!path?.startsWith('/')) return null
  const clean = path.slice(0, 200).replace(/\/+$/, '') || '/'
  return /^[\x20-\x7e]+$/.test(clean) ? clean : null
}

function cleanSource(source: string) {
  const clean = source.trim().toLowerCase().slice(0, 60)
  return /^[a-z0-9][a-z0-9._-]*$/.test(clean) ? clean : null
}

function deviceOf(width: number | undefined, userAgent: string) {
  if (typeof width === 'number' && width > 0)
    return width < 640 ? 'phone' : width < 1024 ? 'tablet' : 'computer'
  return /iPad|Tablet/i.test(userAgent)
    ? 'tablet'
    : /Mobi|Android/i.test(userAgent)
      ? 'phone'
      : 'computer'
}

function browserOf(userAgent: string) {
  const known: Array<[RegExp, string]> = [
    [/Edg\//, 'Edge'],
    [/OPR\/|Opera/, 'Opera'],
    [/SamsungBrowser/, 'Samsung Internet'],
    [/Firefox|FxiOS/, 'Firefox'],
    [/Chrome|CriOS/, 'Chrome'],
    [/Safari/, 'Safari'],
  ]
  return known.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Other'
}

function countryOf(header: string | undefined, timeZone: string | undefined) {
  const code = header?.toUpperCase()
  if (code && /^[A-Z]{2}$/.test(code) && code !== 'XX') return code
  return (timeZone && timezoneCountries.get(timeZone)) ?? null
}

// The same visitor gives the same hash for one bot on one day only. The
// address itself is never stored.
function visitorHash(assistantId: string, day: string, ip: string, ua: string) {
  return createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update([day, assistantId, ip, ua].join(separator))
    .digest('base64url')
    .slice(0, 22)
}

let beaconsThisMinute = 0
function allowBeacon(visitor: string) {
  const minute = Math.floor(Date.now() / 60_000)
  if (minute !== beaconMinute) {
    beacons.clear()
    beaconMinute = minute
    beaconsThisMinute = 0
  }
  if (++beaconsThisMinute > insightsLimits.beaconsPerMinuteTotal) return false
  const sent = (beacons.get(visitor) ?? 0) + 1
  beacons.set(visitor, sent)
  return sent <= insightsLimits.beaconsPerMinute
}

/** What is counted on the website: the owner's choices while visitor
 *  counts are on, nothing while they're off. */
export function countedTracking(site: {
  tracking: boolean
  trackingOptions: tTracking
}): tTracking {
  const counted = { ...defaultTracking, ...site.trackingOptions }
  return {
    visits: site.tracking && counted.visits,
    location: site.tracking && counted.location,
    device: site.tracking && counted.device,
    chat: site.tracking && counted.chat,
  }
}

/** Counts one beacon from a website whose owner turned visitor counts on,
 *  only what they chose to count. Bad or excess input is dropped quietly. */
export function collect(input: {
  assistantId: string
  tracking: tTracking
  beacon: iBeacon
  ip: string
  userAgent: string
  countryHeader?: string
}) {
  const { assistantId, tracking, beacon, userAgent } = input
  if (!userAgent || robots.test(userAgent)) return
  const day = new Date().toISOString().slice(0, 10)
  const hash = visitorHash(assistantId, day, input.ip, userAgent)
  if (!allowBeacon(hash)) return

  let viewed = false
  for (const event of beacon.e.slice(0, insightsLimits.eventsPerBeacon)) {
    if (event.k === 'view' && tracking.visits) {
      const page = cleanPath(event.p)
      if (!page) continue
      viewed = true
      add(assistantId, day, 'views')
      add(assistantId, day, 'page', page)
      // Only a visit's first page says where it came from.
      if (typeof event.r === 'string')
        add(assistantId, day, 'source', cleanSource(event.r) ?? 'direct')
    } else if ((event.k === 'open' || event.k === 'prompt') && tracking.chat)
      add(assistantId, day, event.k === 'open' ? 'opens' : 'prompts')
  }
  if (!viewed) return
  const key = [assistantId, day, hash].join(separator)
  if (!visits.has(key) && visits.size < insightsLimits.pendingVisitors)
    visits.set(key, {
      assistantId,
      day,
      visitorHash: hash,
      country: tracking.location
        ? countryOf(input.countryHeader, beacon.tz)
        : null,
      device: tracking.device ? deviceOf(beacon.w, userAgent) : null,
      browser: tracking.device ? browserOf(userAgent) : null,
    })
}

/** A chat event the server sees itself (docs/whatsappQuestion.md); the
 *  caller checks that chat is counted. */
export function countChatEvent(
  assistantId: string,
  metric: 'whatsappAsks' | 'whatsappOpens',
) {
  add(assistantId, new Date().toISOString().slice(0, 10), metric)
}

function chunks<T>(items: T[], size: number) {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size))
  return out
}

/** Writes what was counted since the last flush. */
export async function flushInsights() {
  const pendingVisits = [...visits.values()]
  visits = new Map()
  // New visitors today add to the unique count and to the country, device
  // and browser breakdowns; repeat visitors add nothing.
  for (const batch of chunks(pendingVisits, 500)) {
    const fresh = await db
      .insert(siteVisitorDaily)
      .values(
        batch.map(({ assistantId, day, visitorHash }) => ({
          assistantId,
          day,
          visitorHash,
        })),
      )
      .onConflictDoNothing()
      .returning({
        assistantId: siteVisitorDaily.assistantId,
        day: siteVisitorDaily.day,
        visitorHash: siteVisitorDaily.visitorHash,
      })
    const isFresh = new Set(fresh.map((row) => row.visitorHash))
    for (const visit of batch) {
      if (!isFresh.has(visit.visitorHash)) continue
      add(visit.assistantId, visit.day, 'visitors')
      if (visit.country)
        add(visit.assistantId, visit.day, 'country', visit.country)
      if (visit.device)
        add(visit.assistantId, visit.day, 'device', visit.device)
      if (visit.browser)
        add(visit.assistantId, visit.day, 'browser', visit.browser)
    }
  }

  const pending = counts
  counts = new Map()
  const rows = [...pending].map(([key, count]) => {
    const [assistantId, day, metric, value] = key.split(separator)
    return { assistantId, day, metric, value, count }
  })
  for (const batch of chunks(rows, 500))
    await db
      .insert(siteStatDaily)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          siteStatDaily.assistantId,
          siteStatDaily.day,
          siteStatDaily.metric,
          siteStatDaily.value,
        ],
        set: { count: sql`${siteStatDaily.count} + excluded.count` },
      })

  // Forget yesterday's distinct values, and prune old rows hourly.
  const today = new Date().toISOString().slice(0, 10)
  for (const key of distinct.keys())
    if (key.split(separator)[1] !== today) distinct.delete(key)
  if (Date.now() - lastPrune > 3_600_000) {
    lastPrune = Date.now()
    const daysAgo = (days: number) =>
      new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    await db
      .delete(siteVisitorDaily)
      .where(lt(siteVisitorDaily.day, daysAgo(insightsLimits.keepVisitorDays)))
    await db
      .delete(siteStatDaily)
      .where(lt(siteStatDaily.day, daysAgo(insightsLimits.keepDays)))
  }
}

let flushing = false
setInterval(() => {
  if (flushing) return
  flushing = true
  flushInsights()
    .catch((error: unknown) => console.error('Insights flush failed', error))
    .finally(() => {
      flushing = false
    })
}, insightsLimits.flushSeconds * 1000).unref()
