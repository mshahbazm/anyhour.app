import { createFileRoute } from '@tanstack/react-router'
import { inboxFilters } from '#/features/conversations/types'
import type { tInboxFilter } from '#/features/conversations/types'

// Rendered by the workspace shell in _workspace.tsx. ?filter= opens the
// inbox on one filter (from the month's numbers).
export const Route = createFileRoute('/_workspace/conversations/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { filter?: tInboxFilter } =>
    inboxFilters.find((item) => item === search.filter)
      ? { filter: search.filter as tInboxFilter }
      : {},
})
