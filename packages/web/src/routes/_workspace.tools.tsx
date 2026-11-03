import { createFileRoute, redirect } from '@tanstack/react-router'

// My tools became Channels. Slack still comes back here after an install,
// so the query (?connect=…&result=…) goes along.
export const Route = createFileRoute('/_workspace/tools')({
  beforeLoad: ({ location }) => {
    throw redirect({ href: `/channels${location.searchStr}`, replace: true })
  },
})
