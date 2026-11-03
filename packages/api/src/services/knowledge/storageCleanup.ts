import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '../../db'
import { storageCleanup } from '../../db/schema'
import { deleteStoredObject } from './r2Storage'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function recordStorageCleanup(
  database: typeof db | tTransaction,
  objectKeys: string[],
) {
  if (!objectKeys.length) return
  // Use the same millisecond clock as the due-work query. PostgreSQL's default
  // now() retains microseconds and can put a just-created task slightly after
  // an immediate JavaScript Date, causing synchronous retirement to skip it.
  const nextAttemptAt = new Date()
  await database
    .insert(storageCleanup)
    .values(
      [...new Set(objectKeys)].map((objectKey) => ({
        objectKey,
        nextAttemptAt,
      })),
    )
    .onConflictDoNothing()
}

// Both the delete operation and worker use the same durable, idempotent path.
export async function sweepStorageCleanup(objectKeys?: string[]) {
  if (objectKeys && !objectKeys.length) return
  const now = new Date()
  const due = await db
    .select({ objectKey: storageCleanup.objectKey })
    .from(storageCleanup)
    .where(
      and(
        lte(storageCleanup.nextAttemptAt, now),
        or(
          isNull(storageCleanup.leaseUntil),
          lte(storageCleanup.leaseUntil, now),
        ),
        objectKeys ? inArray(storageCleanup.objectKey, objectKeys) : undefined,
      ),
    )
    .orderBy(storageCleanup.nextAttemptAt)
    .limit(50)
  for (const item of due) {
    const [claimed] = await db
      .update(storageCleanup)
      .set({
        attemptCount: sql`${storageCleanup.attemptCount} + 1`,
        leaseUntil: new Date(Date.now() + 5 * 60_000),
      })
      .where(
        and(
          eq(storageCleanup.objectKey, item.objectKey),
          lte(storageCleanup.nextAttemptAt, now),
          or(
            isNull(storageCleanup.leaseUntil),
            lte(storageCleanup.leaseUntil, now),
          ),
        ),
      )
      .returning()
    if (!claimed) continue
    const owned = and(
      eq(storageCleanup.objectKey, claimed.objectKey),
      eq(storageCleanup.attemptCount, claimed.attemptCount),
    )
    try {
      await deleteStoredObject(claimed.objectKey)
      await db.delete(storageCleanup).where(owned)
    } catch (error) {
      await db
        .update(storageCleanup)
        .set({
          leaseUntil: null,
          nextAttemptAt: new Date(
            Date.now() +
              Math.min(
                60 * 60_000,
                60_000 * 2 ** Math.min(claimed.attemptCount - 1, 6),
              ),
          ),
          lastError:
            error instanceof Error ? error.name : 'Storage cleanup failed',
        })
        .where(owned)
    }
  }
}
