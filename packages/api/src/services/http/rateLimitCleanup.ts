import { lte } from 'drizzle-orm'
import { db } from '../../db'
import { publicRateLimit } from '../../db/schema'

export async function cleanupExpiredRateLimits() {
  await db
    .delete(publicRateLimit)
    .where(lte(publicRateLimit.expiresAt, new Date()))
}
