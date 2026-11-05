import { createWithOwnWebsite } from '../fixtures/ownWebsite'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import type { knowledgeSource } from '../../src/db/schema'
import { structuredResponse } from '../fixtures/openAiResponses'
import { orgOf } from '../fixtures/knowledgeOwner'

test('page and website scopes share durable ingestion without moving the refresh schedule', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Ingestion scope test requires local PostgreSQL')

  const objects = new Map<string, string>()
  const originGets: string[] = []
  let fixtureOrigin = ''
  let version = 1
  let failNextEmbedding = false
  let embeddingFailures = 0
  let embeddingCalls = 0
  let profileCalls = 0
  let cleanupCalls = 0
  let failNextStageWrite = false
  let stageWriteFailures = 0
  let missingStageReads = 0
  let conditionalDocumentResponses = 0
  let redirectRendered = false
  let raceVersion = 1
  let stageWriteHook: ((key: string) => Promise<void>) | undefined
  // The spawned worker serves every queue in the database, so jobs left by
  // earlier test files (contact memory, overview rebuilds, archive rechecks,
  // scheduled refreshes) also call this fixture. Counters and injected
  // failures apply only to requests carrying this run's content: its tag or
  // its origin.
  const tag = `scope ${crypto.randomUUID().slice(0, 8)}`
  const ours = (text: string) =>
    text.includes(tag) || text.includes(fixtureOrigin)
  const html = (path: string, links = '') =>
    new Response(
      `<html><title>${path}</title><main><h1>Services</h1><p>Rendered appointment information version ${version} for ${path}, ${tag}.</p>${links}</main></html>`,
      { headers: { 'content-type': 'text/html' } },
    )
  const fixture = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/stage' || url.pathname === '/stage/')
        return new Response(
          '<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>',
        )
      if (url.pathname.startsWith('/stage/')) {
        if (req.method === 'PUT') {
          if (failNextStageWrite) {
            failNextStageWrite = false
            stageWriteFailures++
            await req.text()
            return new Response('<Error><Code>InvalidRequest</Code></Error>', {
              status: 400,
            })
          }
          const content = await req.text()
          await stageWriteHook?.(url.pathname)
          objects.set(url.pathname, content)
          return new Response(null)
        }
        if (req.method === 'DELETE') {
          objects.delete(url.pathname)
          return new Response(null, { status: 204 })
        }
        if (!objects.has(url.pathname)) missingStageReads++
        return objects.has(url.pathname)
          ? new Response(objects.get(url.pathname))
          : new Response(null, { status: 404 })
      }
      if (url.pathname === '/v1/embeddings') {
        const { input } = (await req.json()) as { input: string[] }
        const mine = input.some(ours)
        if (mine) embeddingCalls++
        if (mine && failNextEmbedding) {
          failNextEmbedding = false
          embeddingFailures++
          return Response.json({ data: [], usage: { total_tokens: 0 } })
        }
        return Response.json({
          data: input.map((_, index) => ({
            index,
            embedding: Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)),
          })),
          usage: { total_tokens: input.length, prompt_tokens: input.length },
        })
      }
      if (url.pathname === '/v1/responses') {
        if (ours(await req.text())) profileCalls++
        return structuredResponse(
          {
            summary: 'Appointment information',
            purposes: ['Inform'],
            topics: ['Appointments'],
            visitorGoals: ['Find services'],
            actions: [],
          },
          { input: 1, output: 1 },
          'gpt-5.6-luna',
        )
      }
      if (url.pathname === '/jev') {
        cleanupCalls++
        return Response.json({ answers: {} })
      }
      originGets.push(url.pathname)
      if (redirectRendered && url.pathname === '/rendered')
        return Response.redirect(`${fixtureOrigin}/excluded`, 302)
      // The website: its home page links to one page to read, one to skip.
      if (url.pathname === '/')
        return html(
          '/',
          '<a href="/rendered">Services</a><a href="/excluded">Skip</a>',
        )
      if (url.pathname === '/rendered') return html('/rendered')
      if (url.pathname === '/excluded')
        return new Response('<main>Excluded destination evidence.</main>', {
          headers: { 'content-type': 'text/html' },
        })
      if (['/fallback', '/empty'].includes(url.pathname))
        return new Response(
          `<html><title>Fallback</title><main>HTTP fallback information, ${tag}.</main><a href="/unwanted">Next</a></html>`,
          { headers: { 'content-type': 'text/html' } },
        )
      if (url.pathname === '/document') {
        if (req.headers.get('if-none-match') === '"document-v1"') {
          conditionalDocumentResponses++
          return new Response(null, {
            status: 304,
            headers: { etag: '"document-v1"' },
          })
        }
        return new Response(`Public document information, ${tag}.`, {
          headers: {
            'content-type': 'text/plain',
            etag: '"document-v1"',
            'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT',
          },
        })
      }
      if (url.pathname === '/checkpointRace')
        return new Response(
          `Checkpoint race evidence version ${raceVersion}, ${tag}.`,
          {
            headers: { 'content-type': 'text/plain' },
          },
        )
      return new Response('Not found', { status: 404 })
    },
  })
  fixtureOrigin = `http://127.0.0.1:${fixture.port}`
  let handle: (req: Request) => Response | Promise<Response> = () =>
    new Response(null, { status: 503 })
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (req) => handle(req),
  })
  const apiOrigin = `http://127.0.0.1:${server.port}`
  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: String(server.port),
    BETTER_AUTH_URL: apiOrigin,
    FRONT_END_URL: 'http://localhost:3000',
    OPENAI_API_KEY: 'fixture-key',
    OPENAI_BASE_URL: `${fixtureOrigin}/v1`,
    R2_ENDPOINT: fixtureOrigin,
    R2_BUCKET: 'stage',
    R2_ACCESS_KEY_ID: 'fixture',
    R2_SECRET_ACCESS_KEY: 'fixture',
    TYPESAFE_API_KEY: 'fixture',
    DECISION_PROVIDER: 'typesafe',
    TYPESAFE_API_URL: `${fixtureOrigin}/jev`,
  })
  const { app } = await import('../../src/app')
  handle = (req) => app.fetch(req)
  const { db } = await import('../../src/db')
  const { assistant, knowledgeChunk, indexRun, indexRunItem, aiUsageEvent } =
    await import('../../src/db/schema')
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
  const base = `${apiOrigin}/api/organizations/${credentials.organizationId}/assistants`
  let assistantId = ''
  let worker: ReturnType<typeof spawn> | undefined
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
  const request = (path: string, method = 'GET', body?: unknown) =>
    fetch(`${base}/${assistantId}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  async function waitFor(check: () => Promise<boolean>, message: string) {
    for (let i = 0; i < 1500; i++) {
      if (await check()) return
      await Bun.sleep(100)
    }
    throw new Error(message)
  }
  async function waitRun(id: string, expected = 'completed') {
    await waitFor(async () => {
      const response = await request('/runs')
      assert.equal(response.status, 200)
      const run = (
        (await response.json()) as Array<typeof indexRun.$inferSelect>
      ).find((run) => run.id === id)
      if (!run || !['completed', 'failed'].includes(run.status)) return false
      assert.equal(run.status, expected, run.errorSummary ?? undefined)
      return true
    }, `Run ${id} did not finish`)
  }
  async function refresh(sourceId: string) {
    const response = await request(`/sources/${sourceId}/runs`, 'POST')
    assert.equal(response.status, 202)
    return (await response.json()) as { id: string }
  }
  async function readSource(id: string) {
    const response = await request(`/sources/${id}`)
    assert.equal(response.status, 200)
    return (await response.json()) as typeof knowledgeSource.$inferSelect
  }
  async function addSource(path: string, kind = 'webPage') {
    const response = await request('/sources', 'POST', {
      kind,
      url: `${fixtureOrigin}${path}`,
    })
    assert.equal(response.status, 201)
    return (await response.json()) as {
      source: { id: string }
      indexRun: { id: string }
    }
  }
  try {
    const response = await createWithOwnWebsite(
      (path, body) =>
        fetch(`${base}${path}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }),
      { name: 'Scope fixture', websiteUrl: fixtureOrigin },
    )
    assert.equal(response.status, 201)
    const created = (await response.json()) as {
      assistant: { id: string }
      source: { id: string }
      indexRun: { id: string }
    }
    assistantId = created.assistant.id
    assert.equal(
      (
        await request(`/sources/${created.source.id}`, 'PATCH', {
          excludePaths: ['/excluded'],
        })
      ).status,
      200,
    )
    startWorker()
    await waitRun(created.indexRun.id)
    const [initialOwner] = await db
      .select()
      .from(assistant)
      .where(eq(assistant.id, assistantId))
    assert.deepEqual(
      initialOwner.allowedOrigins,
      [fixtureOrigin],
      'Reading the website must not change widget authorization settings',
    )
    const sources = (await (await request('/sources')).json()) as Array<
      typeof knowledgeSource.$inferSelect
    >
    const page = sources.find(
      (source) => source.canonicalUrl === `${fixtureOrigin}/rendered`,
    )!
    assert(page)
    assert(
      !sources.some((source) => source.canonicalUrl?.endsWith('/excluded')),
    )
    const settings = await request('', 'PATCH', { refreshIntervalHours: 24 })
    assert.equal(settings.status, 200)
    const deadline = ((await settings.json()) as { nextRefreshAt: string })
      .nextRefreshAt
    async function unchangedSchedule() {
      const [owner] = await db
        .select()
        .from(assistant)
        .where(eq(assistant.id, assistantId))
      assert.equal(owner.nextRefreshAt?.toISOString(), deadline)
    }

    // A failed embedding is retried from the prepared content.
    version = 2
    failNextEmbedding = true
    const run = await refresh(page.id)
    await waitFor(
      async () => embeddingFailures === 1,
      'Embedding retry was not exercised',
    )
    assert(
      objects.size > 0,
      'Prepared content must remain available after an embedding failure',
    )
    const profilesBeforeRetry = profileCalls
    await waitRun(run.id)
    assert.equal(
      profileCalls,
      profilesBeforeRetry,
      'Embedding retry must reuse prepared content',
    )
    assert.equal(objects.size, 0)
    const saved = await readSource(page.id)
    assert.equal(saved.parentId, created.source.id)
    assert(saved.cleanedText?.includes('version 2'))
    const items = await db
      .select()
      .from(indexRunItem)
      .where(eq(indexRunItem.runId, run.id))
    assert.deepEqual(
      items.map((item) => item.sourceId),
      [page.id],
    )
    await unchangedSchedule()

    const beforeUnchanged = embeddingCalls
    await waitRun((await refresh(page.id)).id)
    assert.equal(
      embeddingCalls,
      beforeUnchanged,
      'Unchanged content should retain embeddings',
    )
    await unchangedSchedule()
    // From here on, only single pages: none of them may read the sitemap.
    originGets.length = 0
    const fallback = await addSource('/fallback')
    await waitRun(fallback.indexRun.id)
    const [fallbackRun] = await db
      .select()
      .from(indexRun)
      .where(eq(indexRun.id, fallback.indexRun.id))
    assert.equal(fallbackRun.crawlProvider, 'http')
    assert(
      fallbackRun.crawlWarning?.includes('JavaScript content may be missing'),
    )
    assert(
      (await readSource(fallback.source.id)).cleanedText?.includes(
        'HTTP fallback',
      ),
    )
    assert(!originGets.includes('/unwanted'))
    assert(!originGets.includes('/sitemap.xml'))
    const empty = await addSource('/empty')
    await waitRun(empty.indexRun.id)
    assert.equal(
      (await readSource(empty.source.id)).status,
      'ready',
      'A missing provider record must use HTTP, not archive the page',
    )
    failNextStageWrite = true
    const document = await addSource('/document', 'publicDocument')
    await waitRun(document.indexRun.id)
    assert.equal(stageWriteFailures, 1)
    assert(
      missingStageReads > 0,
      'Retry must observe and recover the missing first checkpoint',
    )
    assert(
      originGets.filter((path) => path === '/document').length >= 2,
      'Missing checkpoint must be rebuilt from fresh origin evidence',
    )
    const storedDocument = await readSource(document.source.id)
    assert.equal(storedDocument.etag, '"document-v1"')
    assert.equal(
      storedDocument.lastModifiedHeader,
      'Wed, 01 Jan 2025 00:00:00 GMT',
    )
    const profilesBeforeConditional = profileCalls
    const embeddingsBeforeConditional = embeddingCalls
    await waitRun((await refresh(document.source.id)).id)
    assert.equal(conditionalDocumentResponses, 1)
    assert.equal(profileCalls, profilesBeforeConditional)
    assert.equal(embeddingCalls, embeddingsBeforeConditional)
    const documentRuns = await db
      .select({ crawlProvider: indexRun.crawlProvider })
      .from(indexRun)
      .where(eq(indexRun.targetSourceId, document.source.id))
    assert(
      documentRuns.every((run) => run.crawlProvider === null),
      'Public documents keep their extraction path',
    )
    const upload = new FormData()
    upload.set(
      'file',
      new File([`Uploaded service information, ${tag}.`], 'services.txt', {
        type: 'text/plain',
      }),
    )
    const uploadResponse = await fetch(`${base}/${assistantId}/uploads`, {
      method: 'POST',
      headers: { Cookie: headers.Cookie, Origin: headers.Origin },
      body: upload,
    })
    assert.equal(uploadResponse.status, 201)
    const uploaded = (await uploadResponse.json()) as {
      source: { id: string }
      indexRun: { id: string }
    }
    await waitRun(uploaded.indexRun.id)
    await waitRun((await refresh(uploaded.source.id)).id)
    await unchangedSchedule()
    const uploadRuns = await db
      .select({ crawlProvider: indexRun.crawlProvider })
      .from(indexRun)
      .where(eq(indexRun.targetSourceId, uploaded.source.id))
    assert(
      uploadRuns.every((run) => run.crawlProvider === null),
      'Uploads must not start a crawl',
    )
    await waitRun((await refresh(created.source.id)).id)
    await unchangedSchedule()
    const missing = await addSource('/missing')
    await waitRun(missing.indexRun.id, 'failed')
    assert.equal((await readSource(missing.source.id)).status, 'archived')
    await unchangedSchedule()
    assert(
      (
        await db
          .select()
          .from(knowledgeChunk)
          .where(eq(knowledgeChunk.sourceId, page.id))
      ).length > 0,
    )
    const finalSources = (await (await request('/sources')).json()) as Array<
      typeof knowledgeSource.$inferSelect
    >
    assert(
      !finalSources.some((source) =>
        ['/unexpected', '/unwanted'].some((path) =>
          source.canonicalUrl?.endsWith(path),
        ),
      ),
    )

    // A child refreshed alone still obeys its parent's resolved-path exclusions,
    // also when it redirects there.
    redirectRendered = true
    await waitRun((await refresh(page.id)).id, 'failed')
    const afterExcludedRedirect = await readSource(page.id)
    assert(
      !afterExcludedRedirect.cleanedText?.includes(
        'Excluded destination evidence',
      ),
    )
    assert(afterExcludedRedirect.lastError?.includes('path settings'))
    assert.equal(
      afterExcludedRedirect.canonicalUrl,
      `${fixtureOrigin}/rendered`,
    )
    redirectRendered = false

    // Pause an expired preparer's first PUT. Its replacement must own another
    // key, and the stale PUT's eventual cleanup must leave that checkpoint intact.
    await stopWorker()
    const race = await addSource('/checkpointRace', 'publicDocument')
    const { discoverSource, indexSource } =
      await import('../../src/services/knowledge/indexer')
    const { preparePage } =
      await import('../../src/services/knowledge/preparePage')
    await discoverSource(race.indexRun.id, race.source.id)
    let releaseOldPut!: () => void
    const oldPutGate = new Promise<void>((resolve) => {
      releaseOldPut = resolve
    })
    let oldPutKey = ''
    stageWriteHook = async (key) => {
      if (!key.includes(`/pages/${race.source.id}/prepare-`) || oldPutKey)
        return
      oldPutKey = key
      await oldPutGate
    }
    const oldPreparation = indexSource(race.indexRun.id, race.source.id)
    try {
      await waitFor(
        async () => Boolean(oldPutKey),
        'First preparation PUT did not pause',
      )
      await db
        .update(indexRunItem)
        .set({ leaseUntil: new Date(0) })
        .where(
          and(
            eq(indexRunItem.runId, race.indexRun.id),
            eq(indexRunItem.sourceId, race.source.id),
          ),
        )
      raceVersion = 2
      await preparePage(race.indexRun.id, race.source.id)
      const [replacement] = await db
        .select()
        .from(indexRunItem)
        .where(
          and(
            eq(indexRunItem.runId, race.indexRun.id),
            eq(indexRunItem.sourceId, race.source.id),
          ),
        )
      assert.equal(replacement.status, 'prepared')
      assert(replacement.stagedContentKey)
      const replacementKey = `/stage/${replacement.stagedContentKey}`
      assert.notEqual(replacementKey, oldPutKey)
      const replacementContent = objects.get(replacementKey)
      assert(replacementContent?.includes('Checkpoint race evidence version 2'))
      releaseOldPut()
      await oldPreparation
      const [afterStalePut] = await db
        .select()
        .from(indexRunItem)
        .where(
          and(
            eq(indexRunItem.runId, race.indexRun.id),
            eq(indexRunItem.sourceId, race.source.id),
          ),
        )
      assert.equal(afterStalePut.stagedContentKey, replacement.stagedContentKey)
      assert.equal(afterStalePut.attemptCount, replacement.attemptCount)
      assert.equal(
        objects.get(replacementKey),
        replacementContent,
        'Stale preparation changed or deleted the replacement checkpoint',
      )
      assert(
        !objects.has(oldPutKey),
        'The stale attempt object should be retired after its late PUT',
      )

      // Failure to copy a completed checkpoint must not discard its successful
      // cleanup/profile work. The previous key remains authoritative until PUT succeeds.
      const previousCalls = {
        origin: originGets.length,
        cleanup: cleanupCalls,
        profile: profileCalls,
      }
      await db
        .update(indexRunItem)
        .set({ status: 'queued', leaseUntil: null })
        .where(
          and(
            eq(indexRunItem.runId, race.indexRun.id),
            eq(indexRunItem.sourceId, race.source.id),
          ),
        )
      failNextStageWrite = true
      await assert.rejects(preparePage(race.indexRun.id, race.source.id))
      const [afterFailedCopy] = await db
        .select()
        .from(indexRunItem)
        .where(
          and(
            eq(indexRunItem.runId, race.indexRun.id),
            eq(indexRunItem.sourceId, race.source.id),
          ),
        )
      assert.equal(
        afterFailedCopy.stagedContentKey,
        replacement.stagedContentKey,
      )
      assert.equal(objects.get(replacementKey), replacementContent)
      await preparePage(race.indexRun.id, race.source.id)
      const [preparedAgain] = await db
        .select()
        .from(indexRunItem)
        .where(
          and(
            eq(indexRunItem.runId, race.indexRun.id),
            eq(indexRunItem.sourceId, race.source.id),
          ),
        )
      const { groupWebsite } =
        await import('../../src/services/knowledge/groupWebsite')
      failNextStageWrite = true
      await groupWebsite(race.indexRun.id)
      const [afterFailedGrouping] = await db
        .select()
        .from(indexRunItem)
        .where(
          and(
            eq(indexRunItem.runId, race.indexRun.id),
            eq(indexRunItem.sourceId, race.source.id),
          ),
        )
      assert.equal(afterFailedGrouping.status, 'embedding')
      assert.equal(
        afterFailedGrouping.stagedContentKey,
        preparedAgain.stagedContentKey,
      )
      assert(objects.has(`/stage/${preparedAgain.stagedContentKey}`))
      assert.deepEqual(
        {
          origin: originGets.length,
          cleanup: cleanupCalls,
          profile: profileCalls,
        },
        previousCalls,
        'Retrying failed checkpoint publication must reuse completed extraction, cleanup and profile results',
      )
    } finally {
      releaseOldPut()
      await oldPreparation
      stageWriteHook = undefined
    }
    startWorker()
    await waitRun(race.indexRun.id)
    assert(
      (await readSource(race.source.id)).cleanedText?.includes(
        'Checkpoint race evidence version 2',
      ),
    )

    // The scheduler still advances due refreshes, and settings still reset it.
    assert.equal(
      (await request('', 'PATCH', { status: 'published' })).status,
      200,
    )
    await db
      .update(assistant)
      .set({ nextRefreshAt: new Date(0) })
      .where(eq(assistant.id, assistantId))
    await waitFor(async () => {
      const [owner] = await db
        .select()
        .from(assistant)
        .where(eq(assistant.id, assistantId))
      return Boolean(owner.nextRefreshAt && owner.nextRefreshAt > new Date())
    }, 'Scheduler did not advance the due refresh')
    const [scheduledOwner] = await db
      .select()
      .from(assistant)
      .where(eq(assistant.id, assistantId))
    const scheduledDeadline = scheduledOwner.nextRefreshAt!.getTime()
    await waitFor(async () => {
      const active = await db
        .select()
        .from(indexRun)
        .where(
          and(
            eq(indexRun.organizationId, orgOf(assistantId)),
            eq(indexRun.trigger, 'scheduled'),
          ),
        )
      return (
        active.length > 0 &&
        active.every((run) => ['completed', 'failed'].includes(run.status))
      )
    }, 'Scheduled runs did not finish')
    const [afterScheduled] = await db
      .select()
      .from(assistant)
      .where(eq(assistant.id, assistantId))
    assert.equal(
      afterScheduled.nextRefreshAt!.getTime(),
      scheduledDeadline,
      'Scheduled completion must not reset its own timer',
    )
    const changedSettings = await request('', 'PATCH', {
      refreshIntervalHours: 48,
    })
    assert.equal(changedSettings.status, 200)
    const changedDate = new Date(
      ((await changedSettings.json()) as { nextRefreshAt: string })
        .nextRefreshAt,
    )
    assert(changedDate.getTime() > Date.now() + 47 * 3_600_000)
  } finally {
    await stopWorker()
    if (assistantId) {
      await db
        .update(indexRun)
        .set({ status: 'failed', completedAt: new Date() })
        .where(
          and(
            eq(indexRun.organizationId, orgOf(assistantId)),
            eq(indexRun.status, 'running'),
          ),
        )
      await db
        .update(indexRun)
        .set({ status: 'failed', completedAt: new Date() })
        .where(
          and(
            eq(indexRun.organizationId, orgOf(assistantId)),
            eq(indexRun.status, 'queued'),
          ),
        )
      const sources = (await (await request('/sources')).json()) as Array<
        typeof knowledgeSource.$inferSelect
      >
      for (const source of sources.filter((source) => source.parentId === null))
        assert.equal(
          (await request(`/sources/${source.id}`, 'DELETE')).status,
          204,
        )
      await db
        .delete(aiUsageEvent)
        .where(eq(aiUsageEvent.assistantId, assistantId))
      await db
        .delete(indexRun)
        .where(eq(indexRun.organizationId, orgOf(assistantId)))
      await db.delete(assistant).where(eq(assistant.id, assistantId))
    }
    const { getBoss } = await import('../../src/services/queue/boss')
    await (await getBoss()).stop()
    server.stop(true)
    fixture.stop(true)
  }
}, 600_000)
