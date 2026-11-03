import { knowledgeChanged, ownerOf } from './owner'
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '../../db'
import { failPage } from './pageFailure'
import {
  type iSourceCheckMetadata,
  type tSourceFailure,
} from './sourceLifecycle'
import { recordIndexItemOutcome } from './pageOutcomes'
import { exhaustedPageStage } from './pageAttempts'
import { indexRun, indexRunItem, knowledgeSource } from '../../db/schema'
import { deleteOrphanSharedBlocks } from './sharedBlockCleanup'
import { setAsideDuplicatePages } from './duplicatePages'
import {
  enqueueDiscovery,
  enqueueCrawlStart,
  enqueueEmbedPage,
  enqueuePreparePage,
  enqueueGroupWebsite,
  enqueueIndex,
} from '../queue/boss'

type tOutcome = 'indexed' | 'unchanged' | 'failed'

async function getRun(runId: string) {
  const [run] = await db
    .select()
    .from(indexRun)
    .where(eq(indexRun.id, runId))
    .limit(1)
  return run
}

export async function finishIndexItem(
  runId: string,
  sourceId: string,
  outcome: tOutcome,
  expectedStatus: 'preparing' | 'prepared' | 'embedding',
  attemptCount: number,
  advance = true,
  failure?: tSourceFailure,
  metadata?: iSourceCheckMetadata,
) {
  const changed = await recordIndexItemOutcome(
    runId,
    sourceId,
    outcome,
    expectedStatus,
    attemptCount,
    failure,
    metadata,
  )
  if (changed && advance) await advanceIndexRun(runId)
  return changed
}

export async function failIndexItem(
  runId: string,
  sourceId: string,
  error: unknown,
  attemptCount: number,
) {
  const changed = await failPage(runId, sourceId, error, attemptCount)
  if (changed) await advanceIndexRun(runId)
  return changed
}

export async function advanceIndexRun(runId: string) {
  const run = await getRun(runId)
  if (!run || ['completed', 'failed'].includes(run.status)) return
  if (run.phase === 'queued') {
    if (run.status === 'running' && (await completeRunIfReady(runId))) return
    if (run.targetSourceId) {
      const [source] = await db
        .select({ kind: knowledgeSource.kind })
        .from(knowledgeSource)
        .where(eq(knowledgeSource.id, run.targetSourceId))
        .limit(1)
      if (source?.kind === 'website' || source?.kind === 'webPage')
        await enqueueCrawlStart(runId, run.targetSourceId)
      else if (run.status === 'running' && run.discoveredCount > 0)
        await enqueueIndex(runId, run.targetSourceId)
      else await enqueueDiscovery(runId, run.targetSourceId)
    }
    return
  }
  if (run.phase === 'crawling') {
    if (
      run.targetSourceId &&
      run.nextCrawlCheckAt &&
      run.nextCrawlCheckAt <= new Date()
    )
      await enqueueCrawlStart(runId, run.targetSourceId)
    return
  }
  if (!run.crawlCollectedAt) return
  const now = new Date()
  const items = await db
    .select()
    .from(indexRunItem)
    .where(
      and(
        eq(indexRunItem.runId, runId),
        inArray(indexRunItem.status, [
          'queued',
          'preparing',
          'prepared',
          'embedding',
        ]),
        or(isNull(indexRunItem.leaseUntil), lte(indexRunItem.leaseUntil, now)),
      ),
    )
    .orderBy(
      sql`case when ${indexRunItem.status} in ('queued','preparing') then 0 when ${indexRunItem.status} = 'embedding' then 1 else 2 end`,
      indexRunItem.createdAt,
    )
    .limit(500)
  for (const item of items) {
    if (
      exhaustedPageStage(item) &&
      (!item.leaseUntil || item.leaseUntil <= now)
    ) {
      await failPage(
        runId,
        item.sourceId,
        new Error('Page processing attempt limit reached'),
        item.attemptCount,
      )
      continue
    }

    if (
      (item.status === 'queued' &&
        (!item.leaseUntil || item.leaseUntil <= now)) ||
      (item.status === 'preparing' &&
        (!item.leaseUntil || item.leaseUntil <= now))
    )
      await enqueuePreparePage(runId, item.sourceId)
    else if (
      item.status === 'embedding' &&
      (!item.leaseUntil || item.leaseUntil <= now)
    )
      await enqueueEmbedPage(runId, item.sourceId)
  }
  if (items.length) {
    const [pendingPreparation] = await db
      .select({ id: indexRunItem.sourceId })
      .from(indexRunItem)
      .where(
        and(
          eq(indexRunItem.runId, runId),
          inArray(indexRunItem.status, ['queued', 'preparing']),
        ),
      )
      .limit(1)
    if (!pendingPreparation && items.some((item) => item.status === 'prepared'))
      await enqueueGroupWebsite(runId)

    if (items.every((item) => item.status === 'embedding'))
      await db
        .update(indexRun)
        .set({ phase: 'embedding' })
        .where(and(eq(indexRun.id, runId), eq(indexRun.phase, 'preparing')))
    return
  }
  await completeRunIfReady(runId)
}

// Only this controller finalizes completed item sets. Scheduling is owned by
// the scheduler and settings, never by ingestion completion.
export async function completeRunIfReady(runId: string) {
  const finished = await finalizeRun(runId)
  // What its readers know changed, so their overviews are rebuilt once it settles.
  if (finished) await knowledgeChanged(finished).catch(() => undefined)
  return Boolean(finished)
}

async function finalizeRun(runId: string) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(indexRun)
      .where(eq(indexRun.id, runId))
      .for('update')
    if (!current || current.status !== 'running') return false
    if (!current.crawlCollectedAt) {
      // Uploads have no crawl stage; public documents can fail before their
      // preparation checkpoint. Both have a fixed item set once dispatched.
      const [target] = await tx
        .select({ kind: knowledgeSource.kind })
        .from(knowledgeSource)
        .where(eq(knowledgeSource.id, current.targetSourceId ?? ''))
        .limit(1)
      if (
        !target ||
        !['upload', 'publicDocument'].includes(target.kind) ||
        current.discoveredCount === 0
      )
        return false
    }
    const [pending] = await tx
      .select({ sourceId: indexRunItem.sourceId })
      .from(indexRunItem)
      .where(
        and(
          eq(indexRunItem.runId, runId),
          inArray(indexRunItem.status, [
            'queued',
            'preparing',
            'prepared',
            'embedding',
          ]),
        ),
      )
      .limit(1)
    if (pending) return false
    const [finished] = await tx
      .update(indexRun)
      .set({
        // Links are always followed, so a few dead ones are normal: the read
        // fails only when no page could be learned. Failed pages are counted
        // and shown on their own.
        status:
          current.discoveredCount === 0 ||
          current.failedCount >= current.discoveredCount
            ? 'failed'
            : 'completed',
        phase: 'completed',
        completedAt: new Date(),
        errorSummary:
          current.discoveredCount === 0
            ? 'No eligible pages discovered'
            : current.errorSummary,
      })
      .where(
        and(
          eq(indexRun.id, runId),
          eq(indexRun.fetchedCount, current.discoveredCount),
        ),
      )
      .returning({ id: indexRun.id })
    if (finished && current.targetSourceId) {
      await setAsideDuplicatePages(tx, current.targetSourceId)
      await deleteOrphanSharedBlocks(tx, current.targetSourceId)
    }
    return finished ? ownerOf(current) : null
  })
}

let recoveryCursor: string | undefined

export async function recoverIndexRuns() {
  const readBatch = () =>
    db
      .select({ id: indexRun.id })
      .from(indexRun)
      .where(
        and(
          inArray(indexRun.status, ['queued', 'running']),
          recoveryCursor ? gt(indexRun.id, recoveryCursor) : undefined,
        ),
      )
      .orderBy(asc(indexRun.id))
      .limit(1000)
  let active = await readBatch()
  if (!active.length && recoveryCursor) {
    recoveryCursor = undefined
    active = await readBatch()
  }
  for (const run of active) {
    try {
      await advanceIndexRun(run.id)
    } catch (error) {
      console.error(
        'Index run recovery failed',
        run.id,
        error instanceof Error ? error.name : 'UnknownError',
      )
    }
  }
  // Rotate even when a run fails or waits indefinitely. Newly inserted IDs
  // before the cursor are visited after the bounded scan wraps.
  recoveryCursor = active.length === 1000 ? active.at(-1)!.id : undefined
}

export async function repairActiveRunCounters() {
  const active = await db
    .select({ id: indexRun.id })
    .from(indexRun)
    .where(inArray(indexRun.status, ['queued', 'running']))
  for (const run of active) {
    try {
      await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(indexRun)
          .where(eq(indexRun.id, run.id))
          .for('update')
        if (!locked || !['queued', 'running'].includes(locked.status)) return
        const [counts] = await tx
          .select({
            discoveredCount: sql<number>`count(*)::int`,
            fetchedCount: sql<number>`count(*) filter (where ${indexRunItem.status} in ('indexed', 'unchanged', 'failed'))::int`,
            indexedCount: sql<number>`count(*) filter (where ${indexRunItem.status} = 'indexed')::int`,
            unchangedCount: sql<number>`count(*) filter (where ${indexRunItem.status} = 'unchanged')::int`,
            failedCount: sql<number>`count(*) filter (where ${indexRunItem.status} = 'failed')::int`,
          })
          .from(indexRunItem)
          .where(eq(indexRunItem.runId, run.id))
        await tx.update(indexRun).set(counts).where(eq(indexRun.id, run.id))
      })
    } catch (error) {
      console.error(
        'Index counter repair failed',
        run.id,
        error instanceof Error ? error.name : 'UnknownError',
      )
    }
  }
}
