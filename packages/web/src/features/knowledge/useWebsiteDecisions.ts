import { useCallback, useEffect, useState } from 'react'
import { api } from '../workspace/api'
import type { iWebsiteDecision } from '../workspace/types'

// Pages that changed and now disagree with a fact the owner told the bot.
// The bot keeps the owner's version until they decide here or in chat.
export function useWebsiteDecisions(base: string | null) {
  const [decisions, setDecisions] = useState<iWebsiteDecision[]>([])

  const refresh = useCallback(async () => {
    if (!base) {
      setDecisions([])
      return
    }
    setDecisions(await api<iWebsiteDecision[]>(`${base}/decisions`))
  }, [base])

  useEffect(() => {
    setDecisions([])
    const update = () => void refresh().catch(() => undefined)
    update()
    window.addEventListener('focus', update)
    return () => window.removeEventListener('focus', update)
  }, [refresh])

  const resolve = useCallback(
    async (id: string, decision: 'keep' | 'useWebsite') => {
      if (!base) return
      await api(`${base}/decisions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ decision }),
      })
      setDecisions((items) => items.filter((item) => item.id !== id))
    },
    [base],
  )

  return { decisions, refresh, resolve }
}
