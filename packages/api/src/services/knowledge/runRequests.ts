import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db'
import { indexRun, knowledgeSource } from '../../db/schema'
import { advanceIndexRun } from './runOrchestrator'
import { lockOwner, ownedBy, ownerOf } from './owner'
import type { iKnowledgeOwner } from './owner'
import { ApiError } from '../http/apiError'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type tRunTrigger = typeof indexRun.$inferInsert.trigger

// Callers lock the source's owner before requesting runs, matching source
// mutation lock order. The same creation/deduplication policy serves manual
// and timed work.
export async function createRunRequest(
  tx: tTransaction,
  owner: iKnowledgeOwner,
  targetSourceId: string,
  trigger: tRunTrigger,
) {
  const [source] = await tx
    .select({ id: knowledgeSource.id })
    .from(knowledgeSource)
    .where(
      and(
        eq(knowledgeSource.id, targetSourceId),
        ownedBy(knowledgeSource, owner),
      ),
    )
  if (!source) throw new ApiError(404, 'source_missing', 'Source not found')
  const [created] = await tx
    .insert(indexRun)
    .values({ ...ownerOf(owner), targetSourceId, trigger })
    .onConflictDoNothing()
    .returning()
  if (created) return created
  const [active] = await tx
    .select()
    .from(indexRun)
    .where(
      and(
        eq(indexRun.targetSourceId, targetSourceId),
        sql`${indexRun.status} in ('queued', 'running')`,
      ),
    )
    .limit(1)
  if (active) return active
  throw new Error('Could not create indexing run')
}

// Dispatch is always after commit. A failed or ambiguous send leaves the run
// durable for worker recovery, including when the refresh deadline moved on.
export async function dispatchRunRequest(runId: string) {
  try {
    await advanceIndexRun(runId)
  } catch (error) {
    console.error(
      'Indexing run queued for recovery',
      error instanceof Error ? error.name : 'Unknown error',
    )
  }
}

export async function queueRun(
  owner: iKnowledgeOwner,
  targetSourceId: string,
  trigger: tRunTrigger,
) {
  const run = await db.transaction(async (tx) => {
    await lockOwner(tx, owner)
    return createRunRequest(tx, owner, targetSourceId, trigger)
  })
  await dispatchRunRequest(run.id)
  return run
}

// Ends queued or running jobs whose results are no longer wanted: the source
// was deleted, or a note was learned directly. Every stage re-checks its run
// under a lock before writing, so a job already mid-way writes nothing.
export async function closeActiveRuns(
  tx: tTransaction,
  sourceIds: string[],
  reason: string,
) {
  if (!sourceIds.length) return
  await tx
    .update(indexRun)
    .set({
      status: 'completed',
      phase: 'completed',
      completedAt: new Date(),
      errorSummary: reason,
    })
    .where(
      and(
        inArray(indexRun.targetSourceId, sourceIds),
        inArray(indexRun.status, ['queued', 'running']),
      ),
    )
}
