import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'

// A real website read the way a customer's is: the real worker, Cloudflare's
// browser, Jev and embeddings, with the keys in .env. Only the page limit is
// small, so it finishes in a minute or two. Run with `bun run test:crawl`
// when the reading code changes.
const site = 'https://xvelopers.com'
const pageLimit = 5

test(
  'a real website is read, learned and searchable',
  async () => {
    const databaseUrl = process.env.DATABASE_URL
    if (
      !databaseUrl ||
      !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
    )
      throw new Error('The crawl test requires local PostgreSQL')

    let handle: (request: Request) => Response | Promise<Response> = () =>
      new Response(null, { status: 503 })
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request) => handle(request),
    })
    const origin = `http://127.0.0.1:${server.port}`
    Object.assign(process.env, {
      PORT: String(server.port),
      BETTER_AUTH_URL: origin,
      FRONT_END_URL: 'http://localhost:3000',
      MAX_WEBSITE_PAGES: String(pageLimit),
    })
    const { app } = await import('../../src/app')
    handle = (request) => app.fetch(request)
    const { db } = await import('../../src/db')
    const { aiUsageEvent, indexRun, knowledgeSource } =
      await import('../../src/db/schema')
    const { searchKnowledge } =
      await import('../../src/services/knowledge/retrieval')
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

    // The workspace's sources and their runs and usage, so each read starts
    // from nothing and leaves nothing behind. The workspace's AI stays.
    const clearSources = async () => {
      const ids = (
        await db
          .select({ id: knowledgeSource.id })
          .from(knowledgeSource)
          .where(eq(knowledgeSource.organizationId, credentials.organizationId))
      ).map(({ id }) => id)
      if (!ids.length) return
      await db.delete(indexRun).where(inArray(indexRun.targetSourceId, ids))
      await db.delete(aiUsageEvent).where(inArray(aiUsageEvent.sourceId, ids))
      await db.delete(knowledgeSource).where(inArray(knowledgeSource.id, ids))
    }
    await clearSources()

    // The worker customers' reads run in.
    const worker = spawn(process.execPath, ['src/worker.ts'], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    try {
      // One AI per business: it reads the workspace's website.
      const ai = await call('/assistant')
      assert.equal(ai.status, 200, await ai.clone().text())
      const assistantId = ((await ai.json()) as { id: string }).id
      const created = await call('/business/sources', 'POST', {
        kind: 'website',
        url: site,
      })
      assert.equal(created.status, 201, await created.clone().text())
      const made = (await created.json()) as {
        source: { id: string }
        indexRun: { id: string }
      }

      let run: typeof indexRun.$inferSelect | undefined
      for (let i = 0; i < 220; i++) {
        ;[run] = await db
          .select()
          .from(indexRun)
          .where(eq(indexRun.id, made.indexRun.id))
        if (run && ['completed', 'failed'].includes(run.status)) break
        if (i % 20 === 0 && run)
          console.log(
            `${i / 2}s ${run.phase}: ${run.discoveredCount} found, ${run.indexedCount} learned, ${run.failedCount} failed`,
          )
        await Bun.sleep(500)
      }
      assert(run, 'The read was not found')
      assert.equal(run.status, 'completed', run.errorSummary ?? '')
      assert.equal(run.crawlProvider, 'browser')
      assert(run.discoveredCount <= pageLimit, `${run.discoveredCount} pages`)
      assert(run.indexedCount >= 3, `${run.indexedCount} pages learned`)
      // What reading cost, per page and provider, and how long it took.
      const pages = await db
        .select({
          id: knowledgeSource.id,
          url: knowledgeSource.canonicalUrl,
          cleanupStatus: knowledgeSource.cleanupStatus,
        })
        .from(knowledgeSource)
        .where(eq(knowledgeSource.organizationId, credentials.organizationId))
      const usage = await db
        .select()
        .from(aiUsageEvent)
        .where(
          inArray(
            aiUsageEvent.sourceId,
            pages.map(({ id }) => id),
          ),
        )
      for (const page of pages) {
        const events = usage.filter((event) => event.sourceId === page.id)
        if (!events.length) continue
        console.log(
          `${page.url ?? page.id} cleanup ${page.cleanupStatus ?? '-'}: ` +
            events
              .map(
                (event) =>
                  `${event.kind} ${event.provider}/${event.model} ${event.inputTokens} in (${event.cachedInputTokens} cached) $${Number(event.costUsd).toFixed(6)}`,
              )
              .join('; '),
        )
      }
      if (run.startedAt && run.completedAt)
        console.log(
          `Read in ${((run.completedAt.getTime() - run.startedAt.getTime()) / 1000).toFixed(1)}s`,
        )

      const [website] = await db
        .select()
        .from(knowledgeSource)
        .where(eq(knowledgeSource.id, made.source.id))
      assert(website.scopePlan, 'The website was not planned')
      assert(
        website.excludePaths.includes('/guides'),
        `Guides are not skipped: ${website.excludePaths.join(', ')}`,
      )

      const passages = await searchKnowledge(
        assistantId,
        credentials.organizationId,
        null,
        'What does Xvelopers do for local businesses?',
      )
      assert(passages.length > 0, 'Search found nothing')
      assert(
        JSON.stringify(passages).includes('xvelopers.com'),
        'Search did not find the website',
      )
    } finally {
      worker.kill()
      await clearSources()
      server.stop()
    }
  },
  { timeout: 150_000 },
)
