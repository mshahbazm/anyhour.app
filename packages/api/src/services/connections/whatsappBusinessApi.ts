import { customerWhatsappConfig } from '../../config/customerWhatsapp.config'
import { openCredentials } from './credentials'
import { ConnectionError } from './errors'
import type { tConnection } from './types'
import type { tWhatsappInteractive } from '../customerWhatsapp/blocks'

// Meta's Graph API calls for the business's WhatsApp number (typed outbound
// actions). Tokens go only in the Authorization header: never in a URL, an
// error message or a log.

export function whatsappBusinessToken(record: tConnection) {
  const token = openCredentials(record.credentialsEncrypted)?.accessToken
  if (!token)
    throw new ConnectionError(
      'The stored WhatsApp token can’t be read. Paste it again.',
      'unauthorized',
    )
  return token
}

// Graph error codes: 190 an expired or revoked token; 4, 80007, 130429 and
// 131056 rate limits; 131047 the 24-hour window has closed.
const tokenErrors = new Set([190])
const rateErrors = new Set([4, 80007, 130429, 131056])
export const windowClosedError = 131047

export class GraphError extends ConnectionError {
  constructor(
    message: string,
    failure: ConnectionError['failure'],
    public code: number | null,
  ) {
    super(message, failure)
  }
}

// Sends per number in the last second, per process.
const recentSends = new Map<string, number[]>()

async function waitForTurn(phoneNumberId: string) {
  const { sendsPerSecond, maxSendWaitMs } = customerWhatsappConfig
  const started = Date.now()
  while (true) {
    const now = Date.now()
    const recent = (recentSends.get(phoneNumberId) ?? []).filter(
      (at) => now - at < 1_000,
    )
    if (recent.length < sendsPerSecond) {
      recent.push(now)
      recentSends.set(phoneNumberId, recent)
      return
    }
    if (now - started > maxSendWaitMs)
      throw new GraphError(
        'Too many WhatsApp messages at once',
        'rateLimited',
        null,
      )
    await Bun.sleep(1_000 - (now - recent[0]) + 5)
  }
}

async function call<T>(
  path: string,
  token: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${customerWhatsappConfig.graphApiUrl}/${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(customerWhatsappConfig.requestTimeoutMs),
    })
  } catch {
    throw new GraphError('WhatsApp could not be reached', 'unavailable', null)
  }
  const data = (await response.json().catch(() => null)) as
    (T & { error?: { message?: string; code?: number } }) | null
  if (response.ok && data && !data.error) return data
  const code = typeof data?.error?.code === 'number' ? data.error.code : null
  const detail =
    typeof data?.error?.message === 'string'
      ? `: ${data.error.message.slice(0, 200)}`
      : ''
  if (response.status === 401 || (code !== null && tokenErrors.has(code)))
    throw new GraphError(
      'Meta no longer accepts the access token. Paste a new one.',
      'unauthorized',
      code,
    )
  if (response.status === 429 || (code !== null && rateErrors.has(code)))
    throw new GraphError(
      'WhatsApp is rate limiting this number',
      'rateLimited',
      code,
    )
  if (response.status === 403)
    throw new GraphError(
      `The access token can’t use this number${detail}`,
      'forbidden',
      code,
    )
  if (response.status >= 500)
    throw new GraphError(
      `WhatsApp is unavailable (${response.status})`,
      'unavailable',
      code,
    )
  throw new GraphError(
    `WhatsApp refused the request${detail}`,
    'rejected',
    code,
  )
}

interface iSent {
  messages?: Array<{ id: string }>
}

const sentId = (data: iSent) => {
  const id = data.messages?.[0]?.id
  if (!id)
    throw new GraphError('WhatsApp didn’t accept the message', 'rejected', null)
  return id
}

export const whatsappBusinessActions = {
  // The number as customers see it and the business's verified name.
  phoneNumber: (phoneNumberId: string, token: string) =>
    call<{ display_phone_number?: string; verified_name?: string }>(
      `${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
      token,
    ),

  // Subscribes our app to the account's webhooks (messages, statuses).
  subscribe: (businessAccountId: string, token: string) =>
    call(`${encodeURIComponent(businessAccountId)}/subscribed_apps`, token, {
      method: 'POST',
    }),

  unsubscribe: (businessAccountId: string, token: string) =>
    call(`${encodeURIComponent(businessAccountId)}/subscribed_apps`, token, {
      method: 'DELETE',
    }),

  async sendText(
    phoneNumberId: string,
    token: string,
    to: string,
    text: string,
  ) {
    await waitForTurn(phoneNumberId)
    return sentId(
      await call<iSent>(
        `${encodeURIComponent(phoneNumberId)}/messages`,
        token,
        {
          method: 'POST',
          body: {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: {
              body: text.slice(0, customerWhatsappConfig.maxTextChars),
              preview_url: false,
            },
          },
        },
      ),
    )
  },

  // Reply buttons or a list message (customerWhatsapp/blocks.ts), inside
  // the 24-hour window only.
  async sendInteractive(
    phoneNumberId: string,
    token: string,
    to: string,
    interactive: tWhatsappInteractive,
  ) {
    await waitForTurn(phoneNumberId)
    return sentId(
      await call<iSent>(
        `${encodeURIComponent(phoneNumberId)}/messages`,
        token,
        {
          method: 'POST',
          body: {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'interactive',
            interactive,
          },
        },
      ),
    )
  },

  // An approved template whose body has one variable, filled with `text`.
  async sendTemplate(
    phoneNumberId: string,
    token: string,
    to: string,
    template: { name: string; language: string },
    text: string,
  ) {
    await waitForTurn(phoneNumberId)
    return sentId(
      await call<iSent>(
        `${encodeURIComponent(phoneNumberId)}/messages`,
        token,
        {
          method: 'POST',
          body: {
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: {
              name: template.name,
              language: { code: template.language },
              components: [
                { type: 'body', parameters: [{ type: 'text', text }] },
              ],
            },
          },
        },
      ),
    )
  },
}
