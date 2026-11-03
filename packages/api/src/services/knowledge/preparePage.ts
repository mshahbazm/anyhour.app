import { and, eq } from 'drizzle-orm'
import { knowledgeConfig } from '../../config/knowledge.config'
import { db } from '../../db'
import { indexRunItem, knowledgeSource } from '../../db/schema'
import { enqueuePreparePage } from '../queue/boss'
import { extractPageBlocks } from './cleanup/extractBlocks'
import { knowledgeFormatVersion } from './cleanup/formatBlocks'
import { JevDeferred } from './cleanup/classifyBlocks'
import { createPageProfile } from './cleanup/pageProfile'
import { PageUnavailableError } from './pageFailure'
import { PageBlockedError } from './pageLoaders'
import { finishIndexItem, failIndexItem } from './runOrchestrator'
import { dispatchRunRequest } from './runRequests'
import {
  claimPageAttempt,
  pageAttemptLimitExceeded,
  deferPageAttempt,
} from './pageAttempts'
import { discoverPreparedPageLinks } from './crawl'
import { fetchPage } from './fetchPage'
import { preparePageContent } from './prepareContent'
import {
  pageAttemptStageKey,
  readStagedPageIfPresent,
  publishStagedPage,
  retireUnreferencedStage,
  writeStagedPage,
  type iStagedPage,
} from './staging'
import { syncStoredProfileChunk } from './syncProfileChunk'
import { assertPageScope, PageScopeError } from './pageScope'
import { sourceScope } from './sourceScope'
import { sourcePreparationUsage } from './preparationUsage'
import { ownerOf } from './owner'

export async function preparePage(runId: string, sourceId: string) {
  const now = new Date()
  const claim = await claimPageAttempt(runId, sourceId, 'prepare')
  if (!claim) return
  const key = pageAttemptStageKey(
    runId,
    sourceId,
    'prepare',
    claim.attemptCount,
  )
  let registeredKey = false
  if (pageAttemptLimitExceeded(claim, 'prepare')) {
    await failIndexItem(
      runId,
      sourceId,
      new Error('Page preparation attempt limit reached'),
      claim.attemptCount,
    )
    return
  }
  try {
    const [source] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, sourceId))
      .limit(1)
    if (!source) throw new Error('Page source is missing')
    const checkpoint = claim.stagedContentKey
      ? await readStagedPageIfPresent(claim.stagedContentKey)
      : null
    let page: iStagedPage
    if (checkpoint) page = checkpoint
    else {
      const result = await fetchPage(source)
      if (result.unchanged) {
        const finished = await finishIndexItem(
          runId,
          sourceId,
          'unchanged',
          'preparing',
          claim.attemptCount,
          true,
          undefined,
          {
            evidenceUrl: result.page.url,
            httpValidators: result.page.httpValidators,
          },
        )
        if (finished) await syncStoredProfileChunk(sourceId)
        return
      }
      page = result.page
    }
    // Revalidate checkpoints against current settings, including standalone
    // refreshes of children whose website exclusions have changed.
    const scope = await sourceScope(source)
    assertPageScope(scope, source.canonicalUrl ?? source.inputUrl ?? page.url)
    assertPageScope(scope, page.url)
    // Confirm expiry against the website now, rather than deleting on a
    // provider checkpoint which may have been collected before the deadline.
    if (
      (page.httpStatus === 404 || page.httpStatus === 410) &&
      source.deleteAfter &&
      source.deleteAfter <= now &&
      !source.contentDeletedAt
    )
      page = (await fetchPage(source)).page
    if (page.httpStatus === 404 || page.httpStatus === 410)
      throw new PageUnavailableError(page.httpStatus)
    // Old prepared checkpoints no longer have the HTML needed to recover exact
    // anchor positions. Fetch afresh rather than marking plain text as upgraded.
    if (page.formatVersion !== knowledgeFormatVersion) {
      if (!page.html && page.markdown === undefined)
        page = (await fetchPage(source, { force: true })).page
      else
        page = {
          url: page.url,
          title: page.title,
          html: page.html,
          markdown: page.markdown,
          httpValidators: page.httpValidators,
        }
    }
    if (page.html) await discoverPreparedPageLinks(runId, page.html, page.url)
    if (!page.blocks) {
      const extracted = extractPageBlocks(
        page.preparedText
          ? { url: page.url, title: page.title, markdown: page.preparedText }
          : page,
      )
      page = {
        formatVersion: knowledgeFormatVersion,
        url: page.url,
        title: extracted.title,
        blocks: extracted.blocks,
        httpValidators: page.httpValidators,
        ...(page.preparedText
          ? {
              preparedText: page.preparedText,
              retainedBlocks: extracted.blocks,
            }
          : {}),
      }
    } else {
      const { html: _html, markdown: _markdown, ...textPage } = page
      void _html
      void _markdown
      page = textPage
    }
    registeredKey = true
    if (
      !(await publishStagedPage({
        runId,
        sourceId,
        attemptCount: claim.attemptCount,
        status: 'preparing',
        previousKey: claim.stagedContentKey,
        key,
        page,
      }))
    )
      return
    const usage = await sourcePreparationUsage(ownerOf(source), sourceId)
    if (!page.preparedText) {
      const result = await preparePageContent(
        page,
        async (cleanup) => {
          page.cleanup = cleanup
          await writeStagedPage(key, page)
        },
        async (input, output, _attempt, eventId) =>
          usage('cleanup', input, output, eventId),
      )
      page = {
        ...page,
        title: result.title,
        preparedText: result.text,
        retainedBlocks: result.blocks,
        cleanup: result.cleanup,
      }
      await writeStagedPage(key, page)
    }
    if (!page.profileAttempted && page.retainedBlocks) {
      const result = await createPageProfile(page.title, page.retainedBlocks)
      page.profile = result.profile
      page.profileAttempted = true
      page.pendingProfileUsage = {
        id: crypto.randomUUID(),
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      }
      await writeStagedPage(key, page)
    }
    if (page.pendingProfileUsage) {
      const pending = page.pendingProfileUsage
      await usage(
        'pageProfile',
        pending.inputTokens,
        pending.outputTokens,
        pending.id,
      )
      delete page.pendingProfileUsage
      await writeStagedPage(key, page)
    }
    const [advanced] = await db
      .update(indexRunItem)
      .set({ status: 'prepared', stagedContentKey: key, leaseUntil: null })
      .where(
        and(
          eq(indexRunItem.runId, runId),
          eq(indexRunItem.sourceId, sourceId),
          eq(indexRunItem.status, 'preparing'),
          eq(indexRunItem.attemptCount, claim.attemptCount),
        ),
      )
      .returning()
    // Preparation is committed. Dispatch failure belongs to durable run
    // recovery, never to this successful preparation attempt's failure budget.
    if (advanced) await dispatchRunRequest(runId)
  } catch (error) {
    if (
      error instanceof PageUnavailableError ||
      error instanceof PageBlockedError ||
      error instanceof PageScopeError
    ) {
      await failIndexItem(runId, sourceId, error, claim.attemptCount)
      return
    }
    if (error instanceof JevDeferred) {
      const [deferred] = await deferPageAttempt(
        runId,
        sourceId,
        claim.attemptCount,
        error.retryAt,
      )
      if (!deferred) return
      await enqueuePreparePage(
        runId,
        sourceId,
        Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000)),
      )
      return
    }
    if (claim.prepareAttempts >= knowledgeConfig.pageAttempts) {
      await failIndexItem(runId, sourceId, error, claim.attemptCount)
      return
    }
    await db
      .update(indexRunItem)
      .set({
        status: 'queued',
        leaseUntil: null,
        lastError:
          error instanceof Error
            ? error.message.slice(0, 500)
            : 'Preparation failed',
      })
      .where(
        and(
          eq(indexRunItem.runId, runId),
          eq(indexRunItem.sourceId, sourceId),
          eq(indexRunItem.status, 'preparing'),
          eq(indexRunItem.attemptCount, claim.attemptCount),
        ),
      )
    throw error
  } finally {
    // An expired attempt can finish a PUT after its replacement has published
    // another key. Its own object is isolated and receives durable cleanup.
    if (registeredKey)
      await retireUnreferencedStage(key).catch(() => {
        // A process/DB failure is also recovered by the durable prefix sweep.
      })
  }
}
