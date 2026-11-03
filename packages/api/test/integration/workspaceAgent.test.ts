import { orgOf } from '../fixtures/knowledgeOwner'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import {
  installWorkspaceFixture,
  workspaceFixture,
} from '../fixtures/workspaceModel'
import { startRolesProviders } from '../fixtures/rolesProviders'

test('workspace helper and draft preview preserve user authorization and isolate histories', async () => {
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
  process.env.LLM_KEY = 'fixture-key'
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
  installWorkspaceFixture()
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
  const {
    assistant,
    conversation,
    knowledgeSource,
    workspaceChat,
    workspaceMessage,
    workspaceAction,
    session,
    organization,
    member,
  } = await import('../../src/db/schema')
  const org = credentials.organizationId
  type tRole = 'owner' | 'admin' | 'member' | 'outsider'
  function headers(role: tRole) {
    return {
      Cookie: credentials.accounts[role].cookie,
      Origin: 'http://localhost:3000',
      'content-type': 'application/json',
    }
  }
  function request(role: tRole, path: string, method = 'GET', body?: unknown) {
    return fetch(`${origin}${path}`, {
      method,
      headers: headers(role),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }
  async function json<T>(response: Response, expected = 200): Promise<T> {
    assert.equal(response.status, expected, await response.clone().text())
    return (await response.json()) as T
  }
  async function newChat(
    role: tRole,
    organizationId: string | null = org,
    assistantId: string | null = null,
  ) {
    return json<{ id: string }>(
      await request(role, '/api/workspace-agent/chats', 'POST', {
        organizationId,
        assistantId,
      }),
      201,
    )
  }
  function send(
    role: tRole,
    id: string,
    workflow: Array<{ name: string; arguments: Record<string, unknown> }>,
    clientMessageId = crypto.randomUUID(),
  ) {
    return request(role, `/api/workspace-agent/chats/${id}/messages`, 'POST', {
      content: `fixture:${JSON.stringify(workflow)}`,
      clientMessageId,
    })
  }
  async function history(role: tRole, id: string) {
    return json<{
      chat: { organizationId: string; assistantId: string }
      messages: Array<{
        id: string
        role: string
        status: string
        content: string
      }>
      actions: Array<{
        status: string
        name: string
        result: { error?: string }
      }>
    }>(await request(role, `/api/workspace-agent/chats/${id}`))
  }
  const createdOrgs: string[] = []
  try {
    assert.equal(
      (await fetch(`${origin}/api/workspace-agent/context`)).status,
      401,
    )
    const context = await json<{
      organizations: Array<{ id: string; role: string }>
    }>(await request('owner', '/api/workspace-agent/context'))
    assert.equal(
      context.organizations.find((row) => row.id === org)?.role,
      'owner',
    )
    assert.equal(
      (
        await request('outsider', '/api/workspace-agent/chats', 'POST', {
          organizationId: org,
        })
      ).status,
      403,
    )
    const ownerChat = await newChat('owner')
    assert.equal(
      (await request('admin', `/api/workspace-agent/chats/${ownerChat.id}`))
        .status,
      404,
    )
    const clientId = crypto.randomUUID()
    workspaceFixture.onRequest = (modelRequest) => {
      const serialized = JSON.stringify(modelRequest)
      for (const account of Object.values(credentials.accounts))
        assert(
          !serialized.includes(account.cookie),
          'Session credential leaked to model',
        )
      assert(
        !serialized.includes('fixture-key'),
        'Provider credential leaked to model',
      )
    }
    const response = await send(
      'owner',
      ownerChat.id,
      [
        { name: 'read_skill', arguments: { name: 'onboarding' } },
        { name: 'get_context', arguments: {} },
        {
          name: 'create_assistant',
          arguments: { name: 'Workspace test bot', job: null },
        },
      ],
      clientId,
    )
    assert.equal(response.status, 200)
    assert((await response.text()).includes('event: done'))
    const titledChats = await json<Array<{ id: string; title: string }>>(
      await request(
        'owner',
        `/api/workspace-agent/chats?organizationId=${org}`,
      ),
    )
    assert(
      titledChats
        .find((item) => item.id === ownerChat.id)
        ?.title.startsWith('fixture:'),
      'Chat title comes from its first user message',
    )
    let saved = await history('owner', ownerChat.id)
    let botId = saved.chat.assistantId
    // Local integration workspaces may already contain bots. Explicitly create a fresh draft for isolation.
    if (!botId) {
      const created = await json<{
        assistant: { id: string }
        source: null
        indexRun: null
      }>(
        await request('owner', `/api/organizations/${org}/assistants`, 'POST', {
          name: 'Document-first test',
        }),
        201,
      )
      assert.equal(created.source, null)
      assert.equal(created.indexRun, null)
      botId = created.assistant.id
      assert(
        (
          await (
            await send('owner', ownerChat.id, [
              { name: 'select_assistant', arguments: { assistantId: botId } },
            ])
          ).text()
        ).includes('event: done'),
      )
    }
    assert.equal((await send('owner', ownerChat.id, [], clientId)).status, 409)
    const memberChat = await newChat('member', org, botId)
    assert(
      (
        await (
          await send('member', memberChat.id, [
            {
              name: 'add_source',
              arguments: {
                kind: 'webPage',
                url: 'https://example.com/denied',
                scope: 'mine',
              },
            },
          ])
        ).text()
      ).includes('event: done'),
    )
    const denied = await history('member', memberChat.id)
    assert.equal(denied.actions.at(-1)?.status, 'failed')
    assert.equal(denied.actions.at(-1)?.result.error, 'permission_denied')
    const productBase = `/api/organizations/${org}/assistants/${botId}`
    assert.equal(
      (
        await request('member', `${productBase}/sources`, 'POST', {
          kind: 'webPage',
          url: 'https://example.com/denied',
        })
      ).status,
      403,
    )
    // Upload goes through the actual storage fixture and queues indexing.
    const formData = new FormData()
    formData.append(
      'file',
      new File(['Opening hours: 9 to 5.'], 'hours.txt', { type: 'text/plain' }),
    )
    const uploadHeaders = {
      Cookie: credentials.accounts.owner.cookie,
      Origin: 'http://localhost:3000',
    }
    const uploaded = await json<{ source: { id: string } }>(
      await fetch(`${origin}${productBase}/uploads`, {
        method: 'POST',
        headers: uploadHeaders,
        body: formData,
      }),
      201,
    )
    assert(uploaded.source.id)
    const invalid = new FormData()
    invalid.append(
      'file',
      new File(['invalid'], 'photo.png', { type: 'image/png' }),
    )
    assert.equal(
      (
        await fetch(`${origin}${productBase}/uploads`, {
          method: 'POST',
          headers: uploadHeaders,
          body: invalid,
        })
      ).status,
      422,
    )
    const preview = await json<{ id: string }>(
      await request(
        'owner',
        `${productBase}/preview/conversations`,
        'POST',
        {},
      ),
      201,
    )
    assert.equal(
      (
        await request(
          'admin',
          `${productBase}/preview/conversations/${preview.id}`,
        )
      ).status,
      404,
    )
    assert.equal(
      (await request('owner', `${productBase}/conversations/${preview.id}`))
        .status,
      404,
    )
    assert.equal(
      (
        await request(
          'owner',
          `${productBase}/preview/conversations/${preview.id}/messages`,
          'POST',
          { content: 'Hello', clientMessageId: crypto.randomUUID() },
        )
      ).status,
      409,
    )
    const [source] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(botId),
        kind: 'webPage',
        inputUrl: 'https://example.com/ready',
        canonicalUrl: 'https://example.com/ready',
        status: 'ready',
        isIncluded: true,
        lastIndexedAt: new Date(),
      })
      .returning()
    const status = await json<{ ready: boolean }>(
      await request('owner', `${productBase}/preview/status`),
    )
    assert(status.ready)
    workspaceFixture.onRequest = (request) => {
      const serialized = JSON.stringify(request)
      assert(serialized.includes('Your goal is to help visitors find answers'))
      assert(serialized.includes('This is a private test'))
      assert(!serialized.includes('"name":"capture_lead"'))
      assert(!serialized.includes('"name":"invite_member"'))
    }
    assert(
      (
        await (
          await request(
            'owner',
            `${productBase}/preview/conversations/${preview.id}/messages`,
            'POST',
            { content: 'Hello preview', clientMessageId: crypto.randomUUID() },
          )
        ).text()
      ).includes('event: done'),
    )
    workspaceFixture.onRequest = undefined
    const { captureChatLead } = await import('../../src/services/leads/capture')
    await assert.rejects(
      captureChatLead(
        botId,
        preview.id,
        'test',
        { title: 'test', email: 'test@example.com' },
        new AbortController().signal,
      ),
      /Preview conversations cannot create leads/,
    )
    const visitorList = await json<Array<{ id: string }>>(
      await request('owner', `${productBase}/conversations`),
    )
    assert(!visitorList.some((item) => item.id === preview.id))
    assert.equal(
      (
        await fetch(`${origin}/api/widget/${botId}/bootstrap`, {
          method: 'POST',
          headers: { Origin: 'https://example.com' },
        })
      ).status,
      404,
    )
    // Backend validates source ownership, including tool-generated identifiers.
    const [foreignOrg] = await db
      .insert(organization)
      .values({
        id: crypto.randomUUID(),
        slug: crypto.randomUUID(),
        name: 'Other account',
      })
      .returning()
    const [foreignBot] = await db
      .insert(assistant)
      .values({ organizationId: foreignOrg.id, name: 'Other bot' })
      .returning()
    const [foreignSource] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(foreignBot.id),
        kind: 'webPage',
        inputUrl: 'https://example.com/private',
      })
      .returning()
    await (
      await send('owner', ownerChat.id, [
        { name: 'inspect_source', arguments: { sourceId: foreignSource.id } },
      ])
    ).text()
    saved = await history('owner', ownerChat.id)
    assert.equal(saved.actions.at(-1)?.result.error, 'source_missing')
    await db
      .delete(knowledgeSource)
      .where(eq(knowledgeSource.id, foreignSource.id))
    await db.delete(assistant).where(eq(assistant.id, foreignBot.id))
    await db.delete(organization).where(eq(organization.id, foreignOrg.id))
    // Chief of staff: the ideal customer profile is written in the owner's
    // words; a member can't change it through the helper.
    const priorWorkspace = await json<{ idealCustomerProfile: string | null }>(
      await request('owner', `/api/organizations/${org}/workspace`),
    )
    try {
      workspaceFixture.onRequest = (modelRequest) => {
        assert(JSON.stringify(modelRequest).includes('# Chief of staff'))
      }
      const profile =
        'Small restaurants in London that want more table bookings.'
      await (
        await send('owner', ownerChat.id, [
          { name: 'set_ideal_customer_profile', arguments: { text: profile } },
        ])
      ).text()
      workspaceFixture.onRequest = undefined
      assert.equal(
        (await history('owner', ownerChat.id)).actions.at(-1)?.status,
        'completed',
      )
      assert.equal(
        (
          await json<{ idealCustomerProfile: string | null }>(
            await request('owner', `/api/organizations/${org}/workspace`),
          )
        ).idealCustomerProfile,
        profile,
      )
      const memberProfile = await newChat('member', org, botId)
      await (
        await send('member', memberProfile.id, [
          { name: 'set_ideal_customer_profile', arguments: { text: 'Anyone' } },
        ])
      ).text()
      assert.equal(
        (await history('member', memberProfile.id)).actions.at(-1)?.result
          .error,
        'permission_denied',
      )
    } finally {
      workspaceFixture.onRequest = undefined
      await request('owner', `/api/organizations/${org}/workspace`, 'PATCH', {
        idealCustomerProfile: priorWorkspace.idealCustomerProfile,
      })
    }
    // Per-chat concurrency, disconnect completion and timeout recovery.
    workspaceFixture.delayMs = 200
    const pending = await send('owner', ownerChat.id, [])
    const reader = pending.body!.getReader()
    await reader.read()
    assert.equal((await send('owner', ownerChat.id, [])).status, 409)
    await reader.cancel()
    await Bun.sleep(350)
    assert.equal(
      (await history('owner', ownerChat.id)).messages.at(-1)?.status,
      'completed',
    )
    const { workspaceAgentConfig } =
      await import('../../src/config/workspaceAgent.config')
    workspaceAgentConfig.timeoutMs = 30
    const timed = await send('owner', ownerChat.id, [])
    assert((await timed.text()).includes('generation_timeout'))
    workspaceAgentConfig.timeoutMs = 120_000
    workspaceFixture.delayMs = 0
    assert.equal(
      (await history('owner', ownerChat.id)).messages.at(-1)?.status,
      'failed',
    )
    // Recover a stale process-crash record without re-executing its mutation.
    const staleId = crypto.randomUUID()
    const [stale] = await db
      .insert(workspaceMessage)
      .values({
        chatId: ownerChat.id,
        clientMessageId: staleId,
        role: 'assistant',
        status: 'running',
        createdAt: new Date(Date.now() - 180_000),
      })
      .returning()
    await db.insert(workspaceAction).values({
      messageId: stale.id,
      name: 'add_source',
      input: {},
      status: 'running',
    })
    const recovered = await history('owner', ownerChat.id)
    assert.equal(
      recovered.messages.find((row) => row.id === stale.id)?.status,
      'failed',
    )
    assert.equal(recovered.actions.at(-1)?.status, 'unknown')
    // No-workspace onboarding uses Better Auth, binds private chat, and never changes authority from tool args.
    const onboarding = await newChat('outsider', null)
    await (
      await send('outsider', onboarding.id, [
        { name: 'create_workspace', arguments: { name: 'Fixture onboarding' } },
        {
          name: 'create_assistant',
          arguments: { name: 'My first bot', job: null },
        },
      ])
    ).text()
    const onboarded = await history('outsider', onboarding.id)
    assert(onboarded.chat.organizationId)
    assert(onboarded.chat.assistantId)
    createdOrgs.push(onboarded.chat.organizationId)
    const memberships = await db
      .select()
      .from(member)
      .where(
        and(
          eq(member.organizationId, onboarded.chat.organizationId),
          eq(member.userId, credentials.accounts.outsider.userId),
        ),
      )
    assert.equal(memberships[0].role, 'owner')
    // Revoke a session after a turn was admitted, before the model's tool executes.
    const adminChat = await newChat('admin', org, botId)
    workspaceFixture.onRequest = async () => {
      workspaceFixture.onRequest = undefined
      await db
        .delete(session)
        .where(eq(session.userId, credentials.accounts.admin.userId))
    }
    await (
      await send('admin', adminChat.id, [
        {
          name: 'add_source',
          arguments: {
            kind: 'webPage',
            url: 'https://example.com/revoked',
            scope: 'mine',
          },
        },
      ])
    ).text()
    const unauthorizedSources = await db
      .select()
      .from(knowledgeSource)
      .where(
        and(
          eq(knowledgeSource.organizationId, orgOf(botId)),
          eq(knowledgeSource.inputUrl, 'https://example.com/revoked'),
        ),
      )
    assert.equal(unauthorizedSources.length, 0)
    // Session revoked between turns must stop tool execution at the HTTP boundary.
    await db
      .delete(session)
      .where(eq(session.userId, credentials.accounts.member.userId))
    assert.equal(
      (
        await send('member', memberChat.id, [
          { name: 'get_context', arguments: {} },
        ])
      ).status,
      401,
    )
    await db.delete(knowledgeSource).where(eq(knowledgeSource.id, source.id))
    await db.delete(conversation).where(eq(conversation.id, preview.id))
  } finally {
    workspaceFixture.onRequest = undefined
    for (const orgId of createdOrgs) {
      await db
        .delete(workspaceChat)
        .where(eq(workspaceChat.organizationId, orgId))
      await db.delete(assistant).where(eq(assistant.organizationId, orgId))
      await db.delete(member).where(eq(member.organizationId, orgId))
      await db.delete(organization).where(eq(organization.id, orgId))
    }
    server.stop(true)
    providers.server.stop(true)
  }
}, 60_000)
