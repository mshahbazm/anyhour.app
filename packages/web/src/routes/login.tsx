import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthPage } from '#/features/auth/authPage'
import { getSession } from '#/features/auth/session'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => {
    const result: {
      error?: string
      invitationId?: string
      linkToken?: string
    } = {}
    if (typeof search.error === 'string') result.error = search.error
    if (typeof search.invitationId === 'string')
      result.invitationId = search.invitationId
    if (typeof search.linkToken === 'string')
      result.linkToken = search.linkToken
    return result
  },
  beforeLoad: async ({ search }) => {
    if (await getSession())
      throw redirect(
        search.invitationId
          ? {
              to: '/accept-invitation/$invitationId',
              params: { invitationId: search.invitationId },
            }
          : search.linkToken
            ? { to: '/link/$token', params: { token: search.linkToken } }
            : { to: '/' },
      )
  },
  component: LoginRoute,
})

function LoginRoute() {
  const { error, invitationId, linkToken } = Route.useSearch()
  return (
    <AuthPage
      mode="login"
      callbackError={Boolean(error)}
      invitationId={invitationId}
      linkToken={linkToken}
    />
  )
}
