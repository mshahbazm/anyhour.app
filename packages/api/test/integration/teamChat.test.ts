import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { once } from 'node:events'
import { mock, test } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import { startRolesProviders } from '../fixtures/rolesProviders'
import {
  installWorkspaceFixture,
  workspaceFixture,
} from '../fixtures/workspaceModel'
import type { iConnectionList } from '../../src/types/connection.types'
import type { iWhatsappAgents } from '../../src/types/whatsapp.types'

// Employees in the team's chat apps (docs/teamChat.md), against fake Slack
// and WhatsApp servers and the fake owner-assistant model: Slack's signature
// check, the link prompt for unlinked people, a linked member acting with
// their own permissions, held risky actions, and WhatsApp free text next to
// its exact commands.

const sent: Array<{ to: string[]; subject: string }> = []
mock.module('resend', () => ({
  Resend: class {
    emails = {
      send: async (message: { to: string[]; subject: string }) => {
        sent.push(message)
        return { data: { id: crypto.randomUUID() }, error: null }
      },
    }
  },
}))

const signingSecret = 'slack-signing-secret-for-tests'
const botToken = 'xoxb-fake-bot-token'
const team = 'T0TEAMCHAT'

interface iSlackPost {
  method: string
  channel: string
  text: string
  user?: string
  blocks?: Array<{
    type: string
    elements?: Array<{ value: string; text: { text: string } }>
  }>
  thread_ts?: string
}
const slack = { posts: [] as iSlackPost[] }
function startFakeSlack() {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const method = new URL(request.url).pathname.replace('/api/', '')
      if (method === 'oauth.v2.access') {
        const form = new URLSearchParams(await request.text())
        if (form.get('code') !== 'good-code')
          return Response.json({ ok: false, error: 'invalid_code' })
        return Response.json({
          ok: true,
          access_token: botToken,
          bot_user_id: 'UBOT',
          team: { id: team, name: 'Acme Slack' },
        })
      }
      if (request.headers.get('authorization') !== `Bearer ${botToken}`)
        return Response.json({ ok: false, error: 'invalid_auth' })
      if (method === 'conversations.open') {
        const body = (await request.json()) as { users: string }
        return Response.json({ ok: true, channel: { id: `D${body.users}` } })
      }
      if (method === 'chat.postMessage' || method === 'chat.postEphemeral') {
        const body = (await request.json()) as iSlackPost
        slack.posts.push({ ...body, method })
        return Response.json({ ok: true, ts: `${Date.now() / 1000}` })
      }
      return Response.json({ ok: false, error: 'unknown_method' })
    },
  })
}

// A fake WhatsApp Agent Platform with one agent, as in whatsapp.test.ts.
const waKey = 'wa-team-chat-key-0123456789'
const waOwner = 'user:9001'
const whatsapp = {
  outbox: [] as Array<{ id: string; body: string }>,
  updates: [] as Array<Record<string, unknown>>,
}
function startFakeWhatsapp() {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (request.headers.get('authorization') !== `Bearer ${waKey}`)
        return Response.json({ error: { message: 'Invalid' } }, { status: 401 })
      if (url.pathname === '/agent/v1/messages') {
        const body = (await request.json()) as { text: { body: string } }
        const id = `wamid.out.${whatsapp.outbox.length + 1}`
        whatsapp.outbox.push({ id, body: body.text.body })
        return Response.json({ messages: [{ id }] })
      }
      if (url.pathname === '/agent/v1/updates') {
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
function ownerWhatsapps(body: string) {
  whatsapp.updates.push({
    from: waOwner,
    id: `wamid.in.${whatsapp.updates.length + 1}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: 'text',
    text: { body },
  })
}

const fixture = (calls: Array<{ name: string; arguments: object }>) =>
  `fixture:${JSON.stringify(calls)}`

test('team chat apps: signatures, linking, member permissions, confirmations, WhatsApp free text', async () => {
  const value = process.env.DATABASE_URL
  if (
    process.env.NODE_ENV === 'production' ||
    !value ||
    !['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname)
  )
    throw new Error('Requires local PostgreSQL')
  const providers = startRolesProviders()
  Object.assign(process.env, providers.env, {
    NODE_ENV: 'test',
    OPENAI_API_KEY: 'fixture-key',
    SLACK_CLIENT_ID: 'slack-client-id',
    SLACK_CLIENT_SECRET: 'slack-client-secret',
    SLACK_SIGNING_SECRET: signingSecret,
  })
  const fakeSlack = startFakeSlack()
  const fakeWhatsapp = startFakeWhatsapp()
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
  const { teamChatConfig } = await import('../../src/config/teamChat.config')
  teamChatConfig.slackApiUrl = `http://127.0.0.1:${fakeSlack.port}/api`
  const { whatsappConfig } = await import('../../src/config/whatsapp.config')
  Object.assign(whatsappConfig, {
    apiUrl: `http://127.0.0.1:${fakeWhatsapp.port}/agent/v1`,
    sendSpacingMs: 0,
    pollSpacingMs: 0,
  })
  const { app } = await import('../../src/app')
  handle = (request) => app.fetch(request)
  installWorkspaceFixture()
  let modelCalls = 0
  workspaceFixture.onRequest = () => {
    modelCalls += 1
  }
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
    connectionMember,
    member,
    memberRule,
    organization,
    session,
    workspaceAction,
    workspaceChat,
    workspaceMessage,
    whatsappAgent,
  } = await import('../../src/db/schema')
  const { runTeamChatJob } = await import('../../src/services/teamChat/job')
  const { pollWhatsapp } = await import('../../src/services/whatsapp/poller')
  const { getBoss } = await import('../../src/services/queue/boss')
  const boss = await getBoss()

  // Jobs are collected instead of queued, and team-chat jobs run here.
  const jobs: Array<{ name: string; data: Record<string, string> }> = []
  const realSend = boss.send
  boss.send = (async (name: string, data: Record<string, string>) => {
    jobs.push({ name, data })
    return crypto.randomUUID()
  }) as typeof boss.send
  const teamJobs = () => jobs.filter((job) => job.name === 'team-chat')
  async function runTeamJobs() {
    for (const job of teamJobs()) {
      jobs.splice(jobs.indexOf(job), 1)
      await runTeamChatJob(job.data as never)
    }
  }

  const org = crypto.randomUUID()
  await db
    .insert(organization)
    .values({ id: org, name: 'Team chat fixture', slug: org })
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
  const [bot] = await db
    .insert(assistant)
    .values({ organizationId: org, name: 'Ava', status: 'published' })
    .returning()

  type tRole = 'owner' | 'admin' | 'member' | 'outsider'
  const call = (role: tRole, path: string, method = 'GET', body?: unknown) =>
    fetch(`${origin}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        Cookie: credentials.accounts[role].cookie,
        Origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const request = (role: tRole, path: string, method = 'GET', body?: unknown) =>
    call(role, `/api/organizations/${org}${path}`, method, body)
  async function json<T>(response: Response, expected = 200): Promise<T> {
    assert.equal(response.status, expected, await response.clone().text())
    return (await response.json()) as T
  }

  // Signed like Slack does it.
  function toSlack(
    body: string,
    options: { form?: boolean; at?: number; secret?: string } = {},
  ) {
    const at = options.at ?? Math.floor(Date.now() / 1000)
    const signature = `v0=${createHmac(
      'sha256',
      options.secret ?? signingSecret,
    )
      .update(`v0:${at}:${body}`)
      .digest('hex')}`
    return fetch(`${origin}/api/connect/slack/webhook`, {
      method: 'POST',
      headers: {
        'content-type': options.form
          ? 'application/x-www-form-urlencoded'
          : 'application/json',
        'x-slack-request-timestamp': String(at),
        'x-slack-signature': signature,
      },
      body,
    })
  }
  let eventNumber = 0
  const slackDm = (user: string, text: string) =>
    JSON.stringify({
      type: 'event_callback',
      team_id: team,
      event_id: `Ev${(eventNumber += 1)}`,
      event: {
        type: 'message',
        channel_type: 'im',
        channel: `D${user}`,
        user,
        text,
        ts: `${Date.now() / 1000}`,
      },
    })
  const slackTap = (user: string, value: string) =>
    `payload=${encodeURIComponent(
      JSON.stringify({
        type: 'block_actions',
        team: { id: team },
        user: { id: user },
        channel: { id: `D${user}` },
        container: { channel_id: `D${user}` },
        actions: [
          { value, action_ts: `${Date.now() / 1000}${(eventNumber += 1)}` },
        ],
      }),
    )}`
  async function sayInSlack(user: string, text: string) {
    const before = slack.posts.length
    assert.equal((await toSlack(slackDm(user, text))).status, 200)
    await runTeamJobs()
    return slack.posts.slice(before)
  }
  const sharedThreadOf = async (role: 'owner' | 'member') =>
    (
      await db
        .select()
        .from(workspaceChat)
        .where(
          and(
            eq(workspaceChat.userId, credentials.accounts[role].userId),
            eq(workspaceChat.organizationId, org),
            eq(workspaceChat.shared, true),
          ),
        )
    )[0]

  try {
    // (1) Install: owners and admins only; the token is stored encrypted
    // and never shown.
    assert.equal(
      (
        await request('member', '/connections/slack/install', 'POST', {
          assistantId: bot.id,
        })
      ).status,
      403,
    )
    const { url } = await json<{ url: string }>(
      await request('owner', '/connections/slack/install', 'POST', {
        assistantId: bot.id,
      }),
    )
    const state = new URL(url).searchParams.get('state')!
    // Another member can't finish the owner's install.
    const stolen = await call(
      'admin',
      `/api/connect/slack/callback?code=good-code&state=${encodeURIComponent(state)}`,
    )
    assert.equal(stolen.status, 403)
    const back = await call(
      'owner',
      `/api/connect/slack/callback?code=good-code&state=${encodeURIComponent(state)}`,
    )
    assert.equal(back.status, 302)
    assert.equal(
      back.headers.get('location'),
      'http://localhost:3000/channels?connect=slack&result=connected',
    )
    const [record] = await db
      .select()
      .from(connection)
      .where(eq(connection.organizationId, org))
    assert.equal(record.externalAccountId, team)
    assert.equal(record.assistantId, bot.id)
    assert(!record.credentialsEncrypted?.includes(botToken))
    const listed = await json<iConnectionList>(
      await request('member', '/connections'),
    )
    assert.equal(listed.available.slack, true)
    assert.equal(listed.connections[0].accountName, 'Acme Slack')
    assert.equal(listed.connections[0].youLinked, false)
    assert(!JSON.stringify(listed).includes(botToken))

    // (2) Slack signatures: wrong secret, replayed timestamp or none are
    // refused and nothing is stored; a good one answers the URL check.
    const probe = slackDm('UNOBODY', 'hello')
    assert.equal((await toSlack(probe, { secret: 'wrong' })).status, 401)
    assert.equal(
      (await toSlack(probe, { at: Math.floor(Date.now() / 1000) - 600 }))
        .status,
      401,
    )
    const unsigned = await fetch(`${origin}/api/connect/slack/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: probe,
    })
    assert.equal(unsigned.status, 401)
    assert.equal(teamJobs().length, 0)
    const check = await toSlack(
      JSON.stringify({ type: 'url_verification', challenge: 'abc123' }),
    )
    assert.deepEqual(await json(check), { challenge: 'abc123' })

    // (3) An unlinked person gets "Link your account" and nothing else: no
    // model call, no message in any thread.
    const callsBefore = modelCalls
    const toMember = await sayInSlack(
      'UMEMBER',
      fixture([{ name: 'get_workspace', arguments: {} }]),
    )
    assert.equal(toMember.length, 1)
    assert.equal(toMember[0].channel, 'DUMEMBER')
    assert.match(
      toMember[0].text,
      /^Link your account to talk to me here: <http:\/\/localhost:3000\/link\/[\w-]+\|Link your account>\nThe link works once, for 30 minutes\.$/,
    )
    assert.equal(modelCalls, callsBefore)
    assert.equal(await sharedThreadOf('member'), undefined)
    // Slack retrying the same event is handled once.
    const retried = slackDm('UMEMBER', 'again')
    await toSlack(retried)
    await toSlack(retried)
    assert.equal(teamJobs().length, 1)
    await runTeamJobs()
    const link = /\/link\/([\w-]+)\|/.exec(slack.posts.at(-1)!.text)![1]

    // (4) Linking: only someone in the workspace, once.
    assert.equal(
      (await call('outsider', `/api/team-chat/links/${link}`)).status,
      403,
    )
    const preview = await json<{ appName: string; employeeName: string }>(
      await call('member', `/api/team-chat/links/${link}`),
    )
    assert.equal(preview.appName, 'Slack')
    assert.equal(preview.employeeName, 'Ava')
    await json(await call('member', `/api/team-chat/links/${link}`, 'POST'))
    assert.match(slack.posts.at(-1)!.text, /^Linked\./)
    assert.equal(
      (await call('admin', `/api/team-chat/links/${link}`, 'POST')).status,
      404,
    )

    // (5) A linked member's message reaches the owner assistant as that
    // member: an admin-only change is refused by the API, and the thread is
    // the one the dashboard shows.
    const sessionsBefore = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, credentials.accounts.member.userId))
    const replies = await sayInSlack(
      'UMEMBER',
      fixture([
        {
          name: 'update_workspace',
          arguments: { name: 'Renamed from Slack' },
        },
      ]),
    )
    assert.equal(replies.at(-1)?.text, 'Workspace ready.')
    const [orgNow] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, org))
    assert.equal(orgNow.name, 'Team chat fixture')
    const memberThread = await sharedThreadOf('member')
    assert.equal(memberThread.assistantId, bot.id)
    const memberMessages = await db
      .select()
      .from(workspaceMessage)
      .where(eq(workspaceMessage.chatId, memberThread.id))
    assert.deepEqual(
      [...new Set(memberMessages.map((item) => item.via))],
      ['slack'],
    )
    const [refused] = await db
      .select()
      .from(workspaceAction)
      .where(
        and(
          inArray(
            workspaceAction.messageId,
            memberMessages.map((item) => item.id),
          ),
          eq(workspaceAction.name, 'update_workspace'),
        ),
      )
    assert.equal(refused.status, 'failed')
    assert.equal(
      (refused.result as { error?: string }).error,
      'permission_denied',
    )
    const history = await json<{ messages: Array<{ via: string | null }> }>(
      await call('member', `/api/workspace-agent/chats/${memberThread.id}`),
    )
    assert.equal(history.messages.length, 2)
    // The turn's session was removed.
    const sessionsAfter = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, credentials.accounts.member.userId))
    assert.equal(sessionsAfter.length, sessionsBefore.length)

    // (6) Risky actions wait for a button tap: the owner asks to remove a
    // rule, it stays until they tap Yes; another member can't tap it.
    await sayInSlack('UOWNER', 'hi')
    const ownerLink = /\/link\/([\w-]+)\|/.exec(slack.posts.at(-1)!.text)![1]
    await json(await call('owner', `/api/team-chat/links/${ownerLink}`, 'POST'))
    const newRule = async (text: string) => {
      const rules = await json<Array<{ id: string; text: string }>>(
        await request('owner', `/rules`, 'POST', {
          rules: [{ kind: 'rule', text }],
        }),
        201,
      )
      return rules.find((item) => item.text === text)!
    }
    const ruleExists = async (id: string) =>
      (await db.select().from(memberRule).where(eq(memberRule.id, id)))
        .length === 1
    const slackRule = await newRule('Delete me from Slack')
    const asked = await sayInSlack(
      'UOWNER',
      fixture([
        { name: 'delete_member_rule', arguments: { ruleId: slackRule.id } },
      ]),
    )
    assert(await ruleExists(slackRule.id))
    const buttons = asked
      .flatMap((post) => post.blocks ?? [])
      .find((block) => block.type === 'actions')!.elements!
    assert.deepEqual(
      buttons.map((button) => button.text.text),
      ['Yes', 'Cancel'],
    )
    const yes = buttons[0].value
    assert.match(yes, /\|confirm$/)
    const tapped = slack.posts.length
    assert.equal(
      (await toSlack(slackTap('UMEMBER', yes), { form: true })).status,
      200,
    )
    await runTeamJobs()
    assert.equal(
      slack.posts.at(-1)?.text,
      'That choice isn’t open any more. Ask me again.',
    )
    assert(await ruleExists(slackRule.id))
    assert.equal(
      (await toSlack(slackTap('UOWNER', yes), { form: true })).status,
      200,
    )
    await runTeamJobs()
    assert(slack.posts.length > tapped)
    assert.equal(await ruleExists(slackRule.id), false)

    // (7) WhatsApp: messages go to the assistant in the same thread, and a
    // held action needs an exact "yes".
    const agents = await json<iWhatsappAgents>(
      await request('owner', '/whatsapp', 'POST', {
        token: waKey,
        assistantId: bot.id,
      }),
    )
    const agentId = agents.agents[0].id
    const poll = () => pollWhatsapp(agentId, { durationMs: 0 })
    const lastWhatsapp = () => whatsapp.outbox.at(-1)?.body
    ownerWhatsapps('hi')
    await poll()
    assert.match(lastWhatsapp()!, /^Connected\. I’m Ava:/)
    async function sayInWhatsapp(text: string) {
      ownerWhatsapps(text)
      await poll()
      await runTeamJobs()
      return lastWhatsapp()
    }
    assert.equal(await sayInWhatsapp(fixture([])), 'Workspace ready.')
    const ownerThread = await sharedThreadOf('owner')
    const ownerVia = await db
      .select({ via: workspaceMessage.via })
      .from(workspaceMessage)
      .where(eq(workspaceMessage.chatId, ownerThread.id))
    assert.deepEqual([...new Set(ownerVia.map((item) => item.via))].sort(), [
      'slack',
      'whatsapp',
    ])
    const waRule = await newRule('Delete me from WhatsApp')
    const deleteIt = fixture([
      { name: 'delete_member_rule', arguments: { ruleId: waRule.id } },
    ])
    assert.match(
      (await sayInWhatsapp(deleteIt))!,
      /Remove this rule\?\nReply yes to confirm, or cancel\.$/,
    )
    await sayInWhatsapp('yes please')
    assert(await ruleExists(waRule.id))
    await sayInWhatsapp(deleteIt)
    await sayInWhatsapp('Yes')
    assert.equal(await ruleExists(waRule.id), false)
  } finally {
    boss.send = realSend
    workspaceFixture.onRequest = undefined
    await db.delete(whatsappAgent).where(eq(whatsappAgent.organizationId, org))
    await db
      .delete(connectionMember)
      .where(
        inArray(
          connectionMember.connectionId,
          db
            .select({ id: connection.id })
            .from(connection)
            .where(eq(connection.organizationId, org)),
        ),
      )
    await db.delete(connection).where(eq(connection.organizationId, org))
    await db.delete(workspaceChat).where(eq(workspaceChat.organizationId, org))
    await db.delete(memberRule).where(eq(memberRule.organizationId, org))
    server.stop(true)
    fakeSlack.stop(true)
    fakeWhatsapp.stop(true)
    providers.server.stop(true)
    await boss.stop()
  }
}, 120_000)
