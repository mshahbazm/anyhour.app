import { createFileRoute } from '@tanstack/react-router'
import { leadStatuses } from '#/features/leads/status'
import type { tLeadStatus } from '#/features/leads/status'

// Rendered by the workspace shell in _workspace.tsx. ?status= opens the
// list on one status, or open (from the month's numbers).
export const Route = createFileRoute('/_workspace/leads/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { status?: 'open' | tLeadStatus } => {
    const status = ['open', ...leadStatuses].find(
      (item) => item === search.status,
    )
    return status ? { status: status as 'open' | tLeadStatus } : {}
  },
})
