import { orgOf } from '../fixtures/knowledgeOwner'
import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { knowledgeFormatVersion } from '../../src/services/knowledge/cleanup/formatBlocks'

test('committed preparation survives failed dispatch and bounded recovery visits every active run', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Run recovery test requires local PostgreSQL')
  const objects = new Map<string, string>()
  const fixture = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (request.method === 'PUT') {
        objects.set(path, await request.text())
        return new Response(null)
      }
      if (request.method === 'DELETE') {
        objects.delete(path)
        return new Response(null, { status: 204 })
      }
      return objects.has(path)
        ? new Response(objects.get(path))
        : new Response(null, { status: 404 })
    },
  })
  Object.assign(process.env, {
    NODE_ENV: 'test',
    FRONT_END_URL: 'http://localhost:3000',
    R2_ENDPOINT: `http://127.0.0.1:${fixture.port}`,
    R2_BUCKET: 'stage',
    R2_ACCESS_KEY_ID: 'fixture',
    R2_SECRET_ACCESS_KEY: 'fixture',
  })
  const { db } = await import('../../src/db')
  const { assistant, indexRun, indexRunItem, knowledgeSource, organization } =
    await import('../../src/db/schema')
  const { knowledgeConfig } = await import('../../src/config/knowledge.config')
  const { preparePage } =
    await import('../../src/services/knowledge/preparePage')
  const { recoverIndexRuns } =
    await import('../../src/services/knowledge/runOrchestrator')
  const { getBoss } = await import('../../src/services/queue/boss')
  const boss = await getBoss()
  const send = boss.send
  let failDispatch = true
  let failedDispatches = 0
  const seen = new Map<string, number>()
  boss.send = (async (_name: string, data: unknown) => {
    if (failDispatch) {
      failedDispatches++
      throw new Error('Simulated dispatch failure after successful preparation')
    }
    const runId = (data as { runId?: string }).runId
    if (runId) seen.set(runId, (seen.get(runId) ?? 0) + 1)
    return crypto.randomUUID()
  }) as typeof boss.send
  const organizationId = crypto.randomUUID()
  const assistantId = crypto.randomUUID()
  await db.insert(organization).values({
    id: organizationId,
    name: 'Run recovery',
    slug: `run-recovery-${organizationId}`,
  })
  try {
    await db
      .insert(assistant)
      .values({ id: assistantId, organizationId, name: 'Run recovery' })
    const [source] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(assistantId),
        kind: 'webPage',
        status: 'ready',
        inputUrl: 'https://recovery.example/page',
        canonicalUrl: 'https://recovery.example/page',
        cleanedText: 'Previous published knowledge.',
      })
      .returning()
    const [run] = await db
      .insert(indexRun)
      .values({
        organizationId: orgOf(assistantId),
        targetSourceId: source.id,
        trigger: 'manual',
        status: 'running',
        phase: 'preparing',
        startedAt: new Date(),
        crawlCollectedAt: new Date(),
        discoveredCount: 1,
      })
      .returning()
    const stagedKey = `index-runs/${run.id}/pages/${source.id}.json`
    objects.set(
      `/stage/${stagedKey}`,
      JSON.stringify({
        url: source.canonicalUrl,
        title: 'Recovered preparation',
        formatVersion: knowledgeFormatVersion,
        blocks: [],
        retainedBlocks: [],
        preparedText: 'Prepared evidence awaiting embedding.',
        profileAttempted: true,
      }),
    )
    await db.insert(indexRunItem).values({
      runId: run.id,
      sourceId: source.id,
      stagedContentKey: stagedKey,
      attemptCount: knowledgeConfig.pageAttempts - 1,
      prepareAttempts: knowledgeConfig.pageAttempts - 1,
    })
    await preparePage(run.id, source.id)
    const [prepared] = await db
      .select()
      .from(indexRunItem)
      .where(eq(indexRunItem.runId, run.id))
    assert.equal(failedDispatches, 1)
    assert.equal(prepared.status, 'prepared')
    assert.equal(prepared.prepareAttempts, knowledgeConfig.pageAttempts)
    assert.equal(prepared.embedAttempts, 0)
    assert.equal(prepared.lastError, null)
    assert.ok(objects.has(`/stage/${prepared.stagedContentKey}`))
    const [preservedRun] = await db
      .select()
      .from(indexRun)
      .where(eq(indexRun.id, run.id))
    assert.equal(preservedRun.status, 'running')
    assert.equal(preservedRun.failedCount, 0)
    const [preservedSource] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, source.id))
    assert.equal(preservedSource.cleanedText, source.cleanedText)
    await db.delete(indexRun).where(eq(indexRun.id, run.id))
    await db.delete(knowledgeSource).where(eq(knowledgeSource.id, source.id))

    // All 1,001 runs remain active after dispatch. The second scan must reach
    // IDs beyond the first batch instead of repeatedly visiting its first 1,000.
    failDispatch = false
    const sources = Array.from({ length: 1001 }, () => ({
      id: crypto.randomUUID(),
      organizationId,
      assistantId,
      kind: 'upload' as const,
    }))
    await db.insert(knowledgeSource).values(sources)
    const runIds = Array.from({ length: 1001 }, () =>
      crypto.randomUUID(),
    ).sort()
    await db.insert(indexRun).values(
      runIds.map((id, index) => ({
        id,
        organizationId: orgOf(assistantId),
        targetSourceId: sources[index].id,
        trigger: 'manual' as const,
      })),
    )
    await recoverIndexRuns()
    assert.equal(seen.has(runIds.at(-1)!), false)
    await recoverIndexRuns()
    assert.ok(
      seen.has(runIds.at(-1)!),
      'The tail run was starved by the bounded scan',
    )
    assert.ok(
      runIds.every((id) => seen.has(id)),
      'Every active fixture run must receive recovery',
    )
    await recoverIndexRuns()
    assert.ok(
      (seen.get(runIds[0]) ?? 0) >= 2,
      'The cursor must wrap to older active work',
    )
    const retained = await db
      .select()
      .from(indexRun)
      .where(eq(indexRun.organizationId, orgOf(assistantId)))
    assert.equal(retained.length, 1001)
    assert.ok(retained.every((item) => item.status === 'queued'))
  } finally {
    boss.send = send
    await db
      .delete(indexRun)
      .where(eq(indexRun.organizationId, orgOf(assistantId)))
    await db
      .delete(knowledgeSource)
      .where(eq(knowledgeSource.organizationId, orgOf(assistantId)))
    await db.delete(assistant).where(eq(assistant.id, assistantId))
    await db.delete(organization).where(eq(organization.id, organizationId))
    await boss.stop()
    fixture.stop(true)
  }
}, 90_000)
