import { createWithOwnWebsite } from '../fixtures/ownWebsite'
import { orgOf } from '../fixtures/knowledgeOwner'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { and, eq, inArray, sql } from 'drizzle-orm'

test('Reading follows deep links and worker restart repairs durable checkpoints', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Crawl recovery test requires local PostgreSQL')
  const objects = new Map<string, string>()
  let includeNewLink = false
  let excludedGets = 0
  let externalGets = 0
  let aiRequests = 0
  const external = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => {
      externalGets++
      return new Response('External')
    },
  })
  const fixture = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (
        ['/stage', '/stage/'].includes(url.pathname) &&
        url.searchParams.has('list-type')
      )
        return new Response(
          '<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>',
          { headers: { 'content-type': 'application/xml' } },
        )
      if (url.pathname.startsWith('/stage/')) {
        if (req.method === 'PUT') {
          objects.set(url.pathname, await req.text())
          return new Response(null, { status: 200 })
        }
        if (req.method === 'DELETE') {
          objects.delete(url.pathname)
          return new Response(null, { status: 204 })
        }
        const content = objects.get(url.pathname)
        return content
          ? new Response(content, {
              headers: { 'content-type': 'application/json' },
            })
          : new Response('Missing', { status: 404 })
      }
      if (url.pathname === '/v1/embeddings') {
        aiRequests++
        const input = (await req.json()) as { input: string[] }
        return Response.json({
          data: input.input.map((_, index) => ({
            index,
            embedding: Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)),
          })),
          usage: {
            total_tokens: input.input.length,
            prompt_tokens: input.input.length,
          },
        })
      }
      if (url.pathname === '/jev') {
        aiRequests++
        return Response.json({ answers: {} })
      }
      if (url.pathname === '/excluded') {
        excludedGets++
        return new Response('Excluded')
      }
      const links =
        url.pathname === '/'
          ? '<a href="/level-one">Next</a><a href="/excluded">Skip</a>'
          : url.pathname === '/level-one'
            ? `<a href="/level-two">Next</a><a href="/level-two?utm_source=test">Next</a><a href="/">Back</a><a href="http://127.0.0.1:${
                external.port
              }/">External</a>${
                includeNewLink ? '<a href="/new-page">New</a>' : ''
              }`
            : url.pathname === '/level-two'
              ? '<a href="/level-one">Back</a>'
              : url.pathname === '/new-page'
                ? ''
                : null
      if (links === null) return new Response('Not found', { status: 404 })
      // Navigation is useful routing content; a new link changes the source as well as discovery.
      return new Response(
        `<html><title>${url.pathname}</title><nav>${links}</nav><main><h1>${url.pathname}</h1><p>Our plumbing business repairs water heaters and provides scheduled maintenance appointments.</p></main></html>`,
        { headers: { 'content-type': 'text/html' } },
      )
    },
  })
  const fixtureOrigin = `http://127.0.0.1:${fixture.port}`
  let handle: (request: Request) => Response | Promise<Response> = () =>
    new Response('Starting', { status: 503 })
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => handle(request),
  })
  const apiOrigin = `http://127.0.0.1:${server.port}`
  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: String(server.port),
    BETTER_AUTH_URL: apiOrigin,
    FRONT_END_URL: 'http://localhost:3000',
    LLM_KEY: 'fixture-key',
    OPENAI_BASE_URL: `${fixtureOrigin}/v1`,
    R2_ENDPOINT: fixtureOrigin,
    R2_BUCKET: 'stage',
    R2_ACCESS_KEY_ID: 'fixture-key',
    R2_SECRET_ACCESS_KEY: 'fixture-secret',
    TYPESAFE_API_KEY: 'fixture-key',
    TYPESAFE_API_URL: `${fixtureOrigin}/jev`,
  })
  const { app } = await import('../../src/app')
  handle = (request) => app.fetch(request)
  const { db } = await import('../../src/db')
  const { assistant, knowledgeSource, indexRun, indexRunItem } =
    await import('../../src/db/schema')
  const { discoverPreparedPageLinks } =
    await import('../../src/services/knowledge/crawl')
  const { repairActiveRunCounters } =
    await import('../../src/services/knowledge/runOrchestrator')
  const { preparePage } =
    await import('../../src/services/knowledge/preparePage')
  const { embedPage } = await import('../../src/services/knowledge/embedPage')
  const cwd = new URL('../../', import.meta.url).pathname
  const seed = spawn(
    process.execPath,
    ['scripts/seedLocal.ts', '--integration'],
    { cwd, env: process.env, stdio: ['ignore', 'ignore', 'inherit'] },
  )
  assert.equal((await once(seed, 'exit'))[0], 0)
  const { loadTestCredentials } = await import('../../scripts/localSeedSupport')
  const credentials = await loadTestCredentials('integration')
  const headers = {
    Cookie: credentials.accounts.owner.cookie,
    Origin: 'http://localhost:3000',
    'Content-Type': 'application/json',
  }
  const base = `${apiOrigin}/api/organizations/${credentials.organizationId}`
  let worker: ReturnType<typeof spawn> | undefined
  let fixtureAssistantId: string | undefined
  const startWorker = () => {
    worker = spawn(process.execPath, ['src/worker.ts'], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
  }
  const stopWorker = async () => {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill('SIGTERM')
      await once(worker, 'exit')
    }
  }
  try {
    const response = await createWithOwnWebsite(
      (path, body) =>
        fetch(`${base}/assistants${path}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }),
      { name: 'Deep crawl fixture', websiteUrl: fixtureOrigin },
    )
    assert.equal(response.status, 201)
    const created = (await response.json()) as {
      assistant: { id: string }
      source: { id: string }
      indexRun: { id: string }
    }
    const botId = created.assistant.id
    fixtureAssistantId = botId
    const rootId = created.source.id
    assert.equal(
      (
        await fetch(`${base}/assistants/${botId}/sources/${rootId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ excludePaths: ['/excluded'] }),
        })
      ).status,
      200,
    )
    async function waitForRun(runId: string) {
      // A restarted worker may need its 60-second sweep after singleton suppression.
      for (let attempt = 0; attempt < 1000; attempt++) {
        const response = await fetch(`${base}/assistants/${botId}/runs`, {
          headers,
        })
        assert.equal(response.status, 200)
        const runs = (await response.json()) as Array<
          typeof indexRun.$inferSelect
        >
        const run = runs.find((item) => item.id === runId)
        if (run && ['completed', 'failed'].includes(run.status)) return run
        await Bun.sleep(100)
      }
      throw new Error('Crawl fixture did not finish')
    }
    startWorker()
    const first = await waitForRun(created.indexRun.id)
    assert.equal(first.status, 'completed', first.errorSummary ?? undefined)
    assert.equal(first.discoveredCount, 3)
    assert.equal(first.fetchedCount, 3)
    const pages = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.parentId, rootId))
    assert(
      pages.some(
        (page) =>
          page.canonicalUrl === `${fixtureOrigin}/level-two` &&
          page.status === 'ready',
      ),
    )
    assert.equal(excludedGets, 0)
    assert.equal(externalGets, 0)

    includeNewLink = true
    const refresh = await fetch(
      `${base}/assistants/${botId}/sources/${rootId}/runs`,
      { method: 'POST', headers },
    )
    const refreshRun = (await refresh.json()) as { id: string }
    const second = await waitForRun(refreshRun.id)
    console.info('Crawl recovery: initial crawl and recrawl finished')
    assert.equal(second.status, 'completed')
    assert.equal(second.discoveredCount, 4)
    assert.equal(second.unchangedCount, 2)
    assert.equal(second.indexedCount, 2)
    await stopWorker()

    // Recovery repairs a saved item whose old implementation omitted the counter increment.
    const page = pages.find(
      (item) => item.canonicalUrl === `${fixtureOrigin}/level-two`,
    )!
    const runId = crypto.randomUUID()
    const stagedKey = `index-runs/${runId}/pages/${page.id}.json`
    objects.set(
      `/stage/${stagedKey}`,
      JSON.stringify({
        url: page.canonicalUrl,
        title: 'Recovered',
        html: '<main><p>Recovered business facts and service details.</p></main>',
        preparedText: 'Recovered business facts and service details.',
      }),
    )
    await db.insert(indexRun).values({
      id: runId,
      organizationId: orgOf(botId),
      targetSourceId: rootId,
      trigger: 'manual',
      status: 'running',
      phase: 'preparing',
      crawlProvider: 'http',
      crawlCollectedAt: new Date(),
      discoveredCount: 999,
      fetchedCount: 42,
      startedAt: new Date(),
    })
    await db.insert(indexRunItem).values({
      runId,
      sourceId: page.id,
      status: 'preparing',
      stagedContentKey: stagedKey,
      leaseUntil: new Date(Date.now() - 1000),
      attemptCount: 1,
    })
    // Concurrent, duplicate link discovery must remain atomic with counter reconciliation.
    await Promise.all([
      discoverPreparedPageLinks(
        runId,
        '<a href="/level-one">A</a>',
        fixtureOrigin,
      ),
      discoverPreparedPageLinks(
        runId,
        '<a href="/level-one">A</a>',
        fixtureOrigin,
      ),
      repairActiveRunCounters(),
    ])
    await repairActiveRunCounters()
    const [counted] = await db
      .select()
      .from(indexRun)
      .where(eq(indexRun.id, runId))
    const items = await db
      .select()
      .from(indexRunItem)
      .where(eq(indexRunItem.runId, runId))
    assert.equal(counted.discoveredCount, items.length)
    assert.equal(counted.fetchedCount, 0)
    // Run preparation before restarting: inspect the actual staged object and replay its checkpoint.
    await preparePage(runId, page.id)
    const [preparedItem] = await db
      .select()
      .from(indexRunItem)
      .where(
        and(eq(indexRunItem.runId, runId), eq(indexRunItem.sourceId, page.id)),
      )
    assert(preparedItem.stagedContentKey)
    assert.notEqual(
      preparedItem.stagedContentKey,
      stagedKey,
      'Preparation must publish an isolated attempt checkpoint',
    )
    const saved = JSON.parse(
      objects.get(`/stage/${preparedItem.stagedContentKey}`)!,
    ) as {
      html?: string
      preparedText?: string
      blocks?: Array<{ text: string }>
    }
    assert(
      !saved.html && saved.blocks?.length,
      'Preparation must replace raw HTML with retryable text blocks',
    )
    await db
      .update(indexRunItem)
      .set({ status: 'preparing', leaseUntil: new Date(Date.now() - 1000) })
      .where(
        and(eq(indexRunItem.runId, runId), eq(indexRunItem.sourceId, page.id)),
      )
    startWorker()
    const recovered = await waitForRun(runId)
    assert.equal(recovered.status, 'completed')
    assert.equal(recovered.discoveredCount, recovered.fetchedCount)
    const [indexed] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, page.id))
    assert(
      indexed.cleanedText?.includes(
        'Recovered business facts and service details.',
      ),
    )
    assert(!objects.has(`/stage/${stagedKey}`))
    // Counter repair must not rewrite history, even if a historical counter differs.
    await db
      .update(indexRun)
      .set({ discoveredCount: 777 })
      .where(eq(indexRun.id, runId))
    await repairActiveRunCounters()
    const [historical] = await db
      .select()
      .from(indexRun)
      .where(eq(indexRun.id, runId))
    assert.equal(historical.discoveredCount, 777)
    await db
      .update(indexRun)
      .set({ discoveredCount: recovered.discoveredCount })
      .where(eq(indexRun.id, runId))
    const [duplicates] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(indexRunItem)
      .where(eq(indexRunItem.runId, runId))
    assert.equal(duplicates.count, recovered.discoveredCount)
    assert.equal(
      (await db.select().from(assistant).where(eq(assistant.id, botId))).length,
      1,
    )
    await stopWorker()

    const publicRun = async (id: string) => {
      const response = await fetch(`${base}/assistants/${botId}/runs`, {
        headers,
      })
      assert.equal(response.status, 200)
      return (
        (await response.json()) as Array<typeof indexRun.$inferSelect>
      ).find((run) => run.id === id)!
    }
    // A delayed queue delivery must not restart work or overwrite current text
    // after either a completed run or a failed run became terminal.
    const [beforeStale] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, page.id))
    for (const terminalStatus of ['completed', 'failed'] as const) {
      for (const stage of ['prepare', 'embed'] as const) {
        const staleRunId = crypto.randomUUID()
        const staleKey = `index-runs/${staleRunId}/pages/${page.id}.json`
        objects.set(
          `/stage/${staleKey}`,
          JSON.stringify({
            url: page.canonicalUrl,
            title: 'Stale content',
            preparedText: 'Stale text must never replace current knowledge.',
          }),
        )
        await db.insert(indexRun).values({
          id: staleRunId,
          organizationId: orgOf(botId),
          targetSourceId: rootId,
          trigger: 'manual',
          status: terminalStatus,
          phase: 'completed',
          crawlCollectedAt: new Date(),
          discoveredCount: 1,
          startedAt: new Date(),
          completedAt: new Date(),
        })
        await db.insert(indexRunItem).values({
          runId: staleRunId,
          sourceId: page.id,
          status: stage === 'prepare' ? 'queued' : 'embedding',
          attemptCount: 0,
          stagedContentKey: staleKey,
        })
        const aiBefore = aiRequests
        if (stage === 'prepare') await preparePage(staleRunId, page.id)
        else await embedPage(staleRunId, page.id)
        const [staleItem] = await db
          .select()
          .from(indexRunItem)
          .where(eq(indexRunItem.runId, staleRunId))
        assert.equal(
          staleItem.attemptCount,
          0,
          `${stage} claimed a ${terminalStatus} run`,
        )
        assert.equal(
          aiRequests,
          aiBefore,
          'Terminal run delivery called an AI provider',
        )
        assert.equal((await publicRun(staleRunId)).status, terminalStatus)
        const [afterStale] = await db
          .select()
          .from(knowledgeSource)
          .where(eq(knowledgeSource.id, page.id))
        assert.equal(afterStale.contentHash, beforeStale.contentHash)
        assert.equal(afterStale.cleanedText, beforeStale.cleanedText)
        objects.delete(`/stage/${staleKey}`)
        await db
          .update(indexRunItem)
          .set({
            status: 'failed',
            stagedContentKey: null,
            completedAt: new Date(),
          })
          .where(eq(indexRunItem.runId, staleRunId))
      }
    }
    console.info(
      'Crawl recovery: terminal-run deliveries preserved current content',
    )
  } finally {
    await stopWorker()
    if (fixtureAssistantId)
      await db
        .update(indexRun)
        .set({
          status: 'failed',
          phase: 'completed',
          completedAt: new Date(),
          errorSummary: 'Test fixture stopped',
        })
        .where(
          and(
            eq(indexRun.organizationId, orgOf(fixtureAssistantId)),
            inArray(indexRun.status, ['queued', 'running']),
          ),
        )
    server.stop(true)
    fixture.stop(true)
    external.stop(true)
  }
}, 300_000)
