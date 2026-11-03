import type { tGreeting } from './welcome'

interface iWorkspaceSession {
  chatId: string
  websiteDraft?: string
  knowledgeOpen?: boolean
  greeting?: tGreeting
  draft: string
}
export function readWorkspaceSession(
  email: string,
  organizationId: string | null,
  chatId?: string,
): iWorkspaceSession | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(
        `anyhour:view:${email}:${organizationId ?? 'new'}${chatId ? `:chat:${chatId}` : ''}`,
      ) ?? 'null',
    )
    if (
      !value ||
      typeof value.chatId !== 'string' ||
      typeof value.draft !== 'string' ||
      (value.websiteDraft !== undefined &&
        typeof value.websiteDraft !== 'string') ||
      (value.knowledgeOpen !== undefined &&
        typeof value.knowledgeOpen !== 'boolean')
    )
      return null
    // Greetings from the old chat-based setup are dropped, not the draft.
    return {
      ...value,
      greeting: ['ready', 'return', 'hired'].includes(value.greeting)
        ? value.greeting
        : undefined,
    }
  } catch {
    return null
  }
}
export function saveWorkspaceSession(
  email: string,
  organizationId: string | null,
  value: iWorkspaceSession,
) {
  try {
    sessionStorage.setItem(
      `anyhour:view:${email}:${organizationId ?? 'new'}:chat:${value.chatId}`,
      JSON.stringify(value),
    )
    sessionStorage.setItem(
      `anyhour:view:${email}:${organizationId ?? 'new'}`,
      JSON.stringify(value),
    )
  } catch {
    /* Storage may be unavailable. The current view stays usable. */
  }
}
