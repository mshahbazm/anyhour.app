import { and, eq, sql } from 'drizzle-orm'
import type { db } from '../../db'
import { indexRun, indexRunItem } from '../../db/schema'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

type tItemCompletion = {
  runId: string
  sourceId: string
  outcome: 'indexed' | 'unchanged' | 'failed'
  lastError?: string
} & (
  | { expectedStatus: 'queued'; attemptCount?: number }
  | {
      expectedStatus: 'preparing' | 'prepared' | 'embedding'
      attemptCount: number
    }
)

// Call inside the transaction that saves the source and its knowledge. Claim
// completion before those writes, and skip them when this returns false. The
// run lock serializes counters/completion; acquire it before any source lock.
export async function finishRunItem(
  tx: tTransaction,
  completion: tItemCompletion,
): Promise<boolean> {
  const { runId, sourceId, outcome, expectedStatus, attemptCount, lastError } =
    completion
  const [run] = await tx
    .select({ status: indexRun.status })
    .from(indexRun)
    .where(eq(indexRun.id, runId))
    .for('update')
  if (run?.status !== 'running') return false
  const [finished] = await tx
    .update(indexRunItem)
    .set({
      status: outcome,
      completedAt: new Date(),
      leaseUntil: null,
      ...(lastError !== undefined ? { lastError } : {}),
    })
    .where(
      and(
        eq(indexRunItem.runId, runId),
        eq(indexRunItem.sourceId, sourceId),
        eq(indexRunItem.status, expectedStatus),
        attemptCount === undefined
          ? undefined
          : eq(indexRunItem.attemptCount, attemptCount),
      ),
    )
    .returning({ sourceId: indexRunItem.sourceId })
  if (!finished) return false
  await tx
    .update(indexRun)
    .set({
      fetchedCount: sql`${indexRun.fetchedCount} + 1`,
      ...(outcome === 'indexed'
        ? { indexedCount: sql`${indexRun.indexedCount} + 1` }
        : {}),
      ...(outcome === 'unchanged'
        ? { unchangedCount: sql`${indexRun.unchangedCount} + 1` }
        : {}),
      ...(outcome === 'failed'
        ? { failedCount: sql`${indexRun.failedCount} + 1` }
        : {}),
    })
    .where(eq(indexRun.id, runId))
  return true
}
