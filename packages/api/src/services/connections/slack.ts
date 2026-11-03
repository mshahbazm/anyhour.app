import { createHmac, timingSafeEqual } from 'node:crypto'
import { teamChatConfig } from '../../config/teamChat.config'
import { env } from '../../env'
import { handleSlackEvent } from '../teamChat/slack'
import { openCredentials } from './credentials'
import { ConnectionError } from './errors'
import { slackActions } from './slackApi'
import type { iConnectionProvider, iProviderEvent, tConnection } from './types'

// Slack: our Slack app, installed per Slack workspace with OAuth. Its Events
// API and interactivity (button taps) post to /api/connect/slack/webhook,
// signed with our signing secret (docs/teamChat.md).

export const slackRedirectUri = () =>
  `${env.BETTER_AUTH_URL}/api/connect/slack/callback`

export function slackToken(record: tConnection) {
  const token = openCredentials(record.credentialsEncrypted)?.botToken
  if (!token)
    throw new ConnectionError(
      'The stored Slack token can’t be read. Reconnect Slack.',
      'unauthorized',
    )
  return token
}

// v0=HMAC-SHA256(signing secret, "v0:<timestamp>:<body>"), within 5 minutes.
function verifySlack(headers: Headers, rawBody: string) {
  const secret = env.SLACK_SIGNING_SECRET
  const timestamp = headers.get('x-slack-request-timestamp')
  const signature = headers.get('x-slack-signature')
  if (!secret || !timestamp || !signature) return false
  const seconds = Number(timestamp)
  if (
    !Number.isFinite(seconds) ||
    Math.abs(Date.now() / 1000 - seconds) > teamChatConfig.slackSignatureSeconds
  )
    return false
  const expected = Buffer.from(
    `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`,
  )
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

interface iSlackEvent {
  type?: string
  user?: string
  bot_id?: string
  subtype?: string
  channel?: string
  channel_type?: string
  text?: string
  ts?: string
  thread_ts?: string
}

interface iSlackAction {
  type?: string
  team?: { id?: string }
  user?: { id?: string }
  channel?: { id?: string }
  container?: { channel_id?: string; message_ts?: string; thread_ts?: string }
  message?: { thread_ts?: string; ts?: string }
  actions?: Array<{ value?: string; action_ts?: string }>
}

const ack = () => new Response(null, { status: 200 })

function parseSlack(headers: Headers, rawBody: string) {
  // Button taps arrive form-encoded as payload=<json>.
  if (
    headers.get('content-type')?.includes('application/x-www-form-urlencoded')
  ) {
    const payload = JSON.parse(
      new URLSearchParams(rawBody).get('payload') ?? '{}',
    ) as iSlackAction
    const action = payload.actions?.[0]
    const user = payload.user?.id
    const team = payload.team?.id
    const channel = payload.channel?.id ?? payload.container?.channel_id
    if (
      payload.type !== 'block_actions' ||
      !action?.value ||
      !user ||
      !team ||
      !channel
    )
      return { events: [], ack: ack() }
    const event: iProviderEvent = {
      externalAccountId: team,
      externalEventId: `action:${action.action_ts ?? payload.container?.message_ts}:${user}`,
      kind: 'action',
      externalUserId: user,
      payload: {
        user,
        channel,
        threadTs:
          payload.message?.thread_ts ?? payload.container?.thread_ts ?? null,
        value: action.value,
        ts: action.action_ts ?? null,
        direct: channel.startsWith('D'),
      },
    }
    return { events: [event], ack: ack() }
  }
  const body = JSON.parse(rawBody) as {
    type?: string
    challenge?: string
    team_id?: string
    event_id?: string
    event?: iSlackEvent
  }
  if (body.type === 'url_verification')
    return { respond: Response.json({ challenge: body.challenge ?? '' }) }
  const event = body.event
  if (
    body.type !== 'event_callback' ||
    !event ||
    !body.team_id ||
    !body.event_id
  )
    return { events: [], ack: ack() }
  const base = {
    externalAccountId: body.team_id,
    externalEventId: body.event_id,
  }
  if (event.type === 'app_uninstalled' || event.type === 'tokens_revoked')
    return {
      events: [
        {
          ...base,
          kind: 'uninstalled' as const,
          externalUserId: null,
          payload: {},
        },
      ],
      ack: ack(),
    }
  const direct = event.type === 'message' && event.channel_type === 'im'
  const mention = event.type === 'app_mention'
  // Our own and other bots' messages, edits and joins are ignored.
  if (
    (!direct && !mention) ||
    event.bot_id ||
    event.subtype ||
    !event.user ||
    !event.channel ||
    !event.ts
  )
    return { events: [], ack: ack() }
  return {
    events: [
      {
        ...base,
        kind: 'message' as const,
        externalUserId: event.user,
        payload: {
          user: event.user,
          channel: event.channel,
          text: event.text ?? '',
          ts: event.ts,
          // In a channel the reply goes in a thread under their message.
          threadTs: event.thread_ts ?? (mention ? event.ts : null),
          direct,
        },
      },
    ],
    ack: ack(),
  }
}

export const slackProvider: iConnectionProvider = {
  id: 'slack',
  available: () =>
    Boolean(
      env.SLACK_CLIENT_ID &&
      env.SLACK_CLIENT_SECRET &&
      env.SLACK_SIGNING_SECRET,
    ),
  installUrl: (state) =>
    `${teamChatConfig.slackAuthorizeUrl}?${new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID ?? '',
      scope: teamChatConfig.slackScopes.join(','),
      redirect_uri: slackRedirectUri(),
      state,
    })}`,
  async connect(code) {
    const result = await slackActions.exchangeCode({
      code,
      clientId: env.SLACK_CLIENT_ID ?? '',
      clientSecret: env.SLACK_CLIENT_SECRET ?? '',
      redirectUri: slackRedirectUri(),
    })
    if (!result.team?.id || !result.access_token)
      throw new ConnectionError('Slack didn’t finish the install', 'rejected')
    return {
      externalAccountId: result.team.id,
      settings: {
        accountName: result.team.name ?? null,
        botUserId: result.bot_user_id ?? null,
        alertsChannelId: null,
        alertsChannelName: null,
      },
      credentials: { botToken: result.access_token },
    }
  },
  verifyWebhook: verifySlack,
  parseWebhook: parseSlack,
  handleEvent: handleSlackEvent,
  async channels(record) {
    const channels = await slackActions.listChannels(slackToken(record))
    return channels
      .map((channel) => ({ id: channel.id, name: `#${channel.name}` }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },
  async disconnect(record) {
    await slackActions.revoke(slackToken(record))
  },
}
