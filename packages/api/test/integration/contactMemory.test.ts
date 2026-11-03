import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mock, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { startRolesProviders } from '../fixtures/rolesProviders'
import type { iContactFact } from '../../src/types/contact.types'

// The fake model proposes whatever `proposal` holds and records what it read.
let proposal: string[] = []
let calls = 0
let lastInput: {
  knownFacts: string[]
  deals: Array<{ title: string }>
} | null = null
mock.module('../../src/services/ai/openAi', () => ({
  getOpenAi: () => ({
    responses: {
      parse: async ({ input }: { input: string }) => {
        calls++
        lastInput = JSON.parse(input)
        return {
          model: 'gpt-5.6-luna',
          output_parsed: { facts: proposal },
          usage: { input_tokens: 10, output_tokens: 5 },
        }
      },
    },
  }),
}))

test('contact memory: facts from an ended conversation, once, owner-facing over HTTP', async () => {
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
    contactFact,
    conversation,
    lead,
    leadContact,
    member,
    message,
    organization,
  } = await import('../../src/db/schema')
  const { contactMemory } = await import('../../src/config/contacts.config')
  const { extractConversationFacts } =
    await import('../../src/services/contacts/memory')
  const { loadLeadView, leadSummaryLines } =
    await import('../../src/services/leads/leadView')

  const org = crypto.randomUUID()
  await db
    .insert(organization)
    .values({ id: org, name: 'Memory fixture', slug: org })
  for (const role of ['owner', 'admin', 'member'] as const)
    await db.insert(member).values({
      id: crypto.randomUUID(),
      userId: credentials.accounts[role].userId,
      organizationId: org,
      role,
    })
  const [bot] = await db
    .insert(assistant)
    .values({ organizationId: org, name: 'Memory bot' })
    .returning()
  const request = (
    role: 'owner' | 'member' | 'outsider',
    path: string,
    method = 'GET',
  ) =>
    fetch(`${origin}/api/organizations/${org}${path}`, {
      method,
      headers: {
        Cookie: credentials.accounts[role].cookie,
        Origin: 'http://localhost:3000',
      },
    })
  const agentFacts = async (contactId: string) =>
    db
      .select()
      .from(contactFact)
      .where(
        and(
          eq(contactFact.contactId, contactId),
          eq(contactFact.source, 'agent'),
        ),
      )

  try {
    const [person] = await db
      .insert(contact)
      .values({
        organizationId: org,
        name: 'Sara',
        email: 'sara@memory.example',
      })
      .returning()
    const [deal] = await db
      .insert(lead)
      .values({
        organizationId: org,
        assistantId: bot.id,
        contactId: person.id,
        title: 'Kitchen refit',
        capturedVia: 'chat',
      })
      .returning()
    await db
      .insert(leadContact)
      .values({ leadId: deal.id, contactId: person.id, role: 'requester' })
    await db.insert(contactFact).values({
      organizationId: org,
      contactId: person.id,
      text: 'Prefers calls after 6pm.',
      source: 'member',
    })
    // A conversation that ended at `closedAt`, with one visitor message.
    async function endedChat(options: { isTest?: boolean } = {}) {
      const closedAt = new Date()
      const lastMessageAt = new Date(closedAt.getTime() - 60_000)
      const [chat] = await db
        .insert(conversation)
        .values({
          assistantId: bot.id,
          contactId: person.id,
          resumeTokenHash: crypto.randomUUID(),
          status: 'closed',
          closedAt,
          lastMessageAt,
          isTest: options.isTest ?? false,
        })
        .returning()
      await db.insert(message).values({
        conversationId: chat.id,
        role: 'visitor',
        content: 'My husband Tom decides on the budget.',
        createdAt: lastMessageAt,
      })
      return { chat, closedAt: closedAt.toISOString() }
    }

    // One end is extracted once: a repeat of the job stores nothing more.
    proposal = ['prefers calls after 6PM', 'Husband Tom decides on budget.']
    const first = await endedChat()
    const stored = await extractConversationFacts(first.chat.id, first.closedAt)
    assert.deepEqual(
      stored.map((fact) => fact.text),
      ['Husband Tom decides on budget.'],
    )
    assert.equal(stored[0].conversationId, first.chat.id)
    assert.deepEqual(lastInput?.knownFacts, ['Prefers calls after 6pm.'])
    assert.equal(lastInput?.deals[0].title, 'Kitchen refit')
    const before = calls
    assert.deepEqual(
      await extractConversationFacts(first.chat.id, first.closedAt),
      [],
    )
    assert.equal(calls, before)
    assert.equal((await agentFacts(person.id)).length, 1)
    const usage = await db
      .select()
      .from(aiUsageEvent)
      .where(
        and(
          eq(aiUsageEvent.organizationId, org),
          eq(aiUsageEvent.kind, 'contactFacts'),
        ),
      )
    assert.equal(usage.length, 1)

    // Reopened and ended again after new messages: runs again, no duplicates.
    const reopenedAt = new Date()
    await db.insert(message).values({
      conversationId: first.chat.id,
      role: 'visitor',
      content: 'We also have two dogs.',
      createdAt: reopenedAt,
    })
    const closedAgain = new Date(reopenedAt.getTime() + 1000)
    await db
      .update(conversation)
      .set({ lastMessageAt: reopenedAt, closedAt: closedAgain })
      .where(eq(conversation.id, first.chat.id))
    proposal = ['Husband Tom decides on budget!', 'Has two dogs.']
    // The earlier end no longer matches the conversation and is ignored.
    assert.deepEqual(
      await extractConversationFacts(first.chat.id, first.closedAt),
      [],
    )
    const again = await extractConversationFacts(
      first.chat.id,
      closedAgain.toISOString(),
    )
    assert.deepEqual(
      again.map((fact) => fact.text),
      ['Has two dogs.'],
    )

    // Test chats and full memories are skipped without a model call.
    const callsBefore = calls
    const test = await endedChat({ isTest: true })
    assert.deepEqual(
      await extractConversationFacts(test.chat.id, test.closedAt),
      [],
    )
    await db.insert(contactFact).values(
      Array.from({ length: contactMemory.maxFactsPerContact }, (_, index) => ({
        organizationId: org,
        contactId: person.id,
        text: `Filler ${index}`,
        source: 'member' as const,
      })),
    )
    const full = await endedChat()
    proposal = ['Lives in Leeds.']
    assert.deepEqual(
      await extractConversationFacts(full.chat.id, full.closedAt),
      [],
    )
    assert.equal(calls, callsBefore)
    await db
      .delete(contactFact)
      .where(
        and(
          eq(contactFact.contactId, person.id),
          eq(contactFact.source, 'member'),
        ),
      )

    // Owner-facing: the contact's facts reach owner summaries and the routes.
    const view = await loadLeadView(deal.id)
    assert.ok(view)
    assert.ok(view.contactFacts.includes('Has two dogs.'))
    assert.ok(leadSummaryLines(view).includes('- Has two dogs.'))
    const listed = await request('member', `/contacts/${person.id}/facts`)
    assert.equal(listed.status, 200)
    const facts = (await listed.json()) as iContactFact[]
    assert.deepEqual(facts.map((fact) => fact.source).sort(), [
      'agent',
      'agent',
    ])
    assert.equal(
      (await request('outsider', `/contacts/${person.id}/facts`)).status,
      403,
    )
  } finally {
    await db.delete(lead).where(eq(lead.organizationId, org))
    server.stop(true)
    providers.server.stop(true)
  }
}, 60_000)
