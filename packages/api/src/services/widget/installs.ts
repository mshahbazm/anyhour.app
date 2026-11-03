import { and, desc, eq, lt, ne, notInArray, or, sql } from 'drizzle-orm'
import { db } from '../../db'
import { assistant, widgetInstall } from '../../db/schema'

export type tInstallStatus = 'working' | 'notAllowed' | 'notLive'

const limits = {
  /** A busy site writes at most once per this many minutes. */
  throttleMinutes: 5,
  /** Rejected sightings kept per bot, so fake origins can't flood the list. */
  rejected: 10,
  /** Recent sightings remembered in memory, per server process. */
  remembered: 10_000,
}

// Sightings written in the last few minutes. A busy site's page loads then
// cost no database work at all; the database throttle still covers restarts
// and other server processes.
const recent = new Map<string, number>()
function seenRecently(key: string, now: number) {
  const at = recent.get(key)
  if (at && now - at < limits.throttleMinutes * 60_000) return true
  recent.delete(key)
  recent.set(key, now)
  // Oldest first in a Map: drop the oldest when full.
  if (recent.size > limits.remembered)
    recent.delete(recent.keys().next().value as string)
  return false
}

// The widget loaded somewhere: note where, and whether it could work there.
// A rejected load (the chat couldn't start) is classified here, after the
// memory check, so repeats cost no database work.
export async function recordInstallSighting(
  assistantId: string,
  origin: string,
  outcome: 'working' | 'rejected',
) {
  if (!/^https?:\/\/[^/\s]+$/i.test(origin) || origin.length > 300) return
  const now = new Date()
  if (seenRecently(`${assistantId}|${origin}|${outcome}`, now.getTime())) return
  let status: tInstallStatus = 'working'
  if (outcome === 'rejected') {
    const bot = await botExists(assistantId)
    if (!bot) return
    status = bot.status === 'published' ? 'notAllowed' : 'notLive'
  }
  const throttled = new Date(now.getTime() - limits.throttleMinutes * 60_000)
  const [row] = await db
    .insert(widgetInstall)
    .values({ assistantId, origin, status })
    .onConflictDoUpdate({
      target: [widgetInstall.assistantId, widgetInstall.origin],
      set: { status, lastSeenAt: now },
      // Unchanged and recently seen: nothing worth writing.
      setWhere: or(
        ne(widgetInstall.status, status),
        lt(widgetInstall.lastSeenAt, throttled),
      ),
    })
    // xmax is 0 only for a freshly inserted row.
    .returning({ inserted: sql<boolean>`(xmax = 0)` })
  // Only a new rejected site can push the list past its cap.
  if (status === 'working' || !row?.inserted) return
  const keep = await db
    .select({ id: widgetInstall.id })
    .from(widgetInstall)
    .where(
      and(
        eq(widgetInstall.assistantId, assistantId),
        ne(widgetInstall.status, 'working'),
      ),
    )
    .orderBy(desc(widgetInstall.lastSeenAt))
    .limit(limits.rejected)
  await db.delete(widgetInstall).where(
    and(
      eq(widgetInstall.assistantId, assistantId),
      ne(widgetInstall.status, 'working'),
      keep.length
        ? notInArray(
            widgetInstall.id,
            keep.map((row) => row.id),
          )
        : undefined,
    ),
  )
}

// Only sightings for real bots get recorded at all.
async function botExists(assistantId: string) {
  const [row] = await db
    .select({ id: assistant.id, status: assistant.status })
    .from(assistant)
    .where(eq(assistant.id, assistantId))
    .limit(1)
  return row ?? null
}

export async function listInstalls(assistantId: string) {
  return db
    .select({
      origin: widgetInstall.origin,
      status: widgetInstall.status,
      firstSeenAt: widgetInstall.firstSeenAt,
      lastSeenAt: widgetInstall.lastSeenAt,
    })
    .from(widgetInstall)
    .where(eq(widgetInstall.assistantId, assistantId))
    .orderBy(
      sql`case when ${widgetInstall.status} = 'working' then 0 else 1 end`,
      desc(widgetInstall.lastSeenAt),
    )
}
