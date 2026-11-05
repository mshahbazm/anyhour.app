import { orgOf } from '../fixtures/knowledgeOwner'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mock, test } from 'bun:test'
import { createHash } from 'node:crypto'
import type { tPublicBlock } from '../../src/services/workspaceAgent/uiBlocks'

const deliveries: unknown[] = []
mock.module('resend', () => ({
  Resend: class {
    emails = {
      send: async (message: unknown) => {
        deliveries.push(message)
        return { data: { id: crypto.randomUUID() }, error: null }
      },
    }
  },
}))
import { eq, inArray } from 'drizzle-orm'
import {
  installWorkspaceFixture,
  workspaceFixture,
} from '../fixtures/workspaceModel'
import { startRolesProviders } from '../fixtures/rolesProviders'

test('chat choices, workspace settings and team tools enforce permissions and replay safety', async () => {
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
  process.env.OPENAI_API_KEY = 'fixture-key'
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
    invitation,
    workspaceUiBlock,
    publicRateLimit,
    workspaceChat,
    organization,
    member,
    knowledgeSource,
    knowledgeChunk,
    aiUsageEvent,
  } = await import('../../src/db/schema')
  const org = crypto.randomUUID()
  await db
    .insert(organization)
    .values({ id: org, name: 'Management fixture', slug: org })
  for (const role of ['owner', 'admin', 'member'] as const)
    await db.insert(member).values({
      id: crypto.randomUUID(),
      userId: credentials.accounts[role].userId,
      organizationId: org,
      role,
    })
  type tRole = 'owner' | 'admin' | 'member' | 'outsider'
  function headers(role: tRole) {
    return {
      Cookie: credentials.accounts[role].cookie,
      Origin: 'http://localhost:3000',
      'content-type': 'application/json',
    }
  }
  async function request(
    role: tRole,
    path: string,
    method = 'GET',
    body?: unknown,
  ) {
    // These scenarios exercise authorization and idempotency, not rate limits. Reset only this fixture user's bucket.
    const userId = credentials.accounts[role].userId
    await db
      .delete(publicRateLimit)
      .where(
        eq(
          publicRateLimit.keyHash,
          createHash('sha256')
            .update(`workspace-helper:${userId}:${userId}:message`)
            .digest('hex'),
        ),
      )
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
      blocks: tPublicBlock[]
      actions: Array<{
        status: string
        name: string
        result: { error?: string; [key: string]: unknown }
      }>
    }>(await request(role, `/api/workspace-agent/chats/${id}`))
  }
  const ownerChat = await newChat('owner')
  const adminChat = await newChat('admin')
  const memberChat = await newChat('member')
  const workspacePath = `/api/organizations/${org}/workspace`
  const turns = async (
    role: tRole,
    chatId: string,
    workflow: Array<{ name: string; arguments: Record<string, unknown> }>,
  ) => {
    const response = await send(role, chatId, workflow)
    assert.equal(response.status, 200)
    assert((await response.text()).includes('event: done'))
    return history(role, chatId)
  }
  const choices = {
    type: 'choice',
    title: 'What should your bot help with?',
    description: null,
    options: [
      { value: 'answers', label: 'Answer questions', description: null },
      { value: 'enquiries', label: 'Generate enquiries', description: null },
    ],
    items: [],
  }
  const respond = (
    role: tRole,
    chatId: string,
    blockId: string,
    value: string,
  ) =>
    request(
      role,
      `/api/workspace-agent/chats/${chatId}/blocks/${blockId}/respond`,
      'POST',
      { value, clientMessageId: crypto.randomUUID() },
    )
  let onboardingOrg: string | undefined
  try {
    const context = await json<{ user: { email: string } }>(
      await request('owner', '/api/workspace-agent/context'),
    )
    assert.equal(context.user.email, credentials.accounts.owner.email)
    assert.equal((await request('outsider', workspacePath)).status, 403)
    assert.equal(
      (
        await request('member', workspacePath, 'PATCH', {
          name: 'Member rename',
        })
      ).status,
      403,
    )
    // A workspace has a name, not a website: websites are knowledge or install origins.
    assert.equal(
      (
        await request('owner', workspacePath, 'PATCH', {
          mainWebsiteUrl: 'https://example.com',
        })
      ).status,
      422,
    )
    await json(
      await request('admin', workspacePath, 'PATCH', {
        name: 'Updated workspace',
      }),
    )
    assert.equal(
      (await json<{ name: string }>(await request('member', workspacePath)))
        .name,
      'Updated workspace',
    )
    let saved = await turns('owner', ownerChat.id, [
      { name: 'get_context', arguments: {} },
      {
        name: 'create_assistant',
        arguments: { name: 'Goal bot', job: null },
      },
      {
        name: 'set_bot_goal',
        arguments: {
          goal: 'enquiries',
          notes: 'Help interested visitors book a consultation.',
        },
      },
      { name: 'show_choices', arguments: choices },
    ])
    const botId = saved.chat.assistantId
    const botPath = `/api/organizations/${org}/assistants/${botId}`
    saved = await turns('owner', ownerChat.id, [
      {
        name: 'set_bot_goal',
        arguments: { goal: 'both', notes: 'Answer first.' },
      },
      {
        name: 'update_workspace',
        arguments: { name: 'Updated workspace' },
      },
      { name: 'show_choices', arguments: choices },
    ])
    const bot = await json<{
      goal: string
      allowedOrigins: string[]
    }>(await request('owner', botPath))
    assert.equal(bot.goal, 'both')
    assert.deepEqual(bot.allowedOrigins, [])
    let block = saved.blocks.at(-1)!
    assert.equal(
      (await respond('admin', ownerChat.id, block.id, 'answers')).status,
      404,
    )
    assert.equal(
      (await respond('owner', ownerChat.id, block.id, 'invented')).status,
      400,
    )
    workspaceFixture.responseWorkflow = [
      { name: 'set_bot_goal', arguments: { goal: 'answers', notes: null } },
    ]
    const replies = await Promise.all([
      respond('owner', ownerChat.id, block.id, 'answers'),
      respond('owner', ownerChat.id, block.id, 'answers'),
    ])
    assert.deepEqual(replies.map((item) => item.status).sort(), [200, 409])
    for (const reply of replies) await reply.text()
    workspaceFixture.responseWorkflow = undefined
    saved = await history('owner', ownerChat.id)
    assert.equal(saved.blocks.at(-1)?.resolvedValue, 'answers')
    assert.equal(
      (await json<{ goal: string }>(await request('owner', botPath))).goal,
      'answers',
    )
    saved = await turns('owner', ownerChat.id, [
      { name: 'show_choices', arguments: choices },
    ])
    block = saved.blocks.at(-1)!
    await (
      await request(
        'owner',
        `/api/workspace-agent/chats/${ownerChat.id}/messages`,
        'POST',
        { content: 'Generate enquiries', clientMessageId: crypto.randomUUID() },
      )
    ).text()
    assert.equal(
      (await history('owner', ownerChat.id)).blocks.at(-1)?.resolvedValue,
      'enquiries',
    )
    saved = await turns('owner', ownerChat.id, [
      { name: 'show_choices', arguments: choices },
    ])
    block = saved.blocks.at(-1)!
    await (
      await request(
        'owner',
        `/api/workspace-agent/chats/${ownerChat.id}/messages`,
        'POST',
        {
          content: 'Actually, help me decide based on my business.',
          clientMessageId: crypto.randomUUID(),
        },
      )
    ).text()
    assert.equal(
      (await respond('owner', ownerChat.id, block.id, 'answers')).status,
      409,
    )
    saved = await turns('owner', ownerChat.id, [
      { name: 'show_choices', arguments: choices },
    ])
    block = saved.blocks.at(-1)!
    await db
      .update(workspaceUiBlock)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(workspaceUiBlock.id, block.id))
    assert.equal(
      (await respond('owner', ownerChat.id, block.id, 'answers')).status,
      409,
    )

    const memberships = await db
      .select()
      .from(member)
      .where(eq(member.organizationId, org))
    const owner = memberships.find((row) => row.role === 'owner')!
    const target = memberships.find((row) => row.role === 'member')!
    saved = await turns('member', memberChat.id, [
      { name: 'list_team', arguments: { offset: 0 } },
      {
        name: 'invite_member',
        arguments: { email: 'no-send@example.com', role: 'admin' },
      },
      {
        name: 'update_member_role',
        arguments: { memberId: target.id, role: 'admin' },
      },
    ])
    assert.equal(deliveries.length, 0)
    assert(saved.actions.slice(-2).every((action) => action.result.error))
    saved = await turns('admin', adminChat.id, [
      { name: 'list_team', arguments: { offset: 0 } },
      {
        name: 'invite_member',
        arguments: { email: 'fixture-invite@example.com', role: 'member' },
      },
      {
        name: 'update_member_role',
        arguments: { memberId: target.id, role: 'admin' },
      },
      { name: 'request_member_removal', arguments: { memberId: owner.id } },
    ])
    assert.equal(deliveries.length, 1)
    assert.equal(saved.actions.at(-1)?.result.error, 'owner_protected')
    assert.equal(
      (await db.select().from(member).where(eq(member.id, target.id)))[0].role,
      'admin',
    )
    const [invite] = await db
      .select()
      .from(invitation)
      .where(eq(invitation.organizationId, org))
    saved = await turns('owner', ownerChat.id, [
      { name: 'cancel_invitation', arguments: { invitationId: invite.id } },
      {
        name: 'update_member_role',
        arguments: { memberId: owner.id, role: 'member' },
      },
      { name: 'request_member_removal', arguments: { memberId: target.id } },
    ])
    assert.equal(
      (
        await db.select().from(invitation).where(eq(invitation.id, invite.id))
      )[0].status,
      'canceled',
    )
    assert.equal(saved.actions.at(-2)?.result.error, 'owner_protected')
    block = saved.blocks.at(-1)!
    workspaceFixture.responseWorkflow = [
      { name: 'remove_member', arguments: { blockId: block.id } },
    ]
    await (await respond('owner', ownerChat.id, block.id, 'cancel')).text()
    assert.equal(
      (await db.select().from(member).where(eq(member.id, target.id))).length,
      1,
    )
    assert.equal(
      (await history('owner', ownerChat.id)).actions.at(-1)?.result.error,
      'confirmation_required',
    )
    workspaceFixture.responseWorkflow = undefined
    saved = await turns('owner', ownerChat.id, [
      { name: 'request_member_removal', arguments: { memberId: target.id } },
    ])
    block = saved.blocks.at(-1)!
    await db
      .update(member)
      .set({ role: 'member' })
      .where(eq(member.id, target.id))
    workspaceFixture.responseWorkflow = [
      { name: 'remove_member', arguments: { blockId: block.id } },
    ]
    await (await respond('owner', ownerChat.id, block.id, 'confirm')).text()
    assert.equal(
      (await history('owner', ownerChat.id)).actions.at(-1)?.result.error,
      'member_changed',
    )
    workspaceFixture.responseWorkflow = undefined
    saved = await turns('owner', ownerChat.id, [
      { name: 'request_member_removal', arguments: { memberId: target.id } },
    ])
    block = saved.blocks.at(-1)!
    workspaceFixture.responseWorkflow = [
      { name: 'remove_member', arguments: { blockId: block.id } },
      { name: 'remove_member', arguments: { blockId: block.id } },
    ]
    await (await respond('owner', ownerChat.id, block.id, 'confirm')).text()
    assert.equal(
      (await db.select().from(member).where(eq(member.id, target.id))).length,
      0,
    )
    assert.equal(
      (await respond('owner', ownerChat.id, block.id, 'confirm')).status,
      409,
    )
    workspaceFixture.responseWorkflow = undefined
    const newUserChat = await newChat('outsider', null)
    saved = await turns('outsider', newUserChat.id, [
      { name: 'get_profile', arguments: {} },
      { name: 'create_workspace', arguments: { name: 'Document business' } },
      {
        name: 'create_assistant',
        arguments: { name: 'Document bot', job: null },
      },
      {
        name: 'set_bot_goal',
        arguments: {
          goal: 'answers',
          notes: 'No website yet; help me decide later.',
        },
      },
    ])
    onboardingOrg = saved.chat.organizationId
    assert(onboardingOrg)
    assert.equal(
      (
        await json<{ name: string }>(
          await request(
            'outsider',
            `/api/organizations/${onboardingOrg}/workspace`,
          ),
        )
      ).name,
      'Document business',
    )
    assert.equal(
      (await respond('outsider', ownerChat.id, block.id, 'confirm')).status,
      404,
    )

    // Saving a fact the website contradicts asks first, on a card.
    const [factSite] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(botId),
        kind: 'website',
        inputUrl: 'https://facts.example/',
        status: 'ready',
      })
      .returning()
    const [factPage] = await db
      .insert(knowledgeSource)
      .values({
        organizationId: orgOf(botId),
        parentId: factSite.id,
        kind: 'webPage',
        status: 'ready',
        title: 'Pricing | Facts Example',
        canonicalUrl: 'https://facts.example/pricing',
        cleanedText: 'Blog add-on: $200',
        contentHash: 'facts-v1',
      })
      .returning()
    await db.insert(knowledgeChunk).values({
      organizationId: orgOf(botId),
      sourceId: factPage.id,
      position: 0,
      text: 'Blog add-on: $200',
      embedding: Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)),
      embeddingModel: 'text-embedding-3-small',
    })
    const factsChat = await newChat('owner', org, botId)
    const notesPath = `${botPath}/notes`
    const blogNote = async () =>
      (
        await json<
          Array<{ title: string; overrides: Array<{ page: string }> }>
        >(await request('owner', notesPath))
      ).find((note) => note.title === 'Blog add-on price')
    const askToSave = async () => {
      const asked = await turns('owner', factsChat.id, [
        {
          name: 'add_knowledge_note',
          arguments: {
            title: 'Blog add-on price',
            text: 'The blog add-on is $250.',
            fromMessageId: null,
          },
        },
      ])
      const card = asked.blocks.at(-1)!
      assert.equal(card.payload.type, 'confirmation')
      assert.equal(card.status, 'pending')
      assert.equal(await blogNote(), undefined, 'Nothing saved before a yes')
      return card
    }
    workspaceFixture.responseWorkflow = []
    // "Keep the website's answer": nothing is saved, and the card can't be
    // used to save later.
    const declined = await askToSave()
    await (
      await respond('owner', factsChat.id, declined.id, 'keepWebsite')
    ).text()
    assert.equal(await blogNote(), undefined)
    let factTurn = await turns('owner', factsChat.id, [
      {
        name: 'save_confirmed_fact',
        arguments: { confirmationId: declined.id },
      },
    ])
    assert.equal(factTurn.actions.at(-1)?.result.error, 'owner_kept_website')
    assert.equal(await blogNote(), undefined)
    // "Use my new answer": saved on the server before the helper replies,
    // with the page it overrides remembered; the card works once.
    const confirmed = await askToSave()
    await (await respond('owner', factsChat.id, confirmed.id, 'confirm')).text()
    assert.deepEqual(
      (await blogNote())?.overrides.map((item) => item.page),
      ['Pricing'],
    )
    factTurn = await turns('owner', factsChat.id, [
      {
        name: 'save_confirmed_fact',
        arguments: { confirmationId: confirmed.id },
      },
    ])
    assert.equal(factTurn.actions.at(-1)?.result.error, 'confirmation_used')
    workspaceFixture.responseWorkflow = undefined
  } finally {
    workspaceFixture.responseWorkflow = undefined
    for (const id of [org, onboardingOrg].filter((value): value is string =>
      Boolean(value),
    )) {
      await db.delete(workspaceChat).where(eq(workspaceChat.organizationId, id))
      const bots = (
        await db
          .select({ id: assistant.id })
          .from(assistant)
          .where(eq(assistant.organizationId, id))
      ).map((bot) => bot.id)
      if (bots.length) {
        await db
          .delete(aiUsageEvent)
          .where(inArray(aiUsageEvent.assistantId, bots))
        await db
          .update(knowledgeSource)
          .set({ parentId: null })
          .where(eq(knowledgeSource.organizationId, id))
        await db
          .delete(knowledgeSource)
          .where(eq(knowledgeSource.organizationId, id))
      }
      await db.delete(assistant).where(eq(assistant.organizationId, id))
      await db.delete(invitation).where(eq(invitation.organizationId, id))
      await db.delete(member).where(eq(member.organizationId, id))
      await db.delete(organization).where(eq(organization.id, id))
    }
    server.stop(true)
    providers.server.stop(true)
  }
}, 60_000)
