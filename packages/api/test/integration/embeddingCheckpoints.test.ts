import { orgOf } from '../fixtures/knowledgeOwner'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { and, eq } from 'drizzle-orm'

// Supplemental provider + PostgreSQL checks; HTTP ingestion is covered by the
// crawl/action suites. New adapters represent resumed worker deliveries.
test('embedding checkpoints survive later provider and publication failures', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Embedding checkpoint test requires local PostgreSQL')
  let rejectedText: string | undefined
  const requests: string[][] = []
  const provider = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== '/v1/embeddings')
        return new Response(null, { status: 404 })
      const { input } = (await request.json()) as { input: string[] }
      requests.push(input)
      if (rejectedText && input.some((text) => text.includes(rejectedText!)))
        return Response.json(
          {
            error: {
              message: 'Fixture rejects this batch',
              type: 'invalid_request_error',
            },
          },
          { status: 400 },
        )
      return Response.json({
        data: input.map((_, index) => ({
          index,
          embedding: Array.from({ length: 384 }, (_, dimension) =>
            dimension === 0 ? 1 : 0,
          ),
        })),
        usage: { total_tokens: input.length, prompt_tokens: input.length },
      })
    },
  })
  try {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      FRONT_END_URL: 'http://localhost:3000',
      PORT: '3001',
      BETTER_AUTH_URL: 'http://localhost:3001',
      OPENAI_API_KEY: 'fixture-key',
      OPENAI_BASE_URL: `http://127.0.0.1:${provider.port}/v1`,
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
      indexRun,
      indexRunItem,
      embeddingCheckpoint,
      knowledgeChunk,
      knowledgeSharedBlock,
      knowledgeSharedBlockSource,
      aiUsageEvent,
    } = await import('../../src/db/schema')
    const { embedTexts } =
      await import('../../src/services/knowledge/embedding')
    const { runEmbeddingCheckpoint, sweepEmbeddingCheckpoints } =
      await import('../../src/services/knowledge/embeddingCheckpoints')
    const { sourceEmbeddingUsage } =
      await import('../../src/services/knowledge/embeddingUsage')
    const { prepareSharedContent } =
      await import('../../src/services/knowledge/sharedContent')
    const { replaceContentChunks } =
      await import('../../src/services/knowledge/chunkPersistence')
    const [owner] = await db
      .insert(assistant)
      .values({
        organizationId: credentials.organizationId,
        name: 'Embedding checkpoint fixture',
      })
      .returning()
    const [website] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(owner.id),
        kind: 'website',
      })
      .returning()
    const createCase = async () => {
      const [source] = await db
        .insert(knowledgeSource)
        .values({
          organizationId: orgOf(owner.id),
          kind: 'webPage',
          parentId: website.id,
        })
        .returning()
      const [run] = await db
        .insert(indexRun)
        .values({
          organizationId: orgOf(owner.id),
          status: 'running',
          phase: 'embedding',
          trigger: 'manual',
          startedAt: new Date(),
          discoveredCount: 1,
        })
        .returning()
      await db
        .insert(indexRunItem)
        .values({ runId: run.id, sourceId: source.id, status: 'embedding' })
      const onUsage = await sourceEmbeddingUsage(
        { organizationId: owner.organizationId },
        source.id,
      )
      return {
        source,
        run,
        options: () => ({
          onUsage,
          checkpoint: runEmbeddingCheckpoint(run.id, source.id, onUsage),
        }),
      }
    }
    try {
      const partial = await createCase()
      const input = Array.from(
        { length: 129 },
        (_, index) => `paragraph ${index}`,
      )
      rejectedText = 'paragraph 128'
      await assert.rejects(
        embedTexts(input, partial.options()),
        // The provider's 400, classified (its own message never reaches us).
        /could not process this request/,
      )
      assert.equal(
        (
          await db
            .select()
            .from(embeddingCheckpoint)
            .where(eq(embeddingCheckpoint.runId, partial.run.id))
        ).length,
        1,
      )
      rejectedText = undefined
      const resumed = await embedTexts(input, partial.options())
      assert.equal(resumed.vectors.length, 129)
      assert.equal(
        requests.filter((batch) => batch.includes('paragraph 0')).length,
        1,
        'Retry repeated an already completed provider batch',
      )
      const partialUsage = await db
        .select()
        .from(aiUsageEvent)
        .where(eq(aiUsageEvent.sourceId, partial.source.id))
      assert.equal(
        partialUsage.reduce((sum, row) => sum + row.inputTokens, 0),
        129,
        'Cache hits recorded duplicate provider usage',
      )

      // Accounting and vectors commit together. If accounting fails, neither
      // row is durable; retry may repeat this provider request at that boundary.
      const accounting = await createCase()
      const accountingUsage = accounting.options().onUsage
      const broken = runEmbeddingCheckpoint(
        accounting.run.id,
        accounting.source.id,
        async (tokens, database) => {
          await accountingUsage(tokens, database)
          throw new Error('Accounting fixture rollback')
        },
      )
      await assert.rejects(
        embedTexts(['Accounting batch'], {
          onUsage: accountingUsage,
          checkpoint: broken,
        }),
        /Accounting fixture rollback/,
      )
      assert.equal(
        (
          await db
            .select()
            .from(embeddingCheckpoint)
            .where(eq(embeddingCheckpoint.runId, accounting.run.id))
        ).length,
        0,
      )
      assert.equal(
        (
          await db
            .select()
            .from(aiUsageEvent)
            .where(eq(aiUsageEvent.sourceId, accounting.source.id))
        ).length,
        0,
      )
      await embedTexts(['Accounting batch'], accounting.options())
      const requestsAfterAccounting = requests.length
      await embedTexts(['Accounting batch'], accounting.options())
      assert.equal(requests.length, requestsAfterAccounting)
      assert.equal(
        (
          await db
            .select()
            .from(aiUsageEvent)
            .where(eq(aiUsageEvent.sourceId, accounting.source.id))
        ).length,
        1,
      )

      const publication = await createCase()
      const content = ['Document body', 'Profile text']
      const blocks = [{ key: 'footer', text: 'Shared opening hours' }]
      const initial = await embedTexts(content, publication.options())
      rejectedText = 'Shared opening hours'
      await assert.rejects(
        prepareSharedContent(
          { organizationId: owner.organizationId },
          website.id,
          blocks,
          publication.options(),
        ),
        // The provider's 400, classified (its own message never reaches us).
        /could not process this request/,
      )
      rejectedText = undefined
      await embedTexts(content, publication.options())
      const shared = await prepareSharedContent(
        { organizationId: owner.organizationId },
        website.id,
        blocks,
        publication.options(),
      )
      assert.equal(
        requests.filter((batch) => batch.includes('Document body')).length,
        1,
        'Shared failure repeated content/profile provider work',
      )
      const beforeRollback = requests.length
      await assert.rejects(
        db.transaction(async (tx) => {
          await replaceContentChunks(
            tx,
            { organizationId: owner.organizationId },
            publication.source.id,
            content,
            initial.vectors,
          )
          await tx.insert(knowledgeSharedBlock).values(shared.records)
          await tx.insert(knowledgeSharedBlockSource).values(
            shared.ids.map((blockId) => ({
              blockId,
              sourceId: publication.source.id,
            })),
          )
          throw new Error('Publication fixture rollback')
        }),
        /Publication fixture rollback/,
      )
      assert.equal(
        (
          await db
            .select()
            .from(knowledgeChunk)
            .where(eq(knowledgeChunk.sourceId, publication.source.id))
        ).length,
        0,
      )
      assert.equal(
        (
          await db
            .select()
            .from(knowledgeSharedBlock)
            .where(eq(knowledgeSharedBlock.websiteId, website.id))
        ).length,
        0,
      )
      await embedTexts(content, publication.options())
      await prepareSharedContent(
        { organizationId: owner.organizationId },
        website.id,
        blocks,
        publication.options(),
      )
      assert.equal(
        requests.length,
        beforeRollback,
        'Publication retry repeated successful provider work',
      )

      await db
        .update(indexRunItem)
        .set({ status: 'indexed' })
        .where(
          and(
            eq(indexRunItem.runId, partial.run.id),
            eq(indexRunItem.sourceId, partial.source.id),
          ),
        )
      await sweepEmbeddingCheckpoints()
      assert.equal(
        (
          await db
            .select()
            .from(embeddingCheckpoint)
            .where(eq(embeddingCheckpoint.runId, partial.run.id))
        ).length,
        0,
      )
      assert.equal(
        (
          await db
            .select()
            .from(embeddingCheckpoint)
            .where(eq(embeddingCheckpoint.runId, publication.run.id))
        ).length,
        2,
        'Sweeper discarded active retry checkpoints',
      )
      await db
        .delete(knowledgeSource)
        .where(eq(knowledgeSource.id, publication.source.id))
      assert.equal(
        (
          await db
            .select()
            .from(embeddingCheckpoint)
            .where(eq(embeddingCheckpoint.runId, publication.run.id))
        ).length,
        0,
      )
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
    provider.stop(true)
  }
}, 60_000)
