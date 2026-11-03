import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '../../db'
import { knowledgeConfig } from '../../config/knowledge.config'
import { indexRun, indexRunItem } from '../../db/schema'
import { groupRepeatedBlocks } from './cleanup/repeatedBlocks'
import { formatBlocks, knowledgeFormatVersion } from './cleanup/formatBlocks'
import {
  pageAttemptStageKey,
  readStagedPageIfPresent,
  retireUnreferencedStage,
  publishStagedPage,
  type iStagedPage,
} from './staging'
import { advanceIndexRun } from './runOrchestrator'

export async function groupWebsite(runId: string) {
  const lease = new Date(Date.now() + knowledgeConfig.preparationLeaseMs)
  const [run] = await db
    .update(indexRun)
    .set({
      cleanupLeaseUntil: lease,
      cleanupAttempts: sql`${indexRun.cleanupAttempts}+1`,
    })
    .where(
      and(
        eq(indexRun.id, runId),
        eq(indexRun.status, 'running'),
        or(
          isNull(indexRun.cleanupLeaseUntil),
          lt(indexRun.cleanupLeaseUntil, new Date()),
        ),
      ),
    )
    .returning()
  if (!run) return
  let countAttempt = true
  let shouldAdvance = false
  const writtenKeys = new Set<string>()
  try {
    const items = await db
      .select()
      .from(indexRunItem)
      .where(eq(indexRunItem.runId, runId))
    if (
      items.some((item) => ['queued', 'preparing'].includes(item.status)) ||
      !items.some((item) => item.status === 'prepared')
    ) {
      countAttempt = false
      return
    }
    const ready = items.filter((item) =>
      ['prepared', 'embedding'].includes(item.status),
    )
    // Keep retainedBlocks in checkpoints until all pages are advanced; a restart recomputes the same groups.
    const pages: Array<{
      sourceId: string
      key: string
      page: iStagedPage
      item: typeof indexRunItem.$inferSelect
    }> = []
    let missingPreparation = false
    for (const item of ready) {
      let page: iStagedPage | null = null
      try {
        page = item.stagedContentKey
          ? await readStagedPageIfPresent(item.stagedContentKey)
          : null
      } catch {
        // A single object's unavailable storage is a page retry, not a reason
        // to spend the whole website's grouping budget or fail its siblings.
      }
      if (!page) {
        if (item.status === 'prepared') {
          const [reset] = await db
            .update(indexRunItem)
            .set({
              status: 'queued',
              leaseUntil: null,
              lastError:
                'Prepared checkpoint unavailable; retrying page preparation',
            })
            .where(
              and(
                eq(indexRunItem.runId, runId),
                eq(indexRunItem.sourceId, item.sourceId),
                eq(indexRunItem.status, 'prepared'),
                eq(indexRunItem.attemptCount, item.attemptCount),
              ),
            )
            .returning({ sourceId: indexRunItem.sourceId })
          missingPreparation ||= Boolean(reset)
        }
        continue
      }
      pages.push({
        sourceId: item.sourceId,
        key: item.stagedContentKey!,
        page,
        item,
      })
    }
    if (missingPreparation) {
      // Rebuilding evidence keeps the preparation budget; it is not a grouping failure.
      countAttempt = false
      shouldAdvance = true
      return
    }
    // Pages staged under an earlier content format are prepared again.
    const outdated = pages.filter(
      (item) => item.page.formatVersion !== knowledgeFormatVersion,
    )
    if (outdated.length) {
      // Re-preparation does not use a grouping attempt. Failed staging reads do.
      countAttempt = false
      for (const item of outdated)
        await db
          .update(indexRunItem)
          .set({ status: 'queued', leaseUntil: null })
          .where(
            and(
              eq(indexRunItem.runId, runId),
              eq(indexRunItem.sourceId, item.sourceId),
              eq(indexRunItem.status, 'prepared'),
              eq(indexRunItem.attemptCount, item.item.attemptCount),
            ),
          )
      shouldAdvance = true
      return
    }
    const grouped = groupRepeatedBlocks(
      pages.map((p) => ({
        sourceId: p.sourceId,
        blocks: p.page.retainedBlocks ?? [],
      })),
    )
    const embeddingKeys = new Map<string, string>()
    for (const item of pages) {
      // Embedding owns its published checkpoint. Grouping may consult that
      // evidence, but must not rewrite an in-flight embedding attempt's input.
      if (item.item.status !== 'prepared') continue
      embeddingKeys.set(item.sourceId, item.key)
      // Grouping is an optimization. Its global retry limit must never discard
      // successfully prepared evidence; the original checkpoint is indexable.
      if (run.cleanupAttempts > knowledgeConfig.groupingAttempts) continue
      const key = pageAttemptStageKey(
        runId,
        item.sourceId,
        'group',
        run.cleanupAttempts,
      )
      writtenKeys.add(key)
      const group = grouped.get(item.sourceId)!
      try {
        const published = await publishStagedPage({
          runId,
          sourceId: item.sourceId,
          attemptCount: item.item.attemptCount,
          status: 'prepared',
          previousKey: item.key,
          key,
          groupingLease: lease,
          page: item.page.retainedBlocks
            ? {
                ...item.page,
                shared: group.shared,
                preparedText: formatBlocks(group.specific),
              }
            : item.page,
        })
        if (published) embeddingKeys.set(item.sourceId, key)
      } catch {
        // Publication preserves the previous pointer on a failed PUT. Fall
        // back to that complete checkpoint rather than rerunning cleanup/AI.
        // If publication succeeded but retirement failed, prefer its new key.
        const [current] = await db
          .select({ key: indexRunItem.stagedContentKey })
          .from(indexRunItem)
          .where(
            and(
              eq(indexRunItem.runId, runId),
              eq(indexRunItem.sourceId, item.sourceId),
              eq(indexRunItem.status, 'prepared'),
              eq(indexRunItem.attemptCount, item.item.attemptCount),
            ),
          )
        if (current?.key === key) embeddingKeys.set(item.sourceId, key)
      }
    }
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(indexRun)
        .where(eq(indexRun.id, runId))
        .for('update')
      if (
        current?.status !== 'running' ||
        current.cleanupLeaseUntil?.getTime() !== lease.getTime()
      )
        return
      for (const item of pages) {
        const key = embeddingKeys.get(item.sourceId)
        if (!key) continue
        await tx
          .update(indexRunItem)
          .set({ status: 'embedding', leaseUntil: null })
          .where(
            and(
              eq(indexRunItem.runId, runId),
              eq(indexRunItem.sourceId, item.sourceId),
              eq(indexRunItem.status, 'prepared'),
              eq(indexRunItem.attemptCount, item.item.attemptCount),
              eq(indexRunItem.stagedContentKey, key),
            ),
          )
      }
    })
    shouldAdvance = true
  } finally {
    await db
      .update(indexRun)
      .set({
        cleanupLeaseUntil: null,
        ...(!countAttempt
          ? { cleanupAttempts: sql`${indexRun.cleanupAttempts}-1` }
          : {}),
      })
      .where(and(eq(indexRun.id, runId), eq(indexRun.cleanupLeaseUntil, lease)))
    for (const key of writtenKeys)
      await retireUnreferencedStage(key).catch(() => {
        // The prefix sweep recovers cleanup interrupted by a process/DB failure.
      })
    if (shouldAdvance) await advanceIndexRun(runId)
  }
}
