import type { iChatBlock } from './types'

export const apiOrigin = import.meta.env.VITE_API_URL || 'http://localhost:3001'
// Where the separately deployed website widget (packages/widget) is hosted.
export const widgetOrigin =
  import.meta.env.VITE_WIDGET_URL || 'http://localhost:3002'

// A failed request, with its HTTP status so callers can tell "not built yet"
// (404/503) from a real problem.
export class ApiError extends Error {
  status: number
  /** The server's machine-readable reason, e.g. "invalid_status". */
  code: string | null
  /** The server's error object, for reasons that carry more, e.g. who. */
  detail: Record<string, unknown>
  constructor(
    message: string,
    status: number,
    code: string | null = null,
    detail: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

/**
 * The endpoint doesn't exist on this server yet, or is switched off. A 404 or
 * 503 with a reason ("lead_missing", "email_failed") is a real answer about
 * this request, not this.
 */
export function isUnavailable(cause: unknown) {
  return (
    cause instanceof ApiError &&
    (cause.status === 503 || cause.status === 404) &&
    !cause.code
  )
}

/** One calm sentence for a failed request. */
export function problem(cause: unknown, fallback: string) {
  // fetch() itself failed: offline, or the server is restarting.
  if (cause instanceof TypeError)
    return 'I can’t reach the server right now. Try again in a moment.'
  return cause instanceof Error && cause.message ? cause.message : fallback
}

export async function apiResponse(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiOrigin}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body instanceof FormData
        ? {}
        : { 'content-type': 'application/json' }),
      ...init.headers,
    },
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string; code?: string } & Record<string, unknown>
      message?: string
    } | null
    throw new ApiError(
      payload?.error?.message ??
        payload?.message ??
        `Request failed (${response.status})`,
      response.status,
      payload?.error?.code ?? null,
      payload?.error ?? {},
    )
  }
  return response
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiResponse(path, init)
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T)
}

export interface iStreamEvent {
  messageId?: string
  block?: iChatBlock
  type?: string
  organizationId?: string | null
  assistantId?: string | null
  text?: string
  sourceId?: string
  id?: string
  name?: string
  status?: string
  message?: string
  code?: string
  citations?: Array<{
    sourceId: string
    title: string | null
    url: string | null
  }>
}
export async function readEvents(
  response: Response,
  onEvent: (event: string, data: iStreamEvent) => void,
) {
  if (!response.body) throw new Error('The response stream is unavailable')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let terminal = false
  try {
    let finished = false
    while (!finished) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n')
      let separator: number
      while ((separator = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        const event =
          block
            .split('\n')
            .find((line) => line.startsWith('event:'))
            ?.slice(6)
            .trim() ?? 'message'
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (!data) continue
        const parsed: unknown = JSON.parse(data)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('Invalid stream event')
        onEvent(event, parsed)
        if (event === 'done' || event === 'error') terminal = true
      }
      finished = done
    }
    if (!terminal)
      throw new Error('Connection interrupted. Reloading saved results…')
  } finally {
    reader.releaseLock()
  }
}
