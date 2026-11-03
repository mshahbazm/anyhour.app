import { useCallback, useEffect, useRef, useState } from 'react'
import { api, isUnavailable, problem } from '../workspace/api'
import type { iSupportAttention } from './types'

export interface iAttention {
  /** Conversations waiting for the team (the inbox). */
  support: iSupportAttention
}

const noSupport: iSupportAttention = {
  conversations: [],
  count: 0,
}

const pollEvery = 60_000

// Where the team is needed: conversations waiting for a person.
// Polled gently (every minute and when the window regains focus) so the
// sidebar count stays honest without hammering the API.
export function useAttention(organizationId: string | null) {
  const [support, setSupport] = useState<iSupportAttention>(noSupport)
  /** False while the server doesn't offer this yet (404/503). */
  const [available, setAvailable] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(organizationId)
  active.current = organizationId

  const refresh = useCallback(async () => {
    if (!organizationId) return
    try {
      const value = await api<iAttention>(
        `/api/organizations/${organizationId}/attention`,
      )
      if (active.current !== organizationId) return
      setSupport(value.support)
      setAvailable(true)
      setError('')
    } catch (cause) {
      if (active.current !== organizationId) return
      if (isUnavailable(cause)) setAvailable(false)
      else setError(problem(cause, 'Couldn’t check what needs you.'))
    } finally {
      if (active.current === organizationId) setLoaded(true)
    }
  }, [organizationId])

  useEffect(() => {
    setSupport(noSupport)
    setLoaded(false)
    void refresh()
    const update = () => {
      if (!document.hidden) void refresh()
    }
    const timer = window.setInterval(update, pollEvery)
    window.addEventListener('focus', update)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', update)
    }
  }, [refresh])

  return {
    support,
    /** The inbox's Needs you count. */
    supportCount: support.count,
    available,
    loaded,
    error,
    refresh,
  }
}

export type tAttentionState = ReturnType<typeof useAttention>
