import { createFileRoute, redirect } from '@tanstack/react-router'
import { LinkPage } from '#/features/auth/linkPage'
import { getSession } from '#/features/auth/session'

// The one-time "Link your account" link the AI sends in Slack
// (docs/teamChat.md).
export const Route = createFileRoute('/link/$token')({
  beforeLoad: async ({ params }) => {
    const session = await getSession()
    if (!session)
      throw redirect({
        to: '/login',
        search: { error: undefined, linkToken: params.token },
      })
    return { session }
  },
  component: LinkRoute,
})

function LinkRoute() {
  const { token } = Route.useParams()
  const { session } = Route.useRouteContext()
  return <LinkPage token={token} email={session.user.email} />
}
