import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { indexRunItem, knowledgeSource } from '../../db/schema'
import { enqueueArchiveRecheck } from '../queue/boss'
import { recordIndexItemOutcome } from './pageOutcomes'
import { cleanupPageStage } from './staging'

export class PageUnavailableError extends Error {
  constructor(readonly status: 404 | 410) {
    super(`Page returned HTTP ${status}`)
  }
}

export async function failPage(
  runId: string,
  sourceId: string,
  error: unknown,
  attemptCount: number,
) {
  const message =
    error instanceof Error
      ? error.message.slice(0, 500)
      : 'Page indexing failed'
  const [item] = await db
    .select()
    .from(indexRunItem)
    .where(
      and(eq(indexRunItem.runId, runId), eq(indexRunItem.sourceId, sourceId)),
    )
    .limit(1)
  if (
    !item ||
    !['queued', 'preparing', 'prepared', 'embedding'].includes(item.status) ||
    item.attemptCount !== attemptCount
  )
    return false
  const finished = await recordIndexItemOutcome(
    runId,
    sourceId,
    'failed',
    item.status as 'queued' | 'preparing' | 'prepared' | 'embedding',
    item.attemptCount,
    {
      message,
      unavailableStatus:
        error instanceof PageUnavailableError ? error.status : undefined,
    },
  )
  if (!finished) return false
  if (error instanceof PageUnavailableError) {
    const [source] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, sourceId))
    if (
      source?.archivedAt &&
      source.nextArchiveCheckAt &&
      !source.contentDeletedAt
    )
      await enqueueArchiveRecheck(
        source.id,
        source.archivedAt,
        source.nextArchiveCheckAt,
      ).catch(() => {
        // The persisted deadline lets worker recovery enqueue a lost send.
      })
  }
  if (item.stagedContentKey)
    await cleanupPageStage(runId, sourceId, item.stagedContentKey)
  return true
}
