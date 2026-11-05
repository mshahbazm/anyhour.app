import { orgOf } from '../fixtures/knowledgeOwner'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { knowledgeFormatVersion } from '../../src/services/knowledge/cleanup/formatBlocks'
import { buildProfileChunk } from '../../src/services/knowledge/profileChunk'

// Service-level race tests; the provider hook makes concurrent writes
// deterministic. Reading a real website end to end is test/crawl.
test('embedding delivery preserves newer results and rechecks skipped profile vectors', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Embedding recovery test requires local PostgreSQL')
  const objects = new Map<string, string>()
  const vector = Array.from({ length: 384 }, (_, index) =>
    index === 0 ? 1 : 0,
  )
  let onEmbedding: (() => Promise<void>) | undefined
  const fixture = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url)
      if (pathname.startsWith('/stage/')) {
        if (request.method === 'DELETE') {
          objects.delete(pathname)
          return new Response(null, { status: 204 })
        }
        return objects.has(pathname)
          ? new Response(objects.get(pathname))
          : new Response(null, { status: 404 })
      }
      if (pathname === '/v1/embeddings') {
        const { input } = (await request.json()) as { input: string[] }
        const hook = onEmbedding
        onEmbedding = undefined
        await hook?.()
        return Response.json({
          data: input.map((_, index) => ({ index, embedding: vector })),
          usage: { total_tokens: input.length, prompt_tokens: input.length },
        })
      }
      return new Response(null, { status: 404 })
    },
  })
  try {
    const origin = `http://127.0.0.1:${fixture.port}`
    Object.assign(process.env, {
      NODE_ENV: 'test',
      FRONT_END_URL: 'http://localhost:3000',
      PORT: '3001',
      BETTER_AUTH_URL: 'http://localhost:3001',
      OPENAI_API_KEY: 'fixture-key',
      OPENAI_BASE_URL: `${origin}/v1`,
      R2_ENDPOINT: origin,
      R2_BUCKET: 'stage',
      R2_ACCESS_KEY_ID: 'fixture-key',
      R2_SECRET_ACCESS_KEY: 'fixture-secret',
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
    const { loadTestCredentials } =
      await import('../../scripts/localSeedSupport')
    const credentials = await loadTestCredentials('integration')
    const { db } = await import('../../src/db')
    const {
      assistant,
      knowledgeSource,
      knowledgeChunk,
      indexRun,
      indexRunItem,
      aiUsageEvent,
    } = await import('../../src/db/schema')
    const { embedPage } = await import('../../src/services/knowledge/embedPage')
    const [owner] = await db
      .insert(assistant)
      .values({
        organizationId: credentials.organizationId,
        name: 'Embedding recovery fixture',
      })
      .returning()
    const profile = {
      purposes: ['Contact'],
      visitorGoals: ['Book a meeting'],
      actions: [],
      topics: ['Support'],
      summary: 'Contact our team.',
    }
    const profileText = buildProfileChunk('Contact', profile)!
    async function createCase() {
      const [source] = await db
        .insert(knowledgeSource)
        .values({
          organizationId: orgOf(owner.id),
          kind: 'webPage',
          status: 'ready',
          title: 'Contact',
          canonicalUrl: `https://example.invalid/${crypto.randomUUID()}`,
          cleanedText: 'Existing content.',
          contentHash: 'existing-hash',
          pageProfile: profile,
          lastIndexedAt: new Date(Date.now() - 120_000),
          lastCheckedAt: new Date(Date.now() - 120_000),
        })
        .returning()
      await db.insert(knowledgeChunk).values([
        {
          organizationId: orgOf(owner.id),
          sourceId: source.id,
          position: 0,
          kind: 'content',
          text: source.cleanedText!,
          embedding: vector,
          embeddingModel: 'text-embedding-3-small',
        },
        {
          organizationId: orgOf(owner.id),
          sourceId: source.id,
          position: -1,
          kind: 'pageProfile',
          text: profileText,
          embedding: vector,
          embeddingModel: 'text-embedding-3-small',
        },
      ])
      const [run] = await db
        .insert(indexRun)
        .values({
          organizationId: orgOf(owner.id),
          targetSourceId: source.id,
          trigger: 'manual',
          status: 'running',
          phase: 'embedding',
          discoveredCount: 1,
          startedAt: new Date(Date.now() - 60_000),
          crawlCollectedAt: new Date(),
        })
        .returning()
      const key = `index-runs/${run.id}/pages/${source.id}.json`
      objects.set(
        `/stage/${key}`,
        JSON.stringify({
          formatVersion: knowledgeFormatVersion,
          url: source.canonicalUrl,
          title: source.title,
          preparedText: 'Older staged replacement content.',
          profile,
        }),
      )
      await db.insert(indexRunItem).values({
        runId: run.id,
        sourceId: source.id,
        status: 'embedding',
        stagedContentKey: key,
      })
      return { source, run }
    }
    const readSource = async (id: string) =>
      (
        await db
          .select()
          .from(knowledgeSource)
          .where(eq(knowledgeSource.id, id))
      )[0]
    const readChunks = async (id: string) =>
      db
        .select()
        .from(knowledgeChunk)
        .where(eq(knowledgeChunk.sourceId, id))
        .orderBy(knowledgeChunk.position)
    try {
      // Another delivery can finish while the first worker awaits vectors.
      // The late worker must not overwrite that terminal result.
      const { indexSource } =
        await import('../../src/services/knowledge/indexer')
      const { failIndexItem } =
        await import('../../src/services/knowledge/runOrchestrator')
      const [upload] = await db
        .insert(knowledgeSource)
        .values({
          organizationId: orgOf(owner.id),
          kind: 'upload',
          title: 'Upload race',
          cleanedText: 'Uploaded content pending indexing.',
        })
        .returning()
      const [uploadRun] = await db
        .insert(indexRun)
        .values({
          organizationId: orgOf(owner.id),
          targetSourceId: upload.id,
          trigger: 'manual',
          status: 'running',
          discoveredCount: 1,
          startedAt: new Date(),
        })
        .returning()
      await db
        .insert(indexRunItem)
        .values({ runId: uploadRun.id, sourceId: upload.id })
      let failedUpload: Awaited<ReturnType<typeof readSource>> | undefined
      onEmbedding = async () => {
        await failIndexItem(
          uploadRun.id,
          upload.id,
          new Error('Another delivery already failed'),
          1,
        )
        failedUpload = await readSource(upload.id)
      }
      await indexSource(uploadRun.id, upload.id)
      assert(failedUpload, 'Upload did not reach the embedding fixture')
      assert.deepEqual(await readSource(upload.id), failedUpload)
      assert.equal((await readChunks(upload.id)).length, 0)
      const [finishedUpload] = await db
        .select()
        .from(indexRun)
        .where(eq(indexRun.id, uploadRun.id))
      assert.equal(finishedUpload.status, 'failed')
      assert.equal(finishedUpload.fetchedCount, 1)
      assert.equal(finishedUpload.failedCount, 1)
      assert.equal(finishedUpload.indexedCount, 0)
      const discardedUsage = await db
        .select()
        .from(aiUsageEvent)
        .where(
          and(
            eq(aiUsageEvent.sourceId, upload.id),
            eq(aiUsageEvent.kind, 'embedding'),
          ),
        )
      assert.equal(
        discardedUsage.length,
        1,
        'Discarded provider work must be recorded exactly once',
      )
      assert(discardedUsage[0].inputTokens > 0)

      const { indexUpload } =
        await import('../../src/services/knowledge/uploadIndexing')
      for (const unchanged of [false, true]) {
        const text = 'Upload snapshot before a newer result.'
        const startedAt = new Date(Date.now() - 60_000)
        const [snapshot] = await db
          .insert(knowledgeSource)
          .values({
            organizationId: orgOf(owner.id),
            kind: 'upload',
            title: 'Older upload result',
            cleanedText: text,
            contentHash: unchanged
              ? createHash('sha256').update(text).digest('hex')
              : null,
            resultStartedAt: new Date(startedAt.getTime() - 60_000),
          })
          .returning()
        const [run] = await db
          .insert(indexRun)
          .values({
            organizationId: orgOf(owner.id),
            targetSourceId: snapshot.id,
            trigger: 'manual',
            status: 'running',
            discoveredCount: 1,
            startedAt,
          })
          .returning()
        await db.insert(indexRunItem).values({
          runId: run.id,
          sourceId: snapshot.id,
          status: 'embedding',
          attemptCount: 1,
        })
        await db.insert(knowledgeChunk).values({
          organizationId: orgOf(owner.id),
          sourceId: snapshot.id,
          position: 0,
          text: 'Newer committed upload content.',
          embedding: vector,
          embeddingModel: 'text-embedding-3-small',
        })
        let newer: Awaited<ReturnType<typeof readSource>> | undefined
        const saveNewer = async () => {
          await db
            .update(knowledgeSource)
            .set({
              title: 'Newer upload result',
              cleanedText: 'Newer committed upload content.',
              contentHash: 'newer-upload-hash',
              status: 'ready',
              resultStartedAt: new Date(),
              lastAttemptStatus: 'indexed',
              lastIndexedAt: new Date(),
            })
            .where(eq(knowledgeSource.id, snapshot.id))
          newer = await readSource(snapshot.id)
        }
        if (unchanged) await saveNewer()
        else onEmbedding = saveNewer
        const beforeChunks = await readChunks(snapshot.id)
        await indexUpload(run.id, snapshot, 1)
        assert(newer, 'The upload fixture did not save its newer result')
        assert.deepEqual(await readSource(snapshot.id), newer)
        assert.deepEqual(await readChunks(snapshot.id), beforeChunks)
        const [completed] = await db
          .select()
          .from(indexRun)
          .where(eq(indexRun.id, run.id))
        assert.equal(completed.status, 'completed')
        assert.equal(completed.unchangedCount, 1)
        assert.equal(completed.indexedCount, 0)
      }

      // A skipped embedding must be based on the current stored hash/text,
      // even when no newer refresh version has superseded this upload run.
      const originalText = 'Upload content eligible for the hash fast path.'
      const [staleUpload] = await db
        .insert(knowledgeSource)
        .values({
          organizationId: orgOf(owner.id),
          kind: 'upload',
          title: 'Stale hash snapshot',
          cleanedText: originalText,
          contentHash: createHash('sha256').update(originalText).digest('hex'),
          resultStartedAt: new Date(Date.now() - 60_000),
        })
        .returning()
      const [staleUploadRun] = await db
        .insert(indexRun)
        .values({
          organizationId: orgOf(owner.id),
          targetSourceId: staleUpload.id,
          trigger: 'manual',
          status: 'running',
          discoveredCount: 1,
          startedAt: new Date(),
        })
        .returning()
      await db.insert(indexRunItem).values({
        runId: staleUploadRun.id,
        sourceId: staleUpload.id,
        status: 'embedding',
        attemptCount: 1,
      })
      await db
        .update(knowledgeSource)
        .set({
          cleanedText: 'Changed content requiring an embedding.',
          contentHash: null,
        })
        .where(eq(knowledgeSource.id, staleUpload.id))
      const changedUpload = await readSource(staleUpload.id)
      await assert.rejects(
        indexUpload(staleUploadRun.id, staleUpload, 1),
        /Upload changed during indexing/,
      )
      assert.deepEqual(await readSource(staleUpload.id), changedUpload)
      const [uncommittedUpload] = await db
        .select()
        .from(indexRun)
        .where(eq(indexRun.id, staleUploadRun.id))
      assert.equal(uncommittedUpload.fetchedCount, 0)
      assert.equal(uncommittedUpload.unchangedCount, 0)

      for (const status of ['archived', 'ready'] as const) {
        const { source, run } = await createCase()
        const checkedAt = new Date()
        await db
          .update(knowledgeSource)
          .set({
            status,
            lastCheckedAt: checkedAt,
            resultStartedAt: checkedAt,
            archivedAt: status === 'archived' ? checkedAt : null,
            lastIndexedAt:
              status === 'ready' ? checkedAt : source.lastIndexedAt,
          })
          .where(eq(knowledgeSource.id, source.id))
        const before = await readSource(source.id)
        const chunks = await readChunks(source.id)
        await embedPage(run.id, source.id)
        assert.deepEqual(
          await readSource(source.id),
          before,
          `Stale staged success overwrote a newer ${status} result`,
        )
        assert.deepEqual(await readChunks(source.id), chunks)
        const [item] = await db
          .select()
          .from(indexRunItem)
          .where(
            and(
              eq(indexRunItem.runId, run.id),
              eq(indexRunItem.sourceId, source.id),
            ),
          )
        assert.equal(item.status, 'unchanged')
        assert.equal(item.stagedContentKey, null)
      }

      const concurrent = await createCase()
      const concurrentChunks = await readChunks(concurrent.source.id)
      let latest: Awaited<ReturnType<typeof readSource>> | undefined
      onEmbedding = async () => {
        const checkedAt = new Date()
        await db
          .update(knowledgeSource)
          .set({
            status: 'archived',
            archivedAt: checkedAt,
            lastCheckedAt: checkedAt,
            resultStartedAt: checkedAt,
          })
          .where(eq(knowledgeSource.id, concurrent.source.id))
        latest = await readSource(concurrent.source.id)
      }
      await embedPage(concurrent.run.id, concurrent.source.id)
      assert(
        latest,
        'The embedding fixture did not execute the concurrent archive',
      )
      assert.deepEqual(await readSource(concurrent.source.id), latest)
      assert.deepEqual(await readChunks(concurrent.source.id), concurrentChunks)

      const skipped = await createCase()
      onEmbedding = async () => {
        await db
          .update(knowledgeChunk)
          .set({ text: 'A concurrently refreshed profile' })
          .where(
            and(
              eq(knowledgeChunk.sourceId, skipped.source.id),
              eq(knowledgeChunk.kind, 'pageProfile'),
            ),
          )
      }
      await assert.rejects(
        embedPage(skipped.run.id, skipped.source.id),
        /Page changed during embedding/,
      )
      assert.equal(
        (await readSource(skipped.source.id)).contentHash,
        'existing-hash',
      )
      const protectedChunks = await readChunks(skipped.source.id)
      assert.equal(
        protectedChunks.find((chunk) => chunk.kind === 'content')?.text,
        'Existing content.',
      )
      assert.equal(
        protectedChunks.find((chunk) => chunk.kind === 'pageProfile')?.text,
        'A concurrently refreshed profile',
      )
      const [retryable] = await db
        .select()
        .from(indexRunItem)
        .where(
          and(
            eq(indexRunItem.runId, skipped.run.id),
            eq(indexRunItem.sourceId, skipped.source.id),
          ),
        )
      assert.equal(retryable.status, 'embedding')
      assert.equal(retryable.leaseUntil, null)
    } finally {
      await db
        .delete(aiUsageEvent)
        .where(eq(aiUsageEvent.assistantId, owner.id))
      await db
        .delete(indexRun)
        .where(eq(indexRun.organizationId, orgOf(owner.id)))
      await db
        .delete(knowledgeSource)
        .where(eq(knowledgeSource.organizationId, orgOf(owner.id)))
      await db.delete(assistant).where(eq(assistant.id, owner.id))
    }
  } finally {
    fixture.stop(true)
  }
}, 60_000)
