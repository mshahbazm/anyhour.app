import { orgOf } from '../fixtures/knowledgeOwner'
import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { eq } from 'drizzle-orm'

test('index completion is counted once and re-included pages await refresh', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Indexer recovery test requires local PostgreSQL')
  process.env.FRONT_END_URL ??= 'http://localhost:3000'
  const { db } = await import('../../src/db')
  const { assistant, indexRun, indexRunItem, knowledgeSource, organization } =
    await import('../../src/db/schema')
  const { failIndexItem } =
    await import('../../src/services/knowledge/runOrchestrator')
  const { reconcileWebsitePaths } =
    await import('../../src/services/knowledge/sourcePaths')

  const refreshDeadline = new Date(Date.now() + 24 * 3_600_000)
  const organizationId = crypto.randomUUID()
  const assistantId = crypto.randomUUID()
  const rootId = crypto.randomUUID()
  const pageId = crypto.randomUUID()
  const uploadId = crypto.randomUUID()
  const runId = crypto.randomUUID()

  await db.insert(organization).values({
    id: organizationId,
    name: 'Indexer recovery test',
    slug: `indexer-recovery-${organizationId}`,
  })
  try {
    await db.insert(assistant).values({
      id: assistantId,
      organizationId,
      name: 'Indexer recovery test',
      refreshIntervalHours: 24,
      nextRefreshAt: refreshDeadline,
    })
    await db.insert(knowledgeSource).values([
      {
        id: rootId,
        organizationId: orgOf(assistantId),
        kind: 'website',
        inputUrl: 'https://example.com/',
        excludePaths: ['/hours'],
      },
      {
        id: uploadId,
        organizationId: orgOf(assistantId),
        kind: 'upload',
        status: 'pending',
      },
    ])
    await db.insert(knowledgeSource).values({
      id: pageId,
      organizationId: orgOf(assistantId),
      parentId: rootId,
      kind: 'webPage',
      canonicalUrl: 'https://example.com/hours',
      status: 'excluded',
      cleanedText: 'Old opening hours',
      contentHash: 'old-hash',
      etag: 'old-etag',
      lastModifiedHeader: 'old-date',
      readHash: 'old-read-hash',
    })
    await db.insert(indexRun).values({
      id: runId,
      organizationId: orgOf(assistantId),
      targetSourceId: uploadId,
      trigger: 'manual',
      status: 'running',
      discoveredCount: 1,
    })
    await db.insert(indexRunItem).values({ runId, sourceId: uploadId })

    await failIndexItem(runId, uploadId, new Error('failed'), 0)
    await failIndexItem(runId, uploadId, new Error('duplicate'), 0)
    const [run] = await db.select().from(indexRun).where(eq(indexRun.id, runId))
    const [item] = await db
      .select()
      .from(indexRunItem)
      .where(eq(indexRunItem.runId, runId))
    assert.equal(run.status, 'failed')
    assert.equal(run.discoveredCount, 1)
    assert.equal(run.fetchedCount, 1)
    assert.equal(run.failedCount, 1)
    assert.equal(item.status, 'failed')
    const [owner] = await db
      .select()
      .from(assistant)
      .where(eq(assistant.id, assistantId))
    assert.equal(owner.nextRefreshAt?.getTime(), refreshDeadline.getTime())

    await db
      .update(knowledgeSource)
      .set({ excludePaths: [] })
      .where(eq(knowledgeSource.id, rootId))
    await reconcileWebsitePaths(rootId)
    const [page] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, pageId))
    assert.equal(page.status, 'pending')
    assert.equal(page.etag, null)
    assert.equal(page.lastModifiedHeader, null)
    // Included again, the page is read and prepared afresh.
    assert.equal(page.readHash, null)
  } finally {
    await db.delete(indexRun).where(eq(indexRun.id, runId))
    await db.delete(knowledgeSource).where(eq(knowledgeSource.id, pageId))
    await db.delete(knowledgeSource).where(eq(knowledgeSource.id, uploadId))
    await db.delete(knowledgeSource).where(eq(knowledgeSource.id, rootId))
    await db.delete(assistant).where(eq(assistant.id, assistantId))
    await db.delete(organization).where(eq(organization.id, organizationId))
  }
})

test('document failure before preparation finalizes once without closing unfinished crawls', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Indexer recovery test requires local PostgreSQL')
  process.env.FRONT_END_URL ??= 'http://localhost:3000'
  const { db } = await import('../../src/db')
  const { assistant, indexRun, indexRunItem, knowledgeSource, organization } =
    await import('../../src/db/schema')
  const { failIndexItem } =
    await import('../../src/services/knowledge/runOrchestrator')
  const { advanceIndexRun, completeRunIfReady } =
    await import('../../src/services/knowledge/runOrchestrator')
  const { getBoss } = await import('../../src/services/queue/boss')
  const organizationId = crypto.randomUUID()
  const assistantId = crypto.randomUUID()
  const sourceId = crypto.randomUUID()
  const refreshDeadline = new Date(Date.now() + 24 * 3_600_000)
  await db.insert(organization).values({
    id: organizationId,
    name: 'Document recovery test',
    slug: `document-recovery-${organizationId}`,
  })
  try {
    await db.insert(assistant).values({
      id: assistantId,
      organizationId,
      name: 'Document recovery test',
      refreshIntervalHours: 24,
      nextRefreshAt: refreshDeadline,
    })
    await db.insert(knowledgeSource).values({
      id: sourceId,
      organizationId: orgOf(assistantId),
      kind: 'publicDocument',
      inputUrl: 'https://example.test/guide.pdf',
    })
    const [run] = await db
      .insert(indexRun)
      .values({
        organizationId: orgOf(assistantId),
        targetSourceId: sourceId,
        trigger: 'manual',
        status: 'running',
        phase: 'queued',
        startedAt: new Date(),
        discoveredCount: 1,
      })
      .returning()
    await db.insert(indexRunItem).values({ runId: run.id, sourceId })
    // A document must still wait while its only item is pending.
    assert.equal(await completeRunIfReady(run.id), false)
    await failIndexItem(
      run.id,
      sourceId,
      new Error('Failed before preparation'),
      0,
    )
    await failIndexItem(run.id, sourceId, new Error('Duplicate delivery'), 0)
    await advanceIndexRun(run.id)
    const [finished] = await db
      .select()
      .from(indexRun)
      .where(eq(indexRun.id, run.id))
    assert.equal(finished.status, 'failed')
    assert.equal(finished.phase, 'completed')
    assert(finished.completedAt)
    assert.equal(finished.crawlCollectedAt, null)
    assert.equal(finished.fetchedCount, 1)
    assert.equal(finished.failedCount, 1)
    const [owner] = await db
      .select()
      .from(assistant)
      .where(eq(assistant.id, assistantId))
    assert.equal(owner.nextRefreshAt?.getTime(), refreshDeadline.getTime())

    // The active-run constraint must now allow another run for this source.
    const [retry] = await db
      .insert(indexRun)
      .values({
        organizationId: orgOf(assistantId),
        targetSourceId: sourceId,
        trigger: 'manual',
        status: 'running',
      })
      .returning()
    assert.notEqual(retry.id, run.id)
    assert.equal(
      await completeRunIfReady(retry.id),
      false,
      'An empty document run is not complete',
    )
    await db
      .insert(indexRunItem)
      .values({ runId: retry.id, sourceId, status: 'failed' })
    await db
      .update(indexRun)
      .set({ discoveredCount: 1, fetchedCount: 1, failedCount: 1 })
      .where(eq(indexRun.id, retry.id))
    // Web pages and websites must still wait for collection to finish.
    for (const kind of ['webPage', 'website'] as const) {
      await db
        .update(knowledgeSource)
        .set({ kind })
        .where(eq(knowledgeSource.id, sourceId))
      assert.equal(await completeRunIfReady(retry.id), false)
    }
    // Recovery can also close document runs left stuck by the previous version.
    await db
      .update(knowledgeSource)
      .set({ kind: 'publicDocument' })
      .where(eq(knowledgeSource.id, sourceId))
    await advanceIndexRun(retry.id)
    const [recovered] = await db
      .select()
      .from(indexRun)
      .where(eq(indexRun.id, retry.id))
    assert.equal(recovered.status, 'failed')
  } finally {
    await db
      .delete(indexRun)
      .where(eq(indexRun.organizationId, orgOf(assistantId)))
    await db.delete(knowledgeSource).where(eq(knowledgeSource.id, sourceId))
    await db.delete(assistant).where(eq(assistant.id, assistantId))
    await db.delete(organization).where(eq(organization.id, organizationId))
    await (await getBoss()).stop()
  }
}, 30_000)

// Supplemental transaction tests; the HTTP suites exercise the same completion paths.
test('completion rejects stale attempts and commits source writes and counters once', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Item completion test requires local PostgreSQL')
  process.env.FRONT_END_URL ??= 'http://localhost:3000'
  const { db } = await import('../../src/db')
  const { assistant, indexRun, indexRunItem, knowledgeSource, organization } =
    await import('../../src/db/schema')
  const { finishRunItem } =
    await import('../../src/services/knowledge/runItems')
  const organizationId = crypto.randomUUID()
  const assistantId = crypto.randomUUID()
  const sourceId = crypto.randomUUID()
  const runId = crypto.randomUUID()
  await db.insert(organization).values({
    id: organizationId,
    name: 'Completion transaction test',
    slug: `completion-${organizationId}`,
  })
  try {
    await db
      .insert(assistant)
      .values({ id: assistantId, organizationId, name: 'Completion test' })
    await db.insert(knowledgeSource).values({
      id: sourceId,
      organizationId: orgOf(assistantId),
      kind: 'webPage',
      title: 'Original',
    })
    await db.insert(indexRun).values({
      id: runId,
      organizationId: orgOf(assistantId),
      targetSourceId: sourceId,
      trigger: 'manual',
      status: 'running',
      discoveredCount: 1,
    })
    await db
      .insert(indexRunItem)
      .values({ runId, sourceId, status: 'embedding', attemptCount: 2 })
    const completion = {
      runId,
      sourceId,
      outcome: 'indexed' as const,
      expectedStatus: 'embedding' as const,
      attemptCount: 2,
    }
    const readState = async () => ({
      run: (await db.select().from(indexRun).where(eq(indexRun.id, runId)))[0],
      item: (
        await db
          .select()
          .from(indexRunItem)
          .where(eq(indexRunItem.runId, runId))
      )[0],
      source: (
        await db
          .select()
          .from(knowledgeSource)
          .where(eq(knowledgeSource.id, sourceId))
      )[0],
    })
    const original = await readState()
    assert.equal(
      await db.transaction((tx) =>
        finishRunItem(tx, { ...completion, attemptCount: 1 }),
      ),
      false,
    )
    assert.deepEqual(await readState(), original)
    // A failed save after claiming completion must roll back the claim too.
    await assert.rejects(
      db.transaction(async (tx) => {
        assert.equal(await finishRunItem(tx, completion), true)
        await tx
          .update(knowledgeSource)
          .set({ title: 'Uncommitted' })
          .where(eq(knowledgeSource.id, sourceId))
        throw new Error('Saving knowledge failed')
      }),
      /Saving knowledge failed/,
    )
    assert.deepEqual(await readState(), original)
    const outcomes = await Promise.all(
      ['First worker', 'Second worker'].map((title) =>
        db.transaction(async (tx) => {
          const finished = await finishRunItem(tx, completion)
          if (finished)
            await tx
              .update(knowledgeSource)
              .set({ title })
              .where(eq(knowledgeSource.id, sourceId))
          return finished
        }),
      ),
    )
    assert.equal(outcomes.filter(Boolean).length, 1)
    const saved = await readState()
    assert.equal(saved.run.fetchedCount, 1)
    assert.equal(saved.run.indexedCount, 1)
    assert.equal(saved.run.failedCount, 0)
    assert.equal(saved.item.status, 'indexed')
    assert.equal(
      saved.source.title,
      outcomes[0] ? 'First worker' : 'Second worker',
    )
    assert.equal(
      await db.transaction((tx) =>
        finishRunItem(tx, { ...completion, outcome: 'failed' }),
      ),
      false,
    )
    assert.deepEqual(await readState(), saved)
  } finally {
    await db.delete(indexRun).where(eq(indexRun.id, runId))
    await db.delete(knowledgeSource).where(eq(knowledgeSource.id, sourceId))
    await db.delete(assistant).where(eq(assistant.id, assistantId))
    await db.delete(organization).where(eq(organization.id, organizationId))
  }
}, 30_000)

test('discovery retry exhaustion preserves durable items and later page stages', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Discovery recovery test requires local PostgreSQL')
  process.env.FRONT_END_URL ??= 'http://localhost:3000'
  const { db } = await import('../../src/db')
  const { assistant, indexRun, indexRunItem, knowledgeSource, organization } =
    await import('../../src/db/schema')
  const { discoverSource, handleDiscoveryFailure } =
    await import('../../src/services/knowledge/indexer')
  const { knowledgeConfig } = await import('../../src/config/knowledge.config')
  const { getBoss } = await import('../../src/services/queue/boss')
  const boss = await getBoss()
  const send = boss.send
  const queueError = new Error('Simulated dispatch outage')
  let sends = 0
  boss.send = (async () => {
    sends++
    throw queueError
  }) as typeof boss.send
  const organizationId = crypto.randomUUID()
  const assistantId = crypto.randomUUID()
  const sourceId = crypto.randomUUID()
  const runId = crypto.randomUUID()
  await db.insert(organization).values({
    id: organizationId,
    name: 'Discovery recovery',
    slug: `discovery-${organizationId}`,
  })
  try {
    await db
      .insert(assistant)
      .values({ id: assistantId, organizationId, name: 'Discovery recovery' })
    await db.insert(knowledgeSource).values({
      id: sourceId,
      organizationId: orgOf(assistantId),
      kind: 'publicDocument',
      inputUrl: 'https://discovery-recovery.example/document.txt',
      canonicalUrl: 'https://discovery-recovery.example/document.txt',
      status: 'ready',
      cleanedText: 'Previously indexed document content.',
    })
    await db.insert(indexRun).values({
      id: runId,
      organizationId: orgOf(assistantId),
      targetSourceId: sourceId,
      trigger: 'manual',
    })
    const readRun = async () =>
      (await db.select().from(indexRun).where(eq(indexRun.id, runId)))[0]
    for (let retry = 0; retry <= knowledgeConfig.queueRetries; retry++) {
      await assert.rejects(
        discoverSource(runId, sourceId),
        /Simulated dispatch outage/,
      )
      await handleDiscoveryFailure(runId, sourceId, queueError, retry)
    }
    const run = await readRun()
    assert.equal(sends, knowledgeConfig.queueRetries + 1)
    assert.equal(run.status, 'running')
    assert.equal(run.phase, 'queued')
    assert.equal(run.discoveredCount, 1)
    assert.equal(run.fetchedCount, 0)
    const [item] = await db
      .select()
      .from(indexRunItem)
      .where(eq(indexRunItem.runId, runId))
    assert.equal(item.status, 'queued')

    await db
      .update(indexRun)
      .set({ phase: 'preparing', crawlCollectedAt: new Date() })
      .where(eq(indexRun.id, runId))
    // A delayed discovery delivery dispatches the existing page through the
    // controller. Exhaustion of that delivery still cannot fail the run.
    await assert.rejects(
      discoverSource(runId, sourceId),
      /Simulated dispatch outage/,
    )
    await handleDiscoveryFailure(
      runId,
      sourceId,
      queueError,
      knowledgeConfig.queueRetries,
    )
    const progressed = await readRun()
    assert.equal(progressed.status, 'running')
    assert.equal(progressed.phase, 'preparing')
    assert.equal(progressed.discoveredCount, 1)
    assert.equal(progressed.failedCount, 0)
    const [source] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, sourceId))
    assert.equal(source.status, 'ready')
    assert.equal(source.cleanedText, 'Previously indexed document content.')
    assert.equal(source.lastError, null)
  } finally {
    boss.send = send
    await db.delete(indexRun).where(eq(indexRun.id, runId))
    await db.delete(knowledgeSource).where(eq(knowledgeSource.id, sourceId))
    await db.delete(assistant).where(eq(assistant.id, assistantId))
    await db.delete(organization).where(eq(organization.id, organizationId))
    await boss.stop()
  }
}, 30_000)
