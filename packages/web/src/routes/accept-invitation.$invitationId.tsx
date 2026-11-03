import { createFileRoute, redirect } from '@tanstack/react-router'
import { InvitationPage } from '#/features/auth/invitationPage'
import { getSession } from '#/features/auth/session'

export const Route = createFileRoute('/accept-invitation/$invitationId')({
  beforeLoad: async ({ params }) => {
    const session = await getSession()
    if (!session)
      throw redirect({
        to: '/login',
        search: { error: undefined, invitationId: params.invitationId },
      })
    return { session }
  },
  component: AcceptInvitationRoute,
})

function AcceptInvitationRoute() {
  const { invitationId } = Route.useParams()
  const { session } = Route.useRouteContext()
  return (
    <InvitationPage invitationId={invitationId} email={session.user.email} />
  )
}
