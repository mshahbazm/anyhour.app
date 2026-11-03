import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../../db'
import { publicRateLimit } from '../../../db/schema'
import { env } from '../../../env'
import { cleanupLimits, estimateSize } from './jevRequests'

// PostgreSQL reservations coordinate every worker sharing this provider account.
async function acquireSlot(deadline: number) {
  const bucketStart = new Date(0)
  while (Date.now() < deadline) {
    const reservation = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(728413900)`)
      const now = new Date()
      const keys = ['jev:slot:0', 'jev:slot:1', 'jev:start']
      for (const keyHash of keys)
        await tx
          .insert(publicRateLimit)
          .values({ keyHash, bucketStart, expiresAt: now })
          .onConflictDoNothing()
      const rows = await tx
        .select()
        .from(publicRateLimit)
        .where(
          sql`${publicRateLimit.keyHash} in ('jev:slot:0','jev:slot:1','jev:start')`,
        )
      const slot = rows.find(
        (row) => row.keyHash !== 'jev:start' && row.expiresAt <= now,
      )
      const start = rows.find((row) => row.keyHash === 'jev:start')!
      if (!slot || start.expiresAt > now) return null
      const expiresAt = new Date(Date.now() + cleanupLimits.timeoutMs + 5000)
      await tx
        .update(publicRateLimit)
        .set({ expiresAt })
        .where(eq(publicRateLimit.keyHash, slot.keyHash))
      // At most one <=48k estimated-token request per second; no initial burst.
      await tx
        .update(publicRateLimit)
        .set({ expiresAt: new Date(Date.now() + 1000) })
        .where(eq(publicRateLimit.keyHash, 'jev:start'))
      return { key: slot.keyHash, expiresAt }
    })
    if (reservation)
      return async () => {
        await db
          .update(publicRateLimit)
          .set({ expiresAt: new Date() })
          .where(
            and(
              eq(publicRateLimit.keyHash, reservation.key),
              eq(publicRateLimit.expiresAt, reservation.expiresAt),
            ),
          )
      }
    await Bun.sleep(500)
  }
  throw new Error('Jev limiter deadline reached')
}
// Any System One request: block cleanup, or a website's scope plan.
export async function sendJevRequest(request: {
  model: string
  state: unknown
  questions: object
}) {
  if (!env.TYPESAFE_API_KEY) throw new Error('Jev is not configured')
  if (estimateSize(request) > cleanupLimits.request)
    throw new Error('Jev request budget exceeded')
  const release = await acquireSlot(Date.now() + 60_000)
  try {
    const endpoint =
      process.env.NODE_ENV === 'test' && env.TYPESAFE_API_URL
        ? env.TYPESAFE_API_URL
        : 'https://api.typesafe.ai/v1/systemone'
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(cleanupLimits.timeoutMs),
    })
    // Consume the body while the concurrency lease is held.
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: response.headers,
    })
  } finally {
    await release()
  }
}
