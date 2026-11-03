import { orgOf } from '../fixtures/knowledgeOwner'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { and, eq } from 'drizzle-orm'

// Supplemental service test for a whole-run failure with a nonterminal item.
test('staging cleanup protects active references and durably retires terminal-run references', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Staging cleanup test requires local PostgreSQL')

  const objects = new Set<string>()
  let failDeletes = false
  let deleteAttempts = 0
  const fixture = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      if (url.searchParams.has('list-type'))
        return new Response(
          `<ListBucketResult><IsTruncated>false</IsTruncated>${[...objects]
            .map(
              (key) =>
                `<Contents><Key>${key}</Key><LastModified>${new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString()}</LastModified></Contents>`,
            )
            .join('')}</ListBucketResult>`,
          { headers: { 'content-type': 'application/xml' } },
        )
      if (req.method === 'DELETE') {
        deleteAttempts++
        if (failDeletes)
          return new Response('Temporarily unavailable', { status: 503 })
        objects.delete(url.pathname.replace(/^\/stage\//u, ''))
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 404 })
    },
  })
  Object.assign(process.env, {
    NODE_ENV: 'test',
    FRONT_END_URL: 'http://localhost:3000',
    PORT: '3001',
    BETTER_AUTH_URL: 'http://localhost:3001',
    LLM_KEY: 'fixture',
    R2_ENDPOINT: `http://127.0.0.1:${fixture.port}`,
    R2_BUCKET: 'stage',
    R2_ACCESS_KEY_ID: 'fixture',
    R2_SECRET_ACCESS_KEY: 'fixture',
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
  const { assistant, knowledgeSource, indexRun, indexRunItem, storageCleanup } =
    await import('../../src/db/schema')
  const { pageAttemptStageKey, sweepStagedPages } =
    await import('../../src/services/knowledge/staging')
  const { sweepStorageCleanup } =
    await import('../../src/services/knowledge/storageCleanup')
  const [owner] = await db
    .insert(assistant)
    .values({
      organizationId: credentials.organizationId,
      name: 'Staging cleanup fixture',
    })
    .returning()
  let runId = '',
    sourceId = '',
    key = ''
  try {
    const [source] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(owner.id),
        kind: 'webPage',
        inputUrl: 'https://example.invalid/cleanup',
      })
      .returning()
    sourceId = source.id
    const [run] = await db
      .insert(indexRun)
      .values({
        organizationId: orgOf(owner.id),
        targetSourceId: sourceId,
        trigger: 'manual',
        status: 'running',
        phase: 'preparing',
      })
      .returning()
    runId = run.id
    key = pageAttemptStageKey(runId, sourceId, 'prepare', 1)
    objects.add(key)
    await db.insert(indexRunItem).values({
      runId,
      sourceId,
      status: 'prepared',
      stagedContentKey: key,
      attemptCount: 1,
    })
    await sweepStagedPages()
    assert(
      objects.has(key),
      'An old checkpoint still referenced by an active run must survive sweeping',
    )
    assert.equal(deleteAttempts, 0)
    assert.equal(
      (
        await db
          .select()
          .from(storageCleanup)
          .where(eq(storageCleanup.objectKey, key))
      ).length,
      0,
    )

    await db
      .update(indexRun)
      .set({ status: 'failed', completedAt: new Date() })
      .where(eq(indexRun.id, runId))
    failDeletes = true
    await sweepStagedPages()
    const [item] = await db
      .select()
      .from(indexRunItem)
      .where(
        and(eq(indexRunItem.runId, runId), eq(indexRunItem.sourceId, sourceId)),
      )
    assert.equal(
      item.status,
      'prepared',
      'Whole-run cleanup must not invent an item outcome',
    )
    assert.equal(item.stagedContentKey, null)
    assert(
      objects.has(key),
      'The fixture must exercise an actual failed storage deletion',
    )
    const [cleanup] = await db
      .select()
      .from(storageCleanup)
      .where(eq(storageCleanup.objectKey, key))
    assert(
      cleanup,
      'Deletion intent must survive clearing the terminal-run reference',
    )
    assert.equal(cleanup.attemptCount, 1)

    failDeletes = false
    await db
      .update(storageCleanup)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(storageCleanup.objectKey, key))
    await sweepStorageCleanup([key])
    assert(!objects.has(key))
    assert.equal(
      (
        await db
          .select()
          .from(storageCleanup)
          .where(eq(storageCleanup.objectKey, key))
      ).length,
      0,
    )
    // An exhausted page fails before preparation creates an attempt key. Its
    // terminal pointer remains the cleanup record until DELETE succeeds.
    const { preparePage } =
      await import('../../src/services/knowledge/preparePage')
    const { knowledgeConfig } =
      await import('../../src/config/knowledge.config')
    objects.add(key)
    await db
      .update(indexRun)
      .set({
        status: 'running',
        phase: 'preparing',
        completedAt: null,
        crawlCollectedAt: new Date(),
        discoveredCount: 1,
        fetchedCount: 0,
        failedCount: 0,
      })
      .where(eq(indexRun.id, runId))
    await db
      .update(indexRunItem)
      .set({
        status: 'queued',
        stagedContentKey: key,
        attemptCount: knowledgeConfig.pageAttempts,
        prepareAttempts: knowledgeConfig.pageAttempts,
        leaseUntil: null,
      })
      .where(
        and(eq(indexRunItem.runId, runId), eq(indexRunItem.sourceId, sourceId)),
      )
    failDeletes = true
    const beforeFailure = deleteAttempts
    await preparePage(runId, sourceId)
    const [failedItem] = await db
      .select()
      .from(indexRunItem)
      .where(
        and(eq(indexRunItem.runId, runId), eq(indexRunItem.sourceId, sourceId)),
      )
    assert.equal(failedItem.status, 'failed')
    assert.equal(
      failedItem.stagedContentKey,
      key,
      'Plain HTTP 503 must retain the exhausted page cleanup pointer',
    )
    assert(objects.has(key))
    assert(deleteAttempts > beforeFailure)
    failDeletes = false
    await sweepStagedPages()
    assert(!objects.has(key))
  } finally {
    if (key)
      await db.delete(storageCleanup).where(eq(storageCleanup.objectKey, key))
    if (runId) await db.delete(indexRun).where(eq(indexRun.id, runId))
    if (sourceId)
      await db.delete(knowledgeSource).where(eq(knowledgeSource.id, sourceId))
    await db.delete(assistant).where(eq(assistant.id, owner.id))
    fixture.stop(true)
  }
}, 60_000)
