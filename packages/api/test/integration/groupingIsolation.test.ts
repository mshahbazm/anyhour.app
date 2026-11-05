import { orgOf } from '../fixtures/knowledgeOwner'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'

test('grouping isolates unreadable pages and preserves prepared evidence when one grouped PUT fails', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Grouping isolation test requires local PostgreSQL')
  const objects = new Map<string, string>()
  let unreadableKey = '',
    failGroupSource = ''
  const fixture = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url)
      if (pathname.startsWith('/stage/')) {
        const key = pathname.slice('/stage/'.length)
        if (req.method === 'PUT') {
          const content = await req.text()
          if (
            failGroupSource &&
            key.includes(`/pages/${failGroupSource}/group-`)
          ) {
            failGroupSource = ''
            return new Response('<Error><Code>InvalidRequest</Code></Error>', {
              status: 400,
            })
          }
          objects.set(key, content)
          return new Response(null)
        }
        if (req.method === 'DELETE') {
          objects.delete(key)
          return new Response(null, { status: 204 })
        }
        if (key === unreadableKey)
          return new Response('<Error><Code>AccessDenied</Code></Error>', {
            status: 403,
          })
        return objects.has(key)
          ? new Response(objects.get(key))
          : new Response(null, { status: 404 })
      }
      if (pathname === '/v1/embeddings') {
        const { input } = (await req.json()) as { input: string[] }
        return Response.json({
          data: input.map((_, index) => ({
            index,
            embedding: Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)),
          })),
          usage: { total_tokens: input.length, prompt_tokens: input.length },
        })
      }
      return new Response(null, { status: 404 })
    },
  })
  Object.assign(process.env, {
    NODE_ENV: 'test',
    FRONT_END_URL: 'http://localhost:3000',
    PORT: '3001',
    BETTER_AUTH_URL: 'http://localhost:3001',
    OPENAI_API_KEY: 'fixture',
    OPENAI_BASE_URL: `http://127.0.0.1:${fixture.port}/v1`,
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
  const {
    assistant,
    knowledgeSource,
    indexRun,
    indexRunItem,
    aiUsageEvent,
    storageCleanup,
  } = await import('../../src/db/schema')
  const { groupWebsite } =
    await import('../../src/services/knowledge/groupWebsite')
  const { preparePage } =
    await import('../../src/services/knowledge/preparePage')
  const { embedPage } = await import('../../src/services/knowledge/embedPage')
  const { readSourceSharedText } =
    await import('../../src/services/knowledge/sharedContent')
  const { knowledgeFormatVersion, formatBlocks } =
    await import('../../src/services/knowledge/cleanup/formatBlocks')
  const { pageAttemptStageKey, readStagedPageIfPresent } =
    await import('../../src/services/knowledge/staging')
  const { knowledgeConfig } = await import('../../src/config/knowledge.config')
  const [owner] = await db
    .insert(assistant)
    .values({
      organizationId: credentials.organizationId,
      name: 'Grouping isolation fixture',
    })
    .returning()
  const keys: string[] = []
  async function createCase() {
    const [root] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(owner.id),
        kind: 'website',
        inputUrl: 'https://example.invalid',
      })
      .returning()
    const [run] = await db
      .insert(indexRun)
      .values({
        organizationId: orgOf(owner.id),
        targetSourceId: root.id,
        trigger: 'manual',
        status: 'running',
        phase: 'preparing',
        startedAt: new Date(),
        crawlCollectedAt: new Date(),
        discoveredCount: 2,
      })
      .returning()
    const pages = []
    for (let index = 0; index < 2; index++) {
      const [source] = await db
        .insert(knowledgeSource)
        .values({
          organizationId: orgOf(owner.id),
          parentId: root.id,
          kind: 'webPage',
          title: `Page ${index}`,
          inputUrl: `https://example.invalid/${crypto.randomUUID()}`,
        })
        .returning()
      const blocks = [
        {
          id: 'fact',
          text: `Completed business facts for page ${index}.`,
          heading: '',
          region: 'main' as const,
          links: [],
        },
        {
          id: 'hours',
          text: 'Open daily from 9 AM.',
          heading: '',
          region: 'footer' as const,
          links: [],
        },
      ]
      const key = pageAttemptStageKey(run.id, source.id, 'prepare', 1)
      keys.push(key)
      objects.set(
        key,
        JSON.stringify({
          formatVersion: knowledgeFormatVersion,
          url: source.inputUrl,
          title: source.title,
          blocks,
          retainedBlocks: blocks,
          preparedText: formatBlocks(blocks),
          profileAttempted: true,
          profile: null,
        }),
      )
      await db.insert(indexRunItem).values({
        runId: run.id,
        sourceId: source.id,
        status: 'prepared',
        stagedContentKey: key,
        attemptCount: 1,
        prepareAttempts: 1,
      })
      pages.push({ source, key })
    }
    return { run, pages }
  }
  const item = async (runId: string, sourceId: string) =>
    (
      await db
        .select()
        .from(indexRunItem)
        .where(
          and(
            eq(indexRunItem.runId, runId),
            eq(indexRunItem.sourceId, sourceId),
          ),
        )
    )[0]
  try {
    const first = await createCase()
    const [healthy, bad] = first.pages
    unreadableKey = bad.key
    await db
      .update(indexRunItem)
      .set({ prepareAttempts: knowledgeConfig.pageAttempts - 1 })
      .where(
        and(
          eq(indexRunItem.runId, first.run.id),
          eq(indexRunItem.sourceId, bad.source.id),
        ),
      )
    await groupWebsite(first.run.id)
    assert.equal(
      (await item(first.run.id, healthy.source.id)).status,
      'prepared',
    )
    const rerouted = await item(first.run.id, bad.source.id)
    assert.equal(rerouted.status, 'queued')
    assert.equal(rerouted.stagedContentKey, bad.key)
    assert.equal(rerouted.prepareAttempts, knowledgeConfig.pageAttempts - 1)
    const [afterReadFailure] = await db
      .select()
      .from(indexRun)
      .where(eq(indexRun.id, first.run.id))
    assert.equal(afterReadFailure.cleanupAttempts, 0)
    await preparePage(first.run.id, bad.source.id)
    assert.equal((await item(first.run.id, bad.source.id)).status, 'failed')
    await groupWebsite(first.run.id)
    await embedPage(first.run.id, healthy.source.id)
    assert.equal(
      (await item(first.run.id, healthy.source.id)).status,
      'indexed',
    )
    const [firstFinished] = await db
      .select()
      .from(indexRun)
      .where(eq(indexRun.id, first.run.id))
    assert.equal(firstFinished.failedCount, 1)
    assert.equal(firstFinished.indexedCount, 1)
    unreadableKey = ''

    const second = await createCase()
    failGroupSource = second.pages[0].source.id
    await groupWebsite(second.run.id)
    const fallback = await item(second.run.id, second.pages[0].source.id)
    assert.equal(fallback.status, 'embedding')
    assert.equal(fallback.stagedContentKey, second.pages[0].key)
    assert(objects.has(second.pages[0].key))
    for (const page of second.pages) {
      assert.equal(
        (await item(second.run.id, page.source.id)).prepareAttempts,
        1,
      )
      await embedPage(second.run.id, page.source.id)
      const [saved] = await db
        .select()
        .from(knowledgeSource)
        .where(eq(knowledgeSource.id, page.source.id))
      const text = [
        saved.cleanedText,
        ...(await readSourceSharedText(page.source.id)).map(
          (block) => block.text,
        ),
      ].join('\n')
      assert.equal(saved.status, 'ready')
      assert(text.includes('Completed business facts'))
      assert(text.includes('Open daily from 9 AM.'))
    }
    const [secondFinished] = await db
      .select()
      .from(indexRun)
      .where(eq(indexRun.id, second.run.id))
    assert.equal(secondFinished.status, 'completed')
    assert.equal(secondFinished.failedCount, 0)
    objects.set('malformed.json', '{broken')
    assert.equal(
      await readStagedPageIfPresent('malformed.json'),
      null,
      'Malformed checkpoints must be eligible for page re-preparation',
    )
    objects.set(
      'invalidBlocks.json',
      JSON.stringify({
        url: 'https://example.invalid',
        title: 'Invalid blocks',
        retainedBlocks: [{ text: 'Incomplete block' }],
      }),
    )
    assert.equal(
      await readStagedPageIfPresent('invalidBlocks.json'),
      null,
      'One malformed block must not crash grouping for every sibling',
    )
  } finally {
    await db.delete(aiUsageEvent).where(eq(aiUsageEvent.assistantId, owner.id))
    await db
      .delete(indexRun)
      .where(eq(indexRun.organizationId, orgOf(owner.id)))
    await db
      .delete(knowledgeSource)
      .where(eq(knowledgeSource.organizationId, orgOf(owner.id)))
    if (keys.length)
      await db
        .delete(storageCleanup)
        .where(inArray(storageCleanup.objectKey, keys))
    await db.delete(assistant).where(eq(assistant.id, owner.id))
    const { getBoss } = await import('../../src/services/queue/boss')
    await (await getBoss()).stop()
    fixture.stop(true)
  }
}, 90_000)
