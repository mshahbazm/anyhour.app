import { and, eq, inArray, isNull, like, lt, or, sql } from 'drizzle-orm'
import { db } from '../../db'
import { knowledgeConfig } from '../../config/knowledge.config'
import { indexRun, indexRunItem, knowledgeSource } from '../../db/schema'
import { advanceIndexRun } from './runOrchestrator'
import {
  assertFetchableUrl,
  inspectHtml,
  discoverSitemap,
  isSameWebsite,
  normalizeUrl,
  pathAllowed,
} from './web'
import { areTwinPages, preferredPage, twinPrefix } from './pageTwins'
import { isRecordedDuplicate } from './duplicatePages'
import { ownedBy, ownerOf } from './owner'
import { sourceUsageContext } from './sourceUsageContext'
import { planWebsiteScope } from './scopePlan'

type tSource = typeof knowledgeSource.$inferSelect

async function getRun(runId: string) {
  const [run] = await db
    .select()
    .from(indexRun)
    .where(eq(indexRun.id, runId))
    .limit(1)
  return run
}

async function getCrawlTarget(sourceId: string) {
  const [root] = await db
    .select()
    .from(knowledgeSource)
    .where(eq(knowledgeSource.id, sourceId))
    .limit(1)
  if (!root?.inputUrl || !['website', 'webPage'].includes(root.kind))
    throw new Error('Crawl source is missing')
  return root
}

type tAdded = 'added' | 'skipped' | 'full'

// Queue one address of a website for reading, unless its rules skip it or
// the website already has its most pages.
async function addPage(
  runId: string,
  root: tSource,
  value: string,
  via: 'sitemap' | 'link',
): Promise<tAdded> {
  let url: string
  try {
    url = normalizeUrl(value)
  } catch {
    return 'skipped'
  }
  if (
    !root.inputUrl ||
    !isSameWebsite(root.inputUrl, url) ||
    !pathAllowed(url, root.includePaths, root.excludePaths)
  )
    return 'skipped'
  const run = await getRun(runId)
  if (run && run.discoveredCount >= knowledgeConfig.maxWebsitePages)
    return 'full'
  if (await skipTwin(root, url)) return 'skipped'
  if (await isRecordedDuplicate(root.id, url)) return 'skipped'
  const [existing] = await db
    .select()
    .from(knowledgeSource)
    .where(
      and(
        ownedBy(knowledgeSource, root),
        eq(knowledgeSource.canonicalUrl, url),
      ),
    )
    .limit(1)
  let page = existing
  if (!page) {
    ;[page] = await db
      .insert(knowledgeSource)
      .values({
        ...ownerOf(root),
        parentId: root.id,
        kind: 'webPage',
        inputUrl: url,
        canonicalUrl: url,
        discoveredVia: via,
        lastSeenAt: new Date(),
      })
      .onConflictDoNothing()
      .returning()
    if (!page)
      [page] = await db
        .select()
        .from(knowledgeSource)
        .where(
          and(
            ownedBy(knowledgeSource, root),
            eq(knowledgeSource.canonicalUrl, url),
          ),
        )
        .limit(1)
  }
  if (!page?.isIncluded || (page.parentId && page.parentId !== root.id))
    return 'skipped'
  await db
    .update(knowledgeSource)
    .set({ parentId: root.id, lastSeenAt: new Date() })
    .where(eq(knowledgeSource.id, page.id))
  return queuePage(runId, page.id)
}

// Learn a page served at several addresses once, at its best address. A copy
// already learned is set aside so its chunks stop appearing in answers.
async function skipTwin(root: tSource, url: string) {
  const prefix = twinPrefix(url).replace(/[\\%_]/g, '\\$&')
  const candidates = await db
    .select({ canonicalUrl: knowledgeSource.canonicalUrl })
    .from(knowledgeSource)
    .where(
      and(
        eq(knowledgeSource.parentId, root.id),
        // A better address that failed or was set aside doesn't count.
        inArray(knowledgeSource.status, ['pending', 'ready']),
        isNull(knowledgeSource.archivedAt),
        like(knowledgeSource.canonicalUrl, `${prefix}%`),
      ),
    )
  const better = candidates.find(
    ({ canonicalUrl }) =>
      canonicalUrl &&
      areTwinPages(canonicalUrl, url) &&
      preferredPage(canonicalUrl, url) === canonicalUrl,
  )?.canonicalUrl
  if (!better) {
    // This address is the better one: set aside copies found before it.
    const worse = candidates.flatMap(({ canonicalUrl }) =>
      canonicalUrl && areTwinPages(canonicalUrl, url) ? [canonicalUrl] : [],
    )
    if (worse.length)
      await db
        .update(knowledgeSource)
        .set({ status: 'excluded', lastError: `Same page as ${url}` })
        .where(
          and(
            eq(knowledgeSource.parentId, root.id),
            inArray(knowledgeSource.canonicalUrl, worse),
            inArray(knowledgeSource.status, ['pending', 'ready']),
          ),
        )
    return false
  }
  await db
    .update(knowledgeSource)
    .set({ status: 'excluded', lastError: `Same page as ${better}` })
    .where(
      and(
        eq(knowledgeSource.parentId, root.id),
        eq(knowledgeSource.canonicalUrl, url),
        inArray(knowledgeSource.status, ['pending', 'ready']),
      ),
    )
  return true
}

async function queuePage(runId: string, sourceId: string): Promise<tAdded> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(indexRun)
      .where(eq(indexRun.id, runId))
      .for('update')
    if (!run || !['queued', 'running'].includes(run.status)) return 'skipped'
    const [existingItem] = await tx
      .select()
      .from(indexRunItem)
      .where(
        and(eq(indexRunItem.runId, runId), eq(indexRunItem.sourceId, sourceId)),
      )
    if (existingItem) return 'skipped'
    if (run.discoveredCount >= knowledgeConfig.maxWebsitePages) return 'full'
    await tx.insert(indexRunItem).values({ runId, sourceId })
    await tx
      .update(indexRun)
      .set({ discoveredCount: sql`${indexRun.discoveredCount} + 1` })
      .where(eq(indexRun.id, runId))
    return 'added'
  })
}

async function completeCollection(runId: string, target: tSource) {
  await db
    .update(indexRun)
    .set({
      crawlCollectedAt: new Date(),
      phase: 'preparing',
      nextCrawlCheckAt: null,
    })
    .where(and(eq(indexRun.id, runId), eq(indexRun.status, 'running')))
  // A page becomes ready only after its content is processed. Setting its
  // lastCheckedAt here would also make its own result look stale.
  if (target.kind === 'website')
    await db
      .update(knowledgeSource)
      .set({
        status: 'ready',
        lastCheckedAt: new Date(),
        lastAttemptStatus: 'indexed',
        lastError: null,
      })
      .where(eq(knowledgeSource.id, target.id))
  await advanceIndexRun(runId)
}

// The pages we know of up front: the address itself, pages read before and
// the sitemap. Every page's own links are added as it is read
// (discoverPreparedPageLinks), sitemap or not.
async function discoverPages(runId: string, root: tSource) {
  if (!root.inputUrl) throw new Error('Crawl URL missing')
  // The page reader renders pages that need it (pageReading/).
  await db
    .update(indexRun)
    .set({ crawlProvider: 'browser', crawlWarning: null })
    .where(eq(indexRun.id, runId))
  if (root.kind === 'webPage') {
    await queuePage(runId, root.id)
    return completeCollection(runId, root)
  }
  const urls = new Set<string>([root.inputUrl])
  const previous = await db
    .select({ canonicalUrl: knowledgeSource.canonicalUrl })
    .from(knowledgeSource)
    .where(
      and(
        eq(knowledgeSource.parentId, root.id),
        eq(knowledgeSource.isIncluded, true),
      ),
    )
  for (const page of previous)
    if (page.canonicalUrl) urls.add(page.canonicalUrl)
  try {
    const run = await getRun(runId)
    for (const url of await discoverSitemap(root.inputUrl, {
      usage: sourceUsageContext(ownerOf(root), root.id),
      ...(run?.startedAt
        ? { websiteRead: { websiteId: root.id, startedAt: run.startedAt } }
        : {}),
    }))
      urls.add(url)
  } catch {
    /* root remains eligible */
  }
  // Plain addresses first, so their copies are set aside on this run.
  const ordered = [...urls].sort(
    (a, b) => Number(/[?]|\.html?$/i.test(a)) - Number(/[?]|\.html?$/i.test(b)),
  )
  for (const url of ordered)
    if ((await addPage(runId, root, url, 'sitemap')) === 'full') break
  await completeCollection(runId, root)
}

export async function startCrawl(runId: string, sourceId: string) {
  const run = await getRun(runId)
  if (
    !run ||
    !['queued', 'running'].includes(run.status) ||
    run.crawlCollectedAt
  )
    return
  let root = await getCrawlTarget(sourceId)
  await assertFetchableUrl(root.inputUrl!)
  // A new website's articles and listings are set aside before its first
  // read; reading the sitemap and asking about it can take a few minutes.
  const planning =
    run.trigger === 'created' && root.kind === 'website' && !root.scopePlan
  const now = new Date()
  const [claimed] = await db
    .update(indexRun)
    .set({
      status: 'running',
      phase: 'crawling',
      startedAt: run.startedAt ?? new Date(),
      nextCrawlCheckAt: new Date(Date.now() + (planning ? 600_000 : 120_000)),
    })
    .where(
      and(
        eq(indexRun.id, runId),
        or(
          eq(indexRun.phase, 'queued'),
          and(
            eq(indexRun.phase, 'crawling'),
            lt(indexRun.nextCrawlCheckAt, now),
          ),
        ),
      ),
    )
    .returning({ id: indexRun.id })
  if (!claimed) return
  if (planning) root = await planWebsiteScope(root)
  await discoverPages(runId, root)
}

export async function failCrawl(runId: string, error: unknown) {
  const message =
    error instanceof Error
      ? error.message.slice(0, 500)
      : 'Website crawl failed'
  const [failed] = await db
    .update(indexRun)
    .set({
      status: 'failed',
      phase: 'completed',
      errorSummary: message,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(indexRun.id, runId),
        inArray(indexRun.status, ['queued', 'running']),
        isNull(indexRun.crawlCollectedAt),
      ),
    )
    .returning({ sourceId: indexRun.targetSourceId })
  if (failed?.sourceId)
    await db
      .update(knowledgeSource)
      .set({
        lastAttemptStatus: 'failed',
        lastError: message,
        status: sql`CASE WHEN ${knowledgeSource.archivedAt} IS NOT NULL THEN 'archived' WHEN ${knowledgeSource.status} = 'ready' THEN 'ready' ELSE 'failed' END`,
      })
      .where(eq(knowledgeSource.id, failed.sourceId))
}

export async function handleCrawlFailure(
  runId: string,
  error: unknown,
  retryCount: number,
) {
  if (retryCount < knowledgeConfig.queueRetries) return
  await failCrawl(runId, error)
}

// Links on a page just read, in its HTML as the page reader served it.
export async function discoverPreparedPageLinks(
  runId: string,
  html: string,
  url: string,
) {
  const run = await getRun(runId)
  if (!run?.targetSourceId || run.status !== 'running') return
  const root = await getCrawlTarget(run.targetSourceId)
  if (root.kind !== 'website') return
  for (const link of new Set(inspectHtml(html, url).links))
    if ((await addPage(runId, root, link, 'link')) === 'full') return
}
