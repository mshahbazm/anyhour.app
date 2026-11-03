import { useCallback, useEffect, useState } from 'react'
import { api } from '../workspace/api'

export interface iInstallSighting {
  origin: string
  /** working: chat loads; notAllowed: site not on the list; notLive: bot offline. */
  status: 'working' | 'notAllowed' | 'notLive'
  firstSeenAt: string
  lastSeenAt: string
}

// Where the chat code has been seen loading. Refreshes while open, so the
// status updates by itself after the owner adds the code and opens their site.
export function useInstalls(organizationId: string | null, botId?: string) {
  const [installs, setInstalls] = useState<iInstallSighting[]>([])
  const refresh = useCallback(async () => {
    if (!organizationId || !botId) return setInstalls([])
    setInstalls(
      await api<iInstallSighting[]>(
        `/api/organizations/${organizationId}/assistants/${botId}/installs`,
      ),
    )
  }, [organizationId, botId])
  useEffect(() => {
    const update = () => void refresh().catch(() => undefined)
    update()
    const timer = window.setInterval(() => {
      if (!document.hidden) update()
    }, 15_000)
    window.addEventListener('focus', update)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', update)
    }
  }, [refresh])
  return { installs, refresh }
}
