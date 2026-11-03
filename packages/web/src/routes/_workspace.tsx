import {
  createFileRoute,
  redirect,
  useLocation,
  useParams,
} from '@tanstack/react-router'
import { DashboardPage } from '#/features/dashboard/dashboardPage'
import { getSession } from '#/features/auth/session'
import { viewFromPath } from '#/features/workspace/paths'

type tSession = NonNullable<Awaited<ReturnType<typeof getSession>>>

// Signing out reloads the app, so the session is read once per page load
// rather than on every move between workspace pages.
let known: tSession | null = null

// The workspace shell stays mounted while its pages change, so the chat
// and drafts survive navigation. Child routes only name the page.
export const Route = createFileRoute('/_workspace')({
  beforeLoad: async () => {
    const session = known ?? (known = await getSession())
    if (!session) throw redirect({ to: '/login', search: { error: undefined } })
    return { session }
  },
  component: WorkspaceRoute,
})

function WorkspaceRoute() {
  const { session } = Route.useRouteContext()
  const pathname = useLocation({ select: (location) => location.pathname })
  const params = useParams({ strict: false })
  return (
    <DashboardPage
      name={session.user.name}
      email={session.user.email}
      view={viewFromPath(pathname)}
      sourceId={params.sourceId ?? null}
      conversationId={params.conversationId ?? null}
      leadId={params.leadId ?? null}
      contactId={params.contactId ?? null}
    />
  )
}
