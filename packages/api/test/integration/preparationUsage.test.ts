import { orgOf } from '../fixtures/knowledgeOwner'
import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { knowledgeFormatVersion } from '../../src/services/knowledge/cleanup/formatBlocks'
import { decisionTasks } from '../../src/config/models.config'

const jevModel = decisionTasks.blockCleanup.models.typesafe
import type { iStagedPage } from '../../src/services/knowledge/staging'
import { structuredResponse } from '../fixtures/openAiResponses'

test('cleanup and profile accounting resume saved provider work and deduplicate pending events', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Preparation usage test requires local PostgreSQL')
  const objects = new Map<string, string>()
  let jevCalls = 0
  let profileCalls = 0
  let failNextUsage = false
  const fixture = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (path.startsWith('/stage/')) {
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
      }
      if (path === '/jev') {
        jevCalls++
        failNextUsage = true
        const body = (await request.json()) as {
          questions: Record<string, unknown>
        }
        return Response.json({
          model: jevModel,
          answers: Object.fromEntries(
            Object.keys(body.questions).map((id) => [
              id,
              {
                type: 'choice',
                choice: 'knowledge',
                confidence: 0.99,
                probabilities: {
                  knowledge: 0.97,
                  action: 0.01,
                  noise: 0.01,
                  uncertain: 0.01,
                },
              },
            ]),
          ),
          usage: { input_tokens: 120, output_tokens: 12 },
        })
      }
      if (path === '/v1/responses') {
        profileCalls++
        failNextUsage = true
        return structuredResponse(
          {
            summary: 'Opening hours and appointments.',
            purposes: ['Inform'],
            topics: ['Hours'],
            visitorGoals: ['Plan a visit'],
            actions: [],
          },
          { input: 30, output: 10 },
          'gpt-5.6-luna',
        )
      }
      return new Response(null, { status: 404 })
    },
  })
  const origin = `http://127.0.0.1:${fixture.port}`
  Object.assign(process.env, {
    NODE_ENV: 'test',
    FRONT_END_URL: 'http://localhost:3000',
    OPENAI_API_KEY: 'fixture',
    OPENAI_BASE_URL: `${origin}/v1`,
    R2_ENDPOINT: origin,
    R2_BUCKET: 'stage',
    R2_ACCESS_KEY_ID: 'fixture',
    R2_SECRET_ACCESS_KEY: 'fixture',
    DECISION_PROVIDER: 'typesafe',
    TYPESAFE_API_KEY: 'fixture',
    TYPESAFE_API_URL: `${origin}/jev`,
  })
  const { db } = await import('../../src/db')
  const {
    assistant,
    indexRun,
    indexRunItem,
    knowledgeSource,
    organization,
    aiUsageEvent,
  } = await import('../../src/db/schema')
  const { preparePage } =
    await import('../../src/services/knowledge/preparePage')
  const { sourcePreparationUsage } =
    await import('../../src/services/knowledge/preparationUsage')
  const { getBoss } = await import('../../src/services/queue/boss')
  const boss = await getBoss()
  const send = boss.send
  boss.send = (async () => crypto.randomUUID()) as typeof boss.send
  const insert = db.insert.bind(db)
  db.insert = ((table: Parameters<typeof db.insert>[0]) => {
    if (table === aiUsageEvent && failNextUsage) {
      failNextUsage = false
      throw new Error(
        'Injected usage persistence failure after provider response',
      )
    }
    return insert(table)
  }) as typeof db.insert
  const organizationId = crypto.randomUUID()
  const assistantId = crypto.randomUUID()
  await db.insert(organization).values({
    id: organizationId,
    name: 'Preparation accounting',
    slug: `preparation-${organizationId}`,
  })
  try {
    await db.insert(assistant).values({
      id: assistantId,
      organizationId,
      name: 'Preparation accounting',
    })
    const [source] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(assistantId),
        kind: 'webPage',
        inputUrl: 'https://accounting.example/hours',
        canonicalUrl: 'https://accounting.example/hours',
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
    const key = `index-runs/${run.id}/pages/${source.id}.json`
    objects.set(
      `/stage/${key}`,
      JSON.stringify({
        url: source.canonicalUrl,
        title: 'Opening hours',
        formatVersion: knowledgeFormatVersion,
        blocks: [
          {
            id: 'hours',
            text: 'We are open Monday through Friday, 9am to 5pm. Book ahead for appointments.',
            heading: 'Hours',
            region: 'main',
            links: [],
          },
        ],
      }),
    )
    await db
      .insert(indexRunItem)
      .values({ runId: run.id, sourceId: source.id, stagedContentKey: key })
    const checkpoint = async () => {
      const [item] = await db
        .select()
        .from(indexRunItem)
        .where(eq(indexRunItem.runId, run.id))
      assert(item.stagedContentKey)
      return {
        item,
        page: JSON.parse(
          objects.get(`/stage/${item.stagedContentKey}`)!,
        ) as iStagedPage,
      }
    }
    await assert.rejects(
      preparePage(run.id, source.id),
      /Injected usage persistence failure/,
    )
    const cleanup = await checkpoint()
    assert.equal(cleanup.item.status, 'queued')
    assert.equal(jevCalls, 1)
    assert.equal(profileCalls, 0)
    assert.equal(Object.keys(cleanup.page.cleanup!.decisions).length, 1)
    const cleanupUsage = cleanup.page.cleanup!.pendingUsage!
    assert.ok(cleanupUsage.id)

    await assert.rejects(
      preparePage(run.id, source.id),
      /Injected usage persistence failure/,
    )
    const profiled = await checkpoint()
    assert.equal(profiled.item.status, 'queued')
    assert.equal(
      jevCalls,
      1,
      'Accounting recovery must not repeat successful cleanup',
    )
    assert.equal(profileCalls, 1)
    assert.equal(profiled.page.profileAttempted, true)
    assert.ok(profiled.page.profile)
    assert.equal(profiled.page.cleanup?.pendingUsage, undefined)
    const profileUsage = profiled.page.pendingProfileUsage!
    assert.ok(profileUsage.id)

    await preparePage(run.id, source.id)
    const finished = await checkpoint()
    assert.equal(finished.item.status, 'prepared')
    assert.equal(finished.page.pendingProfileUsage, undefined)
    assert.equal(jevCalls, 1)
    assert.equal(
      profileCalls,
      1,
      'Accounting recovery must not repeat successful profiling',
    )
    const usage = await sourcePreparationUsage({ organizationId }, source.id)
    // Retrying an acknowledged insert whose checkpoint acknowledgement was
    // lost must be harmless: the stored provider response supplies the same ID.
    await usage(
      'cleanup',
      {
        provider: 'typesafe',
        model: jevModel,
        inputTokens: cleanupUsage.inputTokens,
        cachedInputTokens: 0,
        outputTokens: cleanupUsage.outputTokens,
        costUsd: '0',
      },
      cleanupUsage.id,
    )
    await usage('pageProfile', profileUsage, profileUsage.id)
    const events = await db
      .select()
      .from(aiUsageEvent)
      .where(eq(aiUsageEvent.sourceId, source.id))
    assert.equal(events.length, 2)
    assert.equal(
      events.find((event) => event.kind === 'cleanup')?.id,
      cleanupUsage.id,
    )
    assert.equal(
      events.find((event) => event.kind === 'pageProfile')?.id,
      profileUsage.id,
    )
    assert.equal(
      events.find((event) => event.kind === 'cleanup')?.inputTokens,
      120,
    )
    assert.equal(
      events.find((event) => event.kind === 'pageProfile')?.inputTokens,
      30,
    )
  } finally {
    db.insert = insert
    boss.send = send
    await db
      .delete(aiUsageEvent)
      .where(eq(aiUsageEvent.assistantId, assistantId))
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
}, 60_000)
