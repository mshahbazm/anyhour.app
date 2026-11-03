import { makeSignature } from 'better-auth/crypto'
import { getAuth } from '../../auth/auth'

// A message from a chat app acts as the team member who linked it, with
// exactly their permissions: the owner assistant's tools call the API with
// a session for that member, as the dashboard does. The session exists only
// on the server for one turn, never leaves it, and is deleted afterwards
// (it would expire within a day anyway).
export async function memberSession(userId: string) {
  const context = await getAuth().$context
  const session = await context.internalAdapter.createSession(userId, true)
  const signature = await makeSignature(session.token, context.secret)
  const headers = new Headers({
    cookie: `${context.authCookies.sessionToken.name}=${session.token}.${signature}`,
  })
  return {
    headers,
    end: () =>
      context.internalAdapter
        .deleteSession(session.token)
        .catch((error: unknown) =>
          console.error(
            'Team chat session cleanup failed',
            error instanceof Error ? error.name : 'Unknown error',
          ),
        ),
  }
}
