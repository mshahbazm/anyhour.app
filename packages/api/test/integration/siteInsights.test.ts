import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { eq } from 'drizzle-orm'

// Website insights from the embed loader to the owner: off by default (the
// launcher says so and beacons are ignored), then counting, unique
// visitors, choosing what is counted, switching off again, access, and the
// visitors step of the month's funnel on Home.
test('website insights from launcher to dashboard', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('Site insights test requires local PostgreSQL')
  process.env.NODE_ENV = 'test'
  let handle: (request: Request) => Response | Promise<Response> = () =>
    new Response('Starting', { status: 503 })
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => handle(request),
  })
  const apiOrigin = `http://127.0.0.1:${server.port}`
  process.env.PORT = String(server.port)
  process.env.BETTER_AUTH_URL = apiOrigin
  process.env.FRONT_END_URL = 'http://localhost:3000'
  const { app } = await import('../../src/app')
  handle = (request) => app.fetch(request)
  const { db } = await import('../../src/db')
  const { assistant, member, organization } =
    await import('../../src/db/schema')
  const { flushInsights } = await import('../../src/services/insights/collect')
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

  // A workspace of its own, with its one AI live on one website.
  const orgId = crypto.randomUUID()
  await db
    .insert(organization)
    .values({ id: orgId, name: 'Insights fixture', slug: orgId })
  for (const role of ['owner', 'member'] as const)
    await db.insert(member).values({
      id: crypto.randomUUID(),
      userId: credentials.accounts[role].userId,
      organizationId: orgId,
      role,
    })
  const site = `https://insights-${crypto.randomUUID()}.example`
  const [bot] = await db
    .insert(assistant)
    .values({
      organizationId: orgId,
      name: 'Insights test',
      status: 'published',
      allowedOrigins: [site],
    })
    .returning()
  const browser =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
  const widget = `${apiOrigin}/api/widget/${bot.id}`
  const ownerCookie = credentials.accounts.owner.cookie
  const insightsUrl = (days: number) =>
    `${apiOrigin}/api/organizations/${orgId}/assistants/${bot.id}/insights?days=${days}`
  function beacon(
    body: unknown,
    ip: string,
    headers: Record<string, string> = {},
  ) {
    return fetch(`${widget}/collect`, {
      method: 'POST',
      headers: {
        Origin: site,
        'User-Agent': browser,
        'X-Forwarded-For': ip,
        'Content-Type': 'text/plain',
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  }
  async function insights(cookie = ownerCookie) {
    await flushInsights()
    const response = await fetch(insightsUrl(7), {
      headers: { Cookie: cookie },
    })
    assert.equal(response.status, 200)
    return (await response.json()) as {
      hasVisits: boolean
      totals: Record<string, number>
      top: Record<string, Array<{ value: string; count: number }>>
    }
  }
  async function monthVisitors() {
    const response = await fetch(
      `${apiOrigin}/api/organizations/${orgId}/stats/month`,
      { headers: { Cookie: ownerCookie } },
    )
    assert.equal(response.status, 200)
    return ((await response.json()) as { websiteVisitors: number | null })
      .websiteVisitors
  }
  function updateBot(body: object) {
    return fetch(
      `${apiOrigin}/api/organizations/${orgId}/assistants/${bot.id}`,
      {
        method: 'PATCH',
        headers: {
          Cookie: ownerCookie,
          Origin: process.env.FRONT_END_URL as string,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    )
  }
  async function launcherTracking() {
    const response = await fetch(`${widget}/launcher`, {
      headers: { Origin: site },
    })
    assert.equal(response.status, 200)
    return ((await response.json()) as { tracking: Record<string, boolean> })
      .tracking
  }
  const first = { tz: 'Europe/London', w: 390 }
  const all = { visits: true, location: true, device: true, chat: true }
  const nothing = { visits: false, location: false, device: false, chat: false }

  try {
    // Off by default: the launcher tells the loader to count nothing, and a
    // beacon sent anyway is ignored.
    assert.deepEqual(await launcherTracking(), nothing)
    const elsewhere = await fetch(`${widget}/launcher`, {
      headers: { Origin: 'https://not-allowed.example' },
    })
    assert.equal(elsewhere.status, 403)
    assert.equal(
      (await beacon({ ...first, e: [{ k: 'view', p: '/' }] }, '203.0.113.8'))
        .status,
      204,
    )
    assert.equal((await insights()).hasVisits, false)
    assert.equal(await monthVisitors(), null)

    // The owner turns visitor counts on; everything is counted by default.
    assert.equal((await updateBot({ tracking: true })).status, 200)
    assert.deepEqual(await launcherTracking(), all)
    assert.equal(await monthVisitors(), 0)

    // One visitor, two pages and a chat open; a second visitor; then noise
    // that must not count: another website, a crawler, and junk.
    assert.equal(
      (
        await beacon(
          {
            ...first,
            e: [{ k: 'view', p: '/', r: 'google.com' }, { k: 'open' }],
          },
          '203.0.113.1',
        )
      ).status,
      204,
    )
    await beacon(
      { ...first, e: [{ k: 'view', p: '/pricing/' }] },
      '203.0.113.1',
    )
    await beacon(
      { tz: 'America/New_York', w: 1440, e: [{ k: 'view', p: '/', r: '' }] },
      '203.0.113.2',
    )
    await beacon({ e: [{ k: 'view', p: '/evil' }] }, '203.0.113.3', {
      Origin: 'https://not-allowed.example',
    })
    await beacon({ e: [{ k: 'view', p: '/crawl' }] }, '203.0.113.4', {
      'User-Agent': 'Googlebot/2.1',
    })
    await beacon('not json', '203.0.113.5')

    const counted = await insights()
    assert.equal(counted.hasVisits, true)
    assert.equal(counted.totals.visitors, 2)
    assert.equal(counted.totals.views, 3)
    assert.equal(counted.totals.opens, 1)
    assert.deepEqual(counted.top.page, [
      { value: '/', count: 2 },
      { value: '/pricing', count: 1 },
    ])
    assert.deepEqual(counted.top.source.map((row) => row.value).sort(), [
      'direct',
      'google.com',
    ])
    assert.deepEqual(counted.top.country.map((row) => row.value).sort(), [
      'GB',
      'US',
    ])
    assert.deepEqual(counted.top.device.map((row) => row.value).sort(), [
      'computer',
      'phone',
    ])
    assert.equal(await monthVisitors(), 2)

    // The same visitor later the same day isn't counted twice.
    await beacon({ ...first, e: [{ k: 'view', p: '/' }] }, '203.0.113.1')
    assert.equal((await insights()).totals.visitors, 2)

    // Switching visits off stops counting views, while chat opens still
    // count; Home has no visitors step.
    assert.equal(
      (await updateBot({ trackingOptions: { ...all, visits: false } })).status,
      200,
    )
    assert.deepEqual(await launcherTracking(), { ...all, visits: false })
    await beacon(
      { ...first, e: [{ k: 'view', p: '/about' }, { k: 'open' }] },
      '203.0.113.6',
    )
    const noVisits = await insights()
    assert.equal(noVisits.totals.views, 4)
    assert.equal(noVisits.totals.visitors, 2)
    assert.equal(noVisits.totals.opens, 2)
    assert.equal(await monthVisitors(), null)
    assert.equal(
      (await updateBot({ trackingOptions: { ...all, visits: 'yes' } })).status,
      422,
    )

    // Switching counting off stops it at once, whatever is chosen.
    assert.equal(
      (await updateBot({ tracking: false, trackingOptions: all })).status,
      200,
    )
    assert.deepEqual(await launcherTracking(), nothing)
    await beacon(
      { ...first, e: [{ k: 'view', p: '/' }, { k: 'open' }] },
      '203.0.113.9',
    )
    const paused = await insights()
    assert.equal(paused.totals.views, 4)
    assert.equal(paused.totals.visitors, 2)
    assert.equal(paused.totals.opens, 2)
    assert.equal(await monthVisitors(), null)

    // Team members can read insights; others can't; ranges are fixed.
    await insights(credentials.accounts.member.cookie)
    const outsider = await fetch(insightsUrl(7), {
      headers: { Cookie: credentials.accounts.outsider.cookie },
    })
    assert.ok([403, 404].includes(outsider.status))
    const badRange = await fetch(insightsUrl(5), {
      headers: { Cookie: ownerCookie },
    })
    assert.equal(badRange.status, 422)
  } finally {
    // The workspace is unique to this run; its counts go with its AI.
    await db.delete(assistant).where(eq(assistant.id, bot.id))
    await db.delete(member).where(eq(member.organizationId, orgId))
    await db.delete(organization).where(eq(organization.id, orgId))
    server.stop(true)
  }
}, 60_000)
