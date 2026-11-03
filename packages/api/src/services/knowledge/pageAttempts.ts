import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { knowledgeConfig } from '../../config/knowledge.config'
import { db } from '../../db'
import { indexRun, indexRunItem } from '../../db/schema'

export type tPageStage = 'prepare' | 'embed'

export function exhaustedPageStage(
  item: Pick<
    typeof indexRunItem.$inferSelect,
    'status' | 'prepareAttempts' | 'embedAttempts'
  >,
) {
  if (item.status === 'queued' || item.status === 'preparing')
    return item.prepareAttempts >= knowledgeConfig.pageAttempts
  if (item.status === 'embedding')
    return item.embedAttempts >= knowledgeConfig.pageAttempts
  return false
}

export async function claimPageAttempt(
  runId: string,
  sourceId: string,
  stage: tPageStage,
) {
  const preparation = stage === 'prepare'
  const [claim] = await db
    .update(indexRunItem)
    .set({
      ...(preparation ? { status: 'preparing' as const } : {}),
      attemptCount: sql`${indexRunItem.attemptCount} + 1`,
      ...(preparation
        ? { prepareAttempts: sql`${indexRunItem.prepareAttempts} + 1` }
        : { embedAttempts: sql`${indexRunItem.embedAttempts} + 1` }),
      leaseUntil: new Date(
        Date.now() +
          (preparation
            ? knowledgeConfig.preparationLeaseMs
            : knowledgeConfig.embeddingLeaseMs),
      ),
      lastError: null,
    })
    .where(
      and(
        eq(indexRunItem.runId, runId),
        eq(indexRunItem.sourceId, sourceId),
        sql`exists (select 1 from ${indexRun} where ${indexRun.id} = ${runId} and ${indexRun.status} = 'running')`,
        preparation
          ? or(
              eq(indexRunItem.status, 'queued'),
              eq(indexRunItem.status, 'preparing'),
            )
          : eq(indexRunItem.status, 'embedding'),
        or(
          isNull(indexRunItem.leaseUntil),
          lte(indexRunItem.leaseUntil, new Date()),
        ),
      ),
    )
    .returning()
  return claim
}

export function pageAttemptLimitExceeded(
  claim: typeof indexRunItem.$inferSelect,
  stage: tPageStage,
) {
  return (
    (stage === 'prepare' ? claim.prepareAttempts : claim.embedAttempts) >
    knowledgeConfig.pageAttempts
  )
}

// Deferral is a durable wait, not a failed preparation. The claim token still
// advances so an old delivery cannot mutate the deferred/newer attempt.
export async function deferPageAttempt(
  runId: string,
  sourceId: string,
  attemptCount: number,
  retryAt: number,
) {
  return db
    .update(indexRunItem)
    .set({
      status: 'queued',
      leaseUntil: new Date(retryAt),
      prepareAttempts: sql`greatest(0, ${indexRunItem.prepareAttempts} - 1)`,
    })
    .where(
      and(
        eq(indexRunItem.runId, runId),
        eq(indexRunItem.sourceId, sourceId),
        eq(indexRunItem.status, 'preparing'),
        eq(indexRunItem.attemptCount, attemptCount),
      ),
    )
    .returning({ sourceId: indexRunItem.sourceId })
}
