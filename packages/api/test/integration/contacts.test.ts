import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { startRolesProviders } from '../fixtures/rolesProviders'
import type {
  iContactDetail,
  iContactIdentity,
  iContactListItem,
  iIdentityTakenError,
  iLeadContact,
} from '../../src/types/contact.types'

test('contacts: identities, merges and lead contacts over HTTP', async () => {
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
    assistant,
    contact,
    conversation,
    lead,
    member,
    message,
    organization,
  } = await import('../../src/db/schema')
  // Captures are checked here; their follow-up jobs aren't queued.
  const { getBoss } = await import('../../src/services/queue/boss')
  const boss = await getBoss()
  const realSend = boss.send
  boss.send = (async () => crypto.randomUUID()) as typeof boss.send

  const org = crypto.randomUUID()
  await db
    .insert(organization)
    .values({ id: org, name: 'Contacts fixture', slug: org })
  for (const role of ['owner', 'admin', 'member'] as const)
    await db.insert(member).values({
      id: crypto.randomUUID(),
      userId: credentials.accounts[role].userId,
      organizationId: org,
      role,
    })
  const widgetOrigin = 'https://contacts.example'
  const [bot] = await db
    .insert(assistant)
    .values({
      organizationId: org,
      name: 'Ava',
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
  const { captureChatLead } = await import('../../src/services/leads/capture')
  // A visitor gives their details in a website chat; returns the new lead.
  async function capture(answers: Record<string, string>) {
    const [chat] = await db
      .insert(conversation)
      .values({ assistantId: bot.id, resumeTokenHash: crypto.randomUUID() })
      .returning()
    await db.insert(message).values({
      conversationId: chat.id,
      role: 'visitor',
      content: Object.values(answers).join(' '),
    })
    const captured = await captureChatLead(
      bot.id,
      chat.id,
      crypto.randomUUID(),
      { title: 'Website enquiry', ...answers },
      AbortSignal.timeout(30_000),
    )
    return { leadId: captured.lead.id, contactId: captured.lead.contactId }
  }
  const tag = crypto.randomUUID().slice(0, 8)
  const anaEmail = `ana-${tag}@contacts.example`
  const anaWork = `ana-${tag}@work.example`
  const anaPhone = `+4477${Date.now().toString().slice(-8)}`

  try {
    // A capture makes a contact with an identity for each detail and a
    // requester row on the lead.
    const first = await capture({
      name: 'Ana Silva',
      email: anaEmail,
      phone: anaPhone,
    })
    const ana = first.contactId
    let detail = await json<iContactDetail>(
      await request('member', `/contacts/${ana}`),
    )
    assert.deepEqual(
      detail.identities.map((item) => [item.kind, item.normalizedValue]).sort(),
      [
        ['email', anaEmail],
        ['phone', anaPhone],
      ],
    )
    assert.deepEqual(
      detail.deals.map((deal) => [deal.id, deal.role, deal.isOpen]),
      [[first.leadId, 'requester', true]],
    )
    assert.equal((await request('outsider', `/contacts/${ana}`)).status, 403)

    // A second email; adding it again is a no-op.
    const work = await json<iContactIdentity>(
      await request('member', `/contacts/${ana}/identities`, 'POST', {
        kind: 'email',
        value: ` ${anaWork.toUpperCase()} `,
      }),
      201,
    )
    assert.equal(work.normalizedValue, anaWork)
    assert.equal(work.source, 'manual')
    await json(
      await request('member', `/contacts/${ana}/identities`, 'POST', {
        kind: 'email',
        value: anaWork,
      }),
    )

    // Capture matches through any identity: the secondary email links Ana.
    const second = await capture({ email: anaWork.toUpperCase() })
    assert.equal(second.contactId, ana)
    const [listed] = await json<iContactListItem[]>(
      await request('member', `/contacts?q=${encodeURIComponent(anaWork)}`),
    )
    assert.equal(listed.id, ana)
    assert.equal(listed.openDealCount, 2)
    assert.deepEqual(listed.identityKinds, ['email', 'phone'])
    assert(listed.lastActivityAt)

    // Another contact can't take Ana's email or number (as WhatsApp either).
    const ben = await capture({
      name: 'Ben',
      email: `ben-${tag}@contacts.example`,
    })
    for (const body of [
      { kind: 'email', value: anaEmail },
      { kind: 'whatsapp', value: anaPhone.replace(/(\d{4})$/, ' $1') },
    ]) {
      const taken = await json<iIdentityTakenError>(
        await request(
          'member',
          `/contacts/${ben.contactId}/identities`,
          'POST',
          body,
        ),
        409,
      )
      assert.equal(taken.error.code, 'identity_taken')
      assert.equal(taken.error.contactId, ana)
      assert.equal(taken.error.contactName, 'Ana Silva')
    }
    assert.equal(
      (
        await request(
          'member',
          `/contacts/${ben.contactId}/identities`,
          'POST',
          {
            kind: 'phone',
            value: '07700 900000',
          },
        )
      ).status,
      422,
      'Phones need international format',
    )

    // People on a lead: the requester is fixed, others join with a role.
    let people = await json<iLeadContact[]>(
      await request('member', `/leads/${first.leadId}/contacts`, 'POST', {
        contactId: ben.contactId,
        role: 'decision_maker',
      }),
      201,
    )
    assert.deepEqual(
      people.map((person) => [person.id, person.role]),
      [
        [ana, 'requester'],
        [ben.contactId, 'decision_maker'],
      ],
    )
    assert.equal(
      (
        await request('member', `/leads/${first.leadId}/contacts`, 'POST', {
          contactId: ben.contactId,
          role: 'billing',
        })
      ).status,
      409,
    )
    assert.equal(
      (
        await request(
          'member',
          `/leads/${first.leadId}/contacts/${ana}`,
          'DELETE',
        )
      ).status,
      422,
      'The requester cannot be removed',
    )
    assert.equal(
      (
        await request(
          'member',
          `/leads/${first.leadId}/contacts/${ana}`,
          'PATCH',
          {
            role: 'billing',
          },
        )
      ).status,
      422,
    )
    people = await json<iLeadContact[]>(
      await request(
        'member',
        `/leads/${first.leadId}/contacts/${ben.contactId}`,
        'PATCH',
        { role: 'billing' },
      ),
    )
    assert.equal(people[1].role, 'billing')
    const leadDetail = await json<{ contacts: iLeadContact[] }>(
      await request('member', `/leads/${first.leadId}`),
    )
    assert.deepEqual(
      leadDetail.contacts.map((person) => person.role),
      ['requester', 'billing'],
    )

    // Ben's memory and conversation, then Ben merges into Ana.
    await json(
      await request('member', `/contacts/${ben.contactId}/facts`, 'POST', {
        text: 'Prefers evenings',
      }),
      201,
    )
    const [chat] = await db
      .insert(conversation)
      .values({
        assistantId: bot.id,
        contactId: ben.contactId,
        resumeTokenHash: crypto.randomUUID(),
      })
      .returning()
    assert.equal(
      (
        await request('member', `/contacts/${ana}/merge`, 'POST', {
          sourceContactId: ana,
        })
      ).status,
      422,
    )
    detail = await json<iContactDetail>(
      await request('member', `/contacts/${ana}/merge`, 'POST', {
        sourceContactId: ben.contactId,
      }),
    )
    assert.equal(detail.contact.name, 'Ana Silva')
    assert(
      detail.identities.some(
        (item) =>
          item.normalizedValue === `ben-${tag}@contacts.example` &&
          item.source === 'merge',
      ),
    )
    assert.deepEqual(
      detail.deals.map((deal) => [deal.id, deal.role]).sort(),
      [
        [first.leadId, 'requester'],
        [second.leadId, 'requester'],
        [ben.leadId, 'requester'],
      ].sort(),
    )
    assert.deepEqual(
      detail.facts.map((fact) => fact.text),
      ['Prefers evenings'],
    )
    assert(detail.conversations.some((item) => item.id === chat.id))
    assert(detail.activities.some((item) => item.kind === 'contacts_merged'))
    assert.equal(
      (await request('member', `/contacts/${ben.contactId}`)).status,
      404,
    )
    const [benLead] = await db
      .select()
      .from(lead)
      .where(eq(lead.id, ben.leadId))
    assert.equal(benLead.contactId, ana)

    // The last way to reach someone stays; removing the display one moves it.
    const solo = await capture({ email: `solo-${tag}@contacts.example` })
    const soloDetail = await json<iContactDetail>(
      await request('member', `/contacts/${solo.contactId}`),
    )
    assert.equal(
      (
        await request(
          'member',
          `/contacts/${solo.contactId}/identities/${soloDetail.identities[0].id}`,
          'DELETE',
        )
      ).status,
      422,
    )
    const primary = detail.identities.find(
      (item) => item.normalizedValue === anaEmail,
    )!
    assert.equal(
      (
        await request(
          'member',
          `/contacts/${ana}/identities/${primary.id}`,
          'DELETE',
        )
      ).status,
      204,
    )
    const [shown] = await db.select().from(contact).where(eq(contact.id, ana))
    assert.equal(shown.normalizedEmail, anaWork)

    // Changes to the people on a lead are logged.
    const { activities } = await json<{
      activities: Array<{ kind: string }>
    }>(await request('member', `/leads/${first.leadId}/activity`))
    assert(
      ['contact_added', 'contact_role_changed'].every((kind) =>
        activities.some((item) => item.kind === kind),
      ),
    )
  } finally {
    boss.send = realSend
    await db.delete(lead).where(eq(lead.organizationId, org))
    await db.delete(conversation).where(eq(conversation.assistantId, bot.id))
    await db.delete(contact).where(eq(contact.organizationId, org))
    server.stop(true)
    providers.server.stop(true)
    await boss.stop()
  }
}, 60_000)
