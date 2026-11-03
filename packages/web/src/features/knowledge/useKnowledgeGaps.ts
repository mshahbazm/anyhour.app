import { useCallback, useEffect, useState } from 'react'
import { api } from '../workspace/api'
import type { iKnowledgeGap } from '../workspace/types'

// Questions the bot can't answer yet. They close by themselves once its
// knowledge answers them, so the list is re-read when the owner comes back.
export function useKnowledgeGaps(base: string | null) {
  const [gaps, setGaps] = useState<iKnowledgeGap[]>([])

  const refresh = useCallback(async () => {
    if (!base) {
      setGaps([])
      return
    }
    setGaps(await api<iKnowledgeGap[]>(`${base}/gaps`))
  }, [base])

  useEffect(() => {
    setGaps([])
    const update = () => void refresh().catch(() => undefined)
    update()
    window.addEventListener('focus', update)
    return () => window.removeEventListener('focus', update)
  }, [refresh])

  const dismiss = useCallback(
    async (id: string) => {
      if (!base) return
      setGaps((items) => items.filter((item) => item.id !== id))
      await api(`${base}/gaps/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'dismissed' }),
      }).catch(() => refresh())
    },
    [base, refresh],
  )

  return { gaps, refresh, dismiss }
}
