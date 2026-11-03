import { createWithOwnWebsite } from '../fixtures/ownWebsite'
import { orgOf } from '../fixtures/knowledgeOwner'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { structuredResponse } from '../fixtures/openAiResponses'

test('website cleanup preserves shared facts, profiles, retrieval permissions and temporary cleanup', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Cleanup integration requires local PostgreSQL')
  const objects = new Map<string, string>()
  const embeddedTexts: string[] = []
  const pageStatuses = new Map<string, number>()
  // Switches the test flips and counters it reads back live on one object.
  // As closure `let`s, the fixture handler sometimes kept reading an old
  // value after the test changed it (seen with Bun 1.3.5): the sitemap left out
  // /never-existed, or storage accepted the DELETE that should fail.
  const fake = {
    failStageDeletes: false,
    rejectedStageDeletes: 0,
    includeMissingPage: false,
    revision: 1,
    jevRequests: 0,
    profileRequests: 0,
  }
  let fixtureOrigin = ''
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
          if (fake.failStageDeletes) {
            fake.rejectedStageDeletes++
            return new Response('Temporarily unavailable', { status: 503 })
          }
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
        const input = (await req.json()) as { input: string[] }
        embeddedTexts.push(...input.input)
        return Response.json({
          data: input.input.map((text, index) => ({
            index,
            embedding: Array.from({ length: 384 }, (_, i) =>
              i === (/Opening hours/i.test(text) ? 0 : 1) ? 1 : 0,
            ),
          })),
          usage: {
            total_tokens: input.input.length,
            prompt_tokens: input.input.length,
          },
        })
      }
      if (url.pathname === '/jev') {
        fake.jevRequests++
        const input = (await req.json()) as {
          model: string
          state: { blocks: Array<{ text: string }> }
          questions: Record<
            string,
            { instructions: string; criteria: Record<string, unknown> }
          >
        }
        assert.equal(input.model, 'jev-1.13.0')
        const answers = Object.fromEntries(
          Object.entries(input.questions).map(([key, question]) => {
            assert.deepEqual(Object.keys(question.criteria).sort(), [
              'action',
              'knowledge',
              'noise',
              'uncertain',
            ])
            const reference = question.instructions.match(
              /(?:state\.)?blocks\[(\d+)\]/,
            )
            assert(reference, 'Question must reference actual state index')
            const block = input.state.blocks[Number(reference[1])]
            assert(block)
            const text = block.text
            const uncertainFact = text.includes(
              'Emergency repairs are available',
            )
            const choice =
              uncertainFact || /Accept all cookies|Slide 1 of 3/.test(text)
                ? 'noise'
                : /Book a repair|View our services/.test(text)
                  ? 'action'
                  : 'knowledge'
            const probabilities = uncertainFact
              ? { knowledge: 0.3, action: 0.1, noise: 0.5, uncertain: 0.1 }
              : Object.fromEntries(
                  ['knowledge', 'action', 'noise', 'uncertain'].map((label) => [
                    label,
                    label === choice ? 1 : 0,
                  ]),
                )
            return [
              key,
              {
                type: 'choice',
                choice,
                confidence: uncertainFact ? 0.4 : 0.99,
                probabilities,
              },
            ]
          }),
        )
        return Response.json({
          model: 'jev-1.13.0',
          answers,
          usage: { input_tokens: 10, output_tokens: 10 },
        })
      }
      if (url.pathname === '/v1/responses') {
        fake.profileRequests++
        const input = (await req.json()) as {
          model: string
          instructions: string
          input: string
        }
        assert.equal(input.model, 'gpt-5.6-luna')
        assert(!/<(?:html|main|footer)\b/.test(input.input))
        return structuredResponse(
          {
            summary: 'Plumbing services and appointment information.',
            purposes: ['Inform visitors about plumbing services'],
            topics: ['Plumbing'],
            visitorGoals: ['Book a repair'],
            actions: [
              {
                label: 'Invented destination',
                url: 'https://invented.invalid/checkout',
              },
            ],
          },
          { input: 30, output: 20 },
          input.model,
        )
      }
      if (req.method === 'GET') {
        const pageData = [
          {
            path: '/',
            title: 'Harbour Plumbing',
            body: '<p>Emergency repairs are available every day in Bristol.</p><p>Our accredited plumbers repair leaking pipes and install efficient water heaters for homes and small businesses.</p>',
          },
          {
            path: '/services',
            title: 'Plumbing services',
            body: '<p>Water heater installation includes removal of the old unit and a two-year workmanship guarantee.</p>',
          },
          {
            path: '/contact',
            title: 'Contact our Bristol team',
            body: '<p>Appointments can be booked by telephone or through our repair booking form.</p>',
          },
          {
            path: '/bath',
            title: 'Bath branch',
            body: '<p>Our Bath branch specialises in commercial boiler maintenance.</p>',
          },
        ]
        // The sitemap leaves out a page once it starts failing.
        const listed = pageData.filter(
          (page) => page.path !== '/contact' || !pageStatuses.has('/contact'),
        )
        if (url.pathname === '/sitemap.xml')
          return new Response(
            `<urlset>${[
              ...listed.map((page) => page.path),
              ...(fake.includeMissingPage ? ['/never-existed'] : []),
            ]
              .map((path) => `<url><loc>${fixtureOrigin}${path}</loc></url>`)
              .join('')}</urlset>`,
          )
        const i = pageData.findIndex((page) => page.path === url.pathname)
        const page = pageData[i]
        if (page && !pageStatuses.has(page.path))
          return new Response(
            `<html><title>${
              page.title
            }</title><header class="header-${fake.revision}-${i}"><a href="/services" aria-current="${
              i === 1 ? 'page' : 'false'
            }">View our services</a></header><main><h1>${page.title}</h1>${
              page.body
            }<div><a href="/contact">Book a repair</a></div><div><button>Slide 1 of 3</button></div><div><button>Accept all cookies</button></div></main><footer id="footer-${fake.revision}-${i}" class="${
              i % 2 ? 'active' : 'default'
            }"><p>${
              i === 3
                ? 'Bath opening hours: Tuesday to Saturday, 10 AM to 4 PM.'
                : `Opening hours: Monday to Friday, 9 AM to ${
                    fake.revision === 1 ? '5 PM' : '6 PM'
                  }.`
            }</p><p>Telephone 0117 555 1212</p></footer></html>`,
            { headers: { 'content-type': 'text/html' } },
          )
      }
      return new Response('Fixture page response', {
        status: pageStatuses.get(url.pathname) ?? 404,
      })
    },
  })
  fixtureOrigin = `http://127.0.0.1:${fixture.port}`
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
  const {
    knowledgeSource,
    knowledgeChunk,
    knowledgeSharedBlock,
    knowledgeSharedBlockSource,
    indexRun,
    indexRunItem,
    conversation,
  } = await import('../../src/db/schema')
  const { searchKnowledge } =
    await import('../../src/services/knowledge/retrieval')
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
  const request = (path: string, method = 'GET', body?: object) =>
    fetch(`${base}${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  let worker: ReturnType<typeof spawn> | undefined
  let assistantId: string | undefined
  try {
    const response = await createWithOwnWebsite(
      (path, body) => request(`/assistants${path}`, 'POST', body),
      { name: 'Shared content cleanup fixture', websiteUrl: fixtureOrigin },
    )
    assert.equal(response.status, 201)
    const created = (await response.json()) as {
      assistant: { id: string }
      source: { id: string }
      indexRun: { id: string }
    }
    assistantId = created.assistant.id
    const botId = assistantId,
      rootId = created.source.id
    async function waitForRun(runId: string) {
      // Eight durable stage attempts can span several recovery sweeps after
      // the transport job exhausts its smaller delivery retry allowance.
      for (let attempt = 0; attempt < 3000; attempt++) {
        const response = await request(`/assistants/${botId}/runs`)
        assert.equal(response.status, 200)
        const runs = (await response.json()) as Array<
          typeof indexRun.$inferSelect
        >
        const run = runs.find((item) => item.id === runId)
        if (run && ['completed', 'failed'].includes(run.status)) return run
        await Bun.sleep(100)
      }
      throw new Error('Cleanup run did not finish within bounded wait')
    }
    worker = spawn(process.execPath, ['src/worker.ts'], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    const first = await waitForRun(created.indexRun.id)
    assert.equal(first.status, 'completed', first.errorSummary ?? undefined)
    assert.equal(first.discoveredCount, 4)
    assert(fake.jevRequests > 0)
    const pages = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.parentId, rootId))
    const home = pages.find((page) => page.canonicalUrl === `${fixtureOrigin}/`)
    assert(home)
    const commonHours = 'Opening hours: Monday to Friday, 9 AM to 5 PM.'
    const sharedBlocks = () =>
      db
        .select()
        .from(knowledgeSharedBlock)
        .where(eq(knowledgeSharedBlock.websiteId, rootId))
    const originalShared = await sharedBlocks()
    const sharedHours = originalShared.filter((block) =>
      block.text.includes(commonHours),
    )
    assert.equal(
      sharedHours.length,
      1,
      'Identical hours must have one shared stored copy despite changing IDs/classes',
    )
    const origins = await db
      .select()
      .from(knowledgeSharedBlockSource)
      .where(eq(knowledgeSharedBlockSource.blockId, sharedHours[0].id))
    assert.equal(
      origins.length,
      3,
      'Shared fact must retain all three source references',
    )
    assert(
      pages.every((page) => !page.cleanedText?.includes(commonHours)),
      'Shared hours duplicated in page-specific storage',
    )
    assert(
      pages
        .find((page) => page.canonicalUrl === `${fixtureOrigin}/bath`)
        ?.cleanedText?.includes('10 AM to 4 PM'),
      'Different branch hours were incorrectly merged',
    )
    const homeResponse = await request(
      `/assistants/${botId}/sources/${home.id}`,
    )
    assert.equal(homeResponse.status, 200)
    const homeDetail = (await homeResponse.json()) as {
      cleanedText: string
      cleanupStatus: string
      cleanupStats: {
        model: string
        attempts: number
        activeMs: number
        inputTokens: number
        outputTokens: number
      }
      pageProfile: {
        summary: string
        purposes: string[]
        actions: Array<{ label: string; url: string }>
      }
      pageActions: Array<{ label: string; url: string }>
    }
    assert(
      homeDetail.cleanedText.includes(commonHours),
      'Source detail must assemble useful shared text',
    )
    assert.equal(homeDetail.cleanupStatus, 'complete')
    assert.equal(homeDetail.cleanupStats.model, 'jev-1.13.0')
    assert(homeDetail.cleanupStats.attempts > 0)
    assert(homeDetail.cleanupStats.activeMs >= 0)
    assert(homeDetail.cleanupStats.inputTokens > 0)
    assert(homeDetail.pageProfile.summary.length > 0)
    assert(homeDetail.pageProfile.purposes.length > 0)
    assert(
      homeDetail.pageActions.some(
        (action) =>
          action.label === 'Book a repair' &&
          action.url === `${fixtureOrigin}/contact`,
      ),
    )
    assert(
      homeDetail.pageProfile.actions.every(
        (action) => !action.url.includes('invented.invalid'),
      ),
      'Model invented an unobserved routing destination',
    )
    assert(
      home.cleanedText?.includes('Emergency repairs are available'),
      'Low-confidence noise decision lost a fact',
    )
    assert(
      embeddedTexts.every((text) => !/<(?:html|main|footer)\b/i.test(text)),
      'Raw HTML reached embeddings',
    )
    assert(
      embeddedTexts.every((text) => !text.includes('Accept all cookies')),
      'Cookie control reached embeddings',
    )
    assert.equal(
      objects.size,
      0,
      `Completed run left temporary objects: ${[...objects.keys()].join(', ')}`,
    )
    const [chat] = await db
      .insert(conversation)
      .values({
        assistantId: botId,
        resumeTokenHash: crypto.randomUUID(),
        isTest: true,
      })
      .returning()
    const retrieve = () =>
      searchKnowledge(
        botId,
        credentials.organizationId,
        chat.id,
        'Opening hours',
      )
    const results = await retrieve()
    assert.equal(
      results.filter((result) => result.text.includes(commonHours)).length,
      1,
      'Shared fact must be retrievable once with a live source citation',
    )
    assert.equal(
      (
        await request(`/assistants/${botId}/sources/${home.id}`, 'PATCH', {
          isIncluded: false,
        })
      ).status,
      200,
    )
    const surviving = (await retrieve()).filter((result) =>
      result.text.includes(commonHours),
    )
    assert.equal(
      surviving.length,
      1,
      'Disabling one origin lost shared fact from other eligible origins',
    )
    assert.notEqual(
      surviving[0].sourceId,
      home.id,
      'Shared retrieval cited disabled origin',
    )
    assert.equal(
      (
        await request(`/assistants/${botId}/sources/${rootId}`, 'PATCH', {
          excludePaths: ['/services', '/contact'],
        })
      ).status,
      200,
    )
    assert(
      !(await retrieve()).some((result) => result.text.includes(commonHours)),
      'Shared content leaked through excluded/disabled origins',
    )
    assert.equal(
      (
        await request(`/assistants/${botId}/sources/${rootId}`, 'PATCH', {
          excludePaths: [],
        })
      ).status,
      200,
    )
    assert.equal(
      (
        await request(`/assistants/${botId}/sources/${home.id}`, 'PATCH', {
          isIncluded: true,
        })
      ).status,
      200,
    )
    assert.equal(
      (
        await request(`/assistants/${botId}/sources/${rootId}`, 'PATCH', {
          isIncluded: false,
        })
      ).status,
      200,
    )
    assert.equal(
      (await retrieve()).length,
      0,
      'Disabled website contributes search results',
    )
    assert.equal(
      (
        await request(`/assistants/${botId}/sources/${rootId}`, 'PATCH', {
          isIncluded: true,
        })
      ).status,
      200,
    )
    fake.revision = 2
    const refresh = await request(
      `/assistants/${botId}/sources/${rootId}/runs`,
      'POST',
    )
    assert.equal(refresh.status, 202)
    const second = await waitForRun(
      ((await refresh.json()) as { id: string }).id,
    )
    assert.equal(second.status, 'completed', second.errorSummary ?? undefined)
    assert.equal(
      objects.size,
      0,
      `Refresh left temporary objects: ${[...objects.keys()].join(', ')}`,
    )
    const refreshedShared = await sharedBlocks()
    assert.equal(
      refreshedShared.filter((block) =>
        block.text.includes('Monday to Friday, 9 AM to 6 PM'),
      ).length,
      1,
    )
    assert(
      refreshedShared.every(
        (block) => !block.text.includes('Monday to Friday, 9 AM to 5 PM'),
      ),
      'Obsolete shared hours survived refresh',
    )
    assert(
      (await retrieve()).some((result) =>
        result.text.includes('Monday to Friday, 9 AM to 6 PM'),
      ),
    )
    assert(fake.profileRequests > 0, 'No page-profile requests were made')
    assert(
      (
        await db
          .select()
          .from(knowledgeChunk)
          .where(eq(knowledgeChunk.organizationId, orgOf(botId)))
      ).length > 0,
    )
    // Missing pages are archived immediately, but their knowledge is retained
    // during the grace period. Provider error HTML must never be indexed.
    const service = pages.find(
      (page) => page.canonicalUrl === `${fixtureOrigin}/services`,
    )!
    const contact = pages.find(
      (page) => page.canonicalUrl === `${fixtureOrigin}/contact`,
    )!
    const bath = pages.find(
      (page) => page.canonicalUrl === `${fixtureOrigin}/bath`,
    )!
    const readPage = async (id: string) => {
      const response = await request(`/assistants/${botId}/sources/${id}`)
      assert.equal(response.status, 200)
      return (await response.json()) as typeof knowledgeSource.$inferSelect & {
        archiveNotice: string | null
      }
    }
    const refreshWebsite = async () => {
      const response = await request(
        `/assistants/${botId}/sources/${rootId}/runs`,
        'POST',
      )
      assert.equal(response.status, 202)
      return waitForRun(((await response.json()) as { id: string }).id)
    }
    const serviceBeforeMissing = await readPage(service.id)
    const bathBeforeFailure = await readPage(bath.id)
    const embeddedBeforeMissing = embeddedTexts.length
    pageStatuses.set('/services', 404)
    pageStatuses.set('/contact', 410)
    pageStatuses.set('/bath', 503)
    fake.includeMissingPage = true
    const missingRun = await refreshWebsite()
    // Other pages were learned, so the read completes; the broken ones are
    // counted on their own.
    assert.equal(missingRun.status, 'completed')
    assert(missingRun.failedCount >= 3)
    const archived = await readPage(service.id)
    assert.equal(archived.status, 'archived')
    assert.equal(archived.lastError, 'Page returned HTTP 404')
    assert.equal(archived.contentHash, serviceBeforeMissing.contentHash)
    assert.equal(archived.cleanedText, serviceBeforeMissing.cleanedText)
    assert(archived.archivedAt && archived.deleteAfter)
    assert.equal(
      new Date(archived.deleteAfter).getTime() -
        new Date(archived.archivedAt).getTime(),
      3 * 24 * 60 * 60_000,
    )
    assert.equal(archived.contentDeletedAt, null)
    assert(archived.archiveNotice?.includes('only if a new check confirms'))
    assert.equal((await readPage(contact.id)).status, 'archived')
    const gone = await readPage(contact.id)
    assert.equal(
      new Date(gone.deleteAfter!).getTime() -
        new Date(gone.archivedAt!).getTime(),
      10 * 60_000,
    )
    assert.equal(
      (await readPage(contact.id)).lastError,
      'Page returned HTTP 410',
    )
    const unavailable = await readPage(bath.id)
    assert.equal(
      unavailable.status,
      'ready',
      'A temporary error must keep the last successful index',
    )
    assert.equal(unavailable.contentHash, bathBeforeFailure.contentHash)
    assert.equal(unavailable.archivedAt, null)
    const missingItems = await db
      .select()
      .from(indexRunItem)
      .where(eq(indexRunItem.runId, missingRun.id))
    assert.equal(
      missingItems.find((item) => item.sourceId === service.id)?.attemptCount,
      1,
    )
    assert.equal(
      missingItems.find((item) => item.sourceId === contact.id)?.attemptCount,
      1,
    )
    const listing = await request(`/assistants/${botId}/sources`)
    assert.equal(listing.status, 200)
    const listed = (await listing.json()) as Array<
      typeof knowledgeSource.$inferSelect
    >
    assert.equal(
      listed.find((page) => page.id === service.id)?.status,
      'archived',
    )
    assert.equal(
      listed.find((page) => page.id === service.id)?.deleteAfter,
      archived.deleteAfter,
    )
    const neverExisted = listed.find(
      (page) => page.canonicalUrl === `${fixtureOrigin}/never-existed`,
    )!
    assert.equal(neverExisted.status, 'archived')
    assert.equal(neverExisted.cleanedCharCount, null)
    assert(
      !embeddedTexts
        .slice(embeddedBeforeMissing)
        .some((text) => text.startsWith('Missing\n')),
    )
    const remaining = await retrieve()
    assert(
      remaining.every(
        (item) =>
          ![service.id, contact.id, neverExisted.id].includes(item.sourceId),
      ),
    )
    assert(
      remaining.some((item) => item.sourceId === bath.id),
      'Temporary failure removed searchable knowledge',
    )
    assert(
      remaining.some(
        (item) =>
          item.text.includes('Monday to Friday, 9 AM to 6 PM') &&
          item.sourceId === home.id,
      ),
      'Shared facts must cite the surviving page',
    )
    assert.equal(
      (
        await request(`/assistants/${botId}/sources/${home.id}`, 'PATCH', {
          isIncluded: false,
        })
      ).status,
      200,
    )
    assert(
      !(await retrieve()).some((item) =>
        item.text.includes('Monday to Friday, 9 AM to 6 PM'),
      ),
      'Archived origins must not keep a shared fact searchable',
    )
    assert.equal(
      (
        await request(`/assistants/${botId}/sources/${home.id}`, 'PATCH', {
          isIncluded: true,
        })
      ).status,
      200,
    )
    assert.equal(objects.size, 0)

    // Even after the deadline, an HTTP failure other than 404/410 must retain
    // the archive. Supplement the worker lifecycle with one controlled retry.
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill('SIGTERM')
      await once(worker, 'exit')
    }
    await db
      .update(knowledgeSource)
      .set({
        deleteAfter: new Date(Date.now() - 1000),
      })
      .where(eq(knowledgeSource.id, contact.id))
    pageStatuses.set('/contact', 503)
    const retryResponse = await request(
      `/assistants/${botId}/sources/${contact.id}/runs`,
      'POST',
    )
    assert.equal(retryResponse.status, 202)
    const retryRun = (await retryResponse.json()) as { id: string }
    const { discoverSource } =
      await import('../../src/services/knowledge/indexer')
    const { preparePage } =
      await import('../../src/services/knowledge/preparePage')
    const { failPage } =
      await import('../../src/services/knowledge/pageFailure')
    await discoverSource(retryRun.id, contact.id)
    await assert.rejects(
      preparePage(retryRun.id, contact.id),
      /Page returned HTTP 503/,
    )
    await failPage(
      retryRun.id,
      contact.id,
      new Error('Page returned HTTP 503'),
      1,
    )
    const deferredArchive = await readPage(contact.id)
    assert.equal(deferredArchive.status, 'archived')
    assert.equal(deferredArchive.contentDeletedAt, null)
    assert(deferredArchive.cleanedText)
    worker = spawn(process.execPath, ['src/worker.ts'], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'ignore', 'inherit'],
    })

    // Advance only the fixture's clock fields. The archive scheduler queues a
    // real HTTP recheck; another 404 after the deadline deletes stored knowledge.
    const { recoverArchiveRechecks } =
      await import('../../src/services/knowledge/archivedPages')
    await db
      .update(knowledgeSource)
      .set({
        archivedAt: new Date(Date.now() - 4 * 24 * 60 * 60_000),
        deleteAfter: new Date(Date.now() - 24 * 60 * 60_000),
        nextArchiveCheckAt: new Date(Date.now() - 1000),
      })
      .where(eq(knowledgeSource.id, service.id))
    await recoverArchiveRechecks()
    let recheck: typeof indexRun.$inferSelect | undefined
    for (let attempt = 0; attempt < 200 && !recheck; attempt++) {
      const rechecksResponse = await request(`/assistants/${botId}/runs`)
      recheck = (
        (await rechecksResponse.json()) as Array<typeof indexRun.$inferSelect>
      ).find(
        (run) =>
          run.targetSourceId === service.id && run.trigger === 'scheduled',
      )
      if (!recheck) await Bun.sleep(100)
    }
    assert(recheck, 'No automatic archive recheck was queued')
    assert.equal((await waitForRun(recheck.id)).status, 'failed')
    const purged = await readPage(service.id)
    assert.equal(purged.status, 'archived')
    assert(purged.contentDeletedAt)
    assert(purged.archiveNotice?.includes('saved content has been deleted'))
    assert.equal(purged.cleanedText, null)
    assert.equal(purged.pageProfile, null)
    assert.deepEqual(purged.pageActions, [])
    assert.equal(purged.contentHash, null)
    assert.equal(purged.nextArchiveCheckAt, null)
    assert.equal(
      (
        await db
          .select()
          .from(knowledgeChunk)
          .where(eq(knowledgeChunk.sourceId, service.id))
      ).length,
      0,
    )
    assert.equal(
      (
        await db
          .select()
          .from(knowledgeSharedBlockSource)
          .where(eq(knowledgeSharedBlockSource.sourceId, service.id))
      ).length,
      0,
    )
    assert(
      (await retrieve()).some((item) =>
        item.text.includes('Monday to Friday, 9 AM to 6 PM'),
      ),
      'Purging one page deleted shared facts belonging to another page',
    )

    // A successful later crawl restores archived pages, even after content was
    // purged, while retries never reset the original grace-period timestamps.
    pageStatuses.clear()
    fake.includeMissingPage = false
    const restoredRun = await refreshWebsite()
    assert.equal(
      restoredRun.failedCount,
      1,
      'Only the never-existing page should remain missing',
    )
    const restored = await readPage(service.id)
    assert.equal(restored.status, 'ready')
    assert.equal(restored.archivedAt, null)
    assert.equal(restored.deleteAfter, null)
    assert.equal(restored.contentDeletedAt, null)
    assert.equal(restored.contentHash, serviceBeforeMissing.contentHash)
    assert.equal((await readPage(contact.id)).status, 'ready')
    assert.equal(
      (await readPage(neverExisted.id)).archivedAt,
      neverExisted.archivedAt,
    )
    assert.equal(objects.size, 0)
    // Supplement the HTTP lifecycle with a durable exhausted checkpoint: recovery
    // must terminate it without another provider call, while storage deletion can retry.
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill('SIGTERM')
      await once(worker, 'exit')
    }
    const failureRunId = crypto.randomUUID()
    const failureKey = `index-runs/${failureRunId}/pages/${home.id}.json`
    objects.set(
      `/stage/${failureKey}`,
      JSON.stringify({
        url: home.canonicalUrl,
        title: 'Failed checkpoint',
        blocks: [
          {
            id: 'b0',
            text: 'Retryable text only',
            heading: '',
            region: 'main',
            links: [],
          },
        ],
      }),
    )
    await db.insert(indexRun).values({
      id: failureRunId,
      organizationId: orgOf(botId),
      targetSourceId: rootId,
      trigger: 'manual',
      status: 'running',
      phase: 'preparing',
      crawlProvider: 'http',
      crawlCollectedAt: new Date(),
      discoveredCount: 1,
      startedAt: new Date(),
    })
    await db.insert(indexRunItem).values({
      runId: failureRunId,
      sourceId: home.id,
      status: 'queued',
      attemptCount: 8,
      prepareAttempts: 8,
      stagedContentKey: failureKey,
    })
    const { sweepStagedPages } =
      await import('../../src/services/knowledge/staging')
    const callsBeforeFailure = fake.jevRequests
    fake.failStageDeletes = true
    await preparePage(failureRunId, home.id)
    const failed = await waitForRun(failureRunId)
    assert.equal(failed.status, 'failed')
    assert.equal(
      fake.jevRequests,
      callsBeforeFailure,
      'Exhausted work retried provider calls',
    )
    const [failedItem] = await db
      .select()
      .from(indexRunItem)
      .where(
        and(
          eq(indexRunItem.runId, failureRunId),
          eq(indexRunItem.sourceId, home.id),
        ),
      )
    assert.equal(failedItem.status, 'failed')
    assert(
      fake.rejectedStageDeletes > 0,
      'Exhausted preparation did not exercise the failing storage fixture',
    )
    assert(
      objects.has(`/stage/${failureKey}`),
      'Failed deletion removed the fixture object',
    )
    assert.equal(
      failedItem.stagedContentKey,
      failureKey,
      'Failed deletion lost its durable cleanup key',
    )
    assert(objects.has(`/stage/${failureKey}`))
    const [lastGood] = await db
      .select()
      .from(knowledgeSource)
      .where(eq(knowledgeSource.id, home.id))
    assert.equal(
      lastGood.status,
      'ready',
      'Failed retry invalidated last useful source',
    )
    assert(lastGood.cleanedText?.includes('Emergency repairs are available'))
    fake.failStageDeletes = false
    await sweepStagedPages()
    const [swept] = await db
      .select()
      .from(indexRunItem)
      .where(
        and(
          eq(indexRunItem.runId, failureRunId),
          eq(indexRunItem.sourceId, home.id),
        ),
      )
    assert.equal(swept.stagedContentKey, null)
    assert.equal(
      objects.size,
      0,
      'Terminal failure left temporary content after storage recovered',
    )
    assert.equal(
      (await request(`/assistants/${botId}/sources/${rootId}`, 'DELETE'))
        .status,
      204,
    )
    assert.equal(
      (await retrieve()).length,
      0,
      'Deleted website contributes search results',
    )
    assert.equal(
      (await sharedBlocks()).length,
      0,
      'Deleting a website left shared text/embeddings behind',
    )
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill('SIGTERM')
      await once(worker, 'exit')
    }
    if (assistantId) {
      await db
        .update(indexRun)
        .set({ status: 'failed', phase: 'completed', completedAt: new Date() })
        .where(eq(indexRun.organizationId, orgOf(assistantId)))
      await request(`/assistants/${assistantId}`, 'DELETE')
    }
    server.stop()
    fixture.stop()
  }
}, 600_000)
