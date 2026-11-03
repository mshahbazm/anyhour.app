import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { createWithOwnWebsite } from '../fixtures/ownWebsite'
import { orgOf } from '../fixtures/knowledgeOwner'

// A new website's articles, listings and other-language copies become exclude
// rules before its first read, decided from free evidence where possible and
// by one Jev call for the rest. Removing a rule reads the website again.
test('a new website skips its articles, and removing the rule reads them', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Website scope test requires local PostgreSQL')

  const insights = Array.from({ length: 40 }, (_, i) => `/insights/post-${i}`)
  const paths = [
    '/',
    '/about',
    '/contact',
    '/services',
    '/services/cleaning',
    '/services/repairs',
    '/insights',
    ...insights,
    '/tag/tips',
    '/tag/news',
    '/my-post',
    '/es',
    '/es/servicios',
    '/es/contacto',
  ]
  const jevRequests: Array<{
    model: string
    state: { groups: Array<{ path: string }> }
    questions: Record<string, unknown>
  }> = []
  let site = ''
  const fixture = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === '/sitemap.xml')
        return new Response(
          `<urlset>${paths.map((path) => `<url><loc>${site}${path}</loc></url>`).join('')}</urlset>`,
        )
      if (url.pathname === '/')
        return new Response(
          '<html lang="en"><head><title>Home</title><link rel="alternate" type="application/rss+xml" href="/feed"></head><body><a href="/services">Services</a></body></html>',
          { headers: { 'content-type': 'text/html' } },
        )
      if (url.pathname === '/feed')
        return new Response(
          `<rss><channel>${['/insights/post-1', '/insights/post-2', '/my-post']
            .map((path) => `<item><link>${site}${path}</link></item>`)
            .join('')}</channel></rss>`,
        )
      if (url.pathname === '/jev') {
        const body = (await request.json()) as (typeof jevRequests)[number]
        jevRequests.push(body)
        return Response.json({
          model: body.model,
          answers: Object.fromEntries(
            Object.keys(body.questions).map((key) => [
              key,
              { type: 'choice', choice: 'business', confidence: 0.9 },
            ]),
          ),
          usage: { input_tokens: 120, output_tokens: 3 },
        })
      }
      return new Response('Not found', { status: 404 })
    },
  })
  site = `http://127.0.0.1:${fixture.port}`
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
    TYPESAFE_API_KEY: 'fixture-key',
    TYPESAFE_API_URL: `${site}/jev`,
  })
  const { app } = await import('../../src/app')
  handle = (request) => app.fetch(request)
  const { db } = await import('../../src/db')
  const { aiUsageEvent, assistant, indexRun, indexRunItem, knowledgeSource } =
    await import('../../src/db/schema')
  const { startCrawl } = await import('../../src/services/knowledge/crawl')
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
  const workspace = `${origin}/api/organizations/${credentials.organizationId}`
  const call = (path: string, method = 'GET', body?: unknown) =>
    fetch(`${workspace}${path}`, {
      method,
      headers: {
        Cookie: credentials.accounts.owner.cookie,
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const startedAt = new Date()
  let assistantId: string | undefined
  try {
    const created = await createWithOwnWebsite(
      (path, body) => call(`/assistants${path}`, 'POST', body),
      { name: 'Scope test', websiteUrl: site },
    )
    assert.equal(created.status, 201, await created.clone().text())
    const made = (await created.json()) as {
      assistant: { id: string }
      source: { id: string }
      indexRun: { id: string }
    }
    assistantId = made.assistant.id
    const sourcePath = `/assistants/${assistantId}/sources/${made.source.id}`

    // What the worker does first with a new website's run.
    await startCrawl(made.indexRun.id, made.source.id)

    const source = (await (await call(sourcePath)).json()) as {
      excludePaths: string[]
      scopePlan: {
        rules: Array<{ rule: string; kind: string; pages: number }>
      } | null
    }
    assert.deepEqual(source.excludePaths.sort(), [
      '/es/',
      '/insights',
      '/my-post$',
      '/tag',
    ])
    assert.deepEqual(
      source.scopePlan?.rules.find(({ rule }) => rule === '/es/'),
      { rule: '/es/', kind: 'language', pages: 2 },
    )
    assert.deepEqual(
      source.scopePlan?.rules.find(({ rule }) => rule === '/insights'),
      { rule: '/insights', kind: 'article', pages: 41 },
    )
    // The feed decided the articles; Jev was asked only about the rest.
    assert.equal(jevRequests.length, 1)
    assert.equal(jevRequests[0].model, 'jev-1.14.0')
    assert.deepEqual(
      jevRequests[0].state.groups.map(({ path }) => path).sort(),
      ['/about', '/contact', '/services'],
    )
    const [usage] = await db
      .select()
      .from(aiUsageEvent)
      .where(
        and(
          eq(aiUsageEvent.sourceId, made.source.id),
          eq(aiUsageEvent.kind, 'scopePlan'),
        ),
      )
    assert.equal(usage?.inputTokens, 120)
    // Reading skips the folders and exactly the one page.
    const queued = (
      await db
        .select({ url: knowledgeSource.canonicalUrl })
        .from(indexRunItem)
        .innerJoin(
          knowledgeSource,
          eq(knowledgeSource.id, indexRunItem.sourceId),
        )
        .where(eq(indexRunItem.runId, made.indexRun.id))
    ).map(({ url }) => new URL(url!).pathname)
    assert(queued.includes('/about'), queued.join(', '))
    assert(queued.includes('/es'), 'The Spanish home page itself is read')
    assert(
      !queued.some((path) => /^\/(?:insights|tag|es\/)|^\/my-post$/.test(path)),
      queued.join(', '),
    )

    // The first read ends; removing the rule starts a new one.
    await db
      .update(indexRun)
      .set({ status: 'completed', phase: 'completed', completedAt: new Date() })
      .where(eq(indexRun.targetSourceId, made.source.id))
    const removed = await call(sourcePath, 'PATCH', {
      excludePaths: ['/my-post$', '/tag'],
    })
    assert.equal(removed.status, 200, await removed.clone().text())
    const runs = await db
      .select({ trigger: indexRun.trigger, status: indexRun.status })
      .from(indexRun)
      .where(eq(indexRun.targetSourceId, made.source.id))
    assert(
      runs.some(
        (run) =>
          run.trigger === 'manual' &&
          ['queued', 'running'].includes(run.status),
      ),
      'Removing a rule did not read the website again',
    )
  } finally {
    if (assistantId) {
      const sources = await db
        .select({ id: knowledgeSource.id })
        .from(knowledgeSource)
        .where(eq(knowledgeSource.organizationId, orgOf(assistantId)))
      const ids = sources.map(({ id }) => id)
      if (ids.length) {
        await db.delete(indexRun).where(inArray(indexRun.targetSourceId, ids))
        await db
          .delete(aiUsageEvent)
          .where(eq(aiUsageEvent.assistantId, assistantId))
        await db.delete(knowledgeSource).where(inArray(knowledgeSource.id, ids))
      }
      await db.delete(assistant).where(eq(assistant.id, assistantId))
    }
    // No worker runs here; leave no jobs for a later test's worker.
    const { getBoss } = await import('../../src/services/queue/boss')
    const boss = await getBoss()
    for (const queue of ['start-crawl', 'prepare-page', 'refresh-overview']) {
      const jobs = (await boss.findJobs(queue, { queued: true })).filter(
        (job) => job.createdOn >= startedAt,
      )
      if (jobs.length)
        await boss.cancel(
          queue,
          jobs.map((job) => job.id),
        )
    }
    await boss.stop()
    server.stop(true)
    fixture.stop(true)
  }
}, 120_000)
