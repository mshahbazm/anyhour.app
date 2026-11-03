import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { indexRun, indexRunItem, knowledgeSource } from '../../db/schema'
import { ApiError } from '../http/apiError'
import { enqueueIndex } from '../queue/boss'
import { preparePage } from './preparePage'
import { knowledgeConfig } from '../../config/knowledge.config'
import { claimPageAttempt, pageAttemptLimitExceeded } from './pageAttempts'
import { recordSourceCheck } from './sourceLifecycle'
import { startCrawl } from './crawl'
import {
  advanceIndexRun,
  completeRunIfReady,
  failIndexItem,
} from './runOrchestrator'
import { indexUpload } from './uploadIndexing'
import { DocumentUnreadableError } from './documents'

async function scheduleIndex(runId: string, sourceId: string) {
  const active = await db.transaction(async (tx) => {
    const [run] = await tx
      .select({ status: indexRun.status })
      .from(indexRun)
      .where(eq(indexRun.id, runId))
      .for('update')
    if (run?.status !== 'running') return false
    const [item] = await tx
      .insert(indexRunItem)
      .values({ runId, sourceId })
      .onConflictDoNothing()
      .returning({ sourceId: indexRunItem.sourceId })
    if (item)
      await tx
        .update(indexRun)
        .set({ discoveredCount: sql`${indexRun.discoveredCount} + 1` })
        .where(eq(indexRun.id, runId))
    return true
  })
  if (!active) return
  // Always retry the send. A previous process may have stopped after the
  // durable item was created but before pg-boss accepted the job.
  await enqueueIndex(runId, sourceId)
}

export async function discoverSource(runId: string, sourceId: string) {
  const [run] = await db
    .select()
    .from(indexRun)
    .where(eq(indexRun.id, runId))
    .limit(1)
  if (!run || ['completed', 'failed'].includes(run.status)) return
  const [source] = await db
    .select()
    .from(knowledgeSource)
    .where(eq(knowledgeSource.id, sourceId))
    .limit(1)
  if (!source) throw new ApiError(404, 'source_missing', 'Source not found')
  // Old discovery messages enter the same controller/crawl path as new runs.
  if (run.crawlCollectedAt) return advanceIndexRun(runId)
  if (source.kind === 'website' || source.kind === 'webPage')
    return startCrawl(runId, sourceId)
  const [active] = await db
    .update(indexRun)
    .set({
      status: 'running',
      startedAt: sql`coalesce(${indexRun.startedAt}, now())`,
    })
    .where(
      and(
        eq(indexRun.id, runId),
        sql`${indexRun.status} in ('queued', 'running')`,
      ),
    )
    .returning({ id: indexRun.id })
  if (!active) return
  if (['publicDocument', 'upload'].includes(source.kind)) {
    await scheduleIndex(runId, source.id)
  } else {
    await db
      .update(knowledgeSource)
      .set({
        status: 'unsupported',
        lastError: 'YouTube ingestion is not available yet',
      })
      .where(eq(knowledgeSource.id, source.id))
    throw new ApiError(
      422,
      'unsupported_source',
      'YouTube ingestion is not available yet',
    )
  }
  await completeRunIfReady(runId)
}

export async function indexSource(runId: string, sourceId: string) {
  const [item] = await db
    .select({
      status: indexRunItem.status,
      runStatus: indexRun.status,
      phase: indexRun.phase,
    })
    .from(indexRunItem)
    .innerJoin(indexRun, eq(indexRunItem.runId, indexRun.id))
    .where(
      and(eq(indexRunItem.runId, runId), eq(indexRunItem.sourceId, sourceId)),
    )
    .limit(1)
  if (
    !item ||
    !['queued', 'embedding'].includes(item.status) ||
    item.runStatus === 'completed' ||
    item.runStatus === 'failed'
  )
    return
  const [source] = await db
    .select()
    .from(knowledgeSource)
    .where(eq(knowledgeSource.id, sourceId))
    .limit(1)
  if (!source) throw new Error('Source missing')
  if (source.kind === 'webPage' && ['queued', 'crawling'].includes(item.phase))
    return startCrawl(runId, sourceId)
  if (source.kind === 'webPage' || source.kind === 'publicDocument') {
    const [active] = await db
      .update(indexRun)
      .set({
        phase: sql`case when ${indexRun.phase} = 'queued' then 'preparing' else ${indexRun.phase} end`,
        crawlCollectedAt: sql`coalesce(${indexRun.crawlCollectedAt}, now())`,
      })
      .where(and(eq(indexRun.id, runId), eq(indexRun.status, 'running')))
      .returning({ id: indexRun.id })
    if (!active) return
    await preparePage(runId, sourceId)
    return
  }
  if (source.kind !== 'upload')
    throw new Error('Unsupported source kind for document indexing')
  await db
    .update(indexRunItem)
    .set({ status: 'embedding' })
    .where(
      and(
        eq(indexRunItem.runId, runId),
        eq(indexRunItem.sourceId, sourceId),
        eq(indexRunItem.status, 'queued'),
      ),
    )
  const claim = await claimPageAttempt(runId, sourceId, 'embed')
  if (!claim) return
  if (pageAttemptLimitExceeded(claim, 'embed')) {
    await failIndexItem(
      runId,
      sourceId,
      new Error('Upload processing attempt limit reached'),
      claim.attemptCount,
    )
    return
  }
  try {
    await indexUpload(runId, source, claim.attemptCount)
  } catch (error) {
    await db
      .update(indexRunItem)
      .set({
        leaseUntil: null,
        lastError:
          error instanceof Error
            ? error.message.slice(0, 500)
            : 'Upload indexing failed',
      })
      .where(
        and(
          eq(indexRunItem.runId, runId),
          eq(indexRunItem.sourceId, sourceId),
          eq(indexRunItem.status, 'embedding'),
          eq(indexRunItem.attemptCount, claim.attemptCount),
        ),
      )
    // An unreadable document will not improve on retry.
    if (
      error instanceof DocumentUnreadableError ||
      claim.embedAttempts >= knowledgeConfig.pageAttempts
    ) {
      await failIndexItem(runId, sourceId, error, claim.attemptCount)
      if (error instanceof DocumentUnreadableError) return
    }
    throw error
  }
}

// Queue delivery retries are transport policy. Discovery owns the terminal
// decision; page and upload attempts own their own durable retry budgets.
export async function handleDiscoveryFailure(
  runId: string,
  sourceId: string,
  error: unknown,
  retryCount: number,
) {
  if (retryCount >= knowledgeConfig.queueRetries)
    await failDiscovery(runId, sourceId, error)
}

// Discovery gave up: the run fails and the source keeps what it last learned.
export async function failDiscovery(
  runId: string,
  sourceId: string,
  error: unknown,
) {
  const message =
    error instanceof Error
      ? error.message.slice(0, 500)
      : 'Unknown indexing failure'
  await db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(indexRun)
      .where(eq(indexRun.id, runId))
      .for('update')
    if (!run || ['completed', 'failed'].includes(run.status)) return
    // Discovery owns only the initial transition. Once an item is durable,
    // failed queue delivery is recoverable by the run controller; a delayed
    // discovery delivery must never terminate preparation or embedding.
    if (run.phase !== 'queued' || run.crawlCollectedAt) return
    const [dispatched] = await tx
      .select({ sourceId: indexRunItem.sourceId })
      .from(indexRunItem)
      .where(eq(indexRunItem.runId, runId))
      .limit(1)
    if (dispatched) return
    await tx
      .update(indexRun)
      .set({ status: 'failed', errorSummary: message, completedAt: new Date() })
      .where(eq(indexRun.id, runId))
    await recordSourceCheck(tx, sourceId, run.startedAt, { message })
  })
}
