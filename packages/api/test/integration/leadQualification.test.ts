import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mock, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { startRolesProviders } from '../fixtures/rolesProviders'

// The fake model answers with whatever `verdict` holds and records what it read.
let verdict: Record<string, unknown> = {}
let failWith: unknown = null
let lastInput: {
  business: { about: string | null; idealCustomerProfile: string | null }
  messages: Array<{ role: string; text: string }>
} | null = null
mock.module('../../src/services/ai/openAi', () => ({
  getOpenAi: () => ({
    responses: {
      parse: async ({ input }: { input: string }) => {
        if (failWith) throw failWith
        lastInput = JSON.parse(input)
        return {
          model: 'gpt-5.6-luna',
          output_parsed: verdict,
          usage: { input_tokens: 10, output_tokens: 5 },
        }
      },
    },
  }),
}))

test('lead qualification: scores a lead, stores it once, and the ideal customer profile over HTTP', async () => {
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
  const {
    aiUsageEvent,
    assistant,
    contact,
    conversation,
    lead,
    leadActivity,
    leadConversation,
    member,
    message,
    organization,
  } = await import('../../src/db/schema')
  const { LeadQualificationError, qualifyLead } =
    await import('../../src/services/leads/qualify')

  const org = crypto.randomUUID()
  await db.insert(organization).values({
    id: org,
    name: 'Qualification fixture',
    slug: org,
    businessAbout: 'We build websites for independent bakeries.',
  })
  for (const role of ['owner', 'admin', 'member'] as const)
    await db.insert(member).values({
      id: crypto.randomUUID(),
      userId: credentials.accounts[role].userId,
      organizationId: org,
      role,
    })
  const [bot] = await db
    .insert(assistant)
    .values({ organizationId: org, name: 'Qualification bot' })
    .returning()

  type tRole = 'owner' | 'admin' | 'member' | 'outsider'
  const request = (role: tRole, method = 'GET', body?: unknown) =>
    fetch(`${origin}/api/organizations/${org}/workspace`, {
      method,
      headers: {
        Cookie: credentials.accounts[role].cookie,
        Origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  try {
    // The ideal customer profile is a workspace field, edited like the business ones.
    const profile =
      'Independent bakeries in the UK that need a new website soon.'
    assert.equal(
      (await request('member', 'PATCH', { idealCustomerProfile: profile }))
        .status,
      403,
    )
    assert.equal(
      (
        await request('admin', 'PATCH', {
          idealCustomerProfile: 'x'.repeat(2001),
        })
      ).status >= 400,
      true,
    )
    const saved = await request('admin', 'PATCH', {
      idealCustomerProfile: `  ${profile}  `,
    })
    assert.equal(saved.status, 200, await saved.clone().text())
    assert.equal(
      ((await saved.json()) as { idealCustomerProfile: string })
        .idealCustomerProfile,
      profile,
    )
    const read = (await (await request('member')).json()) as {
      idealCustomerProfile: string | null
    }
    assert.equal(read.idealCustomerProfile, profile)

    // A chat lead.
    const [person] = await db
      .insert(contact)
      .values({ organizationId: org, name: 'Ana', email: 'ana@bakery.example' })
      .returning()
    const [record] = await db
      .insert(lead)
      .values({
        organizationId: org,
        assistantId: bot.id,
        contactId: person.id,
        title: 'Bakery website',
        capturedVia: 'chat',
      })
      .returning()
    const [chat] = await db
      .insert(conversation)
      .values({
        assistantId: bot.id,
        contactId: person.id,
        resumeTokenHash: crypto.randomUUID(),
      })
      .returning()
    await db
      .insert(leadConversation)
      .values({ leadId: record.id, conversationId: chat.id })
    const start = Date.parse('2026-10-09T09:00:00Z')
    await db.insert(message).values([
      ...Array.from({ length: 24 }, (_, index) => ({
        conversationId: chat.id,
        role: index % 2 ? ('assistant' as const) : ('visitor' as const),
        content: `message ${index}`,
        createdAt: new Date(start + index * 1000),
      })),
      {
        conversationId: chat.id,
        role: 'tool' as const,
        content: '"lead-id"',
        createdAt: new Date(start + 30_000),
      },
    ])

    const activities = () =>
      db
        .select()
        .from(leadActivity)
        .where(
          and(
            eq(leadActivity.leadId, record.id),
            eq(leadActivity.kind, 'qualified'),
          ),
        )
    const stored = async () =>
      (await db.select().from(lead).where(eq(lead.id, record.id)))[0]

    // A model failure writes nothing and says whether to retry.
    failWith = Object.assign(new Error('busy'), { status: 429 })
    const busy = await qualifyLead(record.id, { maxRetries: 0 }).catch(
      (error: unknown) => error,
    )
    assert(busy instanceof LeadQualificationError)
    assert.equal(busy.retryable, true)
    assert.equal((await stored()).score, null)
    assert.equal((await activities()).length, 0)
    failWith = null

    verdict = {
      intent: 'buy',
      fit: 'strong',
      urgency: 'now',
      score: 82,
      summary: 'Ana wants a new bakery website.',
      reasoning: 'A UK bakery ready to start, as the profile asks.',
    }
    const result = await qualifyLead(record.id)
    assert.equal(result?.score, 82)
    assert.equal(lastInput?.business.idealCustomerProfile, profile)
    assert.equal(
      lastInput?.business.about,
      'We build websites for independent bakeries.',
    )
    // The last 20 visitor and bot messages, oldest first; tool rows excluded.
    assert.equal(lastInput?.messages.length, 20)
    assert.equal(lastInput?.messages[0].text, 'message 4')
    assert.equal(lastInput?.messages[19].text, 'message 23')
    assert.deepEqual(
      [...new Set(lastInput?.messages.map((item) => item.role))].sort(),
      ['bot', 'visitor'],
    )
    const scored = await stored()
    assert.equal(scored.intent, 'buy')
    assert.equal(scored.score, 82)
    assert.equal(scored.qualification?.fit, 'strong')
    assert.equal(scored.qualification?.urgency, 'now')
    assert.equal(scored.qualification?.model, 'gpt-5.6-luna')
    let timeline = await activities()
    assert.equal(timeline.length, 1)
    assert.equal(timeline[0].title, 'Scored 82 · strong fit · wants to buy')
    assert.equal(timeline[0].detail?.reasoning, verdict.reasoning)
    const usage = await db
      .select()
      .from(aiUsageEvent)
      .where(
        and(
          eq(aiUsageEvent.organizationId, org),
          eq(aiUsageEvent.kind, 'leadQualification'),
        ),
      )
    assert.equal(usage.length, 1)
    assert.equal(usage[0].assistantId, bot.id)

    // The same judgement again replaces the values but adds no entry.
    verdict = { ...verdict, summary: 'Ana, a bakery owner, wants a website.' }
    await qualifyLead(record.id)
    assert.equal((await stored()).qualification?.summary, verdict.summary)
    assert.equal((await activities()).length, 1)

    // A changed judgement adds one.
    verdict = { ...verdict, score: 64, urgency: 'soon' }
    await qualifyLead(record.id)
    timeline = await activities()
    assert.equal(timeline.length, 2)
    assert.equal((await stored()).score, 64)

    // Missing and merged leads are left alone.
    assert.equal(await qualifyLead(crypto.randomUUID()), null)
    const [other] = await db
      .insert(lead)
      .values({
        organizationId: org,
        assistantId: bot.id,
        contactId: person.id,
        title: 'Duplicate',
        capturedVia: 'manual',
        mergedIntoLeadId: record.id,
      })
      .returning()
    assert.equal(await qualifyLead(other.id), null)
    assert.equal((await stored()).score, 64)
  } finally {
    await db
      .update(lead)
      .set({ mergedIntoLeadId: null })
      .where(eq(lead.organizationId, org))
    await db.delete(lead).where(eq(lead.organizationId, org))
    server.stop(true)
    providers.server.stop(true)
  }
}, 60_000)
