import { orgOf } from '../fixtures/knowledgeOwner'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { eq } from 'drizzle-orm'

// Stale deliveries that cannot be reliably timed through live concurrent crawls.
test('stale failures and delayed archive jobs cannot invalidate restored knowledge', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Archive recovery test requires local PostgreSQL')
  Object.assign(process.env, {
    NODE_ENV: 'test',
    FRONT_END_URL: 'http://localhost:3000',
    PORT: '3001',
    BETTER_AUTH_URL: 'http://localhost:3001',
  })
  const seed = spawn(
    process.execPath,
    ['scripts/seedLocal.ts', '--integration'],
    {
      cwd: new URL('../../', import.meta.url).pathname,
      env: process.env,
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  )
  assert.equal((await once(seed, 'exit'))[0], 0)
  const { loadTestCredentials } = await import('../../scripts/localSeedSupport')
  const credentials = await loadTestCredentials('integration')
  const { db } = await import('../../src/db')
  const { assistant, knowledgeSource, knowledgeChunk, indexRun, indexRunItem } =
    await import('../../src/db/schema')
  const { failPage, PageUnavailableError } =
    await import('../../src/services/knowledge/pageFailure')
  const { recheckArchivedPage } =
    await import('../../src/services/knowledge/archivedPages')
  const { failDiscovery } = await import('../../src/services/knowledge/indexer')
  const { failIndexItem } =
    await import('../../src/services/knowledge/runOrchestrator')
  const { finishIndexItem } =
    await import('../../src/services/knowledge/runOrchestrator')
  const [owner] = await db
    .insert(assistant)
    .values({
      organizationId: credentials.organizationId,
      name: 'Archive recovery fixture',
    })
    .returning()
  try {
    const indexedAt = new Date()
    const [source] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(owner.id),
        kind: 'webPage',
        status: 'ready',
        canonicalUrl: 'https://example.invalid/restored',
        cleanedText: 'Current restored service information.',
        contentHash: 'restored-content',
        lastIndexedAt: indexedAt,
        resultStartedAt: indexedAt,
      })
      .returning()
    await db.insert(knowledgeChunk).values({
      organizationId: orgOf(owner.id),
      sourceId: source.id,
      position: 0,
      text: source.cleanedText!,
      embeddingModel: 'text-embedding-3-small',
      embedding: Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)),
    })
    const [run] = await db
      .insert(indexRun)
      .values({
        organizationId: orgOf(owner.id),
        targetSourceId: source.id,
        trigger: 'manual',
        status: 'running',
        phase: 'preparing',
        discoveredCount: 1,
        startedAt: new Date(indexedAt.getTime() - 60_000),
        crawlCollectedAt: indexedAt,
      })
      .returning()
    await db.insert(indexRunItem).values({
      runId: run.id,
      sourceId: source.id,
      status: 'preparing',
      attemptCount: 1,
    })
    await failPage(run.id, source.id, new PageUnavailableError(404), 1)
    const [after] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, source.id))
    assert.equal(after.status, 'ready')
    assert.equal(after.archivedAt, null)
    assert.equal(after.contentHash, source.contentHash)
    assert.equal(
      (
        await db
          .select()
          .from(knowledgeChunk)
          .where(eq(knowledgeChunk.sourceId, source.id))
      ).length,
      1,
    )
    const [finished] = await db
      .select()
      .from(indexRun)
      .where(eq(indexRun.id, run.id))
    assert.equal(finished.fetchedCount, 1)
    assert.equal(finished.failedCount, 1)

    const oldArchive = new Date(indexedAt.getTime() - 10_000).toISOString()
    await recheckArchivedPage(source.id, oldArchive, oldArchive)
    const archiveAt = new Date(indexedAt.getTime() - 1000)
    await db
      .update(knowledgeSource)
      .set({
        status: 'archived',
        archivedAt: archiveAt,
        nextArchiveCheckAt: archiveAt,
      })
      .where(eq(knowledgeSource.id, source.id))
    await recheckArchivedPage(source.id, oldArchive, oldArchive)
    assert.equal(
      (
        await db
          .select()
          .from(indexRun)
          .where(eq(indexRun.organizationId, orgOf(owner.id)))
      ).length,
      1,
      'Old archive delivery queued a new crawl',
    )
    const [unchanged] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, source.id))
    assert.equal(unchanged.nextArchiveCheckAt?.getTime(), archiveAt.getTime())

    await recheckArchivedPage(
      source.id,
      archiveAt.toISOString(),
      archiveAt.toISOString(),
    )
    const [overlapping] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, source.id))
    assert.equal(
      overlapping.nextArchiveCheckAt?.getTime(),
      archiveAt.getTime(),
      'A run started before the archive deadline consumed the pending recheck',
    )

    // A delayed recheck uses index-source, rather than prepare-page directly.
    // Exhausting its HTTP retries must retain the same archived source state.
    await db
      .update(indexRun)
      .set({ status: 'failed' })
      .where(eq(indexRun.id, run.id))
    const [retryRun] = await db
      .insert(indexRun)
      .values({
        organizationId: orgOf(owner.id),
        targetSourceId: source.id,
        trigger: 'scheduled',
        status: 'running',
        phase: 'preparing',
        discoveredCount: 1,
        startedAt: new Date(),
        crawlCollectedAt: new Date(),
      })
      .returning()
    await db.insert(indexRunItem).values({
      runId: retryRun.id,
      sourceId: source.id,
      status: 'queued',
      attemptCount: 3,
    })
    await db
      .update(knowledgeSource)
      .set({ nextArchiveCheckAt: null })
      .where(eq(knowledgeSource.id, source.id))
    await failIndexItem(
      retryRun.id,
      source.id,
      new Error('Page returned HTTP 503'),
      3,
    )
    const [afterRetry] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, source.id))
    assert.equal(afterRetry.status, 'archived')
    assert.equal(afterRetry.archivedAt?.getTime(), archiveAt.getTime())
    assert.equal(afterRetry.nextArchiveCheckAt, null)
    assert.equal(afterRetry.contentDeletedAt, null)
    assert.equal(afterRetry.cleanedText, source.cleanedText)
    const [failedRetry] = await db
      .select()
      .from(indexRun)
      .where(eq(indexRun.id, retryRun.id))
    assert.equal(failedRetry.status, 'failed')
    assert.equal(failedRetry.fetchedCount, 1)
    assert.equal(failedRetry.failedCount, 1)

    const [discoveryRun] = await db
      .insert(indexRun)
      .values({
        organizationId: orgOf(owner.id),
        targetSourceId: source.id,
        trigger: 'scheduled',
      })
      .returning()
    await failDiscovery(
      discoveryRun.id,
      source.id,
      new Error('Discovery temporarily unavailable'),
    )
    const [afterDiscovery] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, source.id))
    assert.equal(afterDiscovery.status, 'archived')
    assert.equal(afterDiscovery.cleanedText, source.cleanedText)

    // A successful unchanged read (the same read hash) is fresher evidence
    // even though it does not replace the content or bump lastIndexedAt.
    const earlierIndex = new Date(Date.now() - 120_000)
    await db
      .update(knowledgeSource)
      .set({
        status: 'ready',
        archivedAt: null,
        lastIndexedAt: earlierIndex,
        lastCheckedAt: earlierIndex,
        resultStartedAt: earlierIndex,
      })
      .where(eq(knowledgeSource.id, source.id))
    const conditionalRuns = await db
      .insert(indexRun)
      .values(
        [60_000, 30_000].map((age) => ({
          organizationId: orgOf(owner.id),
          trigger: 'manual' as const,
          status: 'running' as const,
          phase: 'preparing' as const,
          discoveredCount: 1,
          startedAt: new Date(Date.now() - age),
          crawlCollectedAt: new Date(),
        })),
      )
      .returning()
    await db.insert(indexRunItem).values(
      conditionalRuns.map((conditionalRun) => ({
        runId: conditionalRun.id,
        sourceId: source.id,
        status: 'preparing' as const,
        attemptCount: 1,
      })),
    )
    await finishIndexItem(
      conditionalRuns[1].id,
      source.id,
      'unchanged',
      'preparing',
      1,
      false,
    )
    await failPage(
      conditionalRuns[0].id,
      source.id,
      new PageUnavailableError(404),
      1,
    )
    const [afterConditional] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, source.id))
    assert.equal(afterConditional.status, 'ready')
    assert.equal(afterConditional.archivedAt, null)
    assert.equal(afterConditional.lastAttemptStatus, 'unchanged')
    assert.equal(
      afterConditional.lastIndexedAt?.getTime(),
      earlierIndex.getTime(),
    )
  } finally {
    await db
      .delete(indexRun)
      .where(eq(indexRun.organizationId, orgOf(owner.id)))
    await db
      .delete(knowledgeSource)
      .where(eq(knowledgeSource.organizationId, orgOf(owner.id)))
    await db.delete(assistant).where(eq(assistant.id, owner.id))
  }
}, 30_000)
