import { whatsappConfig } from '../../config/whatsapp.config'

// The WhatsApp Agent Platform API: send a text to the agent's creator and
// long-poll for their messages. Callers own rate limiting and storage.

export interface iInboundMessage {
  from: string
  id: string
  // Unix seconds, as a string.
  timestamp: string
  type: string
  text?: { body: string }
  // Present when the owner replied to a specific message (an alert).
  context?: { id: string; from?: string }
}

// unauthorized: the key is no longer valid (regenerated, or WhatsApp was
// reinstalled). busy: another poll is running for this agent. Everything
// else is either worth retrying later (rate limited, unavailable) or not.
export type tWhatsappFailure =
  | 'unauthorized'
  | 'forbidden'
  | 'busy'
  | 'rateLimited'
  | 'unavailable'
  | 'rejected'

export class WhatsappError extends Error {
  constructor(
    message: string,
    public failure: tWhatsappFailure,
    public status: number | null,
  ) {
    super(message)
    this.name = 'WhatsappError'
  }

  // Trying the same request again won't help.
  get permanent() {
    return ['unauthorized', 'forbidden', 'rejected'].includes(this.failure)
  }
}

async function errorFor(response: Response) {
  let detail = ''
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown; code?: unknown }
    }
    if (typeof body.error?.message === 'string')
      detail = body.error.message.slice(0, 200)
  } catch {
    // Not JSON; the status says enough.
  }
  const status = response.status
  if (status === 401)
    return new WhatsappError(
      'WhatsApp no longer accepts this agent’s key. It was regenerated or WhatsApp was reinstalled.',
      'unauthorized',
      status,
    )
  if (status === 403)
    return new WhatsappError(
      `WhatsApp refused the message${detail ? `: ${detail}` : ''}`,
      'forbidden',
      status,
    )
  if (status === 409)
    return new WhatsappError(
      'Another poll is running for this agent',
      'busy',
      status,
    )
  if (status === 429)
    return new WhatsappError(
      'WhatsApp is rate limiting this agent',
      'rateLimited',
      status,
    )
  if (status >= 500)
    return new WhatsappError(
      `WhatsApp is unavailable (${status})`,
      'unavailable',
      status,
    )
  return new WhatsappError(
    `WhatsApp rejected the request (${status}${detail ? `: ${detail}` : ''})`,
    'rejected',
    status,
  )
}

async function call(
  path: string,
  token: string,
  init: RequestInit,
  timeoutMs: number,
) {
  try {
    return await fetch(`${whatsappConfig.apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new WhatsappError(
      'WhatsApp could not be reached',
      'unavailable',
      null,
    )
  }
}

// Sends a text to the owner (`user:<id>`). Returns WhatsApp's message id.
export async function sendText(token: string, to: string, body: string) {
  const text =
    body.length > whatsappConfig.maxTextChars
      ? `${body.slice(0, whatsappConfig.maxTextChars - 1)}…`
      : body
  const response = await call(
    '/messages',
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    },
    whatsappConfig.requestTimeoutMs,
  )
  if (!response.ok) throw await errorFor(response)
  const data = (await response.json().catch(() => null)) as {
    messages?: { id?: unknown }[]
  } | null
  const id = data?.messages?.[0]?.id
  if (typeof id !== 'string')
    throw new WhatsappError(
      'WhatsApp didn’t confirm the message',
      'unavailable',
      response.status,
    )
  return id
}

// One long poll. Null when nothing new arrived (204); re-poll with the same
// offset. nextOffset is passed back unchanged on the next call.
export async function getUpdates(
  token: string,
  offset: string,
  timeoutSeconds: number,
): Promise<{ messages: iInboundMessage[]; nextOffset: string | null } | null> {
  const timeout = Math.max(0, Math.min(25, Math.floor(timeoutSeconds)))
  const query = new URLSearchParams({
    offset,
    limit: String(whatsappConfig.updatesPerPoll),
    timeout: String(timeout),
  })
  const response = await call(
    `/updates?${query}`,
    token,
    { method: 'GET' },
    (timeout + 5) * 1000,
  )
  if (response.status === 204) return null
  if (!response.ok) throw await errorFor(response)
  const data = (await response.json().catch(() => null)) as {
    entry?: { changes?: { value?: { messages?: iInboundMessage[] } }[] }[]
    next_offset?: unknown
  } | null
  const messages =
    data?.entry?.flatMap(
      (entry) =>
        entry.changes?.flatMap((change) => change.value?.messages ?? []) ?? [],
    ) ?? []
  const next = data?.next_offset
  return {
    messages: messages.filter(
      (item) => typeof item?.id === 'string' && typeof item.from === 'string',
    ),
    nextOffset:
      typeof next === 'number' || typeof next === 'string'
        ? String(next)
        : null,
  }
}
