import { useCallback, useEffect, useState } from 'react'
import { apiResponse } from './api'
import type { iLead } from './types'

export interface iBotActivity {
  newLeads: number
  /** The newest new leads, newest first, for the briefing. */
  latestNew: iLead[]
  conversations: number
}

// Counts for the sidebar and the AI's welcome-back summary.
export function useBotActivity(
  organizationId: string | null,
  assistantId: string | null,
) {
  const [activity, setActivity] = useState<iBotActivity | null>(null)

  const refresh = useCallback(async () => {
    if (!organizationId || !assistantId) {
      setActivity(null)
      return
    }
    const [leads, conversations] = await Promise.all([
      apiResponse(
        `/api/organizations/${organizationId}/leads?status=new&limit=200`,
      ).then((response) => response.json() as Promise<iLead[]>),
      apiResponse(
        `/api/organizations/${organizationId}/assistants/${assistantId}/conversations?limit=200`,
      ).then((response) => response.json() as Promise<unknown[]>),
    ])
    setActivity({
      newLeads: leads.length,
      latestNew: leads.slice(0, 3),
      conversations: conversations.length,
    })
  }, [organizationId, assistantId])

  useEffect(() => {
    setActivity(null)
    // Members without lead access still get a working workspace.
    const update = () => void refresh().catch(() => undefined)
    update()
    window.addEventListener('focus', update)
    return () => window.removeEventListener('focus', update)
  }, [refresh])

  return { activity, refresh }
}
