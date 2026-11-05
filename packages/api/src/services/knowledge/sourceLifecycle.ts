import { eq } from 'drizzle-orm'
import { knowledgeConfig } from '../../config/knowledge.config'
import type { db } from '../../db'
import {
  knowledgeChunk,
  knowledgeSharedBlockSource,
  knowledgeSource,
} from '../../db/schema'
import { sourceHasNewerResult } from './sourceFreshness'
import { deleteOrphanSharedBlocks } from './sharedBlockCleanup'

type tTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type tSourceFailure = {
  message: string
  unavailableStatus?: 404 | 410
}

export interface iSourceCheckMetadata {
  evidenceUrl?: string
  httpValidators?: { etag: string | null; lastModifiedHeader: string | null }
  readHash?: string
}

// The caller must lock the run and claim its terminal item before calling this
// helper. Source changes and item completion must commit in one transaction.
export async function recordSourceCheck(
  tx: tTransaction,
  sourceId: string,
  runStartedAt: Date | null,
  failure?: tSourceFailure,
  metadata?: iSourceCheckMetadata,
) {
  const [source] = await tx
    .select()
    .from(knowledgeSource)
    .where(eq(knowledgeSource.id, sourceId))
    .for('update')
  if (!source) throw new Error('Page source is missing')
  // Newer checks include 304s and archives, which do not change lastIndexedAt.
  if (sourceHasNewerResult(source, runStartedAt)) return

  const now = new Date()
  if (!failure) {
    await tx
      .update(knowledgeSource)
      .set({
        lastCheckedAt: now,
        resultStartedAt: runStartedAt,
        ...(metadata?.evidenceUrl ? { evidenceUrl: metadata.evidenceUrl } : {}),
        ...metadata?.httpValidators,
        ...(metadata?.readHash ? { readHash: metadata.readHash } : {}),
        lastAttemptStatus: 'unchanged',
        lastError: null,
        status: 'ready',
      })
      .where(eq(knowledgeSource.id, sourceId))
    return
  }

  const missing = failure.unavailableStatus !== undefined
  const firstMissing = missing && !source.archivedAt
  const deleteAfter =
    source.deleteAfter ??
    new Date(
      now.getTime() +
        (failure.unavailableStatus === 410
          ? knowledgeConfig.gonePageGraceMs
          : knowledgeConfig.missingPageGraceMs),
    )
  // Only a fresh confirmed missing response after the grace period may remove
  // knowledge. Transient failures retain the existing content and archive state.
  const deleteContent =
    missing &&
    source.deleteAfter !== null &&
    source.deleteAfter <= now &&
    source.contentDeletedAt === null
  if (deleteContent) {
    await tx.delete(knowledgeChunk).where(eq(knowledgeChunk.sourceId, sourceId))
    await tx
      .delete(knowledgeSharedBlockSource)
      .where(eq(knowledgeSharedBlockSource.sourceId, sourceId))
    if (source.parentId) await deleteOrphanSharedBlocks(tx, source.parentId)
  }
  await tx
    .update(knowledgeSource)
    .set({
      lastAttemptStatus: 'failed',
      lastError: failure.message,
      lastCheckedAt: now,
      resultStartedAt: runStartedAt,
      status: missing
        ? 'archived'
        : source.archivedAt
          ? 'archived'
          : source.status === 'ready'
            ? 'ready'
            : 'failed',
      ...(missing
        ? {
            archivedAt: source.archivedAt ?? now,
            deleteAfter,
            nextArchiveCheckAt:
              deleteContent || source.contentDeletedAt
                ? null
                : firstMissing
                  ? deleteAfter
                  : source.nextArchiveCheckAt,
          }
        : {}),
      ...(deleteContent
        ? {
            cleanedText: null,
            contentHash: null,
            cleanedCharCount: 0,
            pageProfile: null,
            pageActions: [],
            etag: null,
            lastModifiedHeader: null,
            readHash: null,
            cleanupStatus: null,
            cleanupStats: null,
            contentDeletedAt: now,
          }
        : {}),
    })
    .where(eq(knowledgeSource.id, sourceId))
}
