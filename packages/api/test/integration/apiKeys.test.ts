import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { startRolesProviders } from '../fixtures/rolesProviders'
import type {
  iApiKeyIdentity,
  iCreatedApiKey,
} from '../../src/types/integration.types'

test('API keys open their own website sources and nothing else', async () => {
  const value = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !value ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname)
  )
    throw new Error('Requires local PostgreSQL')
  const providers = startRolesProviders()
  Object.assign(process.env, providers.env)
  process.env.NODE_ENV = 'test'
  let handle: (request: Request) => Response | Promise<Response> = () =>
    new Response('Starting', { status: 503 })
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => handle(request),
  })
  const origin = `http://127.0.0.1:${server.port}`
  process.env.BETTER_AUTH_URL = origin
  process.env.PORT = String(server.port)
  process.env.FRONT_END_URL = 'http://localhost:3000'
  const { app } = await import('../../src/app')
  handle = (request) => app.fetch(request)
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
  const { db } = await import('../../src/db')
  const { apiKey, assistant, member, organization } =
    await import('../../src/db/schema')
  const { getBoss } = await import('../../src/services/queue/boss')
  const boss = await getBoss()

  const org = crypto.randomUUID()
  const otherOrg = crypto.randomUUID()
  await db.insert(organization).values([
    {
      id: org,
      name: 'Key fixture',
      slug: org,
      businessAbout: 'Plumbing in Leeds',
    },
    { id: otherOrg, name: 'Other key fixture', slug: otherOrg },
  ])
  const memberIds = {} as Record<'owner' | 'admin' | 'member', string>
  for (const role of ['owner', 'admin', 'member'] as const) {
    memberIds[role] = crypto.randomUUID()
    await db.insert(member).values({
      id: memberIds[role],
      userId: credentials.accounts[role].userId,
      organizationId: org,
      role,
    })
  }
  // The key's creator also owns the other workspace: the key still can't.
  await db.insert(member).values({
    id: crypto.randomUUID(),
    userId: credentials.accounts.owner.userId,
    organizationId: otherOrg,
    role: 'owner',
  })
  await db
    .insert(assistant)
    .values({ organizationId: org, name: 'Key bot', status: 'published' })

  type tRole = 'owner' | 'admin' | 'member' | 'outsider'
  const asSession = (
    role: tRole,
    path: string,
    method = 'GET',
    body?: unknown,
    workspace: string = org,
  ) =>
    fetch(`${origin}/api/organizations/${workspace}${path}`, {
      method,
      headers: {
        Cookie: credentials.accounts[role].cookie,
        Origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const asKey = (
    key: string,
    path: string,
    method = 'GET',
    body?: unknown,
    workspace: string | null = org,
  ) =>
    fetch(
      `${origin}/api${workspace ? `/organizations/${workspace}` : ''}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    )
  const json = async <T>(response: Response) => {
    assert.ok(
      response.ok,
      `${response.status} ${await response.clone().text()}`,
    )
    return (await response.json()) as T
  }
  const code = async (response: Response) =>
    ((await response.json()) as { error: { code: string } }).error.code

  try {
    const key = await json<iCreatedApiKey>(
      await asSession('owner', '/api-keys', 'POST', { name: 'Claude' }),
    )

    // Who the key is.
    const me = await json<iApiKeyIdentity>(
      await asKey(key.key, '/v1/me', 'GET', undefined, null),
    )
    assert.deepEqual(me, {
      organizationId: org,
      organizationName: 'Key fixture',
    })

    // The WordPress plugin's calls: its workspace's website sources.
    const sources = await asKey(key.key, '/business/sources?limit=200')
    assert.equal(sources.status, 200, await sources.clone().text())

    // Another workspace is forbidden, even one its creator owns.
    const foreign = await asKey(
      key.key,
      '/business/sources',
      'GET',
      undefined,
      otherOrg,
    )
    assert.equal(foreign.status, 403)
    assert.equal(await code(foreign), 'organization_forbidden')

    // Everything else stays session-only.
    for (const [path, method, body] of [
      ['/leads', 'GET', undefined],
      ['/contacts', 'GET', undefined],
      ['/attention', 'GET', undefined],
      ['/workspace', 'PATCH', { name: 'Renamed' }],
      ['/api-keys', 'GET', undefined],
      ['/api-keys', 'POST', { name: 'Another' }],
    ] as const) {
      const response = await asKey(key.key, path, method, body)
      assert.equal(response.status, 403, path)
      assert.equal(await code(response), 'api_key_forbidden')
    }

    // Sessions behave as before.
    assert.equal((await asSession('owner', '/leads')).status, 200)
    assert.equal((await asSession('outsider', '/leads')).status, 403)

    // Malformed and revoked keys are refused.
    const malformed = await asKey('wp_live_short', '/business/sources')
    assert.equal(malformed.status, 401)
    assert.equal(await code(malformed), 'invalid_api_key')
    assert.equal(
      (await asSession('owner', `/api-keys/${key.id}`, 'DELETE')).status,
      204,
    )
    assert.equal((await asKey(key.key, '/business/sources')).status, 401)
  } finally {
    await db.delete(apiKey).where(eq(apiKey.organizationId, org))
    await boss.stop()
    server.stop(true)
    providers.server.stop(true)
  }
}, 60_000)
