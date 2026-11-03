import { createFileRoute, redirect } from '@tanstack/react-router'

// The AI's chat moved to the front page; links to a panel (#website-install)
// keep their hash.
export const Route = createFileRoute('/_workspace/chat')({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: `/${location.hash ? `#${location.hash}` : ''}`,
      replace: true,
    })
  },
})
