import { startSpiderStandIn } from '../fixtures/rolesProviders'
import { addWebsite, createTestWorkspace } from '../fixtures/ownWebsite'
import { orgOf } from '../fixtures/knowledgeOwner'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { knowledgeFormatVersion } from '../../src/services/knowledge/cleanup/formatBlocks'
import { buildProfileChunk } from '../../src/services/knowledge/profileChunk'
import { chatFixture, installChatFixture } from '../fixtures/chatModel'
import { structuredResponse } from '../fixtures/openAiResponses'

test('action links survive ingestion, shared retrieval, chat and URL-only refresh', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Action link integration requires local PostgreSQL')
  const objects = new Map<string, string>()
  const embedded: string[] = []
  let destination = 'https://booking.example/reserve(1)?branch=central#slots'
  let documentDestination = '/plans?level=basic#details'
  let profileGoal = 'Book'
  let profileRequests = 0
  let fixtureOrigin = '',
    freshGets = 0
  const html = (path: string) =>
    `<html><title>${path === '/' ? 'Home' : 'Services'}</title><main>${
      path === '/'
        ? '<p>Our team offers maintenance.</p><a href="/services">Our services</a>'
        : `<h2>Service plans</h2><p>Compare our <a href="${documentDestination}">service plans</a>.</p><p><a href="book">Local booking</a></p>`
    }</main><footer><a href="${destination}">Book a repair</a></footer><button>Accept cookies</button></html>`
  const fixture = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/stage' || url.pathname === '/stage/')
        return new Response(
          '<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>',
          { headers: { 'content-type': 'application/xml' } },
        )
      if (url.pathname.startsWith('/stage/')) {
        if (req.method === 'PUT') {
          objects.set(url.pathname, await req.text())
          return new Response(null)
        }
        if (req.method === 'DELETE') {
          objects.delete(url.pathname)
          return new Response(null, { status: 204 })
        }
        return objects.has(url.pathname)
          ? new Response(objects.get(url.pathname))
          : new Response(null, { status: 404 })
      }
      if (url.pathname === '/v1/embeddings') {
        const { input } = (await req.json()) as { input: string[] }
        embedded.push(...input)
        return Response.json({
          data: input.map((text, index) => ({
            index,
            embedding: Array.from({ length: 384 }, (_, i) =>
              text.startsWith('Title:')
                ? i === 0
                  ? text.includes('Arrange a maintenance visit')
                    ? 0.6
                    : 0.8
                  : i === 1
                    ? text.includes('Arrange a maintenance visit')
                      ? 0.8
                      : 0.6
                    : 0
                : i === 0
                  ? 1
                  : 0,
            ),
          })),
          usage: { total_tokens: input.length, prompt_tokens: input.length },
        })
      }
      if (url.pathname === '/v1/responses') {
        profileRequests++
        return structuredResponse(
          {
            summary: 'Services and bookings',
            purposes: ['Inform'],
            topics: ['Services'],
            visitorGoals: [profileGoal],
            actions: [],
          },
          { input: 1, output: 1 },
          'gpt-5.6-luna',
        )
      }
      if (url.pathname === '/jev') {
        const input = (await req.json()) as {
          state: { blocks: Array<{ text: string; inlineParts?: unknown }> }
          questions: Record<string, { instructions: string }>
        }
        assert(
          input.state.blocks.every((block) => block.inlineParts === undefined),
        )
        return Response.json({
          model: 'jev-1.13.0',
          answers: Object.fromEntries(
            Object.entries(input.questions).map(([id, question]) => {
              const index = Number(
                question.instructions.match(/blocks\[(\d+)\]/)![1],
              )
              const choice =
                input.state.blocks[index].text === 'Accept cookies'
                  ? 'noise'
                  : 'knowledge'
              return [
                id,
                {
                  type: 'choice',
                  choice,
                  confidence: 1,
                  probabilities: {
                    knowledge: choice === 'knowledge' ? 1 : 0,
                    action: 0,
                    noise: choice === 'noise' ? 1 : 0,
                    uncertain: 0,
                  },
                },
              ]
            }),
          ),
          usage: { input_tokens: 1, output_tokens: 1 },
        })
      }
      if (url.pathname === '/services')
        return new Response(null, {
          status: 301,
          headers: { location: '/services/' },
        })
      if (url.pathname === '/' || url.pathname === '/services/') {
        freshGets++
        return new Response(html(url.pathname), {
          headers: { 'content-type': 'text/html' },
        })
      }
      return new Response(null, { status: 404 })
    },
  })
  fixtureOrigin = `http://127.0.0.1:${fixture.port}`
  let handle: (request: Request) => Response | Promise<Response> = () =>
    new Response(null, { status: 503 })
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => handle(request),
  })
  try {
    const apiOrigin = `http://127.0.0.1:${server.port}`
    Object.assign(process.env, {
      // Websites are read through a stand-in Spider.
      ...startSpiderStandIn().env,
      NODE_ENV: 'test',
      PORT: String(server.port),
      BETTER_AUTH_URL: apiOrigin,
      FRONT_END_URL: 'http://localhost:3000',
      OPENAI_API_KEY: 'fixture-key',
      OPENAI_BASE_URL: `${fixtureOrigin}/v1`,
      R2_ENDPOINT: fixtureOrigin,
      R2_BUCKET: 'stage',
      R2_ACCESS_KEY_ID: 'fixture-key',
      R2_SECRET_ACCESS_KEY: 'fixture-secret',
      TYPESAFE_API_KEY: 'fixture',
      DECISION_PROVIDER: 'typesafe',
      TYPESAFE_API_URL: `${fixtureOrigin}/jev`,
    })
    const { app } = await import('../../src/app')
    handle = (request) => app.fetch(request)
    installChatFixture()
    const { db } = await import('../../src/db')
    const {
      knowledgeSource,
      knowledgeChunk,
      indexRun,
      indexRunItem,
      knowledgeSharedBlock,
    } = await import('../../src/db/schema')
    const { advanceIndexRun } =
      await import('../../src/services/knowledge/runOrchestrator')
    const cwd = new URL('../../', import.meta.url).pathname
    const seed = spawn(
      process.execPath,
      ['scripts/seedLocal.ts', '--integration'],
      { cwd, env: process.env, stdio: ['ignore', 'ignore', 'inherit'] },
    )
    assert.equal((await once(seed, 'exit'))[0], 0)
    const { loadTestCredentials } =
      await import('../../scripts/localSeedSupport')
    const credentials = await loadTestCredentials('integration')
    const headers = {
      Cookie: credentials.accounts.owner.cookie,
      Origin: 'http://localhost:3000',
      'Content-Type': 'application/json',
    }
    const workspace = await createTestWorkspace(
      credentials,
      'Action link fixture',
    )
    const base = `${apiOrigin}/api/organizations/${workspace.organizationId}`
    const assistantId = workspace.assistantId
    let rootId = ''
    let worker: ReturnType<typeof spawn> | undefined
    // Your business routes; `aiRequest` reaches the AI itself.
    const request = (path: string, method = 'GET', body?: unknown) =>
      fetch(`${base}/business${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    const aiRequest = (path: string, method = 'GET', body?: unknown) =>
      fetch(`${base}/assistants/${assistantId}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    async function waitRun(id: string) {
      for (let i = 0; i < 1500; i++) {
        const response = await request('/runs')
        assert.equal(response.status, 200)
        const run = (
          (await response.json()) as Array<typeof indexRun.$inferSelect>
        ).find((item) => item.id === id)
        if (run && ['completed', 'failed'].includes(run.status)) {
          assert.equal(run.status, 'completed', run.errorSummary ?? undefined)
          return
        }
        await Bun.sleep(100)
      }
      throw new Error('Action link fixture timed out')
    }
    const readSource = async (id: string) => {
      const response = await request(`/sources/${id}`)
      assert.equal(response.status, 200)
      return (await response.json()) as typeof knowledgeSource.$inferSelect
    }
    try {
      const created = await addWebsite(
        (path, body) =>
          fetch(`${base}${path}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          }),
        // Reading follows links; the ones the pages point to aren't pages here.
        {
          websiteUrl: fixtureOrigin,
          excludePaths: ['/plans', '/services/book'],
        },
      )
      rootId = created.source.id
      worker = spawn(process.execPath, ['src/worker.ts'], {
        cwd,
        env: process.env,
        stdio: ['ignore', 'ignore', 'inherit'],
      })
      await waitRun(created.indexRun.id)
      const pages = (await (await request('/sources')).json()) as Array<
        typeof knowledgeSource.$inferSelect
      >
      const service = pages.find(
        (page) => page.canonicalUrl === `${fixtureOrigin}/services`,
      )!
      assert(service)
      const first = await readSource(service.id)
      assert(
        first.cleanedText?.includes(
          `[service plans](<${fixtureOrigin}${documentDestination}>)`,
        ),
      )
      assert(first.cleanedText?.includes(`[Book a repair](<${destination}>)`))
      assert(
        first.cleanedText?.includes(
          `[Local booking](<${fixtureOrigin}/services/book>)`,
        ),
      )
      assert(!first.cleanedText?.includes('Accept cookies'))
      assert(first.contentHash?.startsWith(`${knowledgeFormatVersion}:`))
      const readChunks = () =>
        db
          .select()
          .from(knowledgeChunk)
          .where(eq(knowledgeChunk.sourceId, service.id))
      const initialChunks = await readChunks()
      const initialProfile = initialChunks.filter(
        (chunk) => chunk.kind === 'pageProfile',
      )
      assert.equal(initialProfile.length, 1)
      assert.equal(initialProfile[0].sourceId, service.id)
      assert.equal(
        initialProfile[0].text,
        buildProfileChunk(first.title, first.pageProfile),
      )
      assert(initialChunks.some((chunk) => chunk.kind === 'content'))
      assert(embedded.some((text) => text.includes(destination)))
      const shared = await db
        .select()
        .from(knowledgeSharedBlock)
        .where(eq(knowledgeSharedBlock.organizationId, orgOf(assistantId)))
      assert.equal(
        shared.filter((block) => block.text.includes(destination)).length,
        1,
      )
      assert.equal(objects.size, 0)
      assert.equal(
        (await aiRequest('', 'PATCH', { status: 'published' })).status,
        200,
      )
      const bootstrap = await fetch(
        `${apiOrigin}/api/widget/${assistantId}/bootstrap`,
        { method: 'POST', headers: { Origin: fixtureOrigin } },
      )
      assert.equal(bootstrap.status, 200)
      const { token } = (await bootstrap.json()) as { token: string }
      const widgetHeaders = {
        Origin: fixtureOrigin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
      const conversationResponse = await fetch(
        `${apiOrigin}/api/widget/${assistantId}/conversations`,
        { method: 'POST', headers: widgetHeaders, body: '{}' },
      )
      assert.equal(conversationResponse.status, 201)
      const conversation = (await conversationResponse.json()) as {
        id: string
        resumeToken: string
      }
      async function ask() {
        let observed = ''
        chatFixture.question =
          'Where can I book a repair or compare service plans?'
        chatFixture.onSearchResult = (input) => {
          observed = JSON.stringify(input)
        }
        const reply = await fetch(
          `${apiOrigin}/api/widget/${assistantId}/conversations/${conversation.id}/messages`,
          {
            method: 'POST',
            headers: {
              ...widgetHeaders,
              'X-Conversation-Token': conversation.resumeToken,
            },
            body: JSON.stringify({
              clientMessageId: crypto.randomUUID(),
              content: chatFixture.question,
            }),
          },
        )
        assert.equal(reply.status, 200)
        const stream = await reply.text()
        assert(stream.includes('event: done'), stream)
        const done = stream
          .split('\n\n')
          .find((event) => event.startsWith('event: done\n'))
        assert(done)
        const completed = JSON.parse(
          done.slice(done.indexOf('data: ') + 6),
        ) as {
          citations: Array<{ sourceId: string }>
        }
        assert.equal(
          completed.citations.length,
          1,
          'Only explicitly selected evidence should be cited',
        )
        assert(
          observed.includes(destination),
          'The answering model did not receive the booking URL',
        )
        assert(
          observed.includes(`${fixtureOrigin}${documentDestination}`),
          'The model did not receive the page-specific URL',
        )
        assert(
          observed.includes('pageProfile'),
          'The model did not receive profile matches',
        )
        assert(
          observed.includes('Visitor goals:'),
          'The profile purpose text was lost',
        )
        assert(
          observed.includes('actions'),
          'The saved profile actions were not passed to chat',
        )
        return observed
      }
      await ask()
      const oldDestination = destination
      destination = 'https://booking.example/reserve(2)?branch=north#slots'
      documentDestination = '/plans?level=extended#details'
      const beforeOutsideLocation = freshGets
      const refresh = await request(`/sources/${rootId}/runs`, 'POST')
      assert.equal(refresh.status, 202)
      await waitRun(((await refresh.json()) as { id: string }).id)
      assert(freshGets > beforeOutsideLocation)
      const second = await readSource(service.id)
      assert.notEqual(
        second.contentHash,
        first.contentHash,
        'URL-only change was treated as unchanged',
      )
      assert(second.cleanedText?.includes(destination))
      assert(!second.cleanedText?.includes(oldDestination))
      assert(
        !(await ask()).includes(oldDestination),
        'A replaced URL was still passed to the model',
      )
      // A page that reads the same (its read hash) is unchanged: it isn't
      // profiled or embedded again, even if the profile model would now
      // answer differently, and everything learned from it stays.
      const beforeUnchanged = await readChunks()
      const beforeUnchangedEmbeddings = embedded.length
      const beforeUnchangedProfiles = profileRequests
      profileGoal = 'Arrange a maintenance visit'
      const beforeUnchangedReads = freshGets
      const unchangedRefresh = await request(`/sources/${rootId}/runs`, 'POST')
      assert.equal(unchangedRefresh.status, 202)
      await waitRun(((await unchangedRefresh.json()) as { id: string }).id)
      assert(freshGets > beforeUnchangedReads)
      assert.equal(
        (await readSource(service.id)).lastAttemptStatus,
        'unchanged',
      )
      assert.equal(profileRequests, beforeUnchangedProfiles)
      assert.equal(embedded.length, beforeUnchangedEmbeddings)
      const afterUnchanged = await readChunks()
      assert.deepEqual(
        afterUnchanged.map((chunk) => [chunk.id, chunk.text]).sort(),
        beforeUnchanged.map((chunk) => [chunk.id, chunk.text]).sort(),
      )
      assert(
        !afterUnchanged
          .find((chunk) => chunk.kind === 'pageProfile')!
          .text.includes(profileGoal),
      )

      // Backfill uses saved JSON, never another LLM profile call; repeat is a no-op.
      await db
        .delete(knowledgeChunk)
        .where(
          and(
            eq(knowledgeChunk.sourceId, service.id),
            eq(knowledgeChunk.kind, 'pageProfile'),
          ),
        )
      const beforeBackfillRequests = profileRequests
      const backfill = async (apply: boolean) => {
        const command = spawn(
          process.execPath,
          [
            'scripts/backfillProfileChunks.ts',
            '--workspace',
            workspace.organizationId,
            ...(apply ? ['--apply'] : []),
          ],
          { cwd, env: process.env, stdio: ['ignore', 'pipe', 'inherit'] },
        )
        let output = ''
        command.stdout.on('data', (chunk) => {
          output += String(chunk)
        })
        assert.equal((await once(command, 'exit'))[0], 0)
        return output
      }
      assert(
        (await backfill(false)).includes(
          '1 page-profile embeddings need updating',
        ),
      )
      assert(
        (await backfill(true)).includes('1 page-profile embeddings updated'),
      )
      assert(
        (await backfill(true)).includes('0 page-profile embeddings updated'),
      )
      assert.equal(profileRequests, beforeBackfillRequests)
      assert.equal(
        (await readChunks()).filter((chunk) => chunk.kind === 'pageProfile')
          .length,
        1,
      )
      // A legacy index is prepared again even though the page reads the same
      // (its read hash matches): its stored result can't stand as it is.
      const storedReadHash = async () =>
        (
          await db
            .select({ readHash: knowledgeSource.readHash })
            .from(knowledgeSource)
            .where(eq(knowledgeSource.id, service.id))
        )[0]?.readHash
      const legacyReadHash = await storedReadHash()
      assert(legacyReadHash, 'The page was stored without its read hash')
      await db
        .update(knowledgeSource)
        .set({ contentHash: 'legacy-text-hash' })
        .where(eq(knowledgeSource.id, service.id))
      const beforeFresh = freshGets
      const pageRefresh = await request(`/sources/${service.id}/runs`, 'POST')
      assert.equal(pageRefresh.status, 202)
      await waitRun(((await pageRefresh.json()) as { id: string }).id)
      assert(freshGets > beforeFresh)
      assert.equal(await storedReadHash(), legacyReadHash)
      assert(
        (await readSource(service.id)).contentHash?.startsWith(
          `${knowledgeFormatVersion}:`,
        ),
      )
      assert(
        (await readSource(service.id)).cleanedText?.includes(
          `[Local booking](<${fixtureOrigin}/services/book>)`,
        ),
      )
      // Exercise the scoped upgrade command against the same provider fixtures.
      await db
        .update(knowledgeSource)
        .set({ contentHash: 'legacy-again' })
        .where(eq(knowledgeSource.id, service.id))
      const beforeUpgrade = await db
        .select({ id: indexRun.id })
        .from(indexRun)
        .where(eq(indexRun.organizationId, orgOf(assistantId)))
      const upgradeCommand = async (apply: boolean) => {
        const command = spawn(
          process.execPath,
          [
            'scripts/reindexActionLinks.ts',
            '--workspace',
            workspace.organizationId,
            ...(apply ? ['--apply'] : []),
          ],
          { cwd, env: process.env, stdio: ['ignore', 'pipe', 'inherit'] },
        )
        let output = ''
        command.stdout.on('data', (chunk) => {
          output += String(chunk)
        })
        assert.equal((await once(command, 'exit'))[0], 0)
        return output
      }
      assert(
        (await upgradeCommand(false)).includes(
          '1 legacy pages across 1 source refreshes (preview only)',
        ),
      )
      assert.equal(
        (
          await db
            .select({ id: indexRun.id })
            .from(indexRun)
            .where(eq(indexRun.organizationId, orgOf(assistantId)))
        ).length,
        beforeUpgrade.length,
      )
      // The preview must use the same inclusion rules as retrieval.
      await db
        .update(knowledgeSource)
        .set({ excludePaths: ['/services'] })
        .where(eq(knowledgeSource.id, rootId))
      assert(
        (await upgradeCommand(false)).includes(
          '0 legacy pages across 0 source refreshes',
        ),
      )
      await db
        .update(knowledgeSource)
        .set({
          excludePaths: ['/plans', '/services/book'],
          includePaths: ['/other'],
        })
        .where(eq(knowledgeSource.id, rootId))
      assert(
        (await upgradeCommand(false)).includes(
          '0 legacy pages across 0 source refreshes',
        ),
      )
      await db
        .update(knowledgeSource)
        .set({ includePaths: [] })
        .where(eq(knowledgeSource.id, rootId))
      await upgradeCommand(true)
      const upgradedRuns = (await (await request('/runs')).json()) as Array<
        typeof indexRun.$inferSelect
      >
      const upgradeRun = upgradedRuns.find(
        (run) => !beforeUpgrade.some((previous) => previous.id === run.id),
      )!
      assert(upgradeRun)
      assert.equal(upgradeRun.targetSourceId, rootId)
      await waitRun(upgradeRun.id)
      assert(
        (await readSource(service.id)).contentHash?.startsWith(
          `${knowledgeFormatVersion}:`,
        ),
      )
      // Resume an old prepared checkpoint through the real worker.
      const legacyRun = crypto.randomUUID(),
        legacyKey = `index-runs/${legacyRun}/pages/${service.id}.json`
      objects.set(
        `/stage/${legacyKey}`,
        JSON.stringify({
          url: service.canonicalUrl,
          title: 'Legacy',
          preparedText: 'Legacy text without destinations',
          blocks: [
            {
              id: 'b0',
              text: 'Legacy text without destinations',
              heading: '',
              region: 'main',
              links: [],
            },
          ],
        }),
      )
      await db.insert(indexRun).values({
        id: legacyRun,
        organizationId: orgOf(assistantId),
        targetSourceId: service.id,
        trigger: 'manual',
        status: 'running',
        phase: 'preparing',
        startedAt: new Date(),
        crawlCollectedAt: new Date(),
        discoveredCount: 1,
        cleanupAttempts: 2,
      })
      await db.insert(indexRunItem).values({
        runId: legacyRun,
        sourceId: service.id,
        status: 'prepared',
        stagedContentKey: legacyKey,
      })
      const beforeLegacy = freshGets
      await advanceIndexRun(legacyRun)
      await waitRun(legacyRun)
      const [legacyResult] = await db
        .select({ attempts: indexRun.cleanupAttempts })
        .from(indexRun)
        .where(eq(indexRun.id, legacyRun))
      assert.equal(
        legacyResult.attempts,
        3,
        'Checkpoint upgrades consumed a grouping attempt',
      )
      assert(freshGets > beforeLegacy)
      assert(
        !((await readSource(service.id)).cleanedText ?? '').includes(
          'Legacy text',
        ),
      )
      assert.equal(objects.size, 0)
      const chunks = await db
        .select()
        .from(knowledgeChunk)
        .where(eq(knowledgeChunk.sourceId, service.id))
      assert(chunks.some((chunk) => chunk.text.includes(documentDestination)))
    } finally {
      if (worker && worker.exitCode === null && worker.signalCode === null) {
        worker.kill('SIGTERM')
        await once(worker, 'exit')
      }
      if (assistantId) {
        await db
          .update(indexRun)
          .set({ status: 'failed', completedAt: new Date() })
          .where(
            and(
              eq(indexRun.organizationId, orgOf(assistantId)),
              inArray(indexRun.status, ['queued', 'running']),
            ),
          )
        if (rootId) await request(`/sources/${rootId}`, 'DELETE')
      }
    }
  } finally {
    chatFixture.question = undefined
    chatFixture.onSearchResult = undefined
    server.stop(true)
    fixture.stop(true)
  }
}, 300_000)
