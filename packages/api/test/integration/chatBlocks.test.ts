import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mock, test } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { chatFixture, installChatFixture } from '../fixtures/chatModel'
import type { iInboxConversation } from '../../src/types/support.types'

// Chat UI blocks on the website chat (docs/channels.md, wave 4), over the
// public widget API with the fake AI team member model: a block the model gets
// wrong is dropped and its text still goes out, a tap comes back as the
// visitor's message, and the contact form records a lead.

mock.module('resend', () => ({
  Resend: class {
    emails = {
      send: async () => ({ data: { id: crypto.randomUUID() }, error: null }),
    }
  },
}))

test('chat blocks: invalid blocks dropped, taps, contact form leads', async () => {
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
  const {
    assistant,
    contact,
    conversation,
    lead,
    member,
    message,
    organization,
  } = await import('../../src/db/schema')
  const { getBoss } = await import('../../src/services/queue/boss')
  const boss = await getBoss()
  // The lead-captured job is queued, not run, here.
  const realSend = boss.send
  boss.send = (async () => crypto.randomUUID()) as typeof boss.send

  const org = crypto.randomUUID()
  await db
    .insert(organization)
    .values({ id: org, name: 'Chat blocks fixture', slug: org })
  await db.insert(member).values({
    id: crypto.randomUUID(),
    userId: credentials.accounts.member.userId,
    organizationId: org,
    role: 'member',
  })
  const widgetOrigin = 'https://blocks-fixture.example'
  const [bot] = await db
    .insert(assistant)
    .values({
      organizationId: org,
      name: 'Ava',
      status: 'published',
      allowedOrigins: [widgetOrigin],
    })
    .returning()
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
  const visitor = { ...widget, 'X-Conversation-Token': chat.resumeToken }
  const send = (body: Record<string, unknown>) =>
    fetch(`${origin}/api/widget/${bot.id}/conversations/${chat.id}/messages`, {
      method: 'POST',
      headers: visitor,
      body: JSON.stringify({ clientMessageId: crypto.randomUUID(), ...body }),
    })
  // The `done` event of a reply's stream.
  const say = async (body: Record<string, unknown>) => {
    const response = await send(body)
    assert.equal(response.status, 200, await response.clone().text())
    const events = await response.text()
    const done = /event: done\ndata: (.+)\n/.exec(events)
    assert(done, events)
    return JSON.parse(done[1]) as {
      messageId: string
      blocks: Array<{ id: string; kind: string; fallback: string }>
    }
  }
  const stored = async (id: string) =>
    (await db.select().from(message).where(eq(message.id, id)))[0]
  const lastVisitorMessage = async () =>
    (
      await db
        .select()
        .from(message)
        .where(
          and(eq(message.conversationId, chat.id), eq(message.role, 'visitor')),
        )
    )
      .sort((a, b) => +a.createdAt - +b.createdAt)
      .at(-1)!

  try {
    // (1) A block the model gets wrong never reaches the visitor, and its
    // reply text still does: too many quick replies (the tool's schema) and
    // repeated labels (the server's check).
    for (const wrong of [
      {
        kind: 'choices',
        options: ['A', 'B', 'C', 'D'].map((label) => ({ label })),
      },
      {
        kind: 'choices',
        options: [{ label: 'Morning' }, { label: 'morning' }],
      },
    ]) {
      chatFixture.block = wrong
      const done = await say({ content: 'What can I book?' })
      assert.deepEqual(done.blocks, [])
      const reply = await stored(done.messageId)
      assert.equal(reply.status, 'completed')
      assert.equal(reply.content, 'Saved reply.')
      assert.deepEqual(reply.blocks, [])
    }

    // (2) A tap round trip: quick replies shown, the visitor taps one and
    // their message reads as the option, carrying which block it answered.
    chatFixture.block = {
      kind: 'choices',
      options: [{ label: 'Morning' }, { label: 'Afternoon' }],
    }
    const offered = await say({ content: 'When can I come in?' })
    assert.equal(offered.blocks.length, 1)
    const [choices] = offered.blocks
    assert.equal(choices.kind, 'choices')
    assert.equal(choices.fallback, '1. Morning\n2. Afternoon')
    const history = (await (
      await fetch(`${origin}/api/widget/${bot.id}/conversations/${chat.id}`, {
        headers: visitor,
      })
    ).json()) as { messages: Array<{ id: string; blocks: unknown[] }> }
    assert.deepEqual(
      history.messages.find((item) => item.id === offered.messageId)?.blocks,
      offered.blocks,
    )
    chatFixture.block = undefined
    let modelInput = ''
    chatFixture.onRequest = (input) => (modelInput = JSON.stringify(input))
    await say({
      content: 'whatever the page says',
      blockReply: { blockId: choices.id, value: 'Afternoon' },
    })
    chatFixture.onRequest = undefined
    const tapped = await lastVisitorMessage()
    assert.equal(tapped.content, 'Afternoon')
    assert.deepEqual(tapped.blockReply, {
      blockId: choices.id,
      value: 'Afternoon',
    })
    // The AI team member read what it offered as text, then the tap.
    assert.match(modelInput, /1\. Morning\\n2\. Afternoon/)
    // A value we never offered is kept as plain text, not as a tap.
    await say({
      content: 'Evening please',
      blockReply: { blockId: choices.id, value: 'Evening' },
    })
    const untapped = await lastVisitorMessage()
    assert.equal(untapped.content, 'Evening please')
    assert.equal(untapped.blockReply, null)
    // The inbox shows the block and the tap, read-only.
    const detail = (await (
      await fetch(
        `${origin}/api/organizations/${org}/conversations/${chat.id}`,
        {
          headers: {
            Cookie: credentials.accounts.member.cookie,
            Origin: 'http://localhost:3000',
          },
        },
      )
    ).json()) as iInboxConversation
    assert.deepEqual(
      detail.messages.find((item) => item.id === offered.messageId)?.blocks,
      offered.blocks,
    )
    assert.equal(
      detail.messages.find((item) => item.id === tapped.id)?.blockReply?.value,
      'Afternoon',
    )

    // (3) The contact form records a lead through the normal capture.
    chatFixture.block = {
      kind: 'contactForm',
      ask: 'email',
      askName: true,
      topic: 'Whitening appointment',
    }
    const form = (await say({ content: 'Can someone call me back?' })).blocks[0]
    assert.equal(form.kind, 'contactForm')
    chatFixture.block = undefined
    const formReply = { blockId: form.id, value: 'sent' }
    // Checked like any other capture: what the form asked for, and only a
    // block we sent.
    const noEmail = await send({
      content: 'Sara',
      blockReply: formReply,
      contact: { name: 'Sara' },
    })
    assert.equal(noEmail.status, 422)
    const badEmail = await send({
      content: 'x',
      blockReply: formReply,
      contact: { email: 'not-an-email' },
    })
    assert.equal(badEmail.status, 422)
    const notOurs = await send({
      content: 'x',
      blockReply: { blockId: choices.id, value: 'sent' },
      contact: { email: 'sara@example.com' },
    })
    assert.equal(notOurs.status, 422)
    assert.equal(
      (await db.select().from(lead).where(eq(lead.organizationId, org))).length,
      0,
    )
    await say({
      content: 'Sara · sara@example.com',
      blockReply: formReply,
      contact: { name: 'Sara Malik', email: 'Sara@Example.com' },
    })
    const submitted = await lastVisitorMessage()
    assert.equal(submitted.content, 'Name: Sara Malik\nEmail: Sara@Example.com')
    assert.deepEqual(submitted.blockReply, formReply)
    const leads = await db
      .select()
      .from(lead)
      .where(eq(lead.organizationId, org))
    assert.equal(leads.length, 1)
    assert.equal(leads[0].title, 'Whitening appointment')
    assert.equal(leads[0].capturedVia, 'chat')
    const [person] = await db
      .select()
      .from(contact)
      .where(eq(contact.id, leads[0].contactId))
    assert.equal(person.name, 'Sara Malik')
    assert.equal(person.normalizedEmail, 'sara@example.com')
    const [linked] = await db
      .select({ contactId: conversation.contactId })
      .from(conversation)
      .where(eq(conversation.id, chat.id))
    assert.equal(linked.contactId, person.id)
  } finally {
    boss.send = realSend
    chatFixture.block = undefined
    chatFixture.onRequest = undefined
    try {
      const chats = db
        .select({ id: conversation.id })
        .from(conversation)
        .where(eq(conversation.assistantId, bot.id))
      await db.delete(message).where(inArray(message.conversationId, chats))
      await db.delete(lead).where(eq(lead.organizationId, org))
      await db.delete(conversation).where(eq(conversation.assistantId, bot.id))
    } catch (error) {
      console.error('Chat blocks fixture cleanup failed', error)
    }
    server.stop(true)
    await boss.stop()
  }
}, 120_000)
