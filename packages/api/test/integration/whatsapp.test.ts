import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mock, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { startRolesProviders } from '../fixtures/rolesProviders'
import type { iLeadActivityList } from '../../src/types/lead.types'
import type { iWhatsappAgents } from '../../src/types/whatsapp.types'

// Every email is recorded here instead of reaching Resend.
interface iSentEmail {
  to: string[]
  subject: string
  text: string
}
const sent: iSentEmail[] = []
mock.module('resend', () => ({
  Resend: class {
    emails = {
      send: async (message: iSentEmail) => {
        sent.push(message)
        return { data: { id: crypto.randomUUID() }, error: null }
      },
    }
  },
}))

// The fake model: every lead scores 82.
mock.module('../../src/services/ai/openAi', () => ({
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
      parse: async ({ text }: { text: { format: { name: string } } }) => {
        let value: Record<string, unknown>
        if (text.format.name === 'leadQualification')
          value = {
            intent: 'buy',
            fit: 'strong',
            urgency: 'now',
            score: 82,
            summary: 'Wants a new website soon.',
            reasoning: 'Ready to buy.',
          }
        else value = {}
        return {
          model: 'gpt-5.6-terra',
          output_parsed: value,
          usage: { input_tokens: 10, output_tokens: 5 },
        }
      },
    },
  }),
}))

// A fake WhatsApp Agent Platform: one agent (its key is `goodKey`) whose
// creator is user:4471. Updates are numbered; GET /updates returns those at
// or after the offset, or 204.
const goodKey = 'wa-agent-key-0123456789'
const ownerId = 'user:4471'
interface iFakeInbound {
  from: string
  id: string
  timestamp: string
  type: string
  text: { body: string }
  context?: { id: string; from: string }
}
const whatsapp = {
  revoked: false,
  outbox: [] as Array<{ id: string; to: string; body: string }>,
  updates: [] as iFakeInbound[],
  polls: 0,
}
function startFakeWhatsapp() {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const auth = request.headers.get('authorization')
      if (auth !== `Bearer ${goodKey}` || whatsapp.revoked)
        return Response.json(
          { error: { message: 'Invalid token', code: 190 } },
          { status: 401 },
        )
      if (url.pathname === '/agent/v1/messages' && request.method === 'POST') {
        const body = (await request.json()) as {
          to: string
          text: { body: string }
        }
        if (body.to !== ownerId)
          return Response.json(
            { error: { message: 'Not the creator', code: 131005 } },
            { status: 403 },
          )
        const id = `wamid.out.${whatsapp.outbox.length + 1}`
        whatsapp.outbox.push({ id, to: body.to, body: body.text.body })
        return Response.json({ messages: [{ id }] })
      }
      if (url.pathname === '/agent/v1/updates') {
        whatsapp.polls += 1
        const offset = Number(url.searchParams.get('offset') ?? 0)
        const fresh = whatsapp.updates.slice(offset)
        if (!fresh.length) return new Response(null, { status: 204 })
        return Response.json({
          entry: [{ changes: [{ value: { messages: fresh } }] }],
          next_offset: whatsapp.updates.length,
        })
      }
      return new Response('Not found', { status: 404 })
    },
  })
}

// The owner writes to the agent, optionally quoting an alert.
function ownerSays(
  body: string,
  options: { quote?: string; ageMs?: number } = {},
) {
  whatsapp.updates.push({
    from: ownerId,
    id: `wamid.in.${whatsapp.updates.length + 1}`,
    timestamp: String(Math.floor((Date.now() - (options.ageMs ?? 0)) / 1000)),
    type: 'text',
    text: { body },
    ...(options.quote ? { context: { id: options.quote, from: ownerId } } : {}),
  })
}

test('WhatsApp owner alerts: link, lead alerts, free text, broken key', async () => {
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
  const fake = startFakeWhatsapp()
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
  const { whatsappConfig } = await import('../../src/config/whatsapp.config')
  Object.assign(whatsappConfig, {
    apiUrl: `http://127.0.0.1:${fake.port}/agent/v1`,
    sendSpacingMs: 0,
    pollSpacingMs: 0,
  })
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
  const {
    aiUsageEvent,
    assistant,
    conversation,
    lead,
    member,
    message,
    organization,
    user,
    whatsappAgent,
    whatsappMessage,
  } = await import('../../src/db/schema')
  const { handleLeadCaptured } =
    await import('../../src/services/leads/captured')
  const { pollWhatsapp } = await import('../../src/services/whatsapp/poller')
  const { getBoss } = await import('../../src/services/queue/boss')
  const boss = await getBoss()

  // Jobs are collected instead of queued and run here, in process.
  interface iJob {
    name: string
    data: Record<string, string>
    dueAt: number
  }
  const jobs: iJob[] = []
  const realSend = boss.send
  boss.send = (async (
    name: string,
    data: Record<string, string>,
    options?: { startAfter?: number | Date },
  ) => {
    const after = options?.startAfter
    jobs.push({
      name,
      data,
      dueAt:
        after instanceof Date
          ? after.getTime()
          : Date.now() + (after ?? 0) * 1000,
    })
    return crypto.randomUUID()
  }) as typeof boss.send
  async function drain() {
    for (let round = 0; round < 200; round += 1) {
      const due = jobs.filter(
        (job) => job.name === 'lead-captured' && job.dueAt <= Date.now(),
      )
      if (!due.length) return
      for (const job of due) {
        jobs.splice(jobs.indexOf(job), 1)
        await handleLeadCaptured(job.data.leadId)
      }
    }
  }

  const org = crypto.randomUUID()
  await db
    .insert(organization)
    .values({ id: org, name: 'WhatsApp fixture', slug: org })
  const memberIds = {
    owner: crypto.randomUUID(),
    admin: crypto.randomUUID(),
    member: crypto.randomUUID(),
  }
  for (const role of ['owner', 'admin', 'member'] as const)
    await db.insert(member).values({
      id: memberIds[role],
      userId: credentials.accounts[role].userId,
      organizationId: org,
      role,
    })
  const [owner] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, credentials.accounts.owner.userId))
  const widgetOrigin = 'https://whatsapp.example'
  const [bot] = await db
    .insert(assistant)
    .values({
      organizationId: org,
      name: 'Ava',
      status: 'published',
      goal: 'both',
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
  const { captureChatLead } = await import('../../src/services/leads/capture')
  // A visitor gives their name and email in a website chat.
  async function capture(name: string, email: string) {
    const [chat] = await db
      .insert(conversation)
      .values({ assistantId: bot.id, resumeTokenHash: crypto.randomUUID() })
      .returning()
    await db.insert(message).values({
      conversationId: chat.id,
      role: 'visitor',
      content: `${name} ${email}`,
    })
    const captured = await captureChatLead(
      bot.id,
      chat.id,
      crypto.randomUUID(),
      { title: 'Website enquiry', name, email },
      AbortSignal.timeout(30_000),
    )
    return captured.lead.id
  }
  const timeline = async (leadId: string) =>
    (
      await json<iLeadActivityList>(
        await request('member', `/leads/${leadId}/activity`),
      )
    ).activities
  const emailsTo = (address: string) =>
    sent.filter((item) => item.to.includes(address))
  // One poll round, as the worker's job would run it.
  let agentId = 'none'
  const poll = () => pollWhatsapp(agentId, { durationMs: 0 })
  // Free text waits for the owner assistant in a team-chat job.
  const queuedTurns = () =>
    jobs.filter(
      (job) => job.name === 'team-chat' && job.data.agentId === agentId,
    ).length
  const lastOut = () => whatsapp.outbox.at(-1)!
  const agentRow = async () =>
    (
      await db
        .select()
        .from(whatsappAgent)
        .where(eq(whatsappAgent.organizationId, org))
    )[0]
  const alertFor = async (leadId: string) =>
    (
      await db
        .select()
        .from(whatsappMessage)
        .where(
          and(
            eq(whatsappMessage.leadId, leadId),
            eq(whatsappMessage.kind, 'lead_alert'),
          ),
        )
    )[0]

  try {
    // Every member links their own agents; outsiders can't see any.
    assert.equal((await request('outsider', '/whatsapp')).status, 403)
    assert.deepEqual(await json(await request('member', '/whatsapp')), {
      agents: [],
      limit: 5,
    })

    // A key WhatsApp refuses isn't stored.
    const refused = await request('owner', '/whatsapp', 'POST', {
      token: 'not-the-agent-key',
      assistantId: bot.id,
    })
    assert.equal(refused.status, 422)
    assert.equal(await agentRow(), undefined)

    // (1) Connect: the key is checked, stored encrypted, never returned, and
    // a poll job is queued; then we wait for the owner's hi.
    const connected = await json<iWhatsappAgents>(
      await request('owner', '/whatsapp', 'POST', {
        token: goodKey,
      }),
    )
    assert.equal(connected.agents[0].status, 'waiting_for_hi')
    assert.equal(connected.agents[0].mine, true)
    assert(!JSON.stringify(connected).includes(goodKey))
    const stored = await agentRow()
    agentId = stored.id
    assert(!stored.tokenEncrypted.includes(goodKey))
    assert.equal(stored.connectedByMemberId, memberIds.owner)
    assert(
      jobs.some(
        (job) => job.name === 'whatsapp-poll' && job.data.agentId === agentId,
      ),
    )
    // A member sees only their own; the admin sees the owner's.
    assert.equal(
      (await json<iWhatsappAgents>(await request('member', '/whatsapp'))).agents
        .length,
      0,
    )
    const forAdmin = await json<iWhatsappAgents>(
      await request('admin', '/whatsapp'),
    )
    assert.equal(forAdmin.agents[0]?.mine, false)
    // The same agent can't be linked twice.
    assert.equal(
      (
        await request('admin', '/whatsapp', 'POST', {
          token: goodKey,
          assistantId: bot.id,
        })
      ).status,
      409,
    )
    const shown = await request('owner', '/whatsapp')
    assert(!(await shown.clone().text()).includes(goodKey))

    // The first inbound message links the owner and gets "Connected".
    ownerSays('hi')
    assert.equal(await poll(), 'continue')
    const [linked] = (
      await json<iWhatsappAgents>(await request('owner', '/whatsapp'))
    ).agents
    assert.equal(linked.status, 'linked')
    assert(linked.linkedAt)
    assert.equal(lastOut().to, ownerId)
    assert.match(lastOut().body, /^Connected\./)
    assert.equal((await agentRow()).pollOffset, '1')

    // (2) A new lead is alerted on WhatsApp, which replaces the owner's
    // email, and the timeline says so.
    const ownerEmails = emailsTo(owner.email).length
    const ana = await capture('Ana Baker', 'ana@wa.example')
    await drain()
    const anaAlert = await alertFor(ana)
    assert(anaAlert?.waMessageId)
    const anaText = whatsapp.outbox.find(
      (item) => item.id === anaAlert.waMessageId,
    )!.body
    assert.match(anaText, /^New lead: Ana Baker \(ana@wa\.example\)/)
    assert.match(anaText, /Scored 82 · strong fit · wants to buy/)
    assert.match(anaText, new RegExp(`Open it: .*/leads/${ana}$`))
    assert.equal(emailsTo(owner.email).length, ownerEmails, 'No email')
    const notified = (await timeline(ana)).find(
      (item) => item.kind === 'owner_notified',
    )
    assert.equal(notified?.title, 'Told you on WhatsApp')

    // (3) Messages go to the owner assistant (a team-chat job), quoting an
    // alert or not; stale messages are ignored.
    const outBeforeText = whatsapp.outbox.length
    const turnsBefore = queuedTurns()
    ownerSays('ok', { quote: anaAlert.waMessageId })
    await poll()
    ownerSays('send')
    await poll()
    assert.equal(queuedTurns(), turnsBefore + 2)
    assert.equal(whatsapp.outbox.length, outBeforeText)
    ownerSays('status', { ageMs: 16 * 60_000 })
    await poll()
    assert.equal(queuedTurns(), turnsBefore + 2, 'Stale messages are ignored')
    assert.equal(whatsapp.outbox.length, outBeforeText)

    // (4) A revoked key: the alert falls back to email and the agent shows
    // as broken; polling stops.
    whatsapp.revoked = true
    const emailsBefore = emailsTo(owner.email).length
    const finn = await capture('Finn Gray', 'finn@wa.example')
    await drain()
    // The alert by email, and once, that WhatsApp stopped working.
    assert.equal(emailsTo(owner.email).length, emailsBefore + 2)
    assert.equal(
      emailsTo(owner.email).filter(
        (item) => item.subject === 'WhatsApp stopped working',
      ).length,
      1,
    )
    const fellBack = (await timeline(finn)).find(
      (item) => item.kind === 'owner_notified',
    )
    assert.equal(fellBack?.title, 'Told you by email')
    const [broken] = (
      await json<iWhatsappAgents>(await request('owner', '/whatsapp'))
    ).agents
    assert.equal(broken.status, 'broken')
    assert.match(broken.lastError ?? '', /no longer accepts/)
    assert.equal(await poll(), 'stop')

    // Pasting the key again starts over; disconnecting forgets the key.
    whatsapp.revoked = false
    const again = await json<iWhatsappAgents>(
      await request('owner', '/whatsapp', 'POST', {
        token: goodKey,
      }),
    )
    assert.equal(again.agents.length, 1)
    assert.equal(again.agents[0].status, 'waiting_for_hi')
    assert.equal(
      (await request('member', `/whatsapp/${agentId}`, 'DELETE')).status,
      404,
    )
    assert.equal(
      (await request('owner', `/whatsapp/${agentId}`, 'DELETE')).status,
      204,
    )
    assert.equal(await agentRow(), undefined)
    assert.equal(await poll(), 'stop')
  } finally {
    boss.send = realSend
    await db
      .delete(whatsappMessage)
      .where(eq(whatsappMessage.organizationId, org))
    await db.delete(whatsappAgent).where(eq(whatsappAgent.organizationId, org))
    await db.delete(lead).where(eq(lead.organizationId, org))
    await db.delete(conversation).where(eq(conversation.assistantId, bot.id))
    await db.delete(aiUsageEvent).where(eq(aiUsageEvent.organizationId, org))
    server.stop(true)
    fake.stop(true)
    providers.server.stop(true)
    await boss.stop()
  }
}, 90_000)
