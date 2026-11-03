import { teamChatConfig } from '../../config/teamChat.config'
import { ConnectionError } from './errors'

// Slack Web API calls our app makes (typed outbound actions). Slack answers
// HTTP 200 with { ok: false, error } for most failures.

const authErrors = new Set([
  'invalid_auth',
  'not_authed',
  'account_inactive',
  'token_revoked',
  'token_expired',
  'missing_scope',
])
const accessErrors = new Set([
  'channel_not_found',
  'not_in_channel',
  'is_archived',
  'restricted_action',
  'cannot_dm_bot',
])

export interface iSlackBlock {
  type: string
  [key: string]: unknown
}

async function call<T>(
  method: string,
  token: string | null,
  body: Record<string, unknown>,
  form = false,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${teamChatConfig.slackApiUrl}/${method}`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': form
          ? 'application/x-www-form-urlencoded'
          : 'application/json; charset=utf-8',
      },
      body: form
        ? new URLSearchParams(body as Record<string, string>).toString()
        : JSON.stringify(body),
      signal: AbortSignal.timeout(teamChatConfig.requestTimeoutMs),
    })
  } catch {
    throw new ConnectionError('Slack could not be reached', 'unavailable')
  }
  if (response.status === 429)
    throw new ConnectionError('Slack is rate limiting us', 'rateLimited')
  if (response.status >= 500)
    throw new ConnectionError(
      `Slack is unavailable (${response.status})`,
      'unavailable',
    )
  const data = (await response.json().catch(() => null)) as
    ({ ok?: boolean; error?: string } & T) | null
  if (!data?.ok) {
    const code = data?.error ?? `http_${response.status}`
    if (authErrors.has(code))
      throw new ConnectionError(
        `Slack no longer accepts our app (${code}). Reconnect Slack.`,
        'unauthorized',
      )
    if (accessErrors.has(code))
      throw new ConnectionError(
        `Slack refused the message (${code})`,
        'forbidden',
      )
    if (code === 'ratelimited')
      throw new ConnectionError('Slack is rate limiting us', 'rateLimited')
    throw new ConnectionError(
      `Slack rejected the request (${code})`,
      'rejected',
    )
  }
  return data
}

export const slackActions = {
  // OAuth: the install's bot token, team and our bot user.
  exchangeCode: (input: {
    code: string
    clientId: string
    clientSecret: string
    redirectUri: string
  }) =>
    call<{
      access_token: string
      bot_user_id?: string
      team?: { id: string; name?: string }
    }>(
      'oauth.v2.access',
      null,
      {
        code: input.code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
      },
      true,
    ),

  postMessage: (
    token: string,
    message: {
      channel: string
      text: string
      blocks?: iSlackBlock[]
      thread_ts?: string | null
    },
  ) =>
    call<{ ts: string; channel: string }>('chat.postMessage', token, {
      ...message,
      thread_ts: message.thread_ts ?? undefined,
      unfurl_links: false,
    }),

  // Only `user` sees it: used for link prompts in shared channels.
  postEphemeral: (
    token: string,
    message: {
      channel: string
      user: string
      text: string
      thread_ts?: string | null
    },
  ) =>
    call<{ message_ts: string }>('chat.postEphemeral', token, {
      ...message,
      thread_ts: message.thread_ts ?? undefined,
    }),

  openDm: async (token: string, user: string) =>
    (
      await call<{ channel: { id: string } }>('conversations.open', token, {
        users: user,
      })
    ).channel.id,

  listChannels: async (token: string) =>
    (
      await call<{
        channels: Array<{ id: string; name: string; is_member?: boolean }>
      }>(
        'conversations.list',
        token,
        {
          types: 'public_channel,private_channel',
          exclude_archived: 'true',
          limit: '200',
        },
        true,
      )
    ).channels,

  revoke: (token: string) => call('auth.revoke', token, {}),
}
