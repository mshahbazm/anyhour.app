import { env } from '../../env'
import { ApiError } from '../http/apiError'
import type { tApiDispatch } from '../../types/workspaceAgent.types'

// Only fixed, code-owned paths reach this client. Credentials never enter SDK context.
export function createWorkspaceApiClient(
  headers: Headers,
  dispatch: tApiDispatch,
  signal?: AbortSignal,
) {
  const cookie = headers.get('cookie') ?? ''
  return async function request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    onResponse?: (response: Response) => void,
  ): Promise<T> {
    signal?.throwIfAborted()
    const response = await dispatch(
      new Request(`http://workspace.internal${path}`, {
        method,
        headers: {
          cookie,
          origin: env.FRONT_END_URL,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      }),
    )
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string } & Record<string, unknown>
        message?: string
      } | null
      const { code, message, ...details } = payload?.error ?? {}
      throw new ApiError(
        (response.status >= 500 ? 503 : response.status) as
          400 | 401 | 403 | 404 | 409 | 422 | 429 | 503,
        code ?? 'action_failed',
        message ?? payload?.message ?? 'The requested action failed',
        // Extra fields, such as the contact that already has an email.
        Object.keys(details).length ? details : undefined,
      )
    }
    onResponse?.(response)
    return response.status === 204
      ? (undefined as T)
      : ((await response.json()) as T)
  }
}
