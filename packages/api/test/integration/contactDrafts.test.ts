import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mock, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { startRolesProviders } from '../fixtures/rolesProviders'
import type {
  iContact,
  iContactDetail,
  iContactDrafts,
  iIdentityTakenError,
} from '../../src/types/contact.types'

// The fake model answers the contact draft with what the owner's text says.
let calls = 0
mock.module('../../src/services/ai/openAi', () => ({
  getOpenAi: () => ({
    responses: {
      parse: async () => {
        calls++
        const output_parsed = {
          records: [
            {
              name: 'Ali',
              email: 'ali@pizzahub.example',
              phone: '+44 7700 900123',
              facts: ['Wants a new website.'],
            },
          ],
          missing: [],
        }
        return {
          model: 'gpt-5.6-luna',
          output_parsed,
          usage: { input_tokens: 10, output_tokens: 5 },
        }
      },
    },
  }),
}))

test('contact drafts, and adding a contact by hand, over HTTP', async () => {
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
  const { aiUsageEvent, contact, member, organization } =
    await import('../../src/db/schema')

  const org = crypto.randomUUID()
  await db
    .insert(organization)
    .values({ id: org, name: 'Drafts fixture', slug: org })
  for (const role of ['owner', 'admin', 'member'] as const)
    await db.insert(member).values({
      id: crypto.randomUUID(),
      userId: credentials.accounts[role].userId,
      organizationId: org,
      role,
    })
  type tRole = 'owner' | 'admin' | 'member' | 'outsider'
  const request = (role: tRole, path: string, method = 'GET', body?: unknown) =>
    fetch(`${origin}/api/organizations/${org}${path}`, {
      method,
      headers: {
        Cookie: credentials.accounts[role].cookie,
        Origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  async function json<T>(response: Response, expected = 200): Promise<T> {
    assert.equal(response.status, expected, await response.clone().text())
    return (await response.json()) as T
  }

  try {
    // Contacts: everyone in the workspace drafts and adds them.
    const line =
      'Ali, ali@pizzahub.example, +44 7700 900123, wants a new website'
    assert.equal(
      (await request('outsider', '/contacts/drafts', 'POST', { text: line }))
        .status,
      403,
    )
    const before = calls
    const { draft, missing } = await json<iContactDrafts>(
      await request('member', '/contacts/drafts', 'POST', { text: line }),
    )
    assert.equal(calls, before + 1)
    assert.deepEqual(missing, [])
    assert.equal(draft.email, 'ali@pizzahub.example')
    assert.deepEqual(draft.facts, ['Wants a new website.'])
    const usage = await db
      .select()
      .from(aiUsageEvent)
      .where(
        and(
          eq(aiUsageEvent.organizationId, org),
          eq(aiUsageEvent.kind, 'contactDrafts'),
        ),
      )
    assert.equal(usage.length, 1)

    // Adding one by hand needs a way to reach them.
    assert.equal(
      (await request('member', '/contacts', 'POST', { name: 'Nobody' })).status,
      422,
    )
    assert.equal(
      (
        await request('outsider', '/contacts', 'POST', {
          email: draft.email,
        })
      ).status,
      403,
    )
    const ali = await json<iContact>(
      await request('member', '/contacts', 'POST', {
        name: draft.name,
        email: draft.email,
        phone: draft.phone,
      }),
      201,
    )
    assert.equal(ali.normalizedPhone, '+447700900123')
    const detail = await json<iContactDetail>(
      await request('owner', `/contacts/${ali.id}`),
    )
    assert.deepEqual(
      detail.identities.map((item) => [item.kind, item.source]).sort(),
      [
        ['email', 'manual'],
        ['phone', 'manual'],
      ],
    )

    // Someone else with the same phone, written differently, is a 409 naming Ali.
    const taken = await request('admin', '/contacts', 'POST', {
      name: 'Another Ali',
      phone: '+44 (7700) 900-123',
    })
    assert.equal(taken.status, 409)
    const { error } = (await taken.json()) as iIdentityTakenError
    assert.equal(error.code, 'identity_taken')
    assert.equal(error.contactId, ali.id)
    assert.equal(error.contactName, 'Ali')
    const people = await db
      .select()
      .from(contact)
      .where(eq(contact.organizationId, org))
    assert.equal(people.length, 1)
  } finally {
    await db.delete(contact).where(eq(contact.organizationId, org))
    server.stop(true)
    providers.server.stop(true)
  }
}, 60_000)
