import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'bun:test'
import { eq } from 'drizzle-orm'
import type {
  iMemberRule,
  iMemberRuleDrafts,
} from '../../src/types/memberRule.types'

// The AI's rules (docs/yourAi.md, "Rules") over HTTP, on the production
// path: the real API, auth, database and model provider (drafting).
test('rules: permissions, order, the chat card, drafting and the prompt', async () => {
  const value = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !value ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname)
  )
    throw new Error('Requires local PostgreSQL')
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
    member,
    memberRule,
    organization,
    workspaceChat,
    workspaceMessage,
    workspaceUiBlock,
  } = await import('../../src/db/schema')
  const { listMemberRules } =
    await import('../../src/services/memberRules/rules')
  const { buildVisitorPrompt } =
    await import('../../src/services/chat/visitorPrompt')

  const org = crypto.randomUUID()
  const otherOrg = crypto.randomUUID()
  await db.insert(organization).values([
    { id: org, name: 'Rules fixture', slug: org },
    { id: otherOrg, name: 'Other rules fixture', slug: otherOrg },
  ])
  for (const role of ['owner', 'admin', 'member'] as const)
    await db.insert(member).values({
      id: crypto.randomUUID(),
      userId: credentials.accounts[role].userId,
      organizationId: org,
      role,
    })
  const [ava] = await db
    .insert(assistant)
    .values({ organizationId: org, name: 'Ava' })
    .returning()

  type tRole = 'owner' | 'admin' | 'member' | 'outsider'
  const call = (role: tRole, path: string, method = 'GET', body?: unknown) =>
    fetch(`${origin}/api${path}`, {
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
  const avaRules = `/organizations/${org}/rules`
  const words = (rules: iMemberRule[]) => rules.map((rule) => rule.text)

  try {
    // (1) Owners and admins add; members read; outsiders get nothing.
    const steps = {
      kind: 'steps',
      text: 'Booking a visit',
      when: 'When someone wants to book a visit',
      steps: ['Ask which day suits them', 'Ask for their address'],
    }
    const added = await json<iMemberRule[]>(
      await call('owner', avaRules, 'POST', {
        rules: [
          { kind: 'rule', text: 'Never mention discounts', tag: 'never' },
          steps,
          { kind: 'rule', text: 'Reply in English' },
        ],
      }),
      201,
    )
    assert.deepEqual(words(added), [
      'Never mention discounts',
      'Booking a visit',
      'Reply in English',
    ])
    assert.deepEqual(added[1].steps, steps.steps)
    assert.equal(added[1].when, steps.when)
    assert.equal(added[0].tag, 'never')
    assert.deepEqual(
      words(await json<iMemberRule[]>(await call('member', avaRules))),
      words(added),
    )
    assert.equal(
      (
        await call('member', avaRules, 'POST', {
          rules: [{ kind: 'rule', text: 'Be brief' }],
        })
      ).status,
      403,
    )
    assert.equal(
      (await call('member', `${avaRules}/${added[0].id}`, 'DELETE')).status,
      403,
    )
    assert.equal((await call('outsider', avaRules)).status, 403)
    // Steps need at least two steps.
    assert.equal(
      (
        await call('admin', avaRules, 'POST', {
          rules: [{ ...steps, steps: ['Only one'] }],
        })
      ).status,
      422,
    )

    // (2) Another workspace's rules are refused, and so is this
    // workspace's rule through another's address.
    assert.equal(
      (await call('owner', `/organizations/${otherOrg}/rules`)).status,
      403,
    )
    assert.equal(
      (
        await call(
          'owner',
          `/organizations/${otherOrg}/rules/${added[0].id}`,
          'PATCH',
          { text: 'Hijack' },
        )
      ).status,
      403,
    )

    // (3) Edit in place; a one-line rule has no steps.
    const edited = await json<iMemberRule[]>(
      await call('admin', `${avaRules}/${added[0].id}`, 'PATCH', {
        text: 'Never mention discounts or offers',
      }),
    )
    assert.equal(edited[0].text, 'Never mention discounts or offers')
    assert.equal(
      (
        await call('admin', `${avaRules}/${added[0].id}`, 'PATCH', {
          steps: ['One', 'Two'],
        })
      ).status,
      422,
    )

    // (4) Reorder: every rule once.
    const ordered = await json<iMemberRule[]>(
      await call('owner', `${avaRules}/order`, 'POST', {
        ids: [added[2].id, added[0].id, added[1].id],
      }),
    )
    assert.deepEqual(
      ordered.map((rule) => rule.id),
      [added[2].id, added[0].id, added[1].id],
    )
    assert.equal(
      (
        await call('owner', `${avaRules}/order`, 'POST', {
          ids: [added[2].id],
        })
      ).status,
      422,
    )

    // (5) The visitor prompt carries the rules and the steps.
    const prompt = buildVisitorPrompt({
      botName: 'Ava',
      goal: 'both',
      goalNotes: null,
      rules: await listMemberRules(org),
      business: null,
      overview: null,
      preview: false,
    })
    assert.match(
      prompt,
      /Your rules \(one per line, quoted\):\n- "Reply in English"\n- "Never mention discounts or offers"/,
    )
    assert.match(
      prompt,
      /"When someone wants to book a visit":\n1\. "Ask which day suits them"\n2\. "Ask for their address"/,
    )

    // (6) Remove.
    const left = await json<iMemberRule[]>(
      await call('owner', `${avaRules}/${added[1].id}`, 'DELETE'),
    )
    assert.deepEqual(words(left), [
      'Reply in English',
      'Never mention discounts or offers',
    ])

    // (7) The chat card: Save adds the drafts once; members can't.
    const [chat] = await db
      .insert(workspaceChat)
      .values({
        userId: credentials.accounts.owner.userId,
        organizationId: org,
        assistantId: ava.id,
      })
      .returning()
    const [said] = await db
      .insert(workspaceMessage)
      .values({
        chatId: chat.id,
        clientMessageId: crypto.randomUUID(),
        role: 'assistant',
        content: 'Here’s how I’ll put it.',
        status: 'completed',
      })
      .returning()
    const [block] = await db
      .insert(workspaceUiBlock)
      .values({
        chatId: chat.id,
        messageId: said.id,
        payload: {
          type: 'ruleDraft',
          status: 'proposed',
          rules: [
            {
              kind: 'rule',
              tag: 'askFirst',
              text: 'Ask for their postcode before a price',
              when: null,
              steps: null,
            },
          ],
        },
        status: 'resolved',
      })
      .returning()
    const cardPath = `/workspace-agent/chats/${chat.id}/blocks/${block.id}/rule-draft`
    assert.equal(
      (await call('member', cardPath, 'POST', { action: 'save' })).status,
      404,
    )
    for (let index = 0; index < 2; index += 1) {
      const saved = await json<{ payload: { status: string } }>(
        await call('owner', cardPath, 'POST', { action: 'save' }),
      )
      assert.equal(saved.payload.status, 'saved')
    }
    assert.deepEqual(
      words(await json<iMemberRule[]>(await call('owner', avaRules))),
      [
        'Reply in English',
        'Never mention discounts or offers',
        'Ask for their postcode before a price',
      ],
    )

    // (8) Drafting steps from the owner's words, with the real model.
    const text =
      'When someone wants to book a visit, first ask which day suits them, then ask for their address, then send them the booking link.'
    assert.equal(
      (await call('member', `${avaRules}/drafts`, 'POST', { text })).status,
      403,
    )
    const drafted = await json<iMemberRuleDrafts>(
      await call('admin', `${avaRules}/drafts`, 'POST', { text }),
    )
    assert.equal(drafted.drafts.length, 1, JSON.stringify(drafted))
    const [draft] = drafted.drafts
    assert.equal(draft.kind, 'steps')
    assert.match(draft.when ?? '', /^When /)
    assert.ok((draft.steps ?? []).length >= 3, JSON.stringify(draft))
  } finally {
    await db.delete(memberRule).where(eq(memberRule.organizationId, org))
    await db.delete(workspaceChat).where(eq(workspaceChat.organizationId, org))
    server.stop(true)
  }
}, 90_000)
