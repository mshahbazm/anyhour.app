import { decisionModel } from '../ai/decisions'
import {
  contentHash,
  formatBlocks,
  knowledgeFormatVersion,
} from './cleanup/formatBlocks'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import {
  indexRun,
  indexRunItem,
  knowledgeChunk,
  knowledgeSource,
  knowledgeSharedBlockSource,
  knowledgeSharedBlock,
} from '../../db/schema'
import { prepareSharedContent } from './sharedContent'
import {
  claimPageAttempt,
  exhaustedPageStage,
  pageAttemptLimitExceeded,
} from './pageAttempts'
import { replaceContentChunks, writeProfileChunk } from './chunkPersistence'
import { sourceEmbeddingUsage } from './embeddingUsage'
import { chunkText } from './chunk'
import { runEmbeddingCheckpoint } from './embeddingCheckpoints'
import { embedTexts } from './embedding'
import { buildProfileChunk } from './profileChunk'
import { advanceIndexRun, failIndexItem } from './runOrchestrator'
import { finishRunItem } from './runItems'
import { sourceHasNewerResult } from './sourceFreshness'
import { cleanupPageStage, readStagedPageIfPresent } from './staging'
import { ownerOf } from './owner'

export async function embedPage(runId: string, sourceId: string) {
  const claim = await claimPageAttempt(runId, sourceId, 'embed')
  if (!claim) return
  if (pageAttemptLimitExceeded(claim, 'embed')) {
    await failIndexItem(
      runId,
      sourceId,
      new Error('Embedding attempt limit reached'),
      claim.attemptCount,
    )
    return
  }
  try {
    if (!claim.stagedContentKey) throw new Error('Prepared page is missing')
    const page = await readStagedPageIfPresent(claim.stagedContentKey)
    if (!page) {
      await db
        .update(indexRunItem)
        .set({ status: 'queued', leaseUntil: null, stagedContentKey: null })
        .where(
          and(
            eq(indexRunItem.runId, runId),
            eq(indexRunItem.sourceId, sourceId),
            eq(indexRunItem.status, 'embedding'),
            eq(indexRunItem.attemptCount, claim.attemptCount),
          ),
        )
      await advanceIndexRun(runId)
      return
    }
    if (page.formatVersion !== knowledgeFormatVersion) {
      await db
        .update(indexRunItem)
        .set({
          status: 'queued',
          leaseUntil: null,
          embedAttempts: sql`greatest(0, ${indexRunItem.embedAttempts} - 1)`,
        })
        .where(
          and(
            eq(indexRunItem.runId, runId),
            eq(indexRunItem.sourceId, sourceId),
            eq(indexRunItem.status, 'embedding'),
            eq(indexRunItem.attemptCount, claim.attemptCount),
          ),
        )
      await advanceIndexRun(runId)
      return
    }
    if (page.preparedText === undefined)
      throw new Error('Prepared text is missing')
    const [source] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, sourceId))
      .limit(1)
    if (!source) throw new Error('Page source is missing')
    const chunks = chunkText(page.preparedText, page.title)
    const fullText = page.retainedBlocks
      ? formatBlocks(page.retainedBlocks)
      : page.preparedText
    const hash = contentHash(page.title, fullText)
    const unchanged = hash === source.contentHash
    const sameChunks =
      unchanged &&
      source.cleanedText === page.preparedText &&
      source.title === page.title
    const profileText = buildProfileChunk(page.title, page.profile ?? null)
    const [previousProfile] = await db
      .select({ text: knowledgeChunk.text })
      .from(knowledgeChunk)
      .where(
        and(
          eq(knowledgeChunk.sourceId, sourceId),
          eq(knowledgeChunk.kind, 'pageProfile'),
        ),
      )
      .limit(1)
    const sameProfile = profileText === (previousProfile?.text ?? null)
    const contentInputs = sameChunks ? [] : chunks
    const signal = AbortSignal.timeout(8 * 60_000)
    const onUsage = await sourceEmbeddingUsage(ownerOf(source), sourceId)
    const checkpoint = runEmbeddingCheckpoint(runId, sourceId, onUsage)
    const { vectors } = await embedTexts(
      [...contentInputs, ...(!sameProfile && profileText ? [profileText] : [])],
      { signal, onUsage, checkpoint },
    )
    const shared = source.parentId
      ? await prepareSharedContent(
          ownerOf(source),
          source.parentId,
          page.shared ?? [],
          { signal, onUsage, checkpoint },
        )
      : { ids: [], tokens: 0, records: [] }
    const changed = await db.transaction(async (tx) => {
      const [run] = await tx
        .select({ status: indexRun.status, startedAt: indexRun.startedAt })
        .from(indexRun)
        .where(eq(indexRun.id, runId))
        .for('update')
      if (run?.status !== 'running') return false
      // Use the same source-before-chunks lock order as archive and backfill.
      // Recheck the snapshots used to skip paid embedding calls after the wait.
      const [current] = await tx
        .select()
        .from(knowledgeSource)
        .where(eq(knowledgeSource.id, sourceId))
        .for('update')
      if (!current) throw new Error('Page source is missing')
      const superseded = sourceHasNewerResult(current, run.startedAt)
      const [currentProfile] = await tx
        .select({ text: knowledgeChunk.text })
        .from(knowledgeChunk)
        .where(
          and(
            eq(knowledgeChunk.sourceId, sourceId),
            eq(knowledgeChunk.kind, 'pageProfile'),
          ),
        )
        .limit(1)
      if (
        !superseded &&
        ((sameChunks &&
          (current.contentHash !== source.contentHash ||
            current.cleanedText !== source.cleanedText ||
            current.title !== source.title)) ||
          (sameProfile && (currentProfile?.text ?? null) !== profileText))
      )
        throw new Error(
          'Page changed during embedding; retry with its current index',
        )
      const outcome = unchanged || superseded ? 'unchanged' : 'indexed'
      const finished = await finishRunItem(tx, {
        runId,
        sourceId,
        outcome,
        expectedStatus: 'embedding',
        attemptCount: claim.attemptCount,
      })
      if (!finished) return false
      if (!superseded) {
        if (!sameChunks)
          await replaceContentChunks(
            tx,
            ownerOf(source),
            sourceId,
            chunks,
            vectors,
          )
        if (!sameProfile)
          await writeProfileChunk(
            tx,
            ownerOf(source),
            sourceId,
            profileText,
            vectors[contentInputs.length],
          )
        if (shared.records.length)
          await tx
            .insert(knowledgeSharedBlock)
            .values(shared.records)
            .onConflictDoNothing()
        await tx
          .delete(knowledgeSharedBlockSource)
          .where(eq(knowledgeSharedBlockSource.sourceId, sourceId))
        if (shared.ids.length)
          await tx.insert(knowledgeSharedBlockSource).values(
            [...new Set(shared.ids)].map((blockId) => ({
              blockId,
              sourceId,
            })),
          )
        await tx
          .update(knowledgeSource)
          .set({
            title: page.title,
            evidenceUrl: page.url,
            ...(page.httpValidators ?? {}),
            ...(page.readHash ? { readHash: page.readHash } : {}),
            resultStartedAt: run.startedAt,
            cleanedText: page.preparedText,
            contentHash: hash,
            cleanedCharCount: fullText.length,
            pageProfile: page.profile ?? null,
            pageActions: page.retainedBlocks?.flatMap((b) => b.links) ?? [],
            cleanupStatus: page.cleanup?.complete ? 'complete' : 'incomplete',
            cleanupStats: page.cleanup
              ? {
                  model: page.cleanup.model ?? decisionModel('blockCleanup'),
                  attempts: page.cleanup.attempts,
                  activeMs: page.cleanup.activeMs,
                  inputTokens: page.cleanup.inputTokens,
                  outputTokens: page.cleanup.outputTokens,
                  reason: page.cleanup.reason,
                }
              : null,
            status: 'ready',
            archivedAt: null,
            deleteAfter: null,
            nextArchiveCheckAt: null,
            contentDeletedAt: null,
            lastAttemptStatus: unchanged ? 'unchanged' : 'indexed',
            lastError: null,
            lastCheckedAt: new Date(),
            lastIndexedAt: new Date(),
          })
          .where(eq(knowledgeSource.id, sourceId))
      }
      return true
    })
    if (changed) {
      await cleanupPageStage(runId, sourceId, claim.stagedContentKey)
      await advanceIndexRun(runId)
    }
  } catch (error) {
    await db
      .update(indexRunItem)
      .set({
        leaseUntil: null,
        lastError:
          error instanceof Error
            ? error.message.slice(0, 500)
            : 'Embedding failed',
      })
      .where(
        and(
          eq(indexRunItem.runId, runId),
          eq(indexRunItem.sourceId, sourceId),
          eq(indexRunItem.status, 'embedding'),
          eq(indexRunItem.attemptCount, claim.attemptCount),
        ),
      )
    if (exhaustedPageStage(claim)) {
      await failIndexItem(runId, sourceId, error, claim.attemptCount)
      return
    }
    throw error
  }
}
