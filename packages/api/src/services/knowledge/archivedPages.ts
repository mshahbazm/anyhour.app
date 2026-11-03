import { and, eq, isNotNull, isNull, lte } from 'drizzle-orm'
import { db } from '../../db'
import { knowledgeSource } from '../../db/schema'
import { enqueueArchiveRecheck } from '../queue/boss'
import { ownerOf } from './owner'
import { queueRun } from './runRequests'
import { pathAllowed } from './web'

// Recovery only repairs overdue queue delivery; it does not repeatedly crawl.
export async function recoverArchiveRechecks() {
  const due = await db
    .select({
      id: knowledgeSource.id,
      archivedAt: knowledgeSource.archivedAt,
      nextArchiveCheckAt: knowledgeSource.nextArchiveCheckAt,
    })
    .from(knowledgeSource)
    .where(
      and(
        eq(knowledgeSource.status, 'archived'),
        isNotNull(knowledgeSource.archivedAt),
        isNull(knowledgeSource.contentDeletedAt),
        lte(knowledgeSource.nextArchiveCheckAt, new Date()),
      ),
    )
    .orderBy(knowledgeSource.nextArchiveCheckAt)
    .limit(50)
  for (const source of due)
    await enqueueArchiveRecheck(
      source.id,
      source.archivedAt!,
      source.nextArchiveCheckAt!,
    )
}

export async function recheckArchivedPage(
  sourceId: string,
  archivedAt: string,
  checkAt: string,
) {
  const [source] = await db
    .select({
      id: knowledgeSource.id,
      organizationId: knowledgeSource.organizationId,
      parentId: knowledgeSource.parentId,
      status: knowledgeSource.status,
      isIncluded: knowledgeSource.isIncluded,
      canonicalUrl: knowledgeSource.canonicalUrl,
      inputUrl: knowledgeSource.inputUrl,
      archivedAt: knowledgeSource.archivedAt,
      nextArchiveCheckAt: knowledgeSource.nextArchiveCheckAt,
      contentDeletedAt: knowledgeSource.contentDeletedAt,
    })
    .from(knowledgeSource)
    .where(eq(knowledgeSource.id, sourceId))
  if (
    !source ||
    source.status !== 'archived' ||
    source.contentDeletedAt ||
    source.archivedAt?.toISOString() !== archivedAt ||
    source.nextArchiveCheckAt?.toISOString() !== checkAt
  )
    return
  if (source.nextArchiveCheckAt > new Date())
    throw new Error('Archive recheck is not due yet')
  let eligible = source.isIncluded
  if (eligible && source.parentId) {
    const [parent] = await db
      .select({
        isIncluded: knowledgeSource.isIncluded,
        includePaths: knowledgeSource.includePaths,
        excludePaths: knowledgeSource.excludePaths,
      })
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, source.parentId))
    if (parent)
      eligible =
        parent.isIncluded &&
        pathAllowed(
          source.canonicalUrl ?? source.inputUrl!,
          parent.includePaths,
          parent.excludePaths,
        )
  }
  // queueRun persists its run before dispatch, and retries reuse the active run.
  if (eligible) {
    const run = await queueRun(ownerOf(source), source.id, 'scheduled')
    // An overlapping run may contain evidence fetched before this deadline.
    // Leave the deadline durable until recovery can dispatch a fresh run.
    if (run.startedAt && run.startedAt < source.nextArchiveCheckAt) return
  }
  await db
    .update(knowledgeSource)
    .set({ nextArchiveCheckAt: null })
    .where(
      and(
        eq(knowledgeSource.id, source.id),
        eq(knowledgeSource.archivedAt, source.archivedAt),
        eq(knowledgeSource.nextArchiveCheckAt, source.nextArchiveCheckAt),
      ),
    )
}
