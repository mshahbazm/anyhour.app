import { orgOf } from '../fixtures/knowledgeOwner'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { structuredResponse } from '../fixtures/openAiResponses'

// Facts the owner tells the bot: learned at once, gone at once when deleted,
// checked against the website before they override it, and re-checked when
// that page changes later.
test('notes are live immediately, ask before overriding the website, and follow website changes', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Knowledge notes test requires local PostgreSQL')
  const modelCalls: string[] = []
  // Every text embeds the same, so search returns everything this bot knows.
  const vector = Array.from({ length: 384 }, (_, index) =>
    index === 0 ? 1 : 0,
  )
  const fixture = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === '/v1/embeddings') {
        const body = (await request.json()) as { input: string[] }
        return Response.json({
          data: body.input.map((_, index) => ({ index, embedding: vector })),
          usage: { total_tokens: 1, prompt_tokens: 1 },
        })
      }
      if (url.pathname === '/v1/responses') {
        const body = (await request.json()) as {
          input: string
          text: { format: { name: string } }
        }
        const task = body.text.format.name
        modelCalls.push(task)
        if (task === 'factConflict') {
          // Only this test's pricing page disagrees; anything else the shared
          // test workspace's Your business holds doesn't.
          const passages = (
            JSON.parse(body.input) as { passages: Array<{ text: string }> }
          ).passages
          const passage = passages.findIndex((item) =>
            item.text.includes('Blog add-on: $200'),
          )
          const differs = body.input.includes('$250') && passage >= 0
          return structuredResponse({
            conflicts: differs
              ? [
                  {
                    passage,
                    pageValue: '$200',
                    newValue: '$250',
                    bothCanBeTrue: false,
                    pageSays: 'Blog add-on: $200',
                  },
                ]
              : [],
            youWillSay: 'Blog add-on: $250',
          })
        }
        if (task === 'correctionCheck')
          return structuredResponse({
            outcome: 'changed',
            websiteNow: 'Blog add-on: $300',
          })
        if (task === 'noteRewrite')
          return structuredResponse({ text: 'The blog add-on is $300.' })
      }
      return new Response('Not found', { status: 404 })
    },
  })
  let handle: (request: Request) => Response | Promise<Response> = () =>
    new Response(null, { status: 503 })
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => handle(request),
  })
  const origin = `http://127.0.0.1:${server.port}`
  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: String(server.port),
    BETTER_AUTH_URL: origin,
    FRONT_END_URL: 'http://localhost:3000',
    OPENAI_API_KEY: 'fixture-key',
    OPENAI_BASE_URL: `http://127.0.0.1:${fixture.port}/v1`,
  })
  const { app } = await import('../../src/app')
  handle = (request) => app.fetch(request)
  const { db } = await import('../../src/db')
  const {
    aiUsageEvent,
    assistant,
    knowledgeChunk,
    knowledgeCorrection,
    knowledgeSource,
    indexRun,
    serviceHeartbeat,
  } = await import('../../src/db/schema')
  const { checkCorrections } =
    await import('../../src/services/knowledge/corrections/checkCorrections')
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
  const [owner] = await db
    .insert(assistant)
    .values({
      organizationId: credentials.organizationId,
      name: 'Knowledge notes regression',
    })
    .returning()
  const base = `${origin}/api/organizations/${credentials.organizationId}/assistants/${owner.id}`
  const request = (
    path: string,
    method = 'GET',
    body?: unknown,
    cookie = credentials.accounts.owner.cookie,
  ) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        Cookie: cookie,
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const search = async (question: string) =>
    (await (
      await request(`/knowledge/search?q=${encodeURIComponent(question)}`)
    ).json()) as Array<{ sourceId: string; origin: string; text: string }>
  try {
    const [site] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(owner.id),
        kind: 'website',
        inputUrl: 'https://notes.example/',
        status: 'ready',
      })
      .returning()
    const [pricing] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(owner.id),
        parentId: site.id,
        kind: 'webPage',
        status: 'ready',
        title: 'Pricing | Notes Example',
        canonicalUrl: 'https://notes.example/pricing',
        cleanedText: 'Blog add-on: $200',
        contentHash: 'pricing-v1',
      })
      .returning()
    await db.insert(knowledgeChunk).values({
      organizationId: orgOf(owner.id),
      sourceId: pricing.id,
      position: 0,
      text: pricing.cleanedText!,
      embedding: vector,
      embeddingModel: 'text-embedding-3-small',
    })

    // Only people who can edit the bot may teach it.
    assert.equal(
      (
        await request(
          '/notes',
          'POST',
          { title: 'Hours', text: 'Open 9 to 5.' },
          credentials.accounts.member.cookie,
        )
      ).status,
      403,
    )

    // A note is searchable as the owner's word the moment it is saved.
    // Only this bot's own notes, so nothing reaches the shared test
    // workspace's Your business (knowledgeLayers covers the default).
    const hoursResponse = await request('/notes', 'POST', {
      title: 'Hours',
      text: 'Open 9 to 5.',
      scope: 'mine',
    })
    assert.equal(hoursResponse.status, 201)
    const hours = (await hoursResponse.json()) as { id: string }
    const [hoursRow] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, hours.id))
    assert.equal(hoursRow.kind, 'note')
    assert.equal(hoursRow.title, 'Hours')
    assert.equal(hoursRow.objectKey, null)
    assert.ok(
      (await search('hours')).some(
        (item) => item.sourceId === hours.id && item.origin === 'owner',
      ),
    )

    // A fact the website contradicts is flagged before it is saved.
    const conflictsResponse = await request('/notes/conflicts', 'POST', {
      noteId: null,
      title: 'Blog add-on price',
      text: 'The blog add-on is $250.',
    })
    assert.equal(conflictsResponse.status, 200)
    const conflicts = (await conflictsResponse.json()) as {
      conflicts: Array<{ sourceIds: string[]; page: string; pageSays: string }>
    }
    assert.deepEqual(conflicts.conflicts, [
      {
        sourceIds: [pricing.id],
        page: 'Pricing',
        pageSays: 'Blog add-on: $200',
      },
    ])

    // Confirmed over the website: the page it overrides is remembered.
    const blogResponse = await request('/notes', 'POST', {
      title: 'Blog add-on price',
      text: 'The blog add-on is $250.',
      scope: 'mine',
      overrides: [{ sourceId: pricing.id, excerpt: 'Blog add-on: $200' }],
    })
    assert.equal(blogResponse.status, 201)
    const blog = (await blogResponse.json()) as { id: string }
    const notes = (await (await request('/notes')).json()) as Array<{
      id: string
      overrides: Array<{ page: string }>
    }>
    assert.deepEqual(
      notes.find((note) => note.id === blog.id)?.overrides.map((o) => o.page),
      ['Pricing'],
    )
    // A page it already overrides isn't raised again on the next edit.
    const again = (await (
      await request('/notes/conflicts', 'POST', {
        noteId: blog.id,
        title: 'Blog add-on price',
        text: 'The blog add-on is $250, one-time.',
      })
    ).json()) as { conflicts: unknown[] }
    assert.equal(again.conflicts.length, 0)

    // The page changes to something new: the owner decides, and meanwhile
    // their version stays in place.
    await db
      .update(knowledgeSource)
      .set({ cleanedText: 'Blog add-on: $300', contentHash: 'pricing-v2' })
      .where(eq(knowledgeSource.id, pricing.id))
    await checkCorrections({
      assistantId: owner.id,
      organizationId: credentials.organizationId,
    })
    const decisions = (await (await request('/decisions')).json()) as Array<{
      id: string
      websiteNow: string
      page: string
    }>
    assert.equal(decisions.length, 1)
    assert.equal(decisions[0].websiteNow, 'Blog add-on: $300')
    assert.equal(decisions[0].page, 'Pricing')

    // Keep mine: no longer raised, and the new page wording is remembered.
    assert.equal(
      (
        await request(`/decisions/${decisions[0].id}`, 'PATCH', {
          decision: 'keep',
        })
      ).status,
      200,
    )
    assert.equal(
      ((await (await request('/decisions')).json()) as unknown[]).length,
      0,
    )
    const [kept] = await db
      .select()
      .from(knowledgeCorrection)
      .where(eq(knowledgeCorrection.id, decisions[0].id))
    assert.equal(kept.status, 'active')
    assert.equal(kept.excerpt, 'Blog add-on: $300')

    // Use the website: the note is rewritten to follow the page.
    await db
      .update(knowledgeCorrection)
      .set({ status: 'needsReview', websiteNow: 'Blog add-on: $300' })
      .where(eq(knowledgeCorrection.id, decisions[0].id))
    const followed = await request(`/decisions/${decisions[0].id}`, 'PATCH', {
      decision: 'useWebsite',
    })
    assert.equal(followed.status, 200)
    const [rewritten] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, blog.id))
    assert.match(rewritten.cleanedText ?? '', /\$300/)
    const remaining = await db
      .select()
      .from(knowledgeCorrection)
      .where(
        and(
          eq(knowledgeCorrection.noteId, blog.id),
          eq(knowledgeCorrection.status, 'active'),
        ),
      )
    assert.equal(remaining.length, 0)

    // Deleting a note takes effect at once: nothing of it is searchable.
    assert.equal((await request(`/sources/${hours.id}`, 'DELETE')).status, 204)
    assert.ok(
      !(await search('hours')).some((item) => item.sourceId === hours.id),
    )
    assert.equal(
      (
        await db
          .select()
          .from(knowledgeChunk)
          .where(eq(knowledgeChunk.sourceId, hours.id))
      ).length,
      0,
    )
    assert.ok(modelCalls.includes('factConflict'))

    // Queued work with no worker running is reported as paused, so the owner
    // isn't left watching "Waiting to start".
    const { reportWorkerAlive } =
      await import('../../src/services/queue/workerHealth')
    await db.delete(serviceHeartbeat)
    await db.insert(indexRun).values({
      organizationId: orgOf(owner.id),
      targetSourceId: site.id,
      trigger: 'manual',
    })
    const status = async () =>
      (await (await request('/preview/status')).json()) as {
        indexing: boolean
        paused: boolean
      }
    assert.deepEqual(
      { ...(await status()), runs: undefined },
      { indexing: true, paused: true, ready: true, runs: undefined },
    )
    await reportWorkerAlive()
    assert.equal((await status()).paused, false)
  } finally {
    await db
      .delete(indexRun)
      .where(eq(indexRun.organizationId, orgOf(owner.id)))
    await db
      .update(knowledgeSource)
      .set({ parentId: null })
      .where(eq(knowledgeSource.organizationId, orgOf(owner.id)))
    await db
      .delete(knowledgeSource)
      .where(eq(knowledgeSource.organizationId, orgOf(owner.id)))
    await db.delete(aiUsageEvent).where(eq(aiUsageEvent.assistantId, owner.id))
    await db.delete(assistant).where(eq(assistant.id, owner.id))
    const { getBoss } = await import('../../src/services/queue/boss')
    await (await getBoss()).stop()
    server.stop(true)
    fixture.stop(true)
  }
}, 120_000)
