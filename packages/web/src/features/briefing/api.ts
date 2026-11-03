import { useEffect, useState } from 'react'
import { api, problem } from '../workspace/api'

// Mirrors iMonthStats in packages/api/src/types/stats.types.ts.
export interface iMonthStats {
  monthStart: string
  customersAnswered: number
  outsideHours: number
  leadsCaught: number
  leadsWon: number
  /** Minor units (cents). */
  wonValue: number
  neededYou: number
  answersLearned: number
  /** Null while visitor counts are off. */
  websiteVisitors: number | null
  visitorsChatted: number
}

// `tracking` reloads the numbers when visitor counts are switched.
export function useMonthStats(organizationId: string | null, tracking = false) {
  const [stats, setStats] = useState<iMonthStats | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!organizationId) return
    let current = true
    api<iMonthStats>(`/api/organizations/${organizationId}/stats/month`)
      .then((value) => {
        if (!current) return
        setStats(value)
        setError('')
      })
      .catch((cause: unknown) => {
        if (current) setError(problem(cause, 'Couldn’t load this month.'))
      })
    return () => {
      current = false
    }
  }, [organizationId, tracking])
  return { stats, error }
}
