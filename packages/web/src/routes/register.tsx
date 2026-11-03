import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthPage } from '#/features/auth/authPage'
import { getSession } from '#/features/auth/session'

export const Route = createFileRoute('/register')({
  validateSearch: (search: Record<string, unknown>) => {
    const result: { invitationId?: string } = {}
    if (typeof search.invitationId === 'string')
      result.invitationId = search.invitationId
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
          : { to: '/' },
      )
  },
  component: RegisterRoute,
})

function RegisterRoute() {
  const { invitationId } = Route.useSearch()
  return <AuthPage mode="register" invitationId={invitationId} />
}
