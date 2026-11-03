import { useCallback, useEffect, useState } from 'react'
import { getConnections } from './api'
import type { iConnectionList } from './api'

const emptyList: iConnectionList = {
  available: {
    slack: false,
    whatsappBusiness: false,
  },
  connections: [],
}

// The business's channels and connections, loaded once for the shell so the
// Channels page, member headers, the Tools tab and the preview panel agree.
export function useChannels(organizationId: string | null) {
  const [list, setList] = useState<iConnectionList | null>(null)
  const refresh = useCallback(async () => {
    if (!organizationId) return
    try {
      setList(await getConnections(organizationId))
    } catch {
      setList(emptyList)
    }
  }, [organizationId])
  useEffect(() => {
    setList(null)
    void refresh()
  }, [refresh])
  return { list, setList, refresh }
}
export type tChannels = ReturnType<typeof useChannels>
