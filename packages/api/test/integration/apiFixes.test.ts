import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { and, eq, sql } from 'drizzle-orm'
import { installChatFixture, chatFixture } from '../fixtures/chatModel'

// Run separately from live-provider tests so the fixture cannot affect them.
test('API pagination, contact capture and request-scoped chat', async () => {
  const databaseUrl = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !databaseUrl ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)
  )
    throw new Error('API fixes test requires local PostgreSQL')
  process.env.NODE_ENV = 'test'
  process.env.OPENAI_API_KEY = 'fixture-key'
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
  installChatFixture()
  const { db } = await import('../../src/db')
  const {
    assistant,
    contact,
    contactIdentity,
    conversation,
    message,
    lead,
    leadConversation,
    organization,
  } = await import('../../src/db/schema')
  const { chatConfig } = await import('../../src/config/chat.config')
  const { captureChatLead } = await import('../../src/services/leads/capture')
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
  const orgId = credentials.organizationId
  const ownerHeaders = {
    Cookie: credentials.accounts.owner.cookie,
    Origin: process.env.FRONT_END_URL,
    'Content-Type': 'application/json',
  }
  const widgetOrigin = 'https://api-fixes.example'
  const [bot] = await db
    .insert(assistant)
    .values({
      organizationId: orgId,
      name: 'API fixes',
      status: 'published',
      allowedOrigins: [widgetOrigin],
    })
    .returning()
  const [otherOrg] = await db
    .insert(organization)
    .values({
      id: crypto.randomUUID(),
      name: 'Cursor isolation',
      slug: crypto.randomUUID(),
    })
    .returning()
  try {
    const bootstrap = await fetch(
      `${apiOrigin}/api/widget/${bot.id}/bootstrap`,
      { method: 'POST', headers: { Origin: widgetOrigin } },
    )
    assert.equal(bootstrap.status, 200)
    const { token } = (await bootstrap.json()) as { token: string }
    const widgetHeaders = {
      Authorization: `Bearer ${token}`,
      Origin: widgetOrigin,
      'Content-Type': 'application/json',
    }
    const apiBase = `${apiOrigin}/api/organizations/${orgId}`
    async function startChat() {
      const response = await fetch(
        `${apiOrigin}/api/widget/${bot.id}/conversations`,
        { method: 'POST', headers: widgetHeaders, body: '{}' },
      )
      assert.equal(response.status, 201)
      return (await response.json()) as { id: string; resumeToken: string }
    }
    const send = (
      chat: { id: string; resumeToken: string },
      content: string,
      id = crypto.randomUUID(),
    ) =>
      fetch(
        `${apiOrigin}/api/widget/${bot.id}/conversations/${chat.id}/messages`,
        {
          method: 'POST',
          headers: {
            ...widgetHeaders,
            'X-Conversation-Token': chat.resumeToken,
          },
          body: JSON.stringify({ content, clientMessageId: id }),
        },
      )
    async function waitForReply(chatId: string, status: string) {
      for (let count = 0; count < 100; count++) {
        const [reply] = await db
          .select()
          .from(message)
          .where(
            and(
              eq(message.conversationId, chatId),
              eq(message.role, 'assistant'),
              eq(message.status, status as 'completed' | 'failed'),
            ),
          )
          .limit(1)
        if (reply) return reply
        await Bun.sleep(20)
      }
      throw new Error(`Reply did not reach ${status}`)
    }

    // Closing the page does not discard an accepted request or its saved answer.
    const disconnected = await startChat()
    chatFixture.delayMs = 150
    const streaming = await send(disconnected, 'Hello')
    const reader = streaming.body!.getReader()
    assert.equal((await reader.read()).done, false)
    await reader.cancel()
    const completed = await waitForReply(disconnected.id, 'completed')
    assert.equal(completed.content, 'Saved reply.')
    assert(Math.abs(completed.createdAt.getTime() - Date.now()) < 10_000)
    // Chat age and a previous closed status never gate new replies.
    await db
      .update(conversation)
      .set({
        createdAt: new Date(Date.now() - 366 * 86400000),
        status: 'closed',
      })
      .where(eq(conversation.id, disconnected.id))
    chatFixture.delayMs = 0
    assert(
      (
        await (await send(disconnected, 'A new question one year later')).text()
      ).includes('event: done'),
    )
    const [reopened] = await db
      .select()
      .from(conversation)
      .where(eq(conversation.id, disconnected.id))
    assert.equal(reopened.status, 'open')

    // Delay A between acceptance and generation; B completes through HTTP in
    // that gap. A must retain the history snapshot accepted for its own turn.
    const overlapping = await startChat()
    const { beginReply } = await import('../../src/services/chat/messages')
    const { createAnswerStream } =
      await import('../../src/services/chat/answer')
    const firstClientId = crypto.randomUUID()
    const firstContext = await beginReply(overlapping.id, {
      clientMessageId: firstClientId,
      content: 'First request before overlapping send',
    })
    const laterReply = await send(
      overlapping,
      'Second request must not enter the first reply',
    )
    assert((await laterReply.text()).includes('event: done'))
    const observed: string[] = []
    chatFixture.onRequest = (input) => {
      observed.push(JSON.stringify(input))
    }
    try {
      const firstStream = await createAnswerStream(
        bot.id,
        overlapping.id,
        firstClientId,
        firstContext,
      )
      assert((await new Response(firstStream).text()).includes('event: done'))
      assert(observed.length > 0)
      assert(
        observed.every((input) =>
          input.includes('First request before overlapping send'),
        ),
      )
      assert(
        observed.every(
          (input) =>
            !input.includes('Second request must not enter the first reply'),
        ),
        'Later accepted visitor text leaked into an earlier reply context',
      )
      assert(
        observed.every((input) => !input.includes('Saved reply.')),
        'Later completed answer leaked into an earlier reply context',
      )
    } finally {
      chatFixture.onRequest = undefined
    }

    // A timeout ends this request. Sending again is a new message, not a recovered turn.
    chatConfig.generationTimeoutMs = 50
    chatFixture.delayMs = 250
    const timed = await startChat()
    const turn = crypto.randomUUID()
    const timedContent = 'Time out this reply'
    const timedResponse = await send(timed, timedContent, turn)
    assert((await timedResponse.text()).includes('generation_timeout'))
    await waitForReply(timed.id, 'failed')
    assert.equal((await send(timed, timedContent, turn)).status, 409)
    assert.equal((await send(timed, 'Different content', turn)).status, 409)
    await assert.rejects(() =>
      captureChatLead(
        bot.id,
        timed.id,
        'cancelled-turn',
        {
          title: 'Late request',
          email: 'late@example.com',
        },
        AbortSignal.abort(),
      ),
    )
    chatConfig.generationTimeoutMs = 120_000
    chatFixture.delayMs = 0
    assert(
      (await (await send(timed, 'Send a fresh reply')).text()).includes(
        'event: done',
      ),
    )
    const visitorTurns = await db
      .select()
      .from(message)
      .where(
        and(eq(message.conversationId, timed.id), eq(message.role, 'visitor')),
      )
    assert.equal(visitorTurns.length, 2)

    // Contact from an earlier visitor message; model's unsupported phone is discarded.
    const contactChat = await startChat()
    const email = `person-${crypto.randomUUID()}@example.com`
    assert(
      (
        await (
          await send(
            contactChat,
            `My name is Ada Lovelace. Email ${email.toUpperCase()}`,
          )
        ).text()
      ).includes('event: done'),
    )
    chatFixture.lead = {
      title: 'Callback',
      name: 'Ada Lovelace',
      email,
      phone: '+15559876543',
    }
    chatFixture.failAfterCapture = true
    const captureTurn = crypto.randomUUID()
    assert(
      (
        await (await send(contactChat, 'Please contact me', captureTurn)).text()
      ).includes('event: error'),
    )
    let requests = await db
      .select()
      .from(lead)
      .innerJoin(leadConversation, eq(lead.id, leadConversation.leadId))
      .where(eq(leadConversation.conversationId, contactChat.id))
    assert.equal(requests.length, 1)
    const [person] = await db
      .select()
      .from(contact)
      .where(eq(contact.id, requests[0].lead.contactId))
    assert.equal(person.name, 'Ada Lovelace')
    assert.equal(person.phone, null)
    chatFixture.failAfterCapture = false
    assert.equal(
      (await send(contactChat, 'Please contact me', captureTurn)).status,
      409,
    )
    requests = await db
      .select()
      .from(lead)
      .innerJoin(leadConversation, eq(lead.id, leadConversation.leadId))
      .where(eq(leadConversation.conversationId, contactChat.id))
    assert.equal(requests.length, 1, 'Retry duplicated a captured lead')

    // Returning contact fills an empty phone, retains an existing name, and links the new chat.
    const returning = await startChat()
    const returnedPhone = `+1555${Date.now().toString().slice(-7)}`
    chatFixture.lead = {
      title: 'Another request',
      name: 'Different Name',
      email,
      phone: returnedPhone,
    }
    assert(
      (
        await (
          await send(
            returning,
            `I am Different Name, ${email}. Phone +1 (555) ${returnedPhone.slice(5, 8)}-${returnedPhone.slice(8)}. Please call me.`,
          )
        ).text()
      ).includes('event: done'),
    )
    const [updated] = await db
      .select()
      .from(contact)
      .where(eq(contact.id, person.id))
    assert.equal(updated.name, 'Ada Lovelace')
    assert.equal(updated.normalizedPhone, returnedPhone)
    const [linked] = await db
      .select()
      .from(conversation)
      .where(eq(conversation.id, returning.id))
    assert.equal(linked.contactId, person.id)
    const [newLead] = await db
      .select()
      .from(lead)
      .innerJoin(leadConversation, eq(lead.id, leadConversation.leadId))
      .where(eq(leadConversation.conversationId, returning.id))
    assert(newLead.lead.summary?.includes('Different Name'))
    chatFixture.lead = undefined

    // Do not assemble phone digits across messages or accept an email substring.
    const fragments = await startChat()
    const fragmentEmail = `fragment-${crypto.randomUUID()}@example.com`
    await (
      await send(
        fragments,
        `Email prefix${fragmentEmail}. First phone part +1555`,
      )
    ).text()
    await (await send(fragments, 'Second phone part 1234567')).text()
    chatFixture.lead = {
      title: 'Unsupported fields',
      email: fragmentEmail,
      phone: '+15551234567',
    }
    await (await send(fragments, 'Please call me')).text()
    const fragmentLeads = await db
      .select()
      .from(leadConversation)
      .where(eq(leadConversation.conversationId, fragments.id))
    assert.equal(fragmentLeads.length, 0)
    const [fragmentChat] = await db
      .select()
      .from(conversation)
      .where(eq(conversation.id, fragments.id))
    assert.equal(fragmentChat.knownFields.phone, undefined)
    chatFixture.lead = undefined

    // Matching one email and another contact's phone remains a conflict.
    const otherPhone = `+1666${Date.now().toString().slice(-7)}`
    const [otherPerson] = await db
      .insert(contact)
      .values({
        organizationId: orgId,
        phone: otherPhone,
        normalizedPhone: otherPhone,
      })
      .returning()
    await db.insert(contactIdentity).values({
      organizationId: orgId,
      contactId: otherPerson.id,
      kind: 'phone',
      value: otherPhone,
      normalizedValue: otherPhone,
      source: 'manual',
    })
    const [conflictChat] = await db
      .insert(conversation)
      .values({ assistantId: bot.id, resumeTokenHash: crypto.randomUUID() })
      .returning()
    await db.insert(message).values({
      conversationId: conflictChat.id,
      role: 'visitor',
      content: `${email} ${otherPhone}`,
    })
    const conflict = await captureChatLead(
      bot.id,
      conflictChat.id,
      crypto.randomUUID(),
      { title: 'Enquiry', email, phone: otherPhone },
      AbortSignal.timeout(30_000),
    ).catch((error: unknown) => error)
    assert.equal((conflict as { status?: number }).status, 409)

    // The three collection endpoints: >100 rows, tied timestamps and scoped cursors.
    const timestamp = new Date('2020-01-01T00:00:00Z')
    const people = await db
      .insert(contact)
      .values(
        Array.from({ length: 105 }, () => ({
          organizationId: orgId,
          createdAt: timestamp,
        })),
      )
      .returning()
    const chats = await db
      .insert(conversation)
      .values(
        Array.from({ length: 105 }, () => ({
          assistantId: bot.id,
          resumeTokenHash: crypto.randomUUID(),
          createdAt: timestamp,
        })),
      )
      .returning()
    const leads = await db
      .insert(lead)
      .values(
        people.map((item) => ({
          organizationId: orgId,
          assistantId: bot.id,
          contactId: item.id,
          title: 'Page test',
          capturedVia: 'chat' as const,
          createdAt: timestamp,
        })),
      )
      .returning()
    const [foreignPerson] = await db
      .insert(contact)
      .values({ organizationId: otherOrg.id })
      .returning()
    const [foreignBot] = await db
      .insert(assistant)
      .values({ organizationId: otherOrg.id, name: 'Foreign' })
      .returning()
    const [foreignChat] = await db
      .insert(conversation)
      .values({
        assistantId: foreignBot.id,
        resumeTokenHash: crypto.randomUUID(),
      })
      .returning()
    const [foreignLead] = await db
      .insert(lead)
      .values({
        assistantId: foreignBot.id,
        organizationId: otherOrg.id,
        contactId: foreignPerson.id,
        title: 'Foreign',
        capturedVia: 'chat',
      })
      .returning()
    const cases = [
      {
        path: '/contacts',
        ids: people.map((x) => x.id),
        foreign: foreignPerson.id,
      },
      { path: '/leads', ids: leads.map((x) => x.id), foreign: foreignLead.id },
      {
        path: '/conversations',
        ids: chats.map((x) => x.id),
        foreign: foreignChat.id,
      },
    ]
    for (const item of cases) {
      const first = await fetch(`${apiBase}${item.path}?limit=100`, {
        headers: ownerHeaders,
      })
      assert.equal(first.status, 200)
      const seen = ((await first.json()) as Array<{ id: string }>).map(
        (x) => x.id,
      )
      assert.equal(seen.length, 100)
      let cursor = first.headers.get('x-next-cursor')
      assert(cursor)
      assert(
        first.headers
          .get('access-control-expose-headers')
          ?.includes('X-Next-Cursor'),
      )
      // A new first-page row must not shift the remaining pages.
      if (item.path === '/contacts')
        await db.insert(contact).values({ organizationId: orgId })
      while (cursor) {
        const response: Response = await fetch(
          `${apiBase}${item.path}?cursor=${cursor}&limit=50`,
          { headers: ownerHeaders },
        )
        assert.equal(response.status, 200)
        seen.push(
          ...((await response.json()) as Array<{ id: string }>).map(
            (x) => x.id,
          ),
        )
        cursor = response.headers.get('x-next-cursor')
      }
      assert.equal(new Set(seen).size, seen.length)
      assert(item.ids.every((id) => seen.includes(id)))
      for (const query of [
        'limit=0',
        'limit=201',
        'limit=1.5',
        'cursor=missing',
        `cursor=${item.foreign}`,
      ])
        assert.equal(
          (
            await fetch(`${apiBase}${item.path}?${query}`, {
              headers: ownerHeaders,
            })
          ).status,
          422,
        )
    }
    // Keep fixture artifacts within the existing integration workspace lifecycle.
    await db.delete(lead).where(eq(lead.id, foreignLead.id))
    await db.delete(conversation).where(eq(conversation.id, foreignChat.id))
    await db.delete(assistant).where(eq(assistant.id, foreignBot.id))
    await db.delete(contact).where(eq(contact.id, foreignPerson.id))
    await db.delete(organization).where(eq(organization.id, otherOrg.id))
    // Confirm migration columns exist and no fixture reply remains pending.
    const pending = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(message)
      .innerJoin(conversation, eq(message.conversationId, conversation.id))
      .where(
        and(
          eq(conversation.assistantId, bot.id),
          eq(message.status, 'pending'),
        ),
      )
    assert.equal(pending[0].count, 0)
  } finally {
    chatConfig.generationTimeoutMs = 120_000
    server.stop(true)
  }
}, 60_000)
