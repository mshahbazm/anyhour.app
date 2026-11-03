import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { indexRun } from '../../db/schema'
import { finishRunItem } from './runItems'
import {
  recordSourceCheck,
  type iSourceCheckMetadata,
  type tSourceFailure,
} from './sourceLifecycle'

// Atomic state transitions do not dispatch work. The run controller decides
// what follows a committed outcome.
export async function recordIndexItemOutcome(
  runId: string,
  sourceId: string,
  outcome: 'indexed' | 'unchanged' | 'failed',
  expectedStatus: 'queued' | 'preparing' | 'prepared' | 'embedding',
  attemptCount: number,
  failure?: tSourceFailure,
  metadata?: iSourceCheckMetadata,
) {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select({ status: indexRun.status, startedAt: indexRun.startedAt })
      .from(indexRun)
      .where(eq(indexRun.id, runId))
      .for('update')
    if (run?.status !== 'running') return false
    const finished = await finishRunItem(tx, {
      runId,
      sourceId,
      outcome,
      expectedStatus,
      attemptCount,
      lastError: failure?.message,
    })
    if (!finished) return false
    if (failure || outcome === 'unchanged')
      await recordSourceCheck(tx, sourceId, run.startedAt, failure, metadata)
    return true
  })
}
