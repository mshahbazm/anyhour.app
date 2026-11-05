import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { once } from 'node:events'
import { mock, test } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { chatFixture, installChatFixture } from '../fixtures/chatModel'
import type { iConnectionList } from '../../src/types/connection.types'
import type {
  iInboxConversation,
  iInboxItem,
} from '../../src/types/support.types'

// Customers on the business's WhatsApp number (docs/customerWhatsapp.md),
// against a fake Graph API and the fake AI team member model: Meta's signature,
// a message becoming a conversation and a contact identity, one answer at a
// time, the 24-hour window, and a staff reply going out through the Graph
// API.

mock.module('resend', () => ({
  Resend: class {
    emails = {
      send: async () => ({ data: { id: crypto.randomUUID() }, error: null }),
    }
  },
}))

const appSecret = 'meta-app-secret-for-tests'
const verifyToken = 'meta-verify-token-for-tests'
const accessToken = 'EAAG-fake-system-user-token-0123456789'
const numberId = '109876543210'
const businessAccountId = '204060801'
const customer = '447700900123'

interface iGraphSend {
  to: string
  type: 'text' | 'template' | 'interactive'
  text?: { body: string }
  interactive?: {
    type: string
    body: { text: string }
    action: { buttons: Array<{ reply: { id: string; title: string } }> }
  }
  template?: {
    name: string
    components: Array<{ parameters: Array<{ text: string }> }>
  }
  at: number
}
const graph = { sends: [] as iGraphSend[], subscribed: [] as string[] }
function startFakeGraph() {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (request.headers.get('authorization') !== `Bearer ${accessToken}`)
        return Response.json(
          { error: { message: 'Invalid OAuth access token.', code: 190 } },
          { status: 401 },
        )
      if (url.pathname === `/v23.0/${numberId}` && request.method === 'GET')
        return Response.json({
          display_phone_number: '+44 7700 900000',
          verified_name: 'Acme Dental',
          id: numberId,
        })
      if (url.pathname === `/v23.0/${businessAccountId}/subscribed_apps`) {
        graph.subscribed.push(request.method)
        return Response.json({ success: true })
      }
      if (url.pathname === `/v23.0/${numberId}/messages`) {
        const body = (await request.json()) as iGraphSend
        graph.sends.push({ ...body, at: Date.now() })
        return Response.json({
          messaging_product: 'whatsapp',
          messages: [{ id: `wamid.out.${graph.sends.length}` }],
        })
      }
      return Response.json(
        { error: { message: 'Unknown path', code: 100 } },
        { status: 400 },
      )
    },
  })
}

test('customer WhatsApp: signatures, inbound, one answer at a time, the 24-hour window, staff replies', async () => {
  const value = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !value ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname)
  )
    throw new Error('Requires local PostgreSQL')
  Object.assign(process.env, {
    NODE_ENV: 'test',
    OPENAI_API_KEY: 'fixture-key',
    WHATSAPP_APP_SECRET: appSecret,
    WHATSAPP_VERIFY_TOKEN: verifyToken,
  })
  const fakeGraph = startFakeGraph()
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
  const { customerWhatsappConfig } =
    await import('../../src/config/customerWhatsapp.config')
  customerWhatsappConfig.graphApiUrl = `http://127.0.0.1:${fakeGraph.port}/v23.0`
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
    connection,
    contact,
    contactIdentity,
    conversation,
    member,
    message,
    organization,
  } = await import('../../src/db/schema')
  const { runTeamChatJob } = await import('../../src/services/teamChat/job')
  const { getBoss } = await import('../../src/services/queue/boss')
  const boss = await getBoss()

  // Jobs are collected instead of queued, and run here.
  const jobs: Array<{ name: string; data: Record<string, string> }> = []
  const realSend = boss.send
  boss.send = (async (name: string, data: Record<string, string>) => {
    jobs.push({ name, data })
    return crypto.randomUUID()
  }) as typeof boss.send
  const takeJobs = () => {
    const taken = jobs.filter((job) => job.name === 'team-chat')
    for (const job of taken) jobs.splice(jobs.indexOf(job), 1)
    return taken
  }
  const runJobs = async () => {
    for (const job of takeJobs()) await runTeamChatJob(job.data as never)
  }

  const org = crypto.randomUUID()
  await db
    .insert(organization)
    .values({ id: org, name: 'Customer WhatsApp fixture', slug: org })
  for (const role of ['owner', 'member'] as const)
    await db.insert(member).values({
      id: crypto.randomUUID(),
      userId: credentials.accounts[role].userId,
      organizationId: org,
      role,
    })
  const [employee] = await db
    .insert(assistant)
    .values({ organizationId: org, name: 'Ava', status: 'published' })
    .returning()
  type tRole = 'owner' | 'member'
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

  // Signed like Meta does it.
  const toMeta = (body: string, secret = appSecret) =>
    fetch(`${origin}/api/connect/whatsapp_business/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
      },
      body,
    })
  let inboundNumber = 0
  const webhook = (value: Record<string, unknown>) =>
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: businessAccountId,
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: numberId },
                ...value,
              },
            },
          ],
        },
      ],
    })
  const customerSays = (
    text: string,
    extra: Record<string, unknown> = { type: 'text', text: { body: text } },
  ) =>
    webhook({
      contacts: [{ wa_id: customer, profile: { name: 'Sara Malik' } }],
      messages: [
        {
          from: customer,
          id: `wamid.in.${(inboundNumber += 1)}`,
          timestamp: String(Math.floor(Date.now() / 1000)),
          ...extra,
        },
      ],
    })
  const conversationOf = async () =>
    (
      await db
        .select()
        .from(conversation)
        .where(eq(conversation.assistantId, employee.id))
    )[0]

  try {
    // Connecting: owners and admins only, the token
    // checked with Meta and never shown again.
    const connectInput = {
      phoneNumberId: numberId,
      businessAccountId,
      accessToken,
      assistantId: employee.id,
    }
    assert.equal(
      (
        await request(
          'member',
          '/connections/whatsapp_business',
          'POST',
          connectInput,
        )
      ).status,
      403,
    )
    assert.equal(
      (
        await request('owner', '/connections/whatsapp_business', 'POST', {
          ...connectInput,
          accessToken: 'EAAG-wrong-token-0123456789',
        })
      ).status,
      422,
    )
    const connected = await json<iConnectionList>(
      await request(
        'owner',
        '/connections/whatsapp_business',
        'POST',
        connectInput,
      ),
      201,
    )
    assert.equal(connected.available.whatsappBusiness, true)
    assert.equal(connected.connections[0].phoneNumber, '+44 7700 900000')
    assert.equal(connected.connections[0].accountName, 'Acme Dental')
    assert(!JSON.stringify(connected).includes(accessToken))
    assert.deepEqual(graph.subscribed, ['POST'])
    const [record] = await db
      .select()
      .from(connection)
      .where(eq(connection.organizationId, org))
    assert(!record.credentialsEncrypted?.includes(accessToken))

    // Meta's webhook check answers only our verify token.
    const challenge = (token: string) =>
      fetch(
        `${origin}/api/connect/whatsapp_business/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=42`,
      )
    assert.equal((await challenge('wrong')).status, 403)
    assert.equal(await (await challenge(verifyToken)).text(), '42')

    // (1) Signatures: unsigned or signed with another secret is refused and
    // nothing is stored or queued.
    const probe = customerSays('Hello?')
    assert.equal((await toMeta(probe, 'not-our-secret')).status, 401)
    const unsigned = await fetch(
      `${origin}/api/connect/whatsapp_business/webhook`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: probe,
      },
    )
    assert.equal(unsigned.status, 401)
    assert.equal(takeJobs().length, 0)
    assert.equal(await conversationOf(), undefined)

    // (2) A message becomes a WhatsApp conversation with the AI team member, a
    // contact named from their profile with a whatsapp identity, and an
    // answer sent back as plain text. Meta redelivering it changes nothing.
    const hello = customerSays('Do you do whitening?')
    assert.equal((await toMeta(hello)).status, 200)
    assert.equal((await toMeta(hello)).status, 200)
    assert.equal(jobs.filter((job) => job.name === 'team-chat').length, 1)
    await runJobs()
    const chat = await conversationOf()
    assert.equal(chat.channel, 'whatsapp')
    assert.equal(chat.connectionId, record.id)
    assert.equal(chat.externalUserId, customer)
    const [person] = await db
      .select()
      .from(contact)
      .where(eq(contact.id, chat.contactId!))
    assert.equal(person.name, 'Sara Malik')
    const identities = await db
      .select()
      .from(contactIdentity)
      .where(eq(contactIdentity.contactId, person.id))
    assert.deepEqual(
      identities.map((item) => [item.kind, item.normalizedValue]),
      [['whatsapp', `+${customer}`]],
    )
    assert.equal(graph.sends.length, 1)
    assert.equal(graph.sends[0].to, customer)
    assert.equal(graph.sends[0].type, 'text')
    assert.equal(graph.sends[0].text?.body, 'Saved reply.')
    const delivered = webhook({
      statuses: [
        { id: 'wamid.out.1', status: 'delivered', recipient_id: customer },
      ],
    })
    await toMeta(delivered)
    await runJobs()
    const items = await json<iInboxItem[]>(
      await request('member', '/conversations?filter=all'),
    )
    assert.equal(items.find((item) => item.id === chat.id)?.channel, 'whatsapp')
    const detail = await json<iInboxConversation>(
      await request('member', `/conversations/${chat.id}`),
    )
    assert.deepEqual(
      detail.messages.map((item) => [item.role, item.deliveryStatus]),
      [
        ['visitor', null],
        ['assistant', 'delivered'],
      ],
    )

    // A photo is noted in words for the AI team member.
    await toMeta(
      customerSays('', { type: 'image', image: { caption: 'my tooth' } }),
    )
    await runJobs()
    const [photo] = await db
      .select({ content: message.content })
      .from(message)
      .where(
        and(
          eq(message.conversationId, chat.id),
          eq(message.externalId, `wamid.in.${inboundNumber}`),
        ),
      )
    assert.equal(photo.content, '[image] my tooth')

    // Quick replies go out as WhatsApp reply buttons, and a tap comes back
    // as the customer's message, reading as the option and carrying which
    // block it answered. A button id we never sent stays plain text.
    chatFixture.block = {
      kind: 'choices',
      options: [{ label: 'Morning' }, { label: 'Afternoon' }],
    }
    await toMeta(customerSays('When can I come in?'))
    await runJobs()
    chatFixture.block = undefined
    const buttons = graph.sends.at(-1)!
    assert.equal(buttons.type, 'interactive')
    assert.equal(buttons.interactive?.type, 'button')
    assert.equal(buttons.interactive?.body.text, 'Saved reply.')
    const [, afternoon] = buttons.interactive!.action.buttons
    assert.equal(afternoon.reply.title, 'Afternoon')
    const tap = (id: string, title: string) =>
      customerSays(title, {
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id, title } },
      })
    await toMeta(tap(afternoon.reply.id, 'Afternoon'))
    await toMeta(tap('wp:b_notOurBlock:0', 'Evening'))
    await runJobs()
    const taps = await db
      .select({ content: message.content, blockReply: message.blockReply })
      .from(message)
      .where(
        and(
          eq(message.conversationId, chat.id),
          inArray(message.externalId, [
            `wamid.in.${inboundNumber - 1}`,
            `wamid.in.${inboundNumber}`,
          ]),
        ),
      )
    const [blockId] = afternoon.reply.id.split(':').slice(1)
    assert.deepEqual(
      taps.find((item) => item.content === 'Afternoon')?.blockReply,
      { blockId, value: 'Afternoon' },
    )
    assert.equal(
      taps.find((item) => item.content === 'Evening')?.blockReply,
      null,
    )

    // (3) Two quick messages: their jobs overlap, but answers never do. One
    // answer covers both, or the second starts after the first was sent.
    const sendsBefore = graph.sends.length
    const modelStarts: Array<{ at: number; text: string }> = []
    chatFixture.delayMs = 300
    chatFixture.onRequest = (input) =>
      modelStarts.push({ at: Date.now(), text: JSON.stringify(input) })
    await toMeta(customerSays('How much is it?'))
    await toMeta(customerSays('And do you open Saturdays?'))
    await Promise.all(
      takeJobs().map((job) => runTeamChatJob(job.data as never)),
    )
    chatFixture.delayMs = 0
    chatFixture.onRequest = undefined
    const answers = graph.sends.slice(sendsBefore)
    assert(answers.length >= 1 && answers.length <= 2)
    assert.equal(modelStarts.length, answers.length)
    if (answers.length === 1)
      assert.match(modelStarts[0].text, /How much is it\?.*Saturdays/s)
    else assert(modelStarts[1].at >= answers[0].at)

    // (4) Staff replies go out through the Graph API under the team's
    // name; the AI team member then stays quiet.
    const staffSent = await json<{ deliveryStatus: string | null }>(
      await request('member', `/conversations/${chat.id}/messages`, 'POST', {
        content: 'Hi Sara, it’s £250. See you Saturday?',
      }),
      201,
    )
    assert.equal(staffSent.deliveryStatus, 'sent')
    assert.equal(
      graph.sends.at(-1)?.text?.body,
      'Hi Sara, it’s £250. See you Saturday?',
    )
    const sendsWithTeam = graph.sends.length
    await toMeta(customerSays('Yes please'))
    await runJobs()
    assert.equal(graph.sends.length, sendsWithTeam)
    assert.equal((await conversationOf()).handledBy, 'human')

    // (5) The 24-hour window: once the customer last wrote over a day ago,
    // no free text is sent. Without a template the reply is refused and kept
    // as the draft; with one, the template carries it.
    await db
      .update(message)
      .set({ createdAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(
        and(eq(message.conversationId, chat.id), eq(message.role, 'visitor')),
      )
    const late = await request(
      'member',
      `/conversations/${chat.id}/messages`,
      'POST',
      { content: 'Still keen?' },
    )
    assert.equal(late.status, 409)
    assert.equal(
      ((await late.json()) as { error: { code: string } }).error.code,
      'whatsapp_window_closed',
    )
    assert.equal(graph.sends.length, sendsWithTeam)
    assert.equal((await conversationOf()).handoffDraft, 'Still keen?')
    await json(
      await request('owner', `/connections/${record.id}`, 'PATCH', {
        templateName: 'reply_later',
        templateLanguage: 'en_GB',
      }),
    )
    await json(
      await request('member', `/conversations/${chat.id}/messages`, 'POST', {
        content: 'Still keen?\nWe have Saturday free.',
      }),
      201,
    )
    const templated = graph.sends.at(-1)!
    assert.equal(templated.type, 'template')
    assert.equal(templated.text, undefined)
    assert.equal(templated.template?.name, 'reply_later')
    assert.equal(
      templated.template?.components[0].parameters[0].text,
      'Still keen? We have Saturday free.',
    )
  } finally {
    boss.send = realSend
    chatFixture.delayMs = 0
    chatFixture.onRequest = undefined
    try {
      const chats = db
        .select({ id: conversation.id })
        .from(conversation)
        .where(eq(conversation.assistantId, employee.id))
      await db.delete(message).where(inArray(message.conversationId, chats))
      await db
        .delete(conversation)
        .where(eq(conversation.assistantId, employee.id))
      await db.delete(connection).where(eq(connection.organizationId, org))
    } catch (error) {
      console.error('Customer WhatsApp fixture cleanup failed', error)
    }
    server.stop(true)
    fakeGraph.stop(true)
    await boss.stop()
  }
}, 120_000)
