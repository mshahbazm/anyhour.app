import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mock, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { chatFixture, installChatFixture } from '../fixtures/chatModel'
import type { iAttention } from '../../src/types/support.types'
import type {
  iInboxConversation,
  iInboxItem,
  iInboxMessage,
} from '../../src/types/support.types'

// Owner alerts are emails through Resend: collected here, never sent.
const sent: Array<{ to: string[]; subject: string; text: string }> = []
mock.module('resend', () => ({
  Resend: class {
    emails = {
      send: async (message: (typeof sent)[number]) => {
        sent.push(message)
        return { data: { id: crypto.randomUUID() }, error: null }
      },
    }
  },
}))

// One-shot model call: the handoff's suggested reply. Embeddings are one
// fixed vector.
const suggestedReply = 'Sorry your order arrived broken. I’ll sort it out now.'
mock.module('../../src/services/ai/providers/openAiClient', () => ({
  getOpenAi: () => ({
    embeddings: {
      create: async ({ input }: { input: string[] }) => ({
        data: input.map((_, index) => ({
          index,
          embedding: Array.from({ length: 384 }, (_, dimension) =>
            dimension === 0 ? 1 : 0,
          ),
        })),
        usage: { prompt_tokens: input.length, total_tokens: input.length },
      }),
    },
    responses: {
      parse: async (request: { text: { format: { name: string } } }) => ({
        model: 'gpt-5.6-luna',
        output_parsed:
          request.text.format.name === 'handoffReply'
            ? { reply: suggestedReply }
            : { records: [], missing: [] },
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    },
  }),
}))

test('handoff, staff replies and release over HTTP', async () => {
  const value = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !value ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname)
  )
    throw new Error('Requires local PostgreSQL')
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
  installChatFixture()
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
  const { assistant, conversation, member, message, organization, user } =
    await import('../../src/db/schema')

  const org = crypto.randomUUID()
  await db
    .insert(organization)
    .values({ id: org, name: 'Support fixture', slug: org })
  const memberIds: Record<string, string> = {}
  for (const role of ['owner', 'admin', 'member'] as const) {
    memberIds[role] = crypto.randomUUID()
    await db.insert(member).values({
      id: memberIds[role],
      userId: credentials.accounts[role].userId,
      organizationId: org,
      role,
    })
  }
  const [memberUser] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, credentials.accounts.member.userId))
  const widgetOrigin = 'https://support-fixture.example'
  const [bot] = await db
    .insert(assistant)
    .values({
      organizationId: org,
      name: 'Maya',
      status: 'published',
      allowedOrigins: [widgetOrigin],
    })
    .returning()

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

  // The visitor's side: the public widget API.
  const bootstrap = await fetch(`${origin}/api/widget/${bot.id}/bootstrap`, {
    method: 'POST',
    headers: { Origin: widgetOrigin },
  })
  const { token } = (await bootstrap.json()) as { token: string }
  const widget = {
    Authorization: `Bearer ${token}`,
    Origin: widgetOrigin,
    'Content-Type': 'application/json',
  }
  const started = await fetch(`${origin}/api/widget/${bot.id}/conversations`, {
    method: 'POST',
    headers: widget,
    body: '{}',
  })
  const chat = (await started.json()) as { id: string; resumeToken: string }
  const visitorHeaders = { ...widget, 'X-Conversation-Token': chat.resumeToken }
  const say = async (content: string) => {
    const response = await fetch(
      `${origin}/api/widget/${bot.id}/conversations/${chat.id}/messages`,
      {
        method: 'POST',
        headers: visitorHeaders,
        body: JSON.stringify({ content, clientMessageId: crypto.randomUUID() }),
      },
    )
    assert.equal(response.status, 200)
    return response.text()
  }
  const visitorRead = async (path = '') => {
    const response = await fetch(
      `${origin}/api/widget/${bot.id}/conversations/${chat.id}${path}`,
      { headers: visitorHeaders },
    )
    assert.equal(response.status, 200)
    return response.text()
  }
  const assistantReplies = async () =>
    (
      await db
        .select({ id: message.id })
        .from(message)
        .where(
          and(
            eq(message.conversationId, chat.id),
            eq(message.role, 'assistant'),
          ),
        )
    ).length
  const wants = 'Refund for a mug that arrived cracked'

  try {
    // 1. The AI hands off through its tool: needs-you, one owner alert and a
    // suggested reply.
    chatFixture.handOff = {
      reason: 'money',
      wants,
      known: 'Order placed last week',
      nextStep: 'Offer a refund or a replacement',
    }
    assert(
      (await say('My mug arrived cracked, I want my money back')).includes(
        'event: done',
      ),
    )
    const [handed] = await db
      .select()
      .from(conversation)
      .where(eq(conversation.id, chat.id))
    assert(handed.needsHumanSince, 'needs a person')
    assert.equal(handed.handledBy, 'agent')
    assert.equal(handed.handoffSummary?.wants, wants)
    const attention = await json<iAttention>(
      await request('member', '/attention'),
    )
    assert(attention.support.conversations.some((item) => item.id === chat.id))
    assert(attention.support.count >= 1)
    const needsYou = await json<iInboxItem[]>(
      await request('member', '/conversations?filter=needsYou'),
    )
    assert.deepEqual(
      needsYou.map((item) => item.id),
      [chat.id],
    )
    const alerts = () =>
      sent.filter((item) => item.subject.startsWith('Needs you'))
    assert.equal(alerts().length, 1)
    assert(alerts()[0].text.includes(`/conversations/${chat.id}`))
    let detail: iInboxConversation | null = null
    for (
      let tries = 0;
      tries < 100 && !detail?.conversation.handoffDraft;
      tries++
    ) {
      detail = await json<iInboxConversation>(
        await request('member', `/conversations/${chat.id}`),
      )
      if (!detail.conversation.handoffDraft) await Bun.sleep(20)
    }
    assert.equal(detail?.conversation.handoffDraft, suggestedReply)
    // A second handoff while still waiting doesn't alert again.
    assert((await say('Hello? Anyone there?')).includes('event: done'))
    assert.equal(alerts().length, 1)
    chatFixture.handOff = undefined

    // Outsiders can't read or reply.
    assert.equal((await request('outsider', '/conversations')).status, 403)
    assert.equal(
      (
        await request(
          'outsider',
          `/conversations/${chat.id}/messages`,
          'POST',
          {
            content: 'Hi',
          },
        )
      ).status,
      403,
    )

    // 2. A member replies as staff; the visitor's read shows it with their
    // first name, and never the owner-only summary or draft.
    const reply = await json<iInboxMessage>(
      await request('member', `/conversations/${chat.id}/messages`, 'POST', {
        content: 'Hi, I’m sorry about the mug. I’ll refund you today.',
      }),
      201,
    )
    assert.equal(reply.role, 'staff')
    assert.equal(reply.staff?.id, memberIds.member)
    const firstName = memberUser.name.trim().split(/\s+/)[0]
    const history = JSON.parse(await visitorRead()) as {
      handledBy: string
      messages: Array<{ id: string; role: string; staffName?: string }>
    }
    assert.equal(history.handledBy, 'human')
    const staffMessage = history.messages.find((item) => item.id === reply.id)
    assert.equal(staffMessage?.role, 'staff')
    assert.equal(staffMessage?.staffName, firstName)
    const updates = JSON.parse(
      await visitorRead(
        `/updates?after=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`,
      ),
    ) as {
      handledBy: string
      messages: Array<{ id: string; staffName: string }>
    }
    assert.equal(updates.handledBy, 'human')
    assert.deepEqual(
      updates.messages.map((item) => [item.id, item.staffName]),
      [[reply.id, firstName]],
    )
    for (const text of [await visitorRead(), await visitorRead('/updates')]) {
      assert(!text.includes(wants), 'no handoff summary for visitors')
      assert(!text.includes(suggestedReply), 'no draft for visitors')
      assert(!text.includes('Offer a refund'), 'no next step for visitors')
    }
    const [taken] = await db
      .select()
      .from(conversation)
      .where(eq(conversation.id, chat.id))
    assert.equal(taken.needsHumanSince, null)
    assert.equal(taken.assignedMemberId, memberIds.member)
    assert.equal(taken.handoffDraft, null)
    const afterReply = await json<iInboxItem[]>(
      await request('member', '/conversations?filter=needsYou'),
    )
    assert(!afterReply.some((item) => item.id === chat.id), 'left Needs you')

    // 3. While the team has it the AI stays quiet: no model call, no
    // reply, and the visitor's message lands back in Needs you.
    let modelCalls = 0
    chatFixture.onRequest = () => {
      modelCalls++
    }
    const repliesBefore = await assistantReplies()
    const quiet = await say('Thanks, when will I see it?')
    assert(quiet.includes('event: team'))
    assert(quiet.includes('The team will reply here.'))
    assert.equal(modelCalls, 0)
    assert.equal(await assistantReplies(), repliesBefore)
    const [waiting] = await db
      .select()
      .from(conversation)
      .where(eq(conversation.id, chat.id))
    assert(waiting.needsHumanSince, 'back in Needs you')
    assert.equal(alerts().length, 1, 'no second alert while the team has it')

    // 4. Hand it back to the AI: it answers again.
    assert.equal(
      (await request('outsider', `/conversations/${chat.id}/release`, 'POST'))
        .status,
      403,
    )
    const released = await json<iInboxConversation>(
      await request('member', `/conversations/${chat.id}/release`, 'POST'),
    )
    assert.equal(released.conversation.handledBy, 'agent')
    assert.equal(released.conversation.needsHumanSince, null)
    assert((await say('One more question')).includes('event: delta'))
    assert.equal(modelCalls > 0, true)
    assert.equal(await assistantReplies(), repliesBefore + 1)
    chatFixture.onRequest = undefined
    const aiHandling = await json<iInboxItem[]>(
      await request('owner', '/conversations?filter=aiHandling'),
    )
    assert.deepEqual(
      aiHandling.map((item) => item.id),
      [chat.id],
    )
  } finally {
    chatFixture.handOff = undefined
    chatFixture.onRequest = undefined
    // Best effort: the fixture workspace is unique to this run.
    try {
      await db.delete(conversation).where(eq(conversation.assistantId, bot.id))
    } catch (error) {
      console.error('Support fixture cleanup failed', error)
    }
    server.stop(true)
  }
}, 60_000)
