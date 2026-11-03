import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'
import { createWithOwnWebsite } from '../fixtures/ownWebsite'
import { orgOf } from '../fixtures/knowledgeOwner'

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
    const { aiUsageEvent, assistant, indexRun, knowledgeSource } =
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

    // The worker customers' reads run in.
    const worker = spawn(process.execPath, ['src/worker.ts'], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    let assistantId: string | undefined
    try {
      const created = await createWithOwnWebsite(
        (path, body) => call(`/assistants${path}`, 'POST', body),
        { name: 'Crawl test', websiteUrl: site },
      )
      assert.equal(created.status, 201, await created.clone().text())
      const made = (await created.json()) as {
        assistant: { id: string }
        source: { id: string }
        indexRun: { id: string }
      }
      assistantId = made.assistant.id

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
          await db
            .delete(knowledgeSource)
            .where(inArray(knowledgeSource.id, ids))
        }
        await db.delete(assistant).where(eq(assistant.id, assistantId))
      }
      server.stop()
    }
  },
  { timeout: 150_000 },
)
