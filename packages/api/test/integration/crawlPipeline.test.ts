import { createWithOwnWebsite } from '../fixtures/ownWebsite'
import { orgOf } from '../fixtures/knowledgeOwner'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { test } from 'bun:test'
import { structuredResponse } from '../fixtures/openAiResponses'

test('Website pages pass through preparation and embedding via the live API and worker', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Crawl integration test requires local PostgreSQL')
  process.env.FRONT_END_URL ??= 'http://localhost:3000'
  const objects = new Map<string, string>()

  let version = 1
  const fixturePaths: string[] = []
  let jevCalls = 0
  let fixturePort = 0
  const html = (body: string) =>
    new Response(body, { headers: { 'content-type': 'text/html' } })
  // The sitemap lists two pages; the home page's links lead to the rest.
  const fixture = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      const { origin, pathname: path } = new URL(req.url)
      fixturePaths.push(path)
      const hoursHtml = `<html><title>Opening hours</title><main><h1>Opening hours</h1><p>Open Monday to Friday, 9 AM to ${version === 1 ? '5 PM' : '6 PM'}.</p></main></html>`
      if (path === '/sitemap.xml')
        return new Response(
          `<urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/hours</loc></url></urlset>`,
        )
      if (path === '/')
        return html(
          '<html><title>Harbour Plumbing</title><nav><a href="/hours">All services</a><a href="/missing">About us</a><a href="/opening-hours">Contact</a></nav><main><h1>Harbour Plumbing</h1><p>We repair water heaters in Bristol.</p><a href="/hours">Subscribe to newsletter</a><button>Accept all cookies</button></main></html>',
        )
      // The same page at an unrelated address.
      if (path === '/hours' || path === '/opening-hours') return html(hoursHtml)
      if (path === '/missing')
        return html(
          '<html><title>Emergency service</title><main><h1>Emergency service</h1><p>Call 0117 555 1212 for emergency repairs.</p></main></html>',
        )
      return new Response('Not found', { status: 404 })
    },
  })
  fixturePort = fixture.port ?? 0
  const siteUrl = `http://127.0.0.1:${fixturePort}`
  const provider = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
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
          ? new Response(content)
          : new Response('Missing', { status: 404 })
      }
      if (url.pathname === '/v1/embeddings') {
        const input = (await req.json()) as { input: string[] }
        return Response.json({
          data: input.input.map((_, index) => ({
            index,
            embedding: Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)),
          })),
          usage: {
            prompt_tokens: input.input.length,
            total_tokens: input.input.length,
          },
        })
      }
      if (url.pathname === '/v1/responses') {
        return structuredResponse(
          {
            summary: 'Plumbing business information.',
            purposes: ['Inform visitors'],
            topics: ['Plumbing'],
            visitorGoals: ['Request repairs'],
            actions: [],
          },
          { input: 10, output: 10 },
          'gpt-5.6-luna',
        )
      }
      if (url.pathname === '/jev' && req.method === 'POST') {
        jevCalls += 1
        const input = (await req.json()) as {
          state: { blocks: Array<string | { text: string }> }
          questions: Record<string, { instructions: string }>
        }
        const answers = Object.fromEntries(
          Object.entries(input.questions).map(([key, question]) => {
            const reference = question.instructions.match(
              /(?:state\.)?blocks\[(\d+)\]/,
            )
            assert(reference, 'Jev question must reference its actual block')
            const block = input.state.blocks[Number(reference[1])]
            assert(block, 'Jev question referenced a missing state block')
            const text = typeof block === 'string' ? block : block.text
            const choice = text.includes('Accept all cookies')
              ? 'noise'
              : /Subscribe to newsletter|All services|About us|Contact/.test(
                    text,
                  )
                ? 'action'
                : 'knowledge'
            return [
              key,
              {
                type: 'choice',
                choice,
                confidence: 0.99,
                probabilities: Object.fromEntries(
                  ['knowledge', 'action', 'noise', 'uncertain'].map((label) => [
                    label,
                    label === choice ? 1 : 0,
                  ]),
                ),
              },
            ]
          }),
        )
        return Response.json({
          model: 'jev-1.13.0',
          answers,
          usage: { input_tokens: 1, output_tokens: 1 },
        })
      }
      return new Response('Not found', { status: 404 })
    },
  })

  const portServer = createServer()
  portServer.listen(0, '127.0.0.1')
  await once(portServer, 'listening')
  const address = portServer.address()
  if (!address || typeof address === 'string')
    throw new Error('Could not reserve an API port')
  const apiPort = address.port
  await new Promise<void>((resolve, reject) =>
    portServer.close((error) => (error ? reject(error) : resolve())),
  )
  const apiOrigin = `http://127.0.0.1:${apiPort}`
  process.env.BETTER_AUTH_URL = apiOrigin
  Object.assign(process.env, {
    NODE_ENV: 'test',
    OPENAI_API_KEY: 'fixture-key',
    OPENAI_BASE_URL: `http://127.0.0.1:${provider.port}/v1`,
    R2_ENDPOINT: `http://127.0.0.1:${provider.port}`,
    R2_BUCKET: 'stage',
    R2_ACCESS_KEY_ID: 'fixture-key',
    R2_SECRET_ACCESS_KEY: 'fixture-secret',
  })
  const childEnv = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(apiPort),
    BETTER_AUTH_URL: apiOrigin,
    FRONT_END_URL: 'http://localhost:3000',
    TYPESAFE_API_KEY: 'test-key',
    DECISION_PROVIDER: 'typesafe',
    TYPESAFE_API_URL: `http://127.0.0.1:${provider.port}/jev`,
  }
  const cwd = new URL('../../', import.meta.url).pathname
  const api = spawn(process.execPath, ['src/index.ts'], {
    cwd,
    env: childEnv,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  let worker: ReturnType<typeof spawn> | undefined
  try {
    let ready = false
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        if (
          (
            await fetch(`${apiOrigin}/api/health`, {
              signal: AbortSignal.timeout(500),
            })
          ).ok
        ) {
          ready = true
          break
        }
      } catch {
        /* starting */
      }
      await Bun.sleep(100)
    }
    assert(ready, 'API did not start')
    const seed = spawn(
      process.execPath,
      ['scripts/seedLocal.ts', '--integration'],
      { cwd, env: childEnv, stdio: ['ignore', 'ignore', 'inherit'] },
    )
    const [seedExit] = await once(seed, 'exit')
    assert.equal(seedExit, 0, 'Local account seed failed')
    const { loadTestCredentials } =
      await import('../../scripts/localSeedSupport')
    const credentials = await loadTestCredentials('integration')
    const base = `${apiOrigin}/api/organizations/${credentials.organizationId}`
    const request = (path: string, method = 'GET', body?: object) =>
      fetch(`${base}${path}`, {
        method,
        headers: {
          Cookie: credentials.accounts.owner.cookie,
          Origin: 'http://localhost:3000',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    worker = spawn(process.execPath, ['src/worker.ts'], {
      cwd,
      env: childEnv,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    const createdResponse = await createWithOwnWebsite(
      (path, body) => request(`/assistants${path}`, 'POST', body),
      { name: 'Harbour Plumbing', websiteUrl: `${siteUrl}/` },
    )
    assert.equal(createdResponse.status, 201)
    const created = (await createdResponse.json()) as {
      assistant: { id: string }
      source: { id: string }
      indexRun: { id: string }
    }
    const assistantId = created.assistant.id
    async function waitForRun(runId: string) {
      for (let attempt = 0; attempt < 140; attempt += 1) {
        const runs = (await (
          await request(`/assistants/${assistantId}/runs`)
        ).json()) as Array<{
          id: string
          status: string
          phase: string
          crawlProvider: string
          indexedCount: number
          unchangedCount: number
        }>
        const run = runs.find((item) => item.id === runId)
        if (run && ['completed', 'failed'].includes(run.status)) return run
        await Bun.sleep(500)
      }
      throw new Error('Crawl run did not finish')
    }
    const first = await waitForRun(created.indexRun.id)
    assert.equal(first.status, 'completed')
    assert.equal(first.crawlProvider, 'http')
    assert.equal(first.indexedCount, 4)
    assert(jevCalls > 0, 'Jev did not classify ambiguous content')
    const { db } = await import('../../src/db')
    const { indexRun, indexRunItem, knowledgeChunk, knowledgeSource } =
      await import('../../src/db/schema')
    const { eq } = await import('drizzle-orm')
    const pages = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.organizationId, orgOf(assistantId)))
    const home = pages.find((page) => page.canonicalUrl === `${siteUrl}/`)
    assert(
      home?.cleanedText?.includes('We repair water heaters in Bristol.'),
      'Business fact was lost',
    )
    assert(
      home?.cleanedText?.includes('Subscribe to newsletter'),
      'Useful subscription route was lost',
    )
    assert(
      home?.cleanedText?.includes('All services'),
      'Useful service navigation was lost',
    )
    assert(!home?.cleanedText?.includes('Accept all cookies'))
    const copy = pages.find(
      (page) => page.canonicalUrl === `${siteUrl}/opening-hours`,
    )
    assert.equal(copy?.status, 'excluded', 'Identical page was learned twice')
    assert.equal(copy?.lastError, `Same page as ${siteUrl}/hours`)
    // Pages the sitemap didn't list were found through the home page's links.
    assert.equal(
      pages.find((page) => page.canonicalUrl === `${siteUrl}/missing`)
        ?.discoveredVia,
      'link',
    )
    const copyReads = () =>
      fixturePaths.filter((path) => path === '/opening-hours').length
    const copyReadsBefore = copyReads()

    const unchangedResponse = await request(
      `/assistants/${assistantId}/sources/${created.source.id}/runs`,
      'POST',
    )
    assert.equal(unchangedResponse.status, 202)
    const unchanged = await waitForRun(
      ((await unchangedResponse.json()) as { id: string }).id,
    )
    assert.equal(unchanged.status, 'completed')
    assert.equal(unchanged.indexedCount, 0)
    assert.equal(unchanged.unchangedCount, 3)
    assert.equal(copyReads(), copyReadsBefore, 'The known copy was read again')

    version = 2
    const changedResponse = await request(
      `/assistants/${assistantId}/sources/${created.source.id}/runs`,
      'POST',
    )
    assert.equal(changedResponse.status, 202)
    const changed = await waitForRun(
      ((await changedResponse.json()) as { id: string }).id,
    )
    assert.equal(changed.status, 'completed')
    assert.equal(changed.indexedCount, 1)
    assert.equal(changed.unchangedCount, 2)
    const updated = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.organizationId, orgOf(assistantId)))
    assert(
      updated
        .find((page) => page.canonicalUrl === `${siteUrl}/hours`)
        ?.cleanedText?.includes('6 PM'),
      'Changed content was not indexed',
    )
    const changedHours = updated.find(
      (page) => page.canonicalUrl === `${siteUrl}/hours`,
    )
    assert(changedHours, 'Changed page source is missing')
    const changedChunks = await db
      .select({ text: knowledgeChunk.text })
      .from(knowledgeChunk)
      .where(eq(knowledgeChunk.sourceId, changedHours.id))
    assert(changedChunks.some((chunk) => chunk.text.includes('6 PM')))
    assert(changedChunks.every((chunk) => !chunk.text.includes('5 PM')))

    // Simulate a crash after the durable page item was committed but before its pg-boss job was sent.
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill('SIGTERM')
      await once(worker, 'exit')
    }
    const hours = updated.find(
      (page) => page.canonicalUrl === `${siteUrl}/hours`,
    )
    assert(hours, 'Hours source is missing')
    const recoveryRunId = crypto.randomUUID()
    const { pageStageKey, writeStagedPage } =
      await import('../../src/services/knowledge/staging')
    const stageKey = pageStageKey(recoveryRunId, hours.id)
    await writeStagedPage(stageKey, {
      url: `${siteUrl}/hours`,
      title: 'Opening hours',
      html: '<html><main><h1>Opening hours</h1><p>Open Monday to Friday, 9 AM to 7 PM.</p></main></html>',
    })
    await db.insert(indexRun).values({
      id: recoveryRunId,
      organizationId: orgOf(assistantId),
      targetSourceId: created.source.id,
      trigger: 'manual',
      status: 'running',
      phase: 'preparing',
      crawlProvider: 'http',
      crawlCollectedAt: new Date(),
      discoveredCount: 1,
      startedAt: new Date(),
    })
    await db.insert(indexRunItem).values({
      runId: recoveryRunId,
      sourceId: hours.id,
      stagedContentKey: stageKey,
    })
    worker = spawn(process.execPath, ['src/worker.ts'], {
      cwd,
      env: childEnv,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    const recovered = await waitForRun(recoveryRunId)
    assert.equal(recovered.status, 'completed')
    assert.equal(recovered.indexedCount, 1)
    const [recoveredHours] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, hours.id))
    assert(
      recoveredHours.cleanedText?.includes('7 PM'),
      'Recovery did not index the committed page',
    )
    const recoveredItems = await db
      .select()
      .from(indexRunItem)
      .where(eq(indexRunItem.runId, recoveryRunId))
    assert.equal(recoveredItems.length, 1)
    assert.equal(recoveredItems[0].status, 'indexed')
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill('SIGTERM')
      await once(worker, 'exit')
    }
    if (api.exitCode === null && api.signalCode === null) {
      api.kill('SIGTERM')
      await once(api, 'exit')
    }
    fixture.stop()
    provider.stop()
  }
}, 240_000)
