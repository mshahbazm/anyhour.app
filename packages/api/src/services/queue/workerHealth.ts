import { eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { serviceHeartbeat } from '../../db/schema'

const name = 'worker'
// Several missed beats (every 30 s) before the worker counts as gone.
const staleAfter = sql`interval '2 minutes'`
let warnedAt = 0

// Called by the worker on start and every 30 seconds. Times use the database
// clock on both sides, so app and database time zones never disagree.
export async function reportWorkerAlive() {
  await db
    .insert(serviceHeartbeat)
    .values({ name, beatAt: sql`now()` })
    .onConflictDoUpdate({
      target: serviceHeartbeat.name,
      set: { beatAt: sql`now()` },
    })
}

export async function workerAlive() {
  const [row] = await db
    .select({
      alive: sql<boolean>`${serviceHeartbeat.beatAt} > now() - ${staleAfter}`,
    })
    .from(serviceHeartbeat)
    .where(eq(serviceHeartbeat.name, name))
  const alive = Boolean(row?.alive)
  // An operator signal: reading, refreshes and cleanup all wait on the worker.
  if (!alive && Date.now() - warnedAt > 5 * 60_000) {
    warnedAt = Date.now()
    console.warn('Background worker is not running; queued reading is paused')
  }
  return alive
}
